import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { openDB } from 'idb';
import { openLedger } from './ledger';
import { DEFAULT_SETTINGS } from '../domain/types';

let counter = 0;
const freshName = () => `money-test-${++counter}`;
const nameOf = (c: { name: string }) => c.name;

describe('openLedger', () => {
  it('loads empty data and the default settings from a fresh database', async () => {
    const ledger = await openLedger(freshName(), nameOf);

    const { data, settings } = await ledger.load();

    expect(data).toEqual({ categories: [], transactions: [] });
    expect(settings).toEqual(DEFAULT_SETTINGS);
  });
});

describe('starter Categories and Transactions', () => {
  it('seeds the starter Categories, each with a default key, in separate Expense and Income lists', async () => {
    const ledger = await openLedger(freshName(), nameOf);

    await ledger.seedStarterCategories();
    const { data } = await ledger.load();

    // Picker order is most recently used first; fresh starters keep the starter order.
    const picker = (type: string) =>
      data.categories
        .filter((c) => c.type === type)
        .sort((a, b) => b.lastUsedAt - a.lastUsedAt)
        .map((c) => c.name);
    expect(picker('expense')).toEqual([
      'Groceries', 'Dining out', 'Transport', 'Housing', 'Utilities', 'Health', 'Entertainment', 'Shopping', 'Other',
    ]);
    expect(picker('income')).toEqual(['Salary', 'Gifts', 'Other']);
    expect(data.categories.every((c) => typeof c.defaultKey === 'string')).toBe(true);
  });

  it('keeps a saved Transaction after the database is closed and reopened', async () => {
    const name = freshName();
    const first = await openLedger(name, nameOf);
    await first.seedStarterCategories();
    const groceries = (await first.load()).data.categories.find((c) => c.defaultKey === 'groceries')!;

    const saved = await first.addTransaction({
      date: '2026-10-17', type: 'expense', cents: 6230, categoryIds: [groceries.id], retired: [], note: 'Weekly shop',
    });
    first.close();

    const second = await openLedger(name, nameOf);
    const { data } = await second.load();

    expect(data.transactions).toEqual([saved]);
    expect(saved.id).toEqual(expect.any(String));
  });
});

describe('what saving a Transaction does', () => {
  it('moves its Categories to the front of the picker order and counts one unbacked change', async () => {
    const ledger = await openLedger(freshName(), nameOf);
    await ledger.seedStarterCategories();
    const before = (await ledger.load()).data.categories;
    const transport = before.find((c) => c.defaultKey === 'transport')!;
    const health = before.find((c) => c.defaultKey === 'health')!;

    await ledger.addTransaction({
      date: '2026-10-03', type: 'expense', cents: 1240, categoryIds: [transport.id, health.id], retired: [], note: '',
    });
    const { data, settings } = await ledger.load();

    const picker = data.categories
      .filter((c) => c.type === 'expense')
      .sort((a, b) => b.lastUsedAt - a.lastUsedAt)
      .map((c) => c.name);
    expect(picker.slice(0, 3)).toEqual(expect.arrayContaining(['Transport', 'Health']));
    expect(picker.slice(0, 2).sort()).toEqual(['Health', 'Transport']);
    expect(picker[2]).toBe('Groceries');
    expect(settings.changesSinceBackup).toBe(1);
  });
});

async function ledgerWithOneTransaction() {
  const ledger = await openLedger(freshName(), nameOf);
  await ledger.seedStarterCategories();
  const categories = (await ledger.load()).data.categories;
  const groceries = categories.find((c) => c.defaultKey === 'groceries')!;
  const shopping = categories.find((c) => c.defaultKey === 'shopping')!;
  const saved = await ledger.addTransaction({
    date: '2026-10-17', type: 'expense', cents: 6230, categoryIds: [groceries.id], retired: [], note: 'Weekly shop',
  });
  return { ledger, groceries, shopping, saved };
}

