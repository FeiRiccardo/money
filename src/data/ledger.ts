import { openDB, type IDBPDatabase } from 'idb';
import { dueOccurrences } from '../domain/recurring';
import { validateCategoryName, type NameError } from '../domain/rules';
import {
  DEFAULT_SETTINGS,
  STARTER_CATEGORIES,
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
  load(): Promise<{ data: LedgerData; rules: RecurringRule[]; settings: Settings }>;
  seedStarterCategories(): Promise<void>;
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
  replaceAll(data: LedgerData, rules?: RecurringRule[], photos?: AttachmentSeed[]): Promise<void>;
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

async function countChange(meta: Store, by: number): Promise<void> {
  const stored = ((await meta.get('settings')) as Partial<Settings> | undefined) ?? {};
  const settings: Settings = { ...DEFAULT_SETTINGS, ...stored };
  await meta.put({ ...settings, changesSinceBackup: Math.max(0, settings.changesSinceBackup + by) }, 'settings');
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
): Promise<Ledger> {
  // Version 1: categories, transactions, meta. Version 2 adds recurring rules, version 3 receipt photos
  // (existing data is untouched).
  const db: IDBPDatabase = await openDB(dbName, 3, {
    upgrade(database, oldVersion) {
      if (oldVersion < 1) {
        database.createObjectStore('categories', { keyPath: 'id' });
        database.createObjectStore('transactions', { keyPath: 'id' });
        database.createObjectStore('meta');
      }
      if (oldVersion < 2) database.createObjectStore('rules', { keyPath: 'id' });
      if (oldVersion < 3) {
        database.createObjectStore('attachments', { keyPath: 'id' }).createIndex('byTransaction', 'transactionId');
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
      const stored = (await db.get('meta', 'settings')) as Partial<Settings> | undefined;
      return { data: { categories, transactions }, rules, settings: { ...DEFAULT_SETTINGS, ...stored } };
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
      const settings: Settings = { ...DEFAULT_SETTINGS, ...stored, ...patch };
      await tx.store.put(settings, 'settings');
      await tx.done;
      return settings;
    },

    async replaceAll(data, rules = [], photos = []) {
      const tx = db.transaction(['categories', 'transactions', 'rules', 'attachments', 'meta'], 'readwrite');
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
        { ...DEFAULT_SETTINGS, ...stored, onboarded: true, changesSinceBackup: 0 },
        'settings',
      );
      await tx.done;
    },

    async eraseAll() {
      const tx = db.transaction(['categories', 'transactions', 'rules', 'attachments', 'meta'], 'readwrite');
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
