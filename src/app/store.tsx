import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { openLedger, type CategoryResult, type Ledger, type RuleInput, type TransactionInput } from '../data/ledger';
import { exportArchive, type ArchiveContent, type ArchiveSettings, type PhotoFile } from '../domain/archive';
import { BACKUP_DISMISS_MS, INSTALL_DISMISS_MS } from '../domain/reminders';
import {
  EMPTY_TOASTS,
  dismiss,
  expire,
  nextExpiry,
  pause,
  push,
  resume,
  type ToastInput,
  type ToastItem,
  type ToastState,
} from '../domain/toasts';
import {
  DEFAULT_SETTINGS,
  type Attachment,
  type AttachmentInput,
  type Category,
  type DriveFile,
  type Frequency,
  type Language,
  type LedgerData,
  type RecurringRule,
  type Settings,
  type SortOrder,
  type TxType,
} from '../domain/types';
import i18n, { categoryName, setLanguage as applyLanguage } from '../i18n';
import { formatMoney, todayISO } from './format';
import { exportArchiveFile, exportFiles, requestPersistence } from './platform';

/** "Repeat" chosen on a Transaction: it becomes the first occurrence of a new rule. */
export interface Repeat {
  frequency: Frequency;
  endDate: string | null;
}

/** Photo changes made in the Transaction form, applied when it is saved. */
export interface PhotoChanges {
  added: AttachmentInput[];
  removedIds: string[];
}

/** What a ZIP import brings besides the Transactions, Categories and rules. */
export interface ImportExtras {
  settings: Partial<ArchiveSettings>;
  photos: Map<string, PhotoFile[]>;
  /** Set when the ZIP came from Google Drive: this device now knows that copy. */
  driveFile?: DriveFile;
}

export interface Store {
  ready: boolean;
  storageError: boolean;
  /** True while an older copy of the app, open elsewhere, holds the database and blocks the update. */
  waitingForOtherCopy: boolean;
  data: LedgerData;
  rules: RecurringRule[];
  settings: Settings;
  language: Language;
  /** How many receipt photos each Transaction has (Transactions with none are left out). */
  photoCounts: Record<string, number>;
  attachmentsOf: (transactionId: string) => Promise<Attachment[]>;
  /** Toast messages on screen, oldest first (at most three). */
  toasts: ToastItem[];
  notify: (toast: ToastInput) => void;
  dismissToast: (id: number) => void;
  /** Hold a toast on screen while it is being touched or hovered. */
  pauseToast: (id: number) => void;
  resumeToast: (id: number) => void;
  saveFailed: boolean;
  clearSaveFailed: () => void;
  /** True right after an import: the opening balance is not in the backup, so ask the user to check it. */
  openingCheck: boolean;
  dismissOpeningCheck: () => void;
  addTransaction: (input: TransactionInput, repeat?: Repeat, photos?: PhotoChanges) => Promise<boolean>;
  updateTransaction: (id: string, input: TransactionInput, repeat?: Repeat, photos?: PhotoChanges) => Promise<boolean>;
  deleteTransaction: (id: string) => Promise<void>;
  updateRule: (id: string, input: RuleInput) => Promise<boolean>;
  stopRule: (id: string) => Promise<void>;
  createCategory: (type: TxType, name: string) => Promise<CategoryResult>;
  renameCategory: (id: string, name: string) => Promise<CategoryResult>;
  deleteCategory: (id: string) => Promise<void>;
  setLanguage: (language: Language) => Promise<void>;
  setOpeningBalance: (cents: number) => Promise<void>;
  setSortOrder: (order: SortOrder) => Promise<void>;
  startFresh: (openingCents: number) => Promise<void>;
  /**
   * Replaces everything with imported data, with an Undo. `automatic` is a newer Drive copy loaded on open:
   * its own message, and its Undo leaves this device marked as changed, so the next save asks instead of
   * loading the copy again.
   */
  applyImport: (data: LedgerData, rules: RecurringRule[], extras?: ImportExtras, options?: { automatic?: boolean }) => Promise<void>;
  eraseAll: () => Promise<void>;
  exportBackup: () => Promise<boolean>;
  /** One ZIP with the CSV data, the settings and the receipt photos. */
  exportZip: () => Promise<boolean>;
  /** The Full backup ZIP, as bytes. */
  buildArchive: () => Promise<Uint8Array>;
  /**
   * Records a save to Google Drive. It counts as a backup: the changes it carried (`included`, the counts when
   * the save started) come off the counts, and any made while it was uploading stay.
   */
  recordDriveSave: (file: DriveFile, included: { backup: number; drive: number }) => Promise<void>;
  /** Forgets the Drive copy this device knew (Disconnect). */
  forgetDriveFile: () => Promise<void>;
  dismissBanner: (kind: 'backup' | 'install') => Promise<void>;
}

