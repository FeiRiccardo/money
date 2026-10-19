import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createDriveBackup, type DriveFile } from '../data/driveBackup';
import i18n from '../i18n';
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
    if (!token || running.current) return;
    running.current = true;
    if (manual) setBusy(true);
    try {
      const s = storeRef.current;
      const included = s.settings.changesSinceBackup;
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
      if (storeRef.current.settings.onboarded) void save(false);
    }
  }, [ready, arrival, restore, save]);

  // The automatic save, a few seconds after the last change.
  const pending = settings.changesSinceBackup;
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