describe('editing and deleting a Transaction', () => {
  it('replaces the stored Transaction, keeps its id, and counts another change', async () => {
    const { ledger, shopping, saved } = await ledgerWithOneTransaction();

    const updated = await ledger.updateTransaction(saved.id, {
      date: '2026-10-18', type: 'expense', cents: 7000, categoryIds: [shopping.id], retired: ['Gym'], note: 'New pan',
    });
    const { data, settings } = await ledger.load();

    expect(updated).toEqual({
      id: saved.id, date: '2026-10-18', type: 'expense', cents: 7000, categoryIds: [shopping.id], retired: ['Gym'], note: 'New pan',
      createdAt: saved.createdAt, // an edit does not change when it was first recorded
    });
    expect(data.transactions).toEqual([updated]);
    expect(settings.changesSinceBackup).toBe(2);
  });
});

describe('deleting a Transaction and Undo', () => {
  it('deletes at once and returns a snapshot; restoring it brings everything back, as if never deleted', async () => {
    const { ledger, saved } = await ledgerWithOneTransaction();

    const removed = await ledger.deleteTransaction(saved.id);
    const afterDelete = await ledger.load();

    expect(removed).toEqual(saved);
    expect(afterDelete.data.transactions).toEqual([]);
    expect(afterDelete.settings.changesSinceBackup).toBe(2);

    await ledger.restoreTransaction(removed);
    const afterUndo = await ledger.load();

    expect(afterUndo.data.transactions).toEqual([saved]);
    expect(afterUndo.settings.changesSinceBackup).toBe(1);
  });
});

describe('creating a Category', () => {
  it('adds it at the front of the picker order for its type and counts a change', async () => {
    const { ledger } = await ledgerWithOneTransaction();

    const result = await ledger.createCategory('expense', '  Gym ');
    const { data, settings } = await ledger.load();

    expect(result).toEqual({ ok: true, category: expect.objectContaining({ type: 'expense', name: 'Gym' }) });
    const picker = data.categories
      .filter((c) => c.type === 'expense')
      .sort((a, b) => b.lastUsedAt - a.lastUsedAt)
      .map((c) => c.name);
    expect(picker[0]).toBe('Gym');
    expect(settings.changesSinceBackup).toBe(2);
  });

  it('refuses a duplicate name within the same type, ignoring case, but allows it in the other type', async () => {
    const { ledger } = await ledgerWithOneTransaction();

    expect(await ledger.createCategory('expense', 'groceries')).toEqual({ ok: false, reason: 'duplicate' });
    expect(await ledger.createCategory('income', 'Groceries')).toEqual({
      ok: true,
      category: expect.objectContaining({ type: 'income', name: 'Groceries' }),
    });
    expect(await ledger.createCategory('expense', 'a|b')).toEqual({ ok: false, reason: 'pipe' });
  });
});

describe('deleting a Category', () => {
  it('leaves its name on the Transactions that had it as a Retired label, and reports how many were affected', async () => {
    const { ledger, groceries, shopping, saved } = await ledgerWithOneTransaction();
    const both = await ledger.updateTransaction(saved.id, {
      date: saved.date, type: 'expense', cents: saved.cents, categoryIds: [groceries.id, shopping.id], retired: ['Gym'], note: '',
    });

    const snapshot = await ledger.deleteCategory(groceries.id);
    const { data } = await ledger.load();

    expect(snapshot.affected).toBe(1);
    expect(data.categories.find((c) => c.id === groceries.id)).toBeUndefined();
    expect(data.transactions).toEqual([{ ...both, categoryIds: [shopping.id], retired: ['Gym', 'Groceries'] }]);
  });

  it('can be undone: the Category and every affected Transaction come back exactly as they were', async () => {
    const { ledger, groceries, saved } = await ledgerWithOneTransaction();
    const before = await ledger.load();

    const snapshot = await ledger.deleteCategory(groceries.id);
    await ledger.restoreCategory(snapshot);
    const after = await ledger.load();

    expect(after.data.categories).toEqual(before.data.categories);
    expect(after.data.transactions).toEqual([saved]);
    expect(after.settings.changesSinceBackup).toBe(before.settings.changesSinceBackup);
  });
});

