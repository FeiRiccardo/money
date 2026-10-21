import { parseAmount, validateCategoryName } from './rules';
import type { Category, LedgerData, RecurringRule, Transaction, TxType } from './types';

const BOM = '﻿';
const EOL = '\r\n';

function field(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function formatCents(cents: number): string {
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
}

export interface BackupFiles {
  transactionsCsv: string;
  categoriesCsv: string;
  /** Written only when there is at least one recurring rule; optional on import. */
  recurringCsv?: string | null;
}

const RECURRING_HEADER = 'type,amount,categories,note,frequency,start_date,end_date,next_date';

/** The order Transactions are written to transactions.csv, and so the order of its rows. */
export function exportOrder(data: LedgerData): Transaction[] {
  return [...data.transactions].sort((a, b) => a.date.localeCompare(b.date) || (a.createdAt ?? 0) - (b.createdAt ?? 0));
}

export function exportBackup(
  data: LedgerData,
  nameOf: (category: Category) => string,
  rules: RecurringRule[] = [],
): BackupFiles {
  const byId = new Map(data.categories.map((c) => [c.id, c]));
  const namesOf = (categoryIds: string[], retired: string[]) =>
    [
      ...categoryIds.flatMap((id) => {
        const c = byId.get(id);
        return c ? [nameOf(c)] : [];
      }),
      ...retired,
    ].join('|');

  const rows = exportOrder(data).map((t) =>
    [t.date, t.type, formatCents(t.cents), namesOf(t.categoryIds, t.retired), t.note].map(field).join(','),
  );
  const transactionsCsv = BOM + ['date,type,amount,categories,note', ...rows].join(EOL) + EOL;

  const categoryRows = data.categories.map((c) =>
    [c.type, nameOf(c), c.defaultKey ?? '', c.uncounted ? 'yes' : ''].map(field).join(','),
  );
  const categoriesCsv = BOM + [CATEGORY_HEADER.join(','), ...categoryRows].join(EOL) + EOL;

  const recurringRows = rules.map((r) =>
    [r.type, formatCents(r.cents), namesOf(r.categoryIds, r.retired), r.note, r.frequency, r.startDate, r.endDate ?? '', r.nextDate]
      .map(field)
      .join(','),
  );
  const recurringCsv = rules.length === 0 ? null : BOM + [RECURRING_HEADER, ...recurringRows].join(EOL) + EOL;

  return { transactionsCsv, categoriesCsv, recurringCsv };
}

/** Minimal RFC 4180 reader: quoted fields, doubled quotes, CRLF or LF, optional BOM. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = '';
  let quoted = false;
  const src = text.startsWith(BOM) ? text.slice(1) : text;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        value += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else value += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(value);
      value = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(value);
      rows.push(row);
      row = [];
      value = '';
    } else value += ch;
  }
  if (value !== '' || row.length > 0) {
    row.push(value);
    rows.push(row);
  }
  return rows;
}

export type ImportErrorReason =
  | 'invalidDate'
  | 'invalidType'
  | 'invalidAmount'
  | 'noCategories'
  | 'invalidName'
  | 'duplicateName'
  | 'invalidFrequency'
  | 'invalidDateRange';

export interface ImportPreview {
  data: LedgerData;
  rules: RecurringRule[];
  /** The row of transactions.csv each imported Transaction came from, in the same order as `data.transactions`. */
  transactionRows: number[];
  errors: Array<{ file: 'transactions' | 'categories' | 'recurring'; row: number; reason: ImportErrorReason }>;
  /** Set when a file's header is wrong; nothing is imported. */
  fatal?: 'transactionsColumns' | 'categoriesColumns' | 'recurringColumns';
}

const fold = (s: string) => s.trim().toLowerCase();
const TRANSACTION_HEADER = ['date', 'type', 'amount', 'categories', 'note'];
/** `not_counted` came later: a file without it (an older backup) is still read, with every Category counted. */
const CATEGORY_HEADER = ['type', 'name', 'default_key', 'not_counted'];
const OLD_CATEGORY_HEADER = ['type', 'name', 'default_key'];

function isRealDate(value: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
}

