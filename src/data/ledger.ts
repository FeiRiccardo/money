import { openDB, type IDBPDatabase } from 'idb';
import { validateAccountName, type AccountDeletion } from '../domain/accounts';
import { dueOccurrences } from '../domain/recurring';
import { validateCategoryName, type NameError } from '../domain/rules';
import {
  DEFAULT_SETTINGS,
  MAIN_ACCOUNT_KEY,
  MAIN_ACCOUNT_NAME,
  STARTER_CATEGORIES,
  type Account,
  type Attachment,
  type AttachmentInput,
  type Category,
  type LedgerData,
  type Frequency,
  type RecurringRule,
  type Settings,
  type Transaction,
  type TxType,
} from '../domain/types';

export type TransactionInput = Omit<Transaction, 'id'>;

/** A photo to store on import or Undo; `id` and `addedAt` are kept when given (Undo), made up otherwise. */
export type AttachmentSeed = AttachmentInput & { transactionId: string; id?: string; addedAt?: number };

/** What materializeRules did, so it can be undone as one batch. */
export interface Materialized {
  created: Transaction[];
  /** The rules that moved on, as they were before. */
  rulesBefore: RecurringRule[];
}

export type RuleInput = Omit<RecurringRule, 'id'>;

/** A Transfer: money moved from one Account to another. It is stored as two Transactions that share a transferId. */
export interface TransferInput {
  date: string;
  cents: number;
  fromAccountId: string;
  toAccountId: string;
  note: string;
}

export type AccountResult = { ok: true; account: Account } | { ok: false; reason: NameError };

export type CategoryResult = { ok: true; category: Category } | { ok: false; reason: NameError };

/** What a deleted Category looked like, plus the Transactions it touched, for Undo. */
export interface CategoryDeletion {
  category: Category;
  /** The affected Transactions as they were before the delete. */
  transactions: Transaction[];
  /** The affected rules as they were before the delete. */
  rules: RecurringRule[];
  affected: number;
}