describe('Retired labels reserve their name', () => {
  it('refuses to create a Category with a deleted Category\'s name, but only in the same type', async () => {
    const { ledger, groceries } = await ledgerWithOneTransaction();
    await ledger.deleteCategory(groceries.id);

    expect(await ledger.createCategory('expense', 'groceries')).toEqual({ ok: false, reason: 'reserved' });
    expect((await ledger.createCategory('income', 'Groceries')).ok).toBe(true);
  });
});

describe('a deleted Category nobody used', () => {
  it('leaves no Retired label, so its name is free to use again', async () => {
    const { ledger, shopping } = await ledgerWithOneTransaction();
    await ledger.deleteCategory(shopping.id);

    expect((await ledger.createCategory('expense', 'Shopping')).ok).toBe(true);
  });
});

describe('renaming a Category', () => {
  it('renames it, turns a starter default into a plain custom Category, and counts a change', async () => {
    const { ledger, groceries } = await ledgerWithOneTransaction();

    const result = await ledger.renameCategory(groceries.id, ' Supermarket ');
    const { data, settings } = await ledger.load();

    expect(result).toEqual({ ok: true, category: expect.objectContaining({ id: groceries.id, name: 'Supermarket' }) });
    const stored = data.categories.find((c) => c.id === groceries.id)!;
    expect(stored.name).toBe('Supermarket');
    expect(stored.defaultKey).toBeUndefined();
    expect(settings.changesSinceBackup).toBe(2);
  });

  it('refuses a name used by another Category or reserved by a Retired label, but accepts keeping its own name', async () => {
    const { ledger, groceries, shopping } = await ledgerWithOneTransaction();
    await ledger.addTransaction({
      date: '2026-10-18', type: 'expense', cents: 500, categoryIds: [shopping.id], retired: [], note: '',
    });
    await ledger.deleteCategory(shopping.id);

    expect(await ledger.renameCategory(groceries.id, 'Transport')).toEqual({ ok: false, reason: 'duplicate' });
    expect(await ledger.renameCategory(groceries.id, 'shopping')).toEqual({ ok: false, reason: 'reserved' });
    expect((await ledger.renameCategory(groceries.id, 'GROCERIES')).ok).toBe(true);
  });
});

describe('replacing and erasing everything', () => {
  it('replaceAll swaps in the imported data, keeps language and opening balance, and resets the change count', async () => {
    const { ledger } = await ledgerWithOneTransaction();
    await ledger.updateSettings({ language: 'it', openingCents: 12345 });
    const imported = {
      categories: [{ id: 'c1', type: 'expense' as const, name: 'Food', lastUsedAt: 5 }],
      transactions: [
        { id: 't1', date: '2026-01-02', type: 'expense' as const, cents: 100, categoryIds: ['c1'], retired: [], note: '' },
      ],
    };

    await ledger.replaceAll(imported);
    const { data, settings } = await ledger.load();

    expect(data).toEqual(imported);
    expect(settings).toEqual(expect.objectContaining({
      language: 'it', openingCents: 12345, onboarded: true, changesSinceBackup: 0,
    }));
  });

  it('eraseAll removes every Category, Transaction and setting, so the app is back at first run', async () => {
    const { ledger } = await ledgerWithOneTransaction();
    await ledger.updateSettings({ language: 'it', openingCents: 999, onboarded: true });

    await ledger.eraseAll();
    const { data, settings } = await ledger.load();

    expect(data).toEqual({ categories: [], transactions: [] });
    expect(settings).toEqual(DEFAULT_SETTINGS);
  });
});

describe('upgrading a database written by the first version', () => {
  it('keeps every Transaction and setting, and adds an empty list of recurring rules', async () => {
    const name = freshName();
    // Exactly the schema the live app created in version 1.
    const old = await openDB(name, 1, {
      upgrade(database) {
        database.createObjectStore('categories', { keyPath: 'id' });
        database.createObjectStore('transactions', { keyPath: 'id' });
        database.createObjectStore('meta');
      },
    });
    const legacy = { id: 't1', date: '2026-10-01', type: 'expense', cents: 100, categoryIds: [], retired: ['Gym'], note: 'old' };
    await old.put('transactions', legacy);
    await old.put('meta', { language: 'it', openingCents: 500, onboarded: true }, 'settings');
    old.close();

    const ledger = await openLedger(name, nameOf);
    const { data, rules, settings } = await ledger.load();

    expect(data.transactions).toEqual([legacy]);
    expect(rules).toEqual([]);
    expect(settings).toEqual(expect.objectContaining({ language: 'it', openingCents: 500, onboarded: true, sortOrder: 'newest' }));
  });
});

