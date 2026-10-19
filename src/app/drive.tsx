import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createDriveBackup, type DriveFile } from '../data/driveBackup';
import { importArchive } from '../domain/archive';
import { countChanges } from '../domain/changes';
import i18n, { categoryName } from '../i18n';
import { forgetToken, goToGoogle, GOOGLE_CLIENT_ID, storedToken, type Arrival } from './googleDrive';
import { ImportFlow } from './ImportFlow';
import { useStore } from './store';

/** How long after the last change the automatic save waits, so a burst of edits is one upload. */
const SAVE_DELAY_MS = 5000;

/**
 * - `unavailable`: the build has no Google client ID, so nothing is shown.
 * - `disconnected`: never connected on this device, or Disconnect was used.
 * - `expired`: connected before, but the token has run out; saving waits for Reconnect.
 * - `connected`: saves automatically.
 */
export type DriveStatus = 'unavailable' | 'disconnected' | 'expired' | 'connected';

export interface Drive {
  status: DriveStatus;
  /** Set when Drive holds a copy another device saved: automatic saving stops until the user chooses. */
  conflict: DriveFile | null;
  busy: boolean;
  connect: () => void;
  disconnect: () => Promise<void>;
  /** Saves now. `replace` overwrites the other device's copy (the answer to a conflict). */
  saveNow: (replace?: boolean) => Promise<void>;
  /** Downloads the Drive copy and opens the import preview. */
  restore: () => Promise<void>;
}

const DriveContext = createContext<Drive | null>(null);

export function useDrive(): Drive {
  const drive = useContext(DriveContext);
  if (!drive) throw new Error('useDrive must be used inside <DriveProvider>');
  return drive;
}

function statusNow(): DriveStatus {
  if (!GOOGLE_CLIENT_ID) return 'unavailable';
  const token = storedToken();
  if (!token) return 'disconnected';
  return token.expiresAt > Date.now() ? 'connected' : 'expired';
}

/** What the toast says after loading a newer copy: how many Transactions came and went. */
function loadedMessage(added: number, removed: number): string {
  if (added > 0 && removed > 0) return i18n.t('drive.loadedBoth', { added, removed });
  if (added > 0) return i18n.t('drive.loadedAdded', { count: added });
  if (removed > 0) return i18n.t('drive.loadedRemoved', { count: removed });
  return i18n.t('drive.loadedNewer');
}

