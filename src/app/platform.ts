import { exportArchive, type ArchiveContent } from '../domain/archive';
import { exportBackup, type BackupFiles } from '../domain/backup';
import type { LedgerData, RecurringRule } from '../domain/types';
import { categoryName } from '../i18n';

export function isIos(): boolean {
  const ua = navigator.userAgent;
  return /iPad|iPhone|iPod/.test(ua) || (ua.includes('Mac') && navigator.maxTouchPoints > 1);
}

export function isStandalone(): boolean {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches === true ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

/** Asks the browser not to evict this origin's storage. Returns whether it was granted. */
export async function requestPersistence(): Promise<boolean> {
  try {
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}

export async function isPersisted(): Promise<boolean | null> {
  try {
    const persisted = await navigator.storage?.persisted?.();
    return persisted === undefined ? null : persisted;
  } catch {
    return null;
  }
}

function stamp(now: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

export function backupFileNames(now: Date = new Date()) {
  const day = stamp(now);
  return { transactions: `transactions-${day}.csv`, categories: `categories-${day}.csv`, recurring: `recurring-${day}.csv` };
}

function download(file: File): void {
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = file.name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Hands both CSV files to the user: through the share sheet when the browser supports sharing files
 * (so they can land in Files, iCloud Drive or Google Drive), otherwise as two downloads.
 * Returns false when the user dismissed the share sheet.
 */
export async function exportFiles(data: LedgerData, rules: RecurringRule[], shareTitle: string): Promise<boolean> {
  const files: BackupFiles = exportBackup(data, categoryName, rules);
  const names = backupFileNames();
  const list = [
    new File([files.transactionsCsv], names.transactions, { type: 'text/csv' }),
    new File([files.categoriesCsv], names.categories, { type: 'text/csv' }),
    // Only when there is at least one recurring rule.
    ...(files.recurringCsv ? [new File([files.recurringCsv], names.recurring, { type: 'text/csv' })] : []),
  ];
  if (navigator.canShare?.({ files: list })) {
    try {
      await navigator.share({ files: list, title: shareTitle });
      return true;
    } catch (error) {
      if ((error as DOMException).name === 'AbortError') return false;
    }
  }
  list.forEach(download);
  return true;
}

/** Hands the user one ZIP file with everything, through the share sheet or as a download. Returns false if dismissed. */
export async function exportArchiveFile(content: ArchiveContent, shareTitle: string): Promise<boolean> {
  const bytes = exportArchive(content, categoryName);
  return saveFile(new File([bytes as BlobPart], `money-backup-${stamp(new Date())}.zip`, { type: 'application/zip' }), shareTitle);
}

/** Hands the user the monthly report as a PDF file. Returns false if the share sheet was dismissed. */
export async function saveReportPdf(bytes: Uint8Array, month: string, shareTitle: string): Promise<boolean> {
  return saveFile(new File([bytes as BlobPart], `report-${month}.pdf`, { type: 'application/pdf' }), shareTitle);
}

/** Through the share sheet when the browser can share files, otherwise as a download. */
async function saveFile(file: File, shareTitle: string): Promise<boolean> {
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: shareTitle });
      return true;
    } catch (error) {
      if ((error as DOMException).name === 'AbortError') return false;
    }
  }
  download(file);
  return true;
}

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
}

let deferredInstall: InstallPromptEvent | null = null;

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredInstall = event as InstallPromptEvent;
  });
}

export const canPromptInstall = (): boolean => deferredInstall !== null;

export async function promptInstall(): Promise<void> {
  const event = deferredInstall;
  deferredInstall = null;
  await event?.prompt();
}