describe('when a Transaction was recorded', () => {
  it('stamps each new Transaction later than every earlier one, even within the same millisecond', async () => {
    const { ledger, groceries } = await ledgerWithOneTransaction();
    const input = { date: '2026-10-17', type: 'expense' as const, cents: 100, categoryIds: [groceries.id], retired: [], note: '' };

    const a = await ledger.addTransaction(input);
    const b = await ledger.addTransaction(input);
    const c = await ledger.addTransaction(input);

    expect(a.createdAt).toEqual(expect.any(Number));
    expect(b.createdAt!).toBeGreaterThan(a.createdAt!);
    expect(c.createdAt!).toBeGreaterThan(b.createdAt!);
  });

  it('is kept, with the link to a recurring rule, when the Transaction is edited', async () => {
    const { ledger, groceries } = await ledgerWithOneTransaction();
    const saved = await ledger.addTransaction({
      date: '2026-10-17', type: 'expense', cents: 100, categoryIds: [groceries.id], retired: [], note: '', ruleId: 'rule-1',
    });

    const edited = await ledger.updateTransaction(saved.id, {
      date: '2026-10-18', type: 'expense', cents: 250, categoryIds: [groceries.id], retired: [], note: 'changed',
    });

    expect(edited.createdAt).toBe(saved.createdAt);
    expect(edited.ruleId).toBe('rule-1');
    expect(edited.cents).toBe(250);
  });
});

async function ledgerWithRule(over: Record<string, unknown> = {}) {
  const base = await ledgerWithOneTransaction();
  const rule = await base.ledger.addRule({
    type: 'expense', cents: 72000, categoryIds: [base.groceries.id], retired: [], note: 'Rent',
    frequency: 'monthly', startDate: '2026-01-31', endDate: null, nextDate: '2026-01-31', ...over,
  });
  return { ...base, rule };
}

describe('recurring rules', () => {
  it('addRule stores the rule with its own id and counts a change', async () => {
    const { ledger, rule } = await ledgerWithRule();
    const { rules, settings } = await ledger.load();

    expect(rule.id).toEqual(expect.any(String));
    expect(rules).toEqual([rule]);
    expect(settings.changesSinceBackup).toBe(2); // the first Transaction, then the rule
  });

  it('updateRule changes the rule but keeps its id', async () => {
    const { ledger, rule } = await ledgerWithRule();

    const updated = await ledger.updateRule(rule.id, {
      type: 'expense', cents: 75000, categoryIds: rule.categoryIds, retired: [], note: 'Rent (new price)',
      frequency: 'monthly', startDate: rule.startDate, endDate: '2026-12-31', nextDate: rule.nextDate,
    });

    expect(updated).toEqual({ ...rule, cents: 75000, note: 'Rent (new price)', endDate: '2026-12-31' });
    expect((await ledger.load()).rules).toEqual([updated]);
  });

  it('deleteRule stops the rule but keeps its Transactions, now without the link to it', async () => {
    const { ledger, rule, groceries } = await ledgerWithRule();
    const made = await ledger.addTransaction({
      date: '2026-01-31', type: 'expense', cents: 72000, categoryIds: [groceries.id], retired: [], note: 'Rent', ruleId: rule.id,
    });

    await ledger.deleteRule(rule.id);
    const { rules, data } = await ledger.load();

    expect(rules).toEqual([]);
    const kept = data.transactions.find((t) => t.id === made.id)!;
    expect(kept.note).toBe('Rent');
    expect(kept.ruleId).toBeUndefined();
  });
});