export function DriveProvider({ arrival, children }: { arrival: Arrival; children: ReactNode }) {
  const store = useStore();
  const [status, setStatus] = useState<DriveStatus>(statusNow);
  const [conflict, setConflict] = useState<DriveFile | null>(null);
  const [busy, setBusy] = useState(false);
  const [restoring, setRestoring] = useState<{ bytes: Uint8Array; file: DriveFile } | null>(null);
  const running = useRef(false);
  // The latest store, for saves that finish after a re-render.
  const storeRef = useRef(store);
  storeRef.current = store;

  // Flip to `expired` when the token runs out, so the UI and the automatic save notice.
  useEffect(() => {
    const token = storedToken();
    if (status !== 'connected' || !token) return;
    const timer = window.setTimeout(() => setStatus(statusNow()), Math.max(0, token.expiresAt - Date.now()));
    return () => window.clearTimeout(timer);
  }, [status]);

  const save = useCallback(async (manual: boolean, replace: DriveFile | null = null) => {
    const token = storedToken();
    if (!token) return;
    if (running.current) {
      // A check of Drive is under way: try again once it is done.
      window.setTimeout(() => void save(manual, replace), 1000);
      return;
    }
    running.current = true;
    if (manual) setBusy(true);
    try {
      const s = storeRef.current;
      const included = { backup: s.settings.changesSinceBackup, drive: s.settings.changesSinceDrive };
      const result = await createDriveBackup(token.token).save(await s.buildArchive(), replace ?? s.settings.driveFile);
      if (result.kind === 'saved') {
        setConflict(null);
        await storeRef.current.recordDriveSave(result.file, included);
        if (manual) s.notify({ kind: 'success', message: i18n.t('drive.saved') });
      } else if (result.kind === 'conflict') {
        setConflict(result.remote);
        s.notify({ kind: 'info', message: i18n.t('drive.conflictToast') });
      } else if (result.kind === 'expired') {
        setStatus('expired');
        if (manual) s.notify({ kind: 'error', message: i18n.t('drive.expiredToast') });
      } else if (manual) {
        s.notify({ kind: 'error', message: i18n.t('drive.failed') });
      }
    } finally {
      running.current = false;
      if (manual) setBusy(false);
    }
  }, []);

  /**
   * On open and on coming back: if Drive holds a copy this device has not seen, load it when this device has
   * nothing unsaved, otherwise show the conflict choice. Only the version is fetched unless a load is needed.
   */
  const check = useCallback(async () => {
    const token = storedToken();
    const known = storeRef.current.settings.driveFile;
    // A device never linked to Drive is handled by its first save (which asks if Drive already has a copy).
    if (!token || token.expiresAt <= Date.now() || running.current || !known || !storeRef.current.settings.onboarded) return;
    running.current = true;
    const unsaved = () => storeRef.current.settings.changesSinceDrive > 0;
    const conflictWith = (file: DriveFile) => {
      setConflict(file);
      storeRef.current.notify({ kind: 'info', message: i18n.t('drive.conflictToast') });
    };
    try {
      const backup = createDriveBackup(token.token);
      const latest = await backup.latest();
      if (latest.kind === 'expired') setStatus('expired');
      if (latest.kind !== 'found' || (latest.file.id === known.id && latest.file.modifiedTime === known.modifiedTime)) return;
      if (unsaved()) return conflictWith(latest.file);
      const loaded = await backup.load();
      if (loaded.kind !== 'loaded') return;
      const archive = importArchive(loaded.bytes);
      // A damaged copy is left alone; this device's data stays as it is.
      if (!archive.ok || archive.preview.fatal) return;
      // Edited while downloading: ask instead.
      if (unsaved()) return conflictWith(loaded.file);
      const { added, removed } = countChanges(storeRef.current.data, archive.preview.data, categoryName);
      await storeRef.current.applyImport(
        archive.preview.data,
        archive.preview.rules,
        { settings: archive.settings, photos: archive.attachments, driveFile: loaded.file },
        { automatic: true, message: loadedMessage(added, removed) },
      );
    } finally {
      running.current = false;
    }
  }, []);

  const restore = useCallback(async () => {
    const token = storedToken();
    if (!token || token.expiresAt <= Date.now()) {
      goToGoogle('restore');
      return;
    }
    setBusy(true);
    try {
      const result = await createDriveBackup(token.token).load();
      if (result.kind === 'loaded') setRestoring({ bytes: result.bytes, file: result.file });
      else if (result.kind === 'empty') storeRef.current.notify({ kind: 'info', message: i18n.t('drive.nothingToRestore') });
      else if (result.kind === 'expired') goToGoogle('restore');
      else storeRef.current.notify({ kind: 'error', message: i18n.t('drive.failed') });
    } finally {
      setBusy(false);
    }
  }, []);

  // Back from Google: carry on with what the user asked for.
  const { ready, settings } = store;
  const handledArrival = useRef(false);
  useEffect(() => {
    if (!ready || handledArrival.current || arrival.kind === 'none') return;
    handledArrival.current = true;
    if (arrival.kind === 'refused') {
      storeRef.current.notify({ kind: 'error', message: i18n.t('drive.refused') });
    } else if (arrival.intent === 'restore') {
      void restore();
    } else {
      storeRef.current.notify({ kind: 'success', message: i18n.t('drive.connected') });
      // First link: save (it asks if Drive already has a copy). Reconnecting: the check below takes over.
      if (storeRef.current.settings.onboarded && !storeRef.current.settings.driveFile) void save(false);
    }
  }, [ready, arrival, restore, save]);

  // Look for a newer copy when the app opens, when Drive (re)connects, and when the app comes back.
  useEffect(() => {
    if (!ready || status !== 'connected' || !settings.onboarded) return;
    void check();
    const onVisible = () => {
      if (document.visibilityState === 'visible') void check();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [ready, status, settings.onboarded, check]);

  // The automatic save, a few seconds after the last change.
  const pending = settings.changesSinceDrive;
  useEffect(() => {
    if (!ready || status !== 'connected' || conflict || !settings.onboarded || pending === 0) return;
    const timer = window.setTimeout(() => void save(false), SAVE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [ready, status, conflict, settings.onboarded, pending, save]);

  const drive = useMemo<Drive>(
    () => ({
      status,
      conflict,
      busy,
      connect: () => goToGoogle('connect'),
      async disconnect() {
        forgetToken();
        setConflict(null);
        setStatus(statusNow());
        await storeRef.current.forgetDriveFile();
        storeRef.current.notify({ kind: 'success', message: i18n.t('drive.disconnected') });
      },
      saveNow: (replace = false) => save(true, replace ? conflict : null),
      restore,
    }),
    [status, conflict, busy, save, restore],
  );

  return (
    <DriveContext.Provider value={drive}>
      {children}
      {restoring && (
        <ImportFlow
          source={restoring}
          onClose={() => setRestoring(null)}
          onImported={() => setConflict(null)}
        />
      )}
    </DriveContext.Provider>
  );
}
