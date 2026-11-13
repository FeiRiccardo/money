import { validateAccountName } from './accounts';
import { parseAmount, parseSignedAmount, validateCategoryName } from './rules';
import { MAIN_ACCOUNT_KEY, MAIN_ACCOUNT_NAME, type Account, type Category, type LedgerData, type RecurringRule, type Transaction, type TxType } from './types';

const BOM = '﻿';
const EOL = '\r\n';

function field(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function formatCents(cents: number): string {
  const abs = Math.abs(cents);
  return `${cents < 0 ? '-' : ''}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

export interface BackupFiles {
  transactionsCsv: string;
  categoriesCsv: string;
  /** Written only when there is at least one recurring rule; optional on import. */
  recurringCsv?: string | null;
  /** The Accounts and their Opening balances. Optional on import: a backup from before Accounts has none. */
  accountsCsv?: string | null;
}

const OLD_RECURRING_HEADER = 'type,amount,categories,note,frequency,start_date,end_date,next_date';
const RECURRING_HEADER = OLD_RECURRING_HEADER + ',account';
const ACCOUNT_HEADER = 'name,opening_balance,default_key';

/** The order Transactions are written to transactions.csv, and so the order of its rows. */
export function exportOrder(data: LedgerData): Transaction[] {
  return [...data.transactions].sort((a, b) => a.date.localeCompare(b.date) || (a.createdAt ?? 0) - (b.createdAt ?? 0));
}

/**
 * With Accounts given, every Transaction and rule says which one it is on, and the two halves of a Transfer
 * share a number in the `transfer` column. Without, the files are the older format.
 */
export function exportBackup(
  data: LedgerData,
  nameOf: (category: Category) => string,
  rules: RecurringRule[] = [],
  accounts: Account[] = [],
  accountNameOf: (account: Account) => string = (a) => a.name,
): BackupFiles {
  const withAccounts = accounts.length > 0;
  const accountName = new Map(accounts.map((a) => [a.id, accountNameOf(a)]));
  const transferNumbers = new Map<string, number>();
  for (const t of exportOrder(data)) {
    if (t.transferId !== undefined && !transferNumbers.has(t.transferId)) transferNumbers.set(t.transferId, transferNumbers.size + 1);
  }
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
    [
      t.date,
      t.type,
      formatCents(t.cents),
      namesOf(t.categoryIds, t.retired),
      t.note,
      ...(withAccounts ? [accountName.get(t.accountId) ?? '', t.transferId === undefined ? '' : String(transferNumbers.get(t.transferId))] : []),
    ]
      .map(field)
      .join(','),
  );
  const transactionsCsv =
    BOM + [withAccounts ? TRANSACTION_HEADER.join(',') : OLD_TRANSACTION_HEADER.join(','), ...rows].join(EOL) + EOL;

  const categoryRows = data.categories.map((c) =>
    [c.type, nameOf(c), c.defaultKey ?? '', c.uncounted ? 'yes' : ''].map(field).join(','),
  );
  const categoriesCsv = BOM + [CATEGORY_HEADER.join(','), ...categoryRows].join(EOL) + EOL;

  const recurringRows = rules.map((r) =>
    [
      r.type, formatCents(r.cents), namesOf(r.categoryIds, r.retired), r.note, r.frequency, r.startDate, r.endDate ?? '', r.nextDate,
      ...(withAccounts ? [accountName.get(r.accountId) ?? ''] : []),
    ]
      .map(field)
      .join(','),
  );
  const recurringCsv =
    rules.length === 0 ? null : BOM + [withAccounts ? RECURRING_HEADER : OLD_RECURRING_HEADER, ...recurringRows].join(EOL) + EOL;

  const accountRows = accounts.map((a) => [accountNameOf(a), formatCents(a.openingCents), a.defaultKey ?? ''].map(field).join(','));
  const accountsCsv = withAccounts ? BOM + [ACCOUNT_HEADER, ...accountRows].join(EOL) + EOL : null;

  return { transactionsCsv, categoriesCsv, recurringCsv, accountsCsv };
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
  | 'invalidDateRange'
  | 'invalidOpening'
  | 'invalidTransfer';

export interface ImportPreview {
  data: LedgerData;
  rules: RecurringRule[];
  /** Never empty: a file without Accounts puts everything on one "Main account". */
  accounts: Account[];
  /** False when the files said nothing about Accounts (an older backup): the Opening balance is then unknown. */
  accountsInFile: boolean;
  /** The row of transactions.csv each imported Transaction came from, in the same order as `data.transactions`. */
  transactionRows: number[];
  errors: Array<{ file: 'transactions' | 'categories' | 'recurring' | 'accounts'; row: number; reason: ImportErrorReason }>;
  /** Set when a file's header is wrong; nothing is imported. */
  fatal?: 'transactionsColumns' | 'categoriesColumns' | 'recurringColumns' | 'accountsColumns';
}

const fold = (s: string) => s.trim().toLowerCase();
/** `account` and `transfer` came later: a file without them (an older backup) is still read. */
const OLD_TRANSACTION_HEADER = ['date', 'type', 'amount', 'categories', 'note'];
const TRANSACTION_HEADER = [...OLD_TRANSACTION_HEADER, 'account', 'transfer'];
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
  const nothing = { data: empty, rules: [], accounts: [], accountsInFile: false, transactionRows: [], errors: [] };
  const transactionRows = parseCsv(files.transactionsCsv);
  const transactionHeader = transactionRows[0]?.join(',');
  if (transactionHeader !== TRANSACTION_HEADER.join(',') && transactionHeader !== OLD_TRANSACTION_HEADER.join(',')) {
    return { ...nothing, fatal: 'transactionsColumns' };
  }

  const categoryRows = parseCsv(files.categoriesCsv);
  const categoryHeader = categoryRows[0]?.join(',');
  if (categoryHeader !== CATEGORY_HEADER.join(',') && categoryHeader !== OLD_CATEGORY_HEADER.join(',')) {
    return { ...nothing, fatal: 'categoriesColumns' };
  }

  const recurringRows = files.recurringCsv ? parseCsv(files.recurringCsv) : [];
  const recurringHeader = recurringRows[0]?.join(',');
  if (recurringRows.length > 0 && recurringHeader !== RECURRING_HEADER && recurringHeader !== OLD_RECURRING_HEADER) {
    return { ...nothing, fatal: 'recurringColumns' };
  }

  const accountRows = files.accountsCsv ? parseCsv(files.accountsCsv) : [];
  if (accountRows.length > 0 && accountRows[0]?.join(',') !== ACCOUNT_HEADER) {
    return { ...nothing, fatal: 'accountsColumns' };
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

  const accounts: Account[] = [];
  accountRows.slice(1).forEach(([name, opening, defaultKey], index) => {
    const row = index + 2;
    const checked = validateAccountName(name ?? '', accounts.map((a) => a.name));
    if (!checked.ok) {
      errors.push({ file: 'accounts', row, reason: checked.reason === 'duplicate' ? 'duplicateName' : 'invalidName' });
      return;
    }
    const cents = opening === undefined || opening.trim() === '' ? 0 : parseSignedAmount(opening);
    if (cents === null) {
      errors.push({ file: 'accounts', row, reason: 'invalidOpening' });
      return;
    }
    accounts.push({ id: newId(), name: checked.name, openingCents: cents, ...(defaultKey === MAIN_ACCOUNT_KEY ? { defaultKey } : {}) });
  });
  const accountsInFile = accounts.length > 0;
  /** The Account a name stands for; a name nobody listed makes a new one, no name means the first. */
  const accountFor = (name: string | undefined): string => {
    const wanted = (name ?? '').trim();
    if (wanted === '') {
      if (accounts.length === 0) accounts.push({ id: newId(), name: MAIN_ACCOUNT_NAME, defaultKey: MAIN_ACCOUNT_KEY, openingCents: 0 });
      return accounts[0].id;
    }
    const found = accounts.find((a) => fold(a.name) === fold(wanted));
    if (found) return found.id;
    const made: Account = { id: newId(), name: wanted.slice(0, 30).replaceAll('|', ' '), openingCents: 0 };
    accounts.push(made);
    return made.id;
  };

  const transactions: Transaction[] = [];
  const importedRows: number[] = [];
  const transfers = new Map<string, Array<{ index: number; row: number }>>();
  transactionRows.slice(1).forEach(([date, type, amount, names, note, account, transfer], index) => {
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
    const transferKey = (transfer ?? '').trim();
    // Money moved between Accounts carries no Category.
    if (categoryIds.length + retired.length === 0 && transferKey === '') return fail('noCategories');
    if (transferKey !== '') transfers.set(transferKey, [...(transfers.get(transferKey) ?? []), { index: transactions.length, row }]);
    transactions.push({
      id: newId(), accountId: accountFor(account), date, type, cents, categoryIds, retired, note: note ?? '', createdAt: transactions.length,
    });
    importedRows.push(row);
  });

  // The two halves of a Transfer: one Expense and one Income, the same amount, on different Accounts.
  const dropped = new Set<number>();
  const transferIds = new Map<number, string>();
  for (const halves of transfers.values()) {
    const [a, b] = halves.map((h) => transactions[h.index]);
    const valid = halves.length === 2 && a.type !== b.type && a.cents === b.cents && a.accountId !== b.accountId;
    if (!valid) {
      for (const h of halves) {
        dropped.add(h.index);
        errors.push({ file: 'transactions', row: h.row, reason: 'invalidTransfer' });
      }
      continue;
    }
    const id = newId();
    for (const h of halves) transferIds.set(h.index, id);
  }
  for (const [index, id] of transferIds) transactions[index].transferId = id;
  const kept = transactions.filter((_, i) => !dropped.has(i));
  const keptRows = importedRows.filter((_, i) => !dropped.has(i));
  transactions.length = 0;
  transactions.push(...kept);
  importedRows.length = 0;
  importedRows.push(...keptRows);

  const rules: RecurringRule[] = [];
  recurringRows.slice(1).forEach(([type, amount, names, note, frequency, startDate, endDate, nextDate, account], index) => {
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
      id: newId(), accountId: accountFor(account), type, cents, categoryIds, retired, note: note ?? '', frequency,
      startDate: startDate!, endDate: endDate ? endDate : null, nextDate: next,
    });
  });

  if (accounts.length === 0) accountFor('');
  return { data: { categories, transactions }, rules, accounts, accountsInFile, transactionRows: importedRows, errors };
}