export function previewImport(files: BackupFiles, newId: () => string = () => crypto.randomUUID()): ImportPreview {
  const empty: LedgerData = { categories: [], transactions: [] };
  const transactionRows = parseCsv(files.transactionsCsv);
  if (transactionRows[0]?.join(',') !== TRANSACTION_HEADER.join(',')) {
    return { data: empty, rules: [], transactionRows: [], errors: [], fatal: 'transactionsColumns' };
  }

  const categoryRows = parseCsv(files.categoriesCsv);
  const categoryHeader = categoryRows[0]?.join(',');
  if (categoryHeader !== CATEGORY_HEADER.join(',') && categoryHeader !== OLD_CATEGORY_HEADER.join(',')) {
    return { data: empty, rules: [], transactionRows: [], errors: [], fatal: 'categoriesColumns' };
  }

  const recurringRows = files.recurringCsv ? parseCsv(files.recurringCsv) : [];
  if (recurringRows.length > 0 && recurringRows[0]?.join(',') !== RECURRING_HEADER) {
    return { data: empty, rules: [], transactionRows: [], errors: [], fatal: 'recurringColumns' };
  }

  const errors: ImportPreview['errors'] = [];
  const categories: Category[] = [];
  const seen: Record<TxType, string[]> = { expense: [], income: [] };
  categoryRows.slice(1).forEach(([type, name, defaultKey, notCounted], index) => {
    const row = index + 2;
    if (type !== 'expense' && type !== 'income') {
      errors.push({ file: 'categories', row, reason: 'invalidType' });
      return;
    }
    const checked = validateCategoryName(name ?? '', { existing: seen[type], retired: [] });
    if (!checked.ok) {
      errors.push({ file: 'categories', row, reason: checked.reason === 'duplicate' ? 'duplicateName' : 'invalidName' });
      return;
    }
    seen[type].push(checked.name);
    categories.push({
      id: newId(),
      type,
      name: checked.name,
      defaultKey: defaultKey ? defaultKey : undefined,
      lastUsedAt: 0,
      ...(notCounted === 'yes' ? { uncounted: true } : {}),
    });
  });
  const idByName = new Map(categories.map((c) => [`${c.type}:${fold(c.name)}`, c.id]));

  const transactions: Transaction[] = [];
  const importedRows: number[] = [];
  transactionRows.slice(1).forEach(([date, type, amount, names, note], index) => {
    const row = index + 2;
    const fail = (reason: ImportErrorReason) => errors.push({ file: 'transactions', row, reason });
    if (!isRealDate(date ?? '')) return fail('invalidDate');
    if (type !== 'expense' && type !== 'income') return fail('invalidType');
    const cents = parseAmount(amount ?? '');
    if (cents === null) return fail('invalidAmount');
    const categoryIds: string[] = [];
    const retired: string[] = [];
    for (const name of (names ?? '').split('|').map((n) => n.trim()).filter(Boolean)) {
      const id = idByName.get(`${type}:${fold(name)}`);
      if (id) categoryIds.push(id);
      else retired.push(name);
    }
    if (categoryIds.length + retired.length === 0) return fail('noCategories');
    transactions.push({ id: newId(), date, type, cents, categoryIds, retired, note: note ?? '', createdAt: transactions.length });
    importedRows.push(row);
  });

  const rules: RecurringRule[] = [];
  recurringRows.slice(1).forEach(([type, amount, names, note, frequency, startDate, endDate, nextDate], index) => {
    const row = index + 2;
    const fail = (reason: ImportErrorReason) => errors.push({ file: 'recurring', row, reason });
    if (type !== 'expense' && type !== 'income') return fail('invalidType');
    const cents = parseAmount(amount ?? '');
    if (cents === null) return fail('invalidAmount');
    if (frequency !== 'weekly' && frequency !== 'monthly' && frequency !== 'yearly') return fail('invalidFrequency');
    const next = nextDate ? nextDate : (startDate ?? '');
    if (!isRealDate(startDate ?? '') || !isRealDate(next) || (endDate && !isRealDate(endDate))) return fail('invalidDate');
    if (endDate && endDate < startDate!) return fail('invalidDateRange');
    const categoryIds: string[] = [];
    const retired: string[] = [];
    for (const name of (names ?? '').split('|').map((n) => n.trim()).filter(Boolean)) {
      const id = idByName.get(type + ':' + fold(name));
      if (id) categoryIds.push(id);
      else retired.push(name);
    }
    if (categoryIds.length + retired.length === 0) return fail('noCategories');
    rules.push({
      id: newId(), type, cents, categoryIds, retired, note: note ?? '', frequency,
      startDate: startDate!, endDate: endDate ? endDate : null, nextDate: next,
    });
  });

  return { data: { categories, transactions }, rules, transactionRows: importedRows, errors };
}