describe('creating the Transactions a rule has made due', () => {
  it('back-fills every missed occurrence as an ordinary Transaction linked to the rule, and moves the rule on', async () => {
    const { ledger, rule, groceries } = await ledgerWithRule({ startDate: '2026-01-31', nextDate: '2026-01-31' });

    const { created } = await ledger.materializeRules('2026-04-15');
    const { data, rules, settings } = await ledger.load();

    expect(created.map((t) => t.date)).toEqual(['2026-01-31', '2026-02-28', '2026-03-31']);
    expect(created.every((t) => t.ruleId === rule.id && t.note === 'Rent' && t.cents === 72000)).toBe(true);
    expect(created.every((t) => t.categoryIds.join() === groceries.id)).toBe(true);
    expect(created[1]!.createdAt!).toBeGreaterThan(created[0]!.createdAt!);
    expect(data.transactions.filter((t) => t.ruleId === rule.id)).toHaveLength(3);
    expect(rules[0]!.nextDate).toBe('2026-04-30');
    expect(settings.changesSinceBackup).toBe(2 + 3);
  });

  it('creates nothing the second time on the same day, and nothing when no rule is due', async () => {
    const { ledger } = await ledgerWithRule({ startDate: '2026-01-31', nextDate: '2026-01-31' });
    await ledger.materializeRules('2026-04-15');

    const again = await ledger.materializeRules('2026-04-15');

    expect(again.created).toEqual([]);
    const empty = await openLedger(freshName(), nameOf);
    expect((await empty.materializeRules('2026-04-15')).created).toEqual([]);
  });
});

describe('undoing a batch of generated Transactions', () => {
  it('removes exactly what was created, puts the rule back where it was, and restores the change count', async () => {
    const { ledger } = await ledgerWithRule({ startDate: '2026-01-31', nextDate: '2026-01-31' });
    const before = await ledger.load();

    const batch = await ledger.materializeRules('2026-04-15');
    await ledger.undoMaterialize(batch);
    const after = await ledger.load();

    expect(after.data.transactions).toEqual(before.data.transactions);
    expect(after.rules).toEqual(before.rules);
    expect(after.settings.changesSinceBackup).toBe(before.settings.changesSinceBackup);
  });

  it('leaves Transactions the user added meanwhile alone', async () => {
    const { ledger, groceries } = await ledgerWithRule({ startDate: '2026-03-01', nextDate: '2026-03-01' });
    const batch = await ledger.materializeRules('2026-03-10');
    const mine = await ledger.addTransaction({
      date: '2026-03-05', type: 'expense', cents: 100, categoryIds: [groceries.id], retired: [], note: 'mine',
    });

    await ledger.undoMaterialize(batch);

    expect((await ledger.load()).data.transactions.map((t) => t.id)).toContain(mine.id);
  });
});

describe('making a Transaction repeat', () => {
  it('turns it into the first occurrence of a new rule, without duplicating it', async () => {
    const { ledger, saved } = await ledgerWithOneTransaction(); // 2026-10-17, 62.30, Groceries, "Weekly shop"

    const rule = await ledger.createRuleFromTransaction(saved.id, { frequency: 'monthly', endDate: null });
    const { data, rules } = await ledger.load();

    expect(rule).toEqual(expect.objectContaining({
      type: 'expense', cents: 6230, note: 'Weekly shop', frequency: 'monthly',
      startDate: '2026-10-17', endDate: null, nextDate: '2026-11-17', categoryIds: saved.categoryIds,
    }));
    expect(rules).toEqual([rule]);
    expect(data.transactions).toHaveLength(1);
    expect(data.transactions[0]!.ruleId).toBe(rule.id);
  });

  it('back-fills the occurrences between a past date and today when materialized', async () => {
    const { ledger, saved } = await ledgerWithOneTransaction();
    await ledger.createRuleFromTransaction(saved.id, { frequency: 'monthly', endDate: null });

    const { created } = await ledger.materializeRules('2027-01-20');

    expect(created.map((t) => t.date)).toEqual(['2026-11-17', '2026-12-17', '2027-01-17']);
  });

  it('keeps the end date it was given', async () => {
    const { ledger, saved } = await ledgerWithOneTransaction();

    const rule = await ledger.createRuleFromTransaction(saved.id, { frequency: 'weekly', endDate: '2026-12-31' });

    expect(rule.endDate).toBe('2026-12-31');
    expect(rule.nextDate).toBe('2026-10-24');
  });
});