export interface Ledger {
  load(): Promise<{ data: LedgerData; rules: RecurringRule[]; accounts: Account[]; settings: Settings }>;
  seedStarterCategories(): Promise<void>;
  /** Creates the starter Account of a new database. */
  seedMainAccount(openingCents: number): Promise<void>;
  createAccount(name: string, openingCents: number): Promise<AccountResult>;
  /** Saving a different name makes a starter Account a plain one (it stops translating). */
  updateAccount(id: string, name: string, openingCents: number): Promise<AccountResult>;
  /** Removes the Account with its Transactions and rules; the other half of each Transfer stays as an ordinary Transaction. */
  deleteAccount(id: string, transferLabel: string): Promise<AccountDeletion>;
  restoreAccount(snapshot: AccountDeletion): Promise<void>;
  /** Records a Transfer: an Expense on the source Account and an Income on the destination. Returns [from, to]. */
  addTransfer(input: TransferInput): Promise<[Transaction, Transaction]>;
  updateTransfer(transferId: string, input: TransferInput): Promise<[Transaction, Transaction]>;
  /** Deletes both halves and returns them for restoreTransactions. */
  deleteTransfer(transferId: string): Promise<Transaction[]>;
  /** Puts Transactions back as they were (Undo of a Transfer's delete or edit). */
  restoreTransactions(snapshots: Transaction[]): Promise<void>;
  /** Undo for an add: removes both halves of the Transfer. */
  undoAddTransfer(transferId: string): Promise<void>;
  addTransaction(input: TransactionInput): Promise<Transaction>;
  updateTransaction(id: string, input: TransactionInput): Promise<Transaction>;
  /** Deletes and returns a snapshot to pass to `restoreTransaction` for Undo. */
  deleteTransaction(id: string): Promise<Transaction>;
  restoreTransaction(snapshot: Transaction): Promise<void>;
  /** Undo for an add: removes that Transaction and gives back the change it counted. */
  undoAddTransaction(id: string): Promise<void>;
  addRule(input: RuleInput): Promise<RecurringRule>;
  updateRule(id: string, input: RuleInput): Promise<RecurringRule>;
  /** Stops the rule. Transactions it already created are kept, without their link to it. */
  deleteRule(id: string): Promise<void>;
  /** Makes an existing Transaction the first occurrence of a new rule (it is not duplicated). */
  createRuleFromTransaction(
    transactionId: string,
    schedule: { frequency: Frequency; endDate: string | null },
  ): Promise<RecurringRule>;
  /** Creates every Transaction the rules have made due up to and including today (YYYY-MM-DD). */
  materializeRules(today: string): Promise<Materialized>;
  undoMaterialize(batch: Materialized): Promise<void>;
  createCategory(type: TxType, name: string): Promise<CategoryResult>;
  /** A renamed starter default becomes a plain custom Category (it stops translating). */
  renameCategory(id: string, name: string): Promise<CategoryResult>;
  /** Counts the Category in the summary and charts again, or stops counting it (it stays in the Balance). */
  setCategoryCounted(id: string, counted: boolean): Promise<Category>;
  /** Removes the Category; its displayed name stays on its Transactions as a Retired label. */
  deleteCategory(id: string): Promise<CategoryDeletion>;
  restoreCategory(snapshot: CategoryDeletion): Promise<void>;
  /** Keeps a receipt photo with a Transaction. */
  addAttachment(transactionId: string, input: AttachmentInput): Promise<Attachment>;
  /** A Transaction's photos, in the order they were added. */
  attachmentsOf(transactionId: string): Promise<Attachment[]>;
  /** How many photos each Transaction has (Transactions with none are left out). */
  attachmentCounts(): Promise<Record<string, number>>;
  /** Every photo, oldest first (for the ZIP backup). */
  allAttachments(): Promise<Attachment[]>;
  /** Deletes the photos whose Transaction no longer exists. Not done on delete, so Undo can bring them back. */
  purgeOrphanAttachments(): Promise<void>;
  /** Removes a photo and returns it to pass to `restoreAttachment` for Undo. */
  removeAttachment(id: string): Promise<Attachment>;
  restoreAttachment(snapshot: Attachment): Promise<void>;
  updateSettings(patch: Partial<Settings>): Promise<Settings>;
  /** Import: replaces all Categories, Transactions and photos; settings are kept, the change count resets. */
  replaceAll(data: LedgerData, rules?: RecurringRule[], photos?: AttachmentSeed[], accounts?: Account[]): Promise<void>;
  /** Wipes everything, settings included, so the app is back at first run. */
  eraseAll(): Promise<void>;
  close(): void;
}

/** The few object-store operations the helpers need (both IDB stores in a transaction satisfy it). */
interface Store {
  getAll(): Promise<unknown[]>;
  get(key: string): Promise<unknown>;
  put(value: unknown, key?: string): Promise<unknown>;
  delete(key: string): Promise<unknown>;
}

/** Moves the given Categories to the front of the picker order (strictly newer than any other). */
async function markUsed(categories: Store, ids: string[]): Promise<void> {
  const all = (await categories.getAll()) as Category[];
  let stamp = Math.max(Date.now(), ...all.map((c) => c.lastUsedAt + 1));
  for (const id of ids) {
    const category = all.find((c) => c.id === id);
    if (category) await categories.put({ ...category, lastUsedAt: stamp++ });
  }
}

/** Stored settings with defaults filled in. */
function settingsFrom(stored: Partial<Settings> | undefined): Settings {
  const settings: Settings = { ...DEFAULT_SETTINGS, ...stored };
  // A database from before the Drive count: start it from the backup count.
  if (stored?.changesSinceDrive === undefined) settings.changesSinceDrive = settings.changesSinceBackup;
  return settings;
}

async function countChange(meta: Store, by: number): Promise<void> {
  const settings = settingsFrom((await meta.get('settings')) as Partial<Settings> | undefined);
  await meta.put(
    {
      ...settings,
      changesSinceBackup: Math.max(0, settings.changesSinceBackup + by),
      // An Undo counts too: Drive may already hold what was undone.
      changesSinceDrive: settings.changesSinceDrive + Math.abs(by),
    },
    'settings',
  );
}

