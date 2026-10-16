import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { exportBackup, exportOrder, previewImport, type ImportPreview } from './backup';
import type { Category, LedgerData, RecurringRule, Settings } from './types';

/** The settings worth carrying to another device (the rest describe this device or this session). */
export type ArchiveSettings = Pick<Settings, 'language' | 'openingCents' | 'sortOrder'>;

/** A receipt photo as it travels inside the ZIP. */
export interface PhotoFile {
  mime: string;
  bytes: Uint8Array;
}

export interface ArchiveContent {
  data: LedgerData;
  rules: RecurringRule[];
  settings: ArchiveSettings;
  /** Photos by Transaction id. */
  attachments: Map<string, PhotoFile[]>;
}

export type ArchiveImport =
  | {
      ok: true;
      preview: ImportPreview;
      settings: Partial<ArchiveSettings>;
      /** Photos by the id of the imported Transaction they belong to. */
      attachments: Map<string, PhotoFile[]>;
    }
  | { ok: false; reason: 'notAnArchive' | 'missingFile' };

const EXTENSION_OF: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const MIME_OF: Record<string, string> = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

/**
 * One ZIP holding the same CSV files as the plain backup, the settings, and the receipt photos.
 * A photo is stored as `attachments/<row>-<n>.<ext>`, where <row> is its Transaction's row in transactions.csv.
 */
export function exportArchive(content: ArchiveContent, nameOf: (category: Category) => string): Uint8Array {
  const files = exportBackup(content.data, nameOf, content.rules);
  const photos: Record<string, Uint8Array> = {};
  exportOrder(content.data).forEach((t, index) => {
    (content.attachments.get(t.id) ?? []).forEach((photo, n) => {
      const ext = EXTENSION_OF[photo.mime];
      if (ext) photos[`attachments/${index + 2}-${n}.${ext}`] = photo.bytes;
    });
  });
  return zipSync({
    'transactions.csv': strToU8(files.transactionsCsv),
    'categories.csv': strToU8(files.categoriesCsv),
    ...(files.recurringCsv ? { 'recurring.csv': strToU8(files.recurringCsv) } : {}),
    'settings.json': strToU8(JSON.stringify(content.settings)),
    ...photos,
  });
}

/** Keeps only the settings that have a valid value, so a damaged file cannot break the app. */
function readSettings(text: string | null): Partial<ArchiveSettings> {
  if (text === null) return {};
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(text);
  } catch {
    return {};
  }
  const out: Partial<ArchiveSettings> = {};
  if (raw.language === 'en' || raw.language === 'it') out.language = raw.language;
  if (typeof raw.openingCents === 'number' && Number.isSafeInteger(raw.openingCents)) out.openingCents = raw.openingCents;
  if (['newest', 'oldest', 'largest', 'smallest'].includes(raw.sortOrder as string)) out.sortOrder = raw.sortOrder as ArchiveSettings['sortOrder'];
  return out;
}

export function importArchive(bytes: Uint8Array, newId?: () => string): ArchiveImport {
  let entries: ReturnType<typeof unzipSync>;
  try {
    entries = unzipSync(bytes);
  } catch {
    return { ok: false, reason: 'notAnArchive' };
  }
  const text = (name: string) => (entries[name] ? strFromU8(entries[name]) : null);
  const transactionsCsv = text('transactions.csv');
  const categoriesCsv = text('categories.csv');
  if (transactionsCsv === null || categoriesCsv === null) return { ok: false, reason: 'missingFile' };

  const preview = previewImport({ transactionsCsv, categoriesCsv, recurringCsv: text('recurring.csv') }, newId);
  const idOfRow = new Map(preview.transactionRows.map((row, i) => [row, preview.data.transactions[i].id]));
  const attachments = new Map<string, PhotoFile[]>();
  for (const name of Object.keys(entries).sort()) {
    const match = /^attachments\/(\d+)-(\d+)\.(\w+)$/.exec(name);
    const mime = match ? MIME_OF[match[3]] : undefined;
    const id = match ? idOfRow.get(Number(match[1])) : undefined;
    if (!match || !mime || !id) continue;
    attachments.set(id, [...(attachments.get(id) ?? []), { mime, bytes: entries[name] }]);
  }
  return { ok: true, preview, settings: readSettings(text('settings.json')), attachments };
}