describe('rules and deleted Categories', () => {
  it('a rule keeps its schedule but carries the deleted Category as a Retired label, and Undo restores it', async () => {
    const { ledger, rule, groceries } = await ledgerWithRule();

    const snapshot = await ledger.deleteCategory(groceries.id);
    const afterDelete = (await ledger.load()).rules[0]!;

    expect(afterDelete.categoryIds).toEqual([]);
    expect(afterDelete.retired).toEqual(['Groceries']);
    expect(afterDelete.frequency).toBe('monthly');

    await ledger.restoreCategory(snapshot);
    expect((await ledger.load()).rules).toEqual([rule]);
  });

  it('keeps generating Transactions with the Retired label after the Category is gone', async () => {
    const { ledger, groceries } = await ledgerWithRule({ startDate: '2026-03-01', nextDate: '2026-03-01' });
    await ledger.deleteCategory(groceries.id);

    const { created } = await ledger.materializeRules('2026-03-02');

    expect(created[0]).toEqual(expect.objectContaining({ categoryIds: [], retired: ['Groceries'] }));
  });

  it('a Retired label held only by a rule still reserves its name', async () => {
    const { ledger, groceries } = await ledgerWithRule();
    // Remove the Transaction that also used Groceries, so only the rule carries the label.
    const { data } = await ledger.load();
    for (const t of data.transactions) await ledger.deleteTransaction(t.id);

    await ledger.deleteCategory(groceries.id);

    expect(await ledger.createCategory('expense', 'groceries')).toEqual({ ok: false, reason: 'reserved' });
  });
});

describe('replacing and erasing with rules', () => {
  it('replaceAll swaps the rules too, and keeps settings', async () => {
    const { ledger } = await ledgerWithRule();
    await ledger.updateSettings({ language: 'it' });
    const imported = {
      id: 'new-rule', type: 'income' as const, cents: 100, categoryIds: [], retired: ['Pay'], note: 'x',
      frequency: 'weekly' as const, startDate: '2026-01-01', endDate: null, nextDate: '2026-02-01',
    };

    await ledger.replaceAll({ categories: [], transactions: [] }, [imported]);
    const { rules, settings } = await ledger.load();

    expect(rules).toEqual([imported]);
    expect(settings.language).toBe('it');
  });

  it('replaceAll without rules removes every existing rule', async () => {
    const { ledger } = await ledgerWithRule();

    await ledger.replaceAll({ categories: [], transactions: [] });

    expect((await ledger.load()).rules).toEqual([]);
  });

  it('eraseAll removes the rules as well', async () => {
    const { ledger } = await ledgerWithRule();

    await ledger.eraseAll();

    expect((await ledger.load()).rules).toEqual([]);
  });
});

describe('an older copy of the app still has the database open', () => {
  it('tells the caller it is waiting, and finishes the upgrade as soon as the older copy closes', async () => {
    const name = freshName();
    const older = await openDB(name, 1, {
      upgrade(database) {
        database.createObjectStore('categories', { keyPath: 'id' });
        database.createObjectStore('transactions', { keyPath: 'id' });
        database.createObjectStore('meta');
      },
    });
    let waitingNotices = 0;

    const opening = openLedger(name, nameOf, () => {
      waitingNotices++;
    });
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(waitingNotices).toBe(1);

    older.close();
    const ledger = await opening;
    expect((await ledger.load()).rules).toEqual([]);
  });
});