/** The two Transactions of a Transfer, source first. "before" keeps their ids when an existing Transfer is edited. */
function transferHalves(
  input: TransferInput,
  transferId: string,
  createdAt: number,
  before: Transaction[] = [],
): [Transaction, Transaction] {
  const half = (type: TxType, accountId: string, createdAtOf: number): Transaction => ({
    id: before.find((t) => t.type === type)?.id ?? crypto.randomUUID(),
    accountId,
    transferId,
    date: input.date,
    type,
    cents: input.cents,
    categoryIds: [],
    retired: [],
    note: input.note,
    createdAt: createdAtOf,
  });
  return [half('expense', input.fromAccountId, createdAt), half('income', input.toAccountId, createdAt + 1)];
}

function retiredNames(carriers: Array<{ type: TxType; retired: string[] }>, type: TxType): string[] {
  return [...new Set(carriers.filter((c) => c.type === type).flatMap((c) => c.retired))];
}

/**
 * Opens (and if needed upgrades) the database. `onWaiting` is called when an older copy of the app, open
 * in another tab or window, is holding the database and the upgrade has to wait for it to close.
 */
export async function openLedger(
  dbName: string,
  nameOf: (category: Category) => string,
  onWaiting?: () => void,
  /** How an Account is named on screen (a starter Account is translated); only used to tell two apart. */
  shownName: (account: Account) => string = (a) => a.name,
): Promise<Ledger> {
  // Version 1: categories, transactions, meta. Version 2 adds recurring rules, version 3 receipt photos
  // (existing data is untouched). Version 4 adds Accounts: what was recorded so far moves into one Main account
  // that takes over the Opening balance.
  const db: IDBPDatabase = await openDB(dbName, 4, {
    async upgrade(database, oldVersion, _newVersion, upgrading) {
      if (oldVersion < 1) {
        database.createObjectStore('categories', { keyPath: 'id' });
        database.createObjectStore('transactions', { keyPath: 'id' });
        database.createObjectStore('meta');
      }
      if (oldVersion < 2) database.createObjectStore('rules', { keyPath: 'id' });
      if (oldVersion < 3) {
        database.createObjectStore('attachments', { keyPath: 'id' }).createIndex('byTransaction', 'transactionId');
      }
      if (oldVersion < 4) {
        database.createObjectStore('accounts', { keyPath: 'id' });
        const settings = (await upgrading.objectStore('meta').get('settings')) as (Partial<Settings> & { openingCents?: number }) | undefined;
        if (settings?.onboarded) {
          const main: Account = {
            id: crypto.randomUUID(),
            name: MAIN_ACCOUNT_NAME,
            defaultKey: MAIN_ACCOUNT_KEY,
            openingCents: settings.openingCents ?? 0,
          };
          await upgrading.objectStore('accounts').put(main);
          for (const store of ['transactions', 'rules'] as const) {
            for (const item of (await upgrading.objectStore(store).getAll()) as Array<Transaction | RecurringRule>) {
              await upgrading.objectStore(store).put({ ...item, accountId: main.id });
            }
          }
          const { openingCents: _moved, ...rest } = settings;
          await upgrading.objectStore('meta').put(rest, 'settings');
        }
      }
    },
    blocked() {
      onWaiting?.();
    },
    blocking() {
      // A newer version of the app needs to upgrade: let go of the database so it can.
      db.close();
    },
  });

  return {
    async load() {
      const categories = (await db.getAll('categories')) as Category[];
      const transactions = (await db.getAll('transactions')) as Transaction[];
      const rules = (await db.getAll('rules')) as RecurringRule[];
      const accounts = ((await db.getAll('accounts')) as Account[]).sort((a, b) => a.name.localeCompare(b.name));
      const stored = (await db.get('meta', 'settings')) as Partial<Settings> | undefined;
      return { data: { categories, transactions }, rules, accounts, settings: settingsFrom(stored) };
    },

    async seedMainAccount(openingCents) {
      const main: Account = { id: crypto.randomUUID(), name: MAIN_ACCOUNT_NAME, defaultKey: MAIN_ACCOUNT_KEY, openingCents };
      await db.put('accounts', main);
    },

    async createAccount(name, openingCents) {
      const tx = db.transaction(['accounts', 'meta'], 'readwrite');
      const all = (await tx.objectStore('accounts').getAll()) as Account[];
      const checked = validateAccountName(name, all.map(shownName));
      if (!checked.ok) {
        await tx.done;
        return checked;
      }
      const account: Account = { id: crypto.randomUUID(), name: checked.name, openingCents };
      await tx.objectStore('accounts').put(account);
      await countChange(tx.objectStore('meta'), 1);
      await tx.done;
      return { ok: true, account };
    },

    async updateAccount(id, name, openingCents) {
      const tx = db.transaction(['accounts', 'meta'], 'readwrite');
      const all = (await tx.objectStore('accounts').getAll()) as Account[];
      const current = all.find((a) => a.id === id)!;
      const checked = validateAccountName(name, all.filter((a) => a.id !== id).map(shownName));
      if (!checked.ok) {
        await tx.done;
        return checked;
      }
      // Keeping the shown name keeps a starter Account translating; any other name makes it a plain one.
      const renamed = checked.name !== shownName(current);
      const { defaultKey: _dropped, ...rest } = current;
      const account: Account = renamed ? { ...rest, name: checked.name, openingCents } : { ...current, openingCents };
      await tx.objectStore('accounts').put(account);
      await countChange(tx.objectStore('meta'), 1);
      await tx.done;
      return { ok: true, account };
    },

    async deleteAccount(id, transferLabel) {
      const tx = db.transaction(['accounts', 'transactions', 'rules', 'meta'], 'readwrite');
      const account = (await tx.objectStore('accounts').get(id)) as Account;
      const all = (await tx.objectStore('transactions').getAll()) as Transaction[];
      const own = all.filter((t) => t.accountId === id);
      const transferIds = new Set(own.flatMap((t) => (t.transferId === undefined ? [] : [t.transferId])));
      const partners = all.filter((t) => t.accountId !== id && t.transferId !== undefined && transferIds.has(t.transferId));
      for (const t of own) await tx.objectStore('transactions').delete(t.id);
      // The other half keeps its effect on its Account, as an ordinary Transaction labelled "Transfer".
      for (const t of partners) {
        const { transferId: _gone, ...rest } = t;
        await tx.objectStore('transactions').put({ ...rest, retired: [...t.retired, transferLabel] });
      }
      const rules = ((await tx.objectStore('rules').getAll()) as RecurringRule[]).filter((r) => r.accountId === id);
      for (const r of rules) await tx.objectStore('rules').delete(r.id);
      await tx.objectStore('accounts').delete(id);
      await countChange(tx.objectStore('meta'), 1);
      await tx.done;
      return { account, transactions: own, partners, rules };
    },

    async restoreAccount(snapshot) {
      const tx = db.transaction(['accounts', 'transactions', 'rules', 'meta'], 'readwrite');
      await tx.objectStore('accounts').put(snapshot.account);
      for (const t of [...snapshot.transactions, ...snapshot.partners]) await tx.objectStore('transactions').put(t);
      for (const r of snapshot.rules) await tx.objectStore('rules').put(r);
      await countChange(tx.objectStore('meta'), -1);
      await tx.done;
    },

    async addTransfer(input) {
      const tx = db.transaction(['transactions', 'meta'], 'readwrite');
      const existing = (await tx.objectStore('transactions').getAll()) as Transaction[];
      const createdAt = Math.max(Date.now(), ...existing.map((t) => (t.createdAt ?? 0) + 1));
      const halves = transferHalves(input, crypto.randomUUID(), createdAt);
      for (const half of halves) await tx.objectStore('transactions').put(half);
      await countChange(tx.objectStore('meta'), 1);
      await tx.done;
      return halves;
    },

    async updateTransfer(transferId, input) {
      const tx = db.transaction(['transactions', 'meta'], 'readwrite');
      const before = ((await tx.objectStore('transactions').getAll()) as Transaction[]).filter((t) => t.transferId === transferId);
      const createdAt = Math.min(...before.map((t) => t.createdAt ?? Date.now()));
      const halves = transferHalves(input, transferId, createdAt, before);
      for (const half of halves) await tx.objectStore('transactions').put(half);
      await countChange(tx.objectStore('meta'), 1);
      await tx.done;
      return halves;
    },

    async deleteTransfer(transferId) {
      const tx = db.transaction(['transactions', 'meta'], 'readwrite');
      const halves = ((await tx.objectStore('transactions').getAll()) as Transaction[]).filter((t) => t.transferId === transferId);
      for (const half of halves) await tx.objectStore('transactions').delete(half.id);
      await countChange(tx.objectStore('meta'), 1);
      await tx.done;
      return halves;
    },

    async restoreTransactions(snapshots) {
      const tx = db.transaction(['transactions', 'meta'], 'readwrite');
      for (const t of snapshots) await tx.objectStore('transactions').put(t);
      await countChange(tx.objectStore('meta'), -1);
      await tx.done;
    },

    async undoAddTransfer(transferId) {
      const tx = db.transaction(['transactions', 'meta'], 'readwrite');
      const halves = ((await tx.objectStore('transactions').getAll()) as Transaction[]).filter((t) => t.transferId === transferId);
      if (halves.length > 0) {
        for (const half of halves) await tx.objectStore('transactions').delete(half.id);
        await countChange(tx.objectStore('meta'), -1);
      }
      await tx.done;
    },

    async seedStarterCategories() {
      const base = Date.now();
      const tx = db.transaction('categories', 'readwrite');
      STARTER_CATEGORIES.forEach((starter, index) => {
        const category: Category = {
          id: crypto.randomUUID(),
          type: starter.type,
          name: starter.name,
          defaultKey: starter.key,
          lastUsedAt: base - index,
        };
        void tx.store.put(category);
      });
      await tx.done;
    },

    async addTransaction(input) {
      const tx = db.transaction(['categories', 'transactions', 'meta'], 'readwrite');
      const existing = (await tx.objectStore('transactions').getAll()) as Transaction[];
      const createdAt = Math.max(Date.now(), ...existing.map((t) => (t.createdAt ?? 0) + 1));
      const transaction: Transaction = { ...input, id: crypto.randomUUID(), createdAt };
      await tx.objectStore('transactions').put(transaction);
      await markUsed(tx.objectStore('categories'), transaction.categoryIds);
      await countChange(tx.objectStore('meta'), 1);
      await tx.done;
      return transaction;
    },

    async updateTransaction(id, input) {
      const tx = db.transaction(['categories', 'transactions', 'meta'], 'readwrite');
      const before = (await tx.objectStore('transactions').get(id)) as Transaction | undefined;
      const transaction: Transaction = {
        createdAt: before?.createdAt,
        ruleId: before?.ruleId,
        ...input,
        id,
      };
      await tx.objectStore('transactions').put(transaction);
      await markUsed(tx.objectStore('categories'), transaction.categoryIds);
      await countChange(tx.objectStore('meta'), 1);
      await tx.done;
      return transaction;
    },

    async deleteTransaction(id) {
      const tx = db.transaction(['transactions', 'meta'], 'readwrite');
      const snapshot = (await tx.objectStore('transactions').get(id)) as Transaction;
      await tx.objectStore('transactions').delete(id);
      await countChange(tx.objectStore('meta'), 1);
      await tx.done;
      return snapshot;
    },

    async restoreTransaction(snapshot) {
      const tx = db.transaction(['transactions', 'meta'], 'readwrite');
      await tx.objectStore('transactions').put(snapshot);
      await countChange(tx.objectStore('meta'), -1);
      await tx.done;
    },

    async addRule(input) {
      const rule: RecurringRule = { ...input, id: crypto.randomUUID() };
      const tx = db.transaction(['rules', 'meta'], 'readwrite');
      await tx.objectStore('rules').put(rule);
      await countChange(tx.objectStore('meta'), 1);
      await tx.done;
      return rule;
    },

    async updateRule(id, input) {
      const rule: RecurringRule = { ...input, id };
      const tx = db.transaction(['rules', 'meta'], 'readwrite');
      await tx.objectStore('rules').put(rule);
      await countChange(tx.objectStore('meta'), 1);
      await tx.done;
      return rule;
    },

    async undoAddTransaction(id) {
      const tx = db.transaction(['transactions', 'meta'], 'readwrite');
      const existing = await tx.objectStore('transactions').get(id);
      if (existing) {
        await tx.objectStore('transactions').delete(id);
        await countChange(tx.objectStore('meta'), -1);
      }
      await tx.done;
    },

    async createRuleFromTransaction(transactionId, schedule) {
      const tx = db.transaction(['transactions', 'rules', 'meta'], 'readwrite');
      const source = (await tx.objectStore('transactions').get(transactionId)) as Transaction;
      const draft: RecurringRule = {
        id: crypto.randomUUID(),
        accountId: source.accountId,
        type: source.type,
        cents: source.cents,
        categoryIds: source.categoryIds,
        retired: source.retired,
        note: source.note,
        frequency: schedule.frequency,
        startDate: source.date,
        endDate: schedule.endDate,
        nextDate: source.date,
      };
      // The Transaction itself is the first occurrence, so the rule continues from the one after it.
      const rule: RecurringRule = { ...draft, nextDate: dueOccurrences(draft, source.date).nextDate };
      await tx.objectStore('rules').put(rule);
      await tx.objectStore('transactions').put({ ...source, ruleId: rule.id });
      await countChange(tx.objectStore('meta'), 1);
      await tx.done;
      return rule;
    },

    async deleteRule(id) {
      const tx = db.transaction(['rules', 'transactions', 'meta'], 'readwrite');
      await tx.objectStore('rules').delete(id);
      const all = (await tx.objectStore('transactions').getAll()) as Transaction[];
      for (const t of all.filter((x) => x.ruleId === id)) {
        const { ruleId: _link, ...rest } = t;
        await tx.objectStore('transactions').put(rest);
      }
      await countChange(tx.objectStore('meta'), 1);
      await tx.done;
    },

    async materializeRules(today) {
      const tx = db.transaction(['categories', 'transactions', 'rules', 'meta'], 'readwrite');
      const rules = (await tx.objectStore('rules').getAll()) as RecurringRule[];
      const existing = (await tx.objectStore('transactions').getAll()) as Transaction[];
      let stamp = Math.max(Date.now(), ...existing.map((t) => (t.createdAt ?? 0) + 1));
      const created: Transaction[] = [];
      const rulesBefore: RecurringRule[] = [];

      for (const rule of rules) {
        const due = dueOccurrences(rule, today);
        if (due.dates.length === 0) continue;
        rulesBefore.push(rule);
        for (const date of due.dates) {
          const transaction: Transaction = {
            id: crypto.randomUUID(),
            accountId: rule.accountId,
            date,
            type: rule.type,
            cents: rule.cents,
            categoryIds: rule.categoryIds,
            retired: rule.retired,
            note: rule.note,
            createdAt: stamp++,
            ruleId: rule.id,
          };
          await tx.objectStore('transactions').put(transaction);
          created.push(transaction);
        }
        await tx.objectStore('rules').put({ ...rule, nextDate: due.nextDate });
      }
      if (created.length > 0) await countChange(tx.objectStore('meta'), created.length);
      await tx.done;
      return { created, rulesBefore };
    },

    async undoMaterialize(batch) {
      const tx = db.transaction(['transactions', 'rules', 'meta'], 'readwrite');
      for (const t of batch.created) await tx.objectStore('transactions').delete(t.id);
      for (const rule of batch.rulesBefore) await tx.objectStore('rules').put(rule);
      await countChange(tx.objectStore('meta'), -batch.created.length);
      await tx.done;
    },

    async createCategory(type, name) {
      const tx = db.transaction(['categories', 'transactions', 'rules', 'meta'], 'readwrite');
      const all = (await tx.objectStore('categories').getAll()) as Category[];
      const transactions = (await tx.objectStore('transactions').getAll()) as Transaction[];
      const rules = (await tx.objectStore('rules').getAll()) as RecurringRule[];
      const checked = validateCategoryName(name, {
        existing: all.filter((c) => c.type === type).map(nameOf),
        retired: retiredNames([...transactions, ...rules], type),
      });
      if (!checked.ok) {
        await tx.done;
        return checked;
      }
      const category: Category = {
        id: crypto.randomUUID(),
        type,
        name: checked.name,
        lastUsedAt: Math.max(Date.now(), ...all.map((c) => c.lastUsedAt + 1)),
      };
      await tx.objectStore('categories').put(category);
      await countChange(tx.objectStore('meta'), 1);
      await tx.done;
      return { ok: true, category };
    },

    async renameCategory(id, name) {
      const tx = db.transaction(['categories', 'transactions', 'rules', 'meta'], 'readwrite');
      const all = (await tx.objectStore('categories').getAll()) as Category[];
      const current = all.find((c) => c.id === id)!;
      const transactions = (await tx.objectStore('transactions').getAll()) as Transaction[];
      const rules = (await tx.objectStore('rules').getAll()) as RecurringRule[];
      const checked = validateCategoryName(name, {
        existing: all.filter((c) => c.type === current.type && c.id !== id).map(nameOf),
        retired: retiredNames([...transactions, ...rules], current.type),
      });
      if (!checked.ok) {
        await tx.done;
        return checked;
      }
      const { defaultKey: _dropped, ...rest } = current;
      const category: Category = { ...rest, name: checked.name };
      await tx.objectStore('categories').put(category);
      await countChange(tx.objectStore('meta'), 1);
      await tx.done;
      return { ok: true, category };
    },

    async setCategoryCounted(id, counted) {
      const tx = db.transaction(['categories', 'meta'], 'readwrite');
      const { uncounted: _old, ...rest } = (await tx.objectStore('categories').get(id)) as Category;
      const category: Category = counted ? rest : { ...rest, uncounted: true };
      await tx.objectStore('categories').put(category);
      await countChange(tx.objectStore('meta'), 1);
      await tx.done;
      return category;
    },

    async deleteCategory(id) {
      const tx = db.transaction(['categories', 'transactions', 'rules', 'meta'], 'readwrite');
      const category = (await tx.objectStore('categories').get(id)) as Category;
      const label = nameOf(category);
      const all = (await tx.objectStore('transactions').getAll()) as Transaction[];
      const touched = all.filter((t) => t.categoryIds.includes(id));
      for (const t of touched) {
        await tx.objectStore('transactions').put({
          ...t,
          categoryIds: t.categoryIds.filter((c) => c !== id),
          retired: t.retired.includes(label) ? t.retired : [...t.retired, label],
        });
      }
      const allRules = (await tx.objectStore('rules').getAll()) as RecurringRule[];
      const touchedRules = allRules.filter((r) => r.categoryIds.includes(id));
      for (const r of touchedRules) {
        await tx.objectStore('rules').put({
          ...r,
          categoryIds: r.categoryIds.filter((c) => c !== id),
          retired: r.retired.includes(label) ? r.retired : [...r.retired, label],
        });
      }
      await tx.objectStore('categories').delete(id);
      await countChange(tx.objectStore('meta'), 1);
      await tx.done;
      return { category, transactions: touched, rules: touchedRules, affected: touched.length };
    },

    async restoreCategory(snapshot) {
      const tx = db.transaction(['categories', 'transactions', 'rules', 'meta'], 'readwrite');
      await tx.objectStore('categories').put(snapshot.category);
      for (const t of snapshot.transactions) await tx.objectStore('transactions').put(t);
      for (const r of snapshot.rules) await tx.objectStore('rules').put(r);
      await countChange(tx.objectStore('meta'), -1);
      await tx.done;
    },

    async addAttachment(transactionId, input) {
      const tx = db.transaction(['attachments', 'meta'], 'readwrite');
      const existing = (await tx.objectStore('attachments').getAll()) as Attachment[];
      const addedAt = Math.max(Date.now(), ...existing.map((a) => a.addedAt + 1));
      const attachment: Attachment = { id: crypto.randomUUID(), transactionId, mime: input.mime, data: input.data, addedAt };
      await tx.objectStore('attachments').put(attachment);
      await countChange(tx.objectStore('meta'), 1);
      await tx.done;
      return attachment;
    },

    async attachmentsOf(transactionId) {
      const found = (await db.getAllFromIndex('attachments', 'byTransaction', transactionId)) as Attachment[];
      return found.sort((a, b) => a.addedAt - b.addedAt);
    },

    async attachmentCounts() {
      const counts: Record<string, number> = {};
      for (const a of (await db.getAll('attachments')) as Attachment[]) {
        counts[a.transactionId] = (counts[a.transactionId] ?? 0) + 1;
      }
      return counts;
    },

    async allAttachments() {
      return ((await db.getAll('attachments')) as Attachment[]).sort((a, b) => a.addedAt - b.addedAt);
    },

    async purgeOrphanAttachments() {
      const tx = db.transaction(['attachments', 'transactions'], 'readwrite');
      const alive = new Set((await tx.objectStore('transactions').getAllKeys()) as string[]);
      for (const a of (await tx.objectStore('attachments').getAll()) as Attachment[]) {
        if (!alive.has(a.transactionId)) await tx.objectStore('attachments').delete(a.id);
      }
      await tx.done;
    },

    async removeAttachment(id) {
      const tx = db.transaction(['attachments', 'meta'], 'readwrite');
      const snapshot = (await tx.objectStore('attachments').get(id)) as Attachment;
      await tx.objectStore('attachments').delete(id);
      await countChange(tx.objectStore('meta'), 1);
      await tx.done;
      return snapshot;
    },

    async restoreAttachment(snapshot) {
      const tx = db.transaction(['attachments', 'meta'], 'readwrite');
      await tx.objectStore('attachments').put(snapshot);
      await countChange(tx.objectStore('meta'), -1);
      await tx.done;
    },

    async updateSettings(patch) {
      const tx = db.transaction('meta', 'readwrite');
      const stored = ((await tx.store.get('settings')) as Partial<Settings> | undefined) ?? {};
      const settings: Settings = { ...settingsFrom(stored), ...patch };
      await tx.store.put(settings, 'settings');
      await tx.done;
      return settings;
    },

    async replaceAll(data, rules = [], photos = [], accounts = []) {
      const tx = db.transaction(['categories', 'transactions', 'rules', 'accounts', 'attachments', 'meta'], 'readwrite');
      await tx.objectStore('accounts').clear();
      for (const a of accounts) await tx.objectStore('accounts').put(a);
      await tx.objectStore('categories').clear();
      await tx.objectStore('transactions').clear();
      await tx.objectStore('rules').clear();
      await tx.objectStore('attachments').clear();
      let stamp = Date.now();
      for (const p of photos) {
        const attachment: Attachment = {
          id: p.id ?? crypto.randomUUID(),
          transactionId: p.transactionId,
          mime: p.mime,
          data: p.data,
          addedAt: p.addedAt ?? stamp++,
        };
        await tx.objectStore('attachments').put(attachment);
      }
      for (const c of data.categories) await tx.objectStore('categories').put(c);
      for (const t of data.transactions) await tx.objectStore('transactions').put(t);
      for (const r of rules) await tx.objectStore('rules').put(r);
      const stored = ((await tx.objectStore('meta').get('settings')) as Partial<Settings> | undefined) ?? {};
      await tx.objectStore('meta').put(
        // The imported data is not in Drive yet (a restore from Drive says otherwise right after).
        { ...settingsFrom(stored), onboarded: true, changesSinceBackup: 0, changesSinceDrive: 1 },
        'settings',
      );
      await tx.done;
    },

    async eraseAll() {
      const tx = db.transaction(['categories', 'transactions', 'rules', 'accounts', 'attachments', 'meta'], 'readwrite');
      await tx.objectStore('accounts').clear();
      await tx.objectStore('attachments').clear();
      await tx.objectStore('categories').clear();
      await tx.objectStore('transactions').clear();
      await tx.objectStore('rules').clear();
      await tx.objectStore('meta').clear();
      await tx.done;
    },

    close() {
      db.close();
    },
  };
}
