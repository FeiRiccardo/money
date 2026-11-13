import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { openLedger } from './ledger';

let counter = 0;
const freshName = () => `money-accounts-test-${++counter}`;
const nameOf = (c: { name: string }) => c.name;

async function twoAccounts() {
  const ledger = await openLedger(freshName(), nameOf);
  await ledger.seedStarterCategories();
  await ledger.seedMainAccount(10000);
  const made = await ledger.createAccount('Savings', 50000);
  if (!made.ok) throw new Error('could not create');
  const { accounts } = await ledger.load();
  const main = accounts.find((a) => a.defaultKey === 'main')!;
  return { ledger, main, savings: made.account };
}

describe('Accounts', () => {
  it('starts a new database with one Main account holding the Opening balance', async () => {
    const ledger = await openLedger(freshName(), nameOf);
    await ledger.seedMainAccount(2500);

    const { accounts } = await ledger.load();

    expect(accounts).toEqual([expect.objectContaining({ name: 'Main account', defaultKey: 'main', openingCents: 2500 })]);
  });

  it('lists Accounts by name and refuses a name another Account already has, whatever its case', async () => {
    const { ledger } = await twoAccounts();

    const duplicate = await ledger.createAccount('  savings ', 0);
    const empty = await ledger.createAccount('   ', 0);
    const { accounts } = await ledger.load();

    expect(duplicate).toEqual({ ok: false, reason: 'duplicate' });
    expect(empty).toEqual({ ok: false, reason: 'empty' });
    expect(accounts.map((a) => a.name)).toEqual(['Main account', 'Savings']);
  });

  it('keeps the starter Account translating until it is given another name', async () => {
    const { ledger, main } = await twoAccounts();

    const sameName = await ledger.updateAccount(main.id, 'Main account', 99);
    const renamed = await ledger.updateAccount(main.id, 'Checking', 99);

    expect(sameName.ok && sameName.account.defaultKey).toBe('main');
    expect(renamed.ok && renamed.account).toEqual({ id: main.id, name: 'Checking', openingCents: 99 });
  });

  it('records a Transfer as an Expense on the source and an Income on the destination, sharing one transferId', async () => {
    const { ledger, main, savings } = await twoAccounts();

    const [from, to] = await ledger.addTransfer({ date: '2026-11-01', cents: 20000, fromAccountId: main.id, toAccountId: savings.id, note: 'Monthly saving' });
    const { data } = await ledger.load();

    expect(from).toMatchObject({ type: 'expense', accountId: main.id, cents: 20000, categoryIds: [], retired: [] });
    expect(to).toMatchObject({ type: 'income', accountId: savings.id, cents: 20000 });
    expect(from.transferId).toBeDefined();
    expect(to.transferId).toBe(from.transferId);
    expect(data.transactions).toHaveLength(2);
  });

  it('edits both halves of a Transfer together, keeping their ids', async () => {
    const { ledger, main, savings } = await twoAccounts();
    const [from, to] = await ledger.addTransfer({ date: '2026-11-01', cents: 20000, fromAccountId: main.id, toAccountId: savings.id, note: '' });

    await ledger.updateTransfer(from.transferId!, { date: '2026-11-05', cents: 30000, fromAccountId: savings.id, toAccountId: main.id, note: 'back' });
    const { data } = await ledger.load();

    expect(data.transactions.find((t) => t.id === from.id)).toMatchObject({ type: 'expense', accountId: savings.id, cents: 30000, date: '2026-11-05', note: 'back' });
    expect(data.transactions.find((t) => t.id === to.id)).toMatchObject({ type: 'income', accountId: main.id, cents: 30000 });
  });

  it('deletes both halves of a Transfer, and Undo puts both back', async () => {
    const { ledger, main, savings } = await twoAccounts();
    const [from] = await ledger.addTransfer({ date: '2026-11-01', cents: 100, fromAccountId: main.id, toAccountId: savings.id, note: '' });

    const snapshot = await ledger.deleteTransfer(from.transferId!);
    expect((await ledger.load()).data.transactions).toEqual([]);
    await ledger.restoreTransactions(snapshot);

    expect((await ledger.load()).data.transactions).toHaveLength(2);
  });

  it('undoes the adding of a Transfer by removing both halves', async () => {
    const { ledger, main, savings } = await twoAccounts();
    const [from] = await ledger.addTransfer({ date: '2026-11-01', cents: 100, fromAccountId: main.id, toAccountId: savings.id, note: '' });

    await ledger.undoAddTransfer(from.transferId!);

    expect((await ledger.load()).data.transactions).toEqual([]);
  });

  it('deleting an Account removes its Transactions and rules, and leaves the other half of a Transfer as an ordinary Transaction', async () => {
    const { ledger, main, savings } = await twoAccounts();
    const [out] = await ledger.addTransfer({ date: '2026-11-01', cents: 700, fromAccountId: main.id, toAccountId: savings.id, note: '' });
    await ledger.addTransaction({ accountId: savings.id, date: '2026-11-02', type: 'expense', cents: 50, categoryIds: [], retired: ['Fee'], note: '' });
    await ledger.addRule({
      accountId: savings.id, type: 'expense', cents: 1, categoryIds: [], retired: ['Fee'], note: '',
      frequency: 'monthly', startDate: '2026-11-01', endDate: null, nextDate: '2026-12-01',
    });

    const snapshot = await ledger.deleteAccount(savings.id, 'Transfer');
    const after = await ledger.load();

    expect(after.accounts.map((a) => a.id)).toEqual([main.id]);
    expect(after.rules).toEqual([]);
    expect(after.data.transactions).toHaveLength(1);
    const left = after.data.transactions[0];
    expect(left.id).toBe(out.id);
    expect(left.accountId).toBe(main.id);
    expect(left.transferId).toBeUndefined();
    expect(left.retired).toEqual(['Transfer']);
    expect(snapshot.transactions).toHaveLength(2);
    expect(snapshot.partners.map((p) => p.id)).toEqual([out.id]);
  });

  it('restoring a deleted Account brings back everything, including the Transfer as it was', async () => {
    const { ledger, main, savings } = await twoAccounts();
    await ledger.addTransfer({ date: '2026-11-01', cents: 700, fromAccountId: main.id, toAccountId: savings.id, note: '' });
    const before = await ledger.load();
    const byId = (a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id);

    const snapshot = await ledger.deleteAccount(savings.id, 'Transfer');
    await ledger.restoreAccount(snapshot);
    const after = await ledger.load();

    expect(after.accounts).toEqual(before.accounts);
    expect([...after.data.transactions].sort(byId)).toEqual([...before.data.transactions].sort(byId));
  });

  it("a recurring rule creates its Transactions on the rule's Account", async () => {
    const { ledger, savings } = await twoAccounts();
    await ledger.addRule({
      accountId: savings.id, type: 'income', cents: 100, categoryIds: [], retired: ['Interest'], note: '',
      frequency: 'monthly', startDate: '2026-11-01', endDate: null, nextDate: '2026-11-01',
    });

    const batch = await ledger.materializeRules('2026-11-15');

    expect(batch.created).toHaveLength(1);
    expect(batch.created[0].accountId).toBe(savings.id);
  });

  it('erasing everything also removes the Accounts', async () => {
    const { ledger } = await twoAccounts();

    await ledger.eraseAll();

    expect((await ledger.load()).accounts).toEqual([]);
  });
});