describe('undoing an add', () => {
  it('removes the Transaction that was just added and gives back the change count', async () => {
    const { ledger, groceries } = await ledgerWithOneTransaction();
    const before = await ledger.load();
    const added = await ledger.addTransaction({
      date: '2026-10-20', type: 'expense', cents: 450, categoryIds: [groceries.id], retired: [], note: 'oops',
    });

    await ledger.undoAddTransaction(added.id);
    const after = await ledger.load();

    expect(after.data.transactions).toEqual(before.data.transactions);
    expect(after.settings.changesSinceBackup).toBe(before.settings.changesSinceBackup);
  });

  it('does nothing if that Transaction is already gone', async () => {
    const { ledger } = await ledgerWithOneTransaction();
    const before = await ledger.load();

    await ledger.undoAddTransaction('does-not-exist');

    expect((await ledger.load()).settings.changesSinceBackup).toBe(before.settings.changesSinceBackup);
  });
});

describe('receipt photos', () => {
  const photo = (...bytes: number[]) => ({ mime: 'image/jpeg', data: new Uint8Array(bytes).buffer });
  const bytesOf = (a: { data: ArrayBuffer }) => [...new Uint8Array(a.data)];

  it('keeps photos attached to their Transaction, in the order they were added, after reopening', async () => {
    const name = freshName();
    const first = await openLedger(name, nameOf);
    await first.seedStarterCategories();
    const groceries = (await first.load()).data.categories.find((c) => c.defaultKey === 'groceries')!;
    const a = await first.addTransaction({ date: '2026-10-17', type: 'expense', cents: 100, categoryIds: [groceries.id], retired: [], note: 'a' });
    const b = await first.addTransaction({ date: '2026-10-18', type: 'expense', cents: 200, categoryIds: [groceries.id], retired: [], note: 'b' });

    await first.addAttachment(a.id, photo(1));
    await first.addAttachment(a.id, photo(2));
    await first.addAttachment(b.id, photo(3));
    first.close();

    const second = await openLedger(name, nameOf);
    expect((await second.attachmentsOf(a.id)).map(bytesOf)).toEqual([[1], [2]]);
    expect((await second.attachmentsOf(b.id)).map(bytesOf)).toEqual([[3]]);
    expect(await second.attachmentCounts()).toEqual({ [a.id]: 2, [b.id]: 1 });
  });

  it('counts adding and removing a photo as changes since the last backup', async () => {
    const { ledger, saved } = await ledgerWithOneTransaction();
    const base = (await ledger.load()).settings.changesSinceBackup;

    const added = await ledger.addAttachment(saved.id, photo(1));
    expect((await ledger.load()).settings.changesSinceBackup).toBe(base + 1);

    await ledger.removeAttachment(added.id);
    expect((await ledger.load()).settings.changesSinceBackup).toBe(base + 2);
  });

  it('removes a photo, and restoring the snapshot brings it back with the same id and the change count back', async () => {
    const { ledger, saved } = await ledgerWithOneTransaction();
    const added = await ledger.addAttachment(saved.id, photo(7, 8));
    const base = (await ledger.load()).settings.changesSinceBackup;

    const snapshot = await ledger.removeAttachment(added.id);
    expect(await ledger.attachmentsOf(saved.id)).toEqual([]);

    await ledger.restoreAttachment(snapshot);
    const [back] = await ledger.attachmentsOf(saved.id);
    expect(back.id).toBe(added.id);
    expect(bytesOf(back)).toEqual([7, 8]);
    expect((await ledger.load()).settings.changesSinceBackup).toBe(base);
  });
});