const StoreContext = createContext<Store | null>(null);

export function useStore(): Store {
  const store = useContext(StoreContext);
  if (!store) throw new Error('useStore must be used inside <StoreProvider>');
  return store;
}

const EMPTY: LedgerData = { categories: [], transactions: [] };

/** What a Transaction or rule is called in a message: its note, else its first Category. */
function labelOf(item: { note: string; categoryIds: string[]; retired: string[] }, categories: Category[]): string {
  const first = item.categoryIds.map((id) => categories.find((c) => c.id === id)).find(Boolean);
  return item.note || (first ? categoryName(first) : (item.retired[0] ?? ''));
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const ledgerRef = useRef<Ledger | null>(null);
  const runningRecurring = useRef(false);
  const [ready, setReady] = useState(false);
  const [storageError, setStorageError] = useState(false);
  const [waitingForOtherCopy, setWaitingForOtherCopy] = useState(false);
  const [data, setData] = useState<LedgerData>(EMPTY);
  const [rules, setRules] = useState<RecurringRule[]>([]);
  const [photoCounts, setPhotoCounts] = useState<Record<string, number>>({});
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [queue, setQueue] = useState<ToastState>(EMPTY_TOASTS);
  const [saveFailed, setSaveFailed] = useState(false);
  const [openingCheck, setOpeningCheck] = useState(false);

  const refresh = useCallback(async () => {
    const loaded = await ledgerRef.current!.load();
    setData(loaded.data);
    setRules(loaded.rules);
    setPhotoCounts(await ledgerRef.current!.attachmentCounts());
    setSettings(loaded.settings);
    applyLanguage(loaded.settings.language);
  }, []);

  useEffect(() => {
    let cancelled = false;
    openLedger('money-tracker', categoryName, () => setWaitingForOtherCopy(true))
      .then(async (ledger) => {
        if (cancelled) return;
        setWaitingForOtherCopy(false);
        ledgerRef.current = ledger;
        // Photos of Transactions deleted in an earlier session can no longer be undone, so they go now.
        await ledger.purgeOrphanAttachments();
        await refresh();
        setReady(true);
      })
      .catch(() => {
        setStorageError(true);
        setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  // ---- toasts
  const notify = useCallback((input: ToastInput) => setQueue((q) => push(q, input, Date.now()).state), []);
  const dismissToast = useCallback((id: number) => setQueue((q) => dismiss(q, id)), []);
  const pauseToast = useCallback((id: number) => setQueue((q) => pause(q, id, Date.now())), []);
  const resumeToast = useCallback((id: number) => setQueue((q) => resume(q, id, Date.now())), []);

  // One timer, set for whichever toast expires next.
  useEffect(() => {
    const at = nextExpiry(queue);
    if (at === null) return;
    const timer = window.setTimeout(() => setQueue((q) => expire(q, Date.now())), Math.max(0, at - Date.now()));
    return () => window.clearTimeout(timer);
  }, [queue]);

  /** Runs a write; any failure becomes the blocking "not saved, back up now" message. */
  const write = useCallback(
    async <T,>(fn: (ledger: Ledger) => Promise<T>): Promise<{ ok: true; value: T } | { ok: false }> => {
      try {
        const value = await fn(ledgerRef.current!);
        await refresh();
        return { ok: true, value };
      } catch {
        setSaveFailed(true);
        return { ok: false };
      }
    },
    [refresh],
  );

  /** Creates the Transactions the recurring rules have made due, and offers one Undo for the batch. */
  const runRecurring = useCallback(
    async (silent = false) => {
      if (!ledgerRef.current || runningRecurring.current) return;
      runningRecurring.current = true;
      try {
        const batch = await ledgerRef.current.materializeRules(todayISO());
        if (batch.created.length === 0) return;
        await refresh();
        if (!silent) {
          notify({
            kind: 'success',
            message: i18n.t('recurring.added', { count: batch.created.length }),
            actionLabel: i18n.t('common.undo'),
            onAction: () => void write((l) => l.undoMaterialize(batch)),
          });
        }
      } catch {
        setSaveFailed(true);
      } finally {
        runningRecurring.current = false;
      }
    },
    [refresh, notify, write],
  );

  // Run when the app opens and whenever it comes back to the foreground (a new day may have started).
  const onboarded = settings.onboarded;
  useEffect(() => {
    if (!ready || storageError || !onboarded) return;
    void runRecurring();
    const onVisible = () => {
      if (document.visibilityState === 'visible') void runRecurring();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [ready, storageError, onboarded, runRecurring]);

  const store = useMemo<Store>(() => {
    const archiveContent = async (): Promise<ArchiveContent> => {
      const attachments = new Map<string, PhotoFile[]>();
      for (const a of await ledgerRef.current!.allAttachments()) {
        attachments.set(a.transactionId, [...(attachments.get(a.transactionId) ?? []), { mime: a.mime, bytes: new Uint8Array(a.data) }]);
      }
      const { language, openingCents, sortOrder } = settings;
      return { data, rules, settings: { language, openingCents, sortOrder }, attachments };
    };
    const requestPersistenceOnce = async () => {
      const current = (await ledgerRef.current!.load()).settings;
      if (current.persistRequested) return;
      await requestPersistence();
      await ledgerRef.current!.updateSettings({ persistRequested: true });
    };
    const undo = i18n.t('common.undo');
    const freshCategories = async () => (await ledgerRef.current!.load()).data.categories;
    const detail = async (tx: { note: string; categoryIds: string[]; retired: string[]; cents: number }) => ({
      what: labelOf(tx, await freshCategories()),
      amount: formatMoney(tx.cents, settings.language),
    });
    const repeatMessage = async (repeat: Repeat, tx: { note: string; categoryIds: string[]; retired: string[] }) =>
      i18n.t('toast.repeatSet', {
        frequency: i18n.t(`recurring.${repeat.frequency}`).toLowerCase(),
        what: labelOf(tx, await freshCategories()),
      });

    return {
      ready,
      storageError,
      waitingForOtherCopy,
      data,
      rules,
      settings,
      language: settings.language,
      photoCounts,
      attachmentsOf: (transactionId) => ledgerRef.current!.attachmentsOf(transactionId),
      toasts: queue.items,
      notify,
      dismissToast,
      pauseToast,
      resumeToast,
      saveFailed,
      clearSaveFailed: () => setSaveFailed(false),
      openingCheck,
      dismissOpeningCheck: () => setOpeningCheck(false),

      async addTransaction(input, repeat, photos) {
        const result = await write(async (l) => {
          const saved = await l.addTransaction(input);
          for (const photo of photos?.added ?? []) await l.addAttachment(saved.id, photo);
          if (repeat) await l.createRuleFromTransaction(saved.id, repeat);
          return saved;
        });
        if (!result.ok) return false;
        await requestPersistenceOnce();
        const saved = result.value;
        const message = i18n.t('toast.added', await detail(saved));
        // With Repeat chosen the rule and its batch have their own Undo, so this one has none.
        if (repeat) {
          notify({ kind: 'success', message });
          notify({ kind: 'info', message: await repeatMessage(repeat, saved) });
          await runRecurring();
        } else {
          notify({ kind: 'success', message, actionLabel: undo, onAction: () => void write((l) => l.undoAddTransaction(saved.id)) });
        }
        await refresh();
        return true;
      },
      async updateTransaction(id, input, repeat, photos) {
        const original = data.transactions.find((t) => t.id === id);
        const result = await write(async (l) => {
          await l.updateTransaction(id, input);
          for (const photoId of photos?.removedIds ?? []) await l.removeAttachment(photoId);
          for (const photo of photos?.added ?? []) await l.addAttachment(id, photo);
          if (repeat) await l.createRuleFromTransaction(id, repeat);
        });
        if (!result.ok) return false;
        const message = i18n.t('toast.updated', await detail(input));
        if (repeat) {
          notify({ kind: 'success', message });
          notify({ kind: 'info', message: await repeatMessage(repeat, input) });
          await runRecurring();
        } else {
          notify({
            kind: 'success',
            message,
            ...(original ? { actionLabel: undo, onAction: () => void write((l) => l.restoreTransaction(original)) } : {}),
          });
        }
        return true;
      },
      async deleteTransaction(id) {
        const result = await write((l) => l.deleteTransaction(id));
        if (!result.ok) return;
        const snapshot = result.value;
        notify({
          kind: 'success',
          message: i18n.t('toast.deleted', await detail(snapshot)),
          actionLabel: undo,
          onAction: () => void write((l) => l.restoreTransaction(snapshot)),
        });
      },

      async updateRule(id, input) {
        const result = await write((l) => l.updateRule(id, input));
        if (result.ok) notify({ kind: 'success', message: i18n.t('toast.ruleUpdated', { what: labelOf(input, await freshCategories()) }) });
        return result.ok;
      },
      async stopRule(id) {
        const rule = rules.find((r) => r.id === id);
        const result = await write((l) => l.deleteRule(id));
        if (result.ok && rule) notify({ kind: 'success', message: i18n.t('toast.ruleStopped', { what: labelOf(rule, await freshCategories()) }) });
      },

      async createCategory(type, name) {
        const result = await write((l) => l.createCategory(type, name));
        if (!result.ok) return { ok: false, reason: 'empty' };
        if (result.value.ok) notify({ kind: 'success', message: i18n.t('toast.categoryCreated', { name: categoryName(result.value.category) }) });
        return result.value;
      },
      async renameCategory(id, name) {
        const result = await write((l) => l.renameCategory(id, name));
        if (!result.ok) return { ok: false, reason: 'empty' };
        if (result.value.ok) notify({ kind: 'success', message: i18n.t('toast.categoryRenamed', { name: categoryName(result.value.category) }) });
        return result.value;
      },
      async deleteCategory(id) {
        const result = await write((l) => l.deleteCategory(id));
        if (!result.ok) return;
        const snapshot = result.value;
        notify({
          kind: 'success',
          message: i18n.t('toast.categoryDeleted', { name: categoryName(snapshot.category) }),
          actionLabel: undo,
          onAction: () => void write((l) => l.restoreCategory(snapshot)),
        });
      },

      async setLanguage(language) {
        applyLanguage(language);
        await write((l) => l.updateSettings({ language }));
      },
      async setOpeningBalance(cents) {
        const result = await write((l) => l.updateSettings({ openingCents: cents }));
        if (result.ok) notify({ kind: 'success', message: i18n.t('toast.openingSaved') });
      },
      async setSortOrder(order) {
        await write((l) => l.updateSettings({ sortOrder: order }));
      },
      async startFresh(openingCents) {
        await write(async (l) => {
          await l.seedStarterCategories();
          await l.updateSettings({ onboarded: true, openingCents });
        });
      },

      async applyImport(imported, importedRules, extras, options) {
        const before = await ledgerRef.current!.load();
        const beforePhotos = await ledgerRef.current!.allAttachments();
        const photos = [...(extras?.photos ?? new Map<string, PhotoFile[]>())].flatMap(([transactionId, files]) =>
          files.map((f) => ({ transactionId, mime: f.mime, data: f.bytes.slice().buffer as ArrayBuffer })),
        );
        const result = await write(async (l) => {
          await l.replaceAll(imported, importedRules, photos);
          // From Drive: this device now holds exactly that copy.
          const patch = { ...extras?.settings, ...(extras?.driveFile ? { driveFile: extras.driveFile, changesSinceDrive: 0 } : {}) };
          if (Object.keys(patch).length > 0) await l.updateSettings(patch);
        });
        if (!result.ok) return;
        if (extras?.settings.language) applyLanguage(extras.settings.language);
        await runRecurring(true);
        // The opening balance is only in question when the backup did not carry it.
        setOpeningCheck(extras?.settings.openingCents === undefined);
        notify({
          kind: 'success',
          message: i18n.t(options?.automatic ? 'drive.loadedNewer' : 'import.done'),
          actionLabel: undo,
          onAction: () => {
            setOpeningCheck(false);
            void write(async (l) => {
              await l.replaceAll(before.data, before.rules, beforePhotos);
              await l.updateSettings(options?.automatic ? { ...before.settings, changesSinceDrive: 1 } : before.settings);
            });
          },
        });
      },

      async eraseAll() {
        const result = await write((l) => l.eraseAll());
        if (!result.ok) return;
        applyLanguage('en');
        notify({ kind: 'success', message: i18n.t('toast.erased') });
      },

      async exportBackup() {
        try {
          const shared = await exportFiles(data, rules, i18n.t('export.shareTitle'));
          if (!shared) return false;
          await write((l) => l.updateSettings({ lastBackupAt: Date.now(), changesSinceBackup: 0 }));
          notify({ kind: 'success', message: i18n.t('export.done') });
          return true;
        } catch {
          notify({ kind: 'error', message: i18n.t('toast.exportFailed') });
          return false;
        }
      },

      async exportZip() {
        try {
          const shared = await exportArchiveFile(await archiveContent(), i18n.t('export.shareTitle'));
          if (!shared) return false;
          await write((l) => l.updateSettings({ lastBackupAt: Date.now(), changesSinceBackup: 0 }));
          notify({ kind: 'success', message: i18n.t('export.zipDone') });
          return true;
        } catch {
          notify({ kind: 'error', message: i18n.t('toast.exportFailed') });
          return false;
        }
      },

      async buildArchive() {
        return exportArchive(await archiveContent(), categoryName);
      },

      async recordDriveSave(file, included) {
        await write(async (l) => {
          const now = (await l.load()).settings;
          await l.updateSettings({
            driveFile: file,
            driveSavedAt: Date.now(),
            lastBackupAt: Date.now(),
            changesSinceBackup: Math.max(0, now.changesSinceBackup - included.backup),
            changesSinceDrive: Math.max(0, now.changesSinceDrive - included.drive),
          });
        });
      },

      async forgetDriveFile() {
        await write((l) => l.updateSettings({ driveFile: null }));
      },

      async dismissBanner(kind) {
        const patch =
          kind === 'backup'
            ? { backupBannerHiddenUntil: Date.now() + BACKUP_DISMISS_MS }
            : { installNudgeHiddenUntil: Date.now() + INSTALL_DISMISS_MS };
        await write((l) => l.updateSettings(patch));
      },
    };
  }, [ready, storageError, waitingForOtherCopy, data, rules, photoCounts, settings, queue.items, notify, dismissToast, pauseToast, resumeToast, saveFailed, openingCheck, write, refresh, runRecurring]);

  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>;
}