describe('receipt photos: cleanup, import and erase', () => {
  const photo = (...bytes: number[]) => ({ mime: 'image/jpeg', data: new Uint8Array(bytes).buffer });
  const bytesOf = (a: { data: ArrayBuffer }) => [...new Uint8Array(a.data)];

  it('keeps the photos of a deleted Transaction until it is purged, so Undo still has them', async () => {
    const { ledger, saved } = await ledgerWithOneTransaction();
    await ledger.addAttachment(saved.id, photo(1));

    const snapshot = await ledger.deleteTransaction(saved.id);
    expect((await ledger.attachmentsOf(saved.id)).length).toBe(1);

    await ledger.restoreTransaction(snapshot);
    await ledger.purgeOrphanAttachments();
    expect((await ledger.attachmentsOf(saved.id)).length).toBe(1);

    await ledger.deleteTransaction(saved.id);
    await ledger.purgeOrphanAttachments();
    expect(await ledger.attachmentCounts()).toEqual({});
  });

  it('lists every photo, for the ZIP backup', async () => {
    const { ledger, saved } = await ledgerWithOneTransaction();
    await ledger.addAttachment(saved.id, photo(1));
    await ledger.addAttachment(saved.id, photo(2));

    expect((await ledger.allAttachments()).map(bytesOf)).toEqual([[1], [2]]);
  });

  it('replaceAll swaps the photos for the imported ones, and passing the old ones back undoes it', async () => {
    const { ledger, saved } = await ledgerWithOneTransaction();
    await ledger.addAttachment(saved.id, photo(1));
    const before = await ledger.load();
    const oldPhotos = await ledger.allAttachments();
    const imported = {
      categories: before.data.categories,
      transactions: [{ ...saved, id: 'imported-1' }],
    };

    await ledger.replaceAll(imported, [], [{ transactionId: 'imported-1', ...photo(9) }]);
    expect(await ledger.attachmentCounts()).toEqual({ 'imported-1': 1 });
    expect(bytesOf((await ledger.attachmentsOf('imported-1'))[0])).toEqual([9]);

    await ledger.replaceAll(before.data, before.rules, oldPhotos);
    expect(await ledger.attachmentCounts()).toEqual({ [saved.id]: 1 });
  });

  it('replaceAll without photos removes the existing ones, and eraseAll removes them too', async () => {
    const { ledger, saved } = await ledgerWithOneTransaction();
    await ledger.addAttachment(saved.id, photo(1));
    const { data } = await ledger.load();

    await ledger.replaceAll(data);
    expect(await ledger.attachmentCounts()).toEqual({});

    await ledger.addAttachment(saved.id, photo(2));
    await ledger.eraseAll();
    expect(await ledger.allAttachments()).toEqual([]);
  });

  it('upgrades a database made before photos existed without losing anything', async () => {
    const name = freshName();
    const old = await openDB(name, 2, {
      upgrade(db) {
        db.createObjectStore('categories', { keyPath: 'id' });
        db.createObjectStore('transactions', { keyPath: 'id' });
        db.createObjectStore('meta');
        db.createObjectStore('rules', { keyPath: 'id' });
      },
    });
    await old.put('categories', { id: 'c1', type: 'expense', name: 'Food', lastUsedAt: 0 });
    old.close();

    const ledger = await openLedger(name, nameOf);

    expect((await ledger.load()).data.categories.map((c) => c.name)).toEqual(['Food']);
    expect(await ledger.attachmentCounts()).toEqual({});
  });
});

describe('changes not yet saved to Google Drive', () => {
  it('counts every write, Undo included, because Drive may already hold what was undone', async () => {
    const { ledger, saved } = await ledgerWithOneTransaction();
    expect((await ledger.load()).settings.changesSinceDrive).toBe(1);

    await ledger.updateSettings({ changesSinceDrive: 0 });
    await ledger.undoAddTransaction(saved.id);
    expect((await ledger.load()).settings.changesSinceDrive).toBe(1);
  });

  it('marks data imported from a file as not in Drive yet', async () => {
    const { ledger } = await ledgerWithOneTransaction();
    await ledger.updateSettings({ changesSinceDrive: 0 });
    await ledger.replaceAll({ categories: [], transactions: [] });
    expect((await ledger.load()).settings.changesSinceDrive).toBe(1);
  });

  it('starts from the backup count on a database saved before the Drive count existed', async () => {
    const name = freshName();
    const ledger = await openLedger(name, nameOf);
    ledger.close();
    const db = await openDB(name);
    await db.put('meta', { ...DEFAULT_SETTINGS, changesSinceBackup: 4, changesSinceDrive: undefined }, 'settings');
    db.close();

    const reopened = await openLedger(name, nameOf);
    expect((await reopened.load()).settings.changesSinceDrive).toBe(4);
  });
});

