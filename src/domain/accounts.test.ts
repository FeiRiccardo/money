import { describe, expect, it } from 'vitest';
import { openingOf, scopeTo, validateAccountName } from './accounts';
import { exportBackup, previewImport } from './backup';
import { monthlySeries } from './charts';
import { buildReport } from './report';
import { balance, summarize } from './summary';
import type { Account, Category, LedgerData, Transaction } from './types';

const nameOf = (c: Category) => c.name;
const food: Category = { id: 'food', type: 'expense', name: 'Food', lastUsedAt: 0 };
const pay: Category = { id: 'pay', type: 'income', name: 'Pay', lastUsedAt: 0 };
const main: Account = { id: 'main', name: 'Main account', defaultKey: 'main', openingCents: 10000 };
const savings: Account = { id: 'sav', name: 'Savings', openingCents: 50000 };

let n = 0;
const tx = (over: Partial<Transaction>): Transaction => ({
  id: `t${++n}`, accountId: 'main', date: '2026-11-03', type: 'expense', cents: 1000, categoryIds: ['food'], retired: [], note: '', createdAt: n, ...over,
});
/** A Transfer of 200.00 from Main to Savings. */
const transfer = (): Transaction[] => [
  tx({ id: 'out', accountId: 'main', transferId: 'x', cents: 20000, categoryIds: [], note: 'save' }),
  tx({ id: 'in', accountId: 'sav', transferId: 'x', type: 'income', cents: 20000, categoryIds: [], note: 'save' }),
];
const ledger = (...transactions: Transaction[]): LedgerData => ({ categories: [food, pay], transactions });

describe('Accounts and the Balance', () => {
  it('shows one Account on its own, or all of them added together', () => {
    const data = ledger(tx({ cents: 3000 }), tx({ accountId: 'sav', type: 'income', cents: 500, categoryIds: ['pay'] }));

    expect(balance(scopeTo(data, 'main'), openingOf([main, savings], 'main'))).toBe(10000 - 3000);
    expect(balance(scopeTo(data, 'sav'), openingOf([main, savings], 'sav'))).toBe(50000 + 500);
    expect(balance(scopeTo(data, null), openingOf([main, savings], null))).toBe(60000 - 3000 + 500);
  });

  it('a Transfer moves the Balance of each Account but leaves the total as it was', () => {
    const data = ledger(...transfer());

    expect(balance(scopeTo(data, 'main'), main.openingCents)).toBe(10000 - 20000);
    expect(balance(scopeTo(data, 'sav'), savings.openingCents)).toBe(50000 + 20000);
    expect(balance(data, openingOf([main, savings], null))).toBe(60000);
  });
});

describe('a Transfer is not income or an expense', () => {
  it('is left out of the month totals, the Category lines, the Not-counted list, the trend and the report totals', () => {
    const data = ledger(tx({ cents: 700 }), ...transfer());

    const summary = summarize(data, '2026-11', nameOf);
    const series = monthlySeries(data, '2026-11', 1);
    const report = buildReport(data, '2026-11', 0, nameOf);

    expect(summary).toMatchObject({ incomeCents: 0, expenseCents: 700, uncountedLines: [] });
    expect(summary.expenseLines.map((l) => l.name)).toEqual(['Food']);
    expect(series[0]).toMatchObject({ incomeCents: 0, expenseCents: 700 });
    expect(report).toMatchObject({ incomeCents: 0, expenseCents: 700, uncountedLines: [] });
  });

  it('still shows in the report list, marked as a Transfer, and counts in the report Balance', () => {
    const report = buildReport(ledger(...transfer()), '2026-11', 10000, nameOf);

    expect(report.days[0].items.map((i) => i.transfer)).toEqual([true, true]);
    expect(report.endBalanceCents).toBe(10000 - 20000 + 20000);
  });
});

describe('validateAccountName', () => {
  it('trims, and refuses empty, long, "|" and duplicate names', () => {
    expect(validateAccountName('  TFR ', [])).toEqual({ ok: true, name: 'TFR' });
    expect(validateAccountName('', [])).toEqual({ ok: false, reason: 'empty' });
    expect(validateAccountName('x'.repeat(31), [])).toEqual({ ok: false, reason: 'tooLong' });
    expect(validateAccountName('a|b', [])).toEqual({ ok: false, reason: 'pipe' });
    expect(validateAccountName('savings', ['Savings'])).toEqual({ ok: false, reason: 'duplicate' });
  });
});

describe('backup files with Accounts', () => {
  const files = (data: LedgerData, accounts = [main, savings]) => exportBackup(data, nameOf, [], accounts);
  let ids = 0;
  const newId = () => `id-${++ids}`;

  it('writes an accounts file with the Opening balances, and the account and transfer columns', () => {
    const out = files(ledger(tx({ note: 'lunch' }), ...transfer()));

    expect(out.accountsCsv).toBe('﻿name,opening_balance,default_key\r\nMain account,100.00,main\r\nSavings,500.00,\r\n');
    expect(out.transactionsCsv.split('\r\n').slice(0, 4)).toEqual([
      '﻿date,type,amount,categories,note,account,transfer',
      '2026-11-03,expense,10.00,Food,lunch,Main account,',
      '2026-11-03,expense,200.00,,save,Main account,1',
      '2026-11-03,income,200.00,,save,Savings,1',
    ]);
  });

  it('writes a negative Opening balance with its sign', () => {
    expect(files(ledger(), [{ ...main, openingCents: -12550 }]).accountsCsv).toContain('Main account,-125.50,main');
  });

  it('round-trips Accounts, which Account each Transaction is on, and Transfers as linked pairs', () => {
    const back = previewImport(files(ledger(tx({ note: 'lunch' }), ...transfer())), newId);

    expect(back.errors).toEqual([]);
    expect(back.accountsInFile).toBe(true);
    expect(back.accounts.map((a) => [a.name, a.openingCents, a.defaultKey])).toEqual([
      ['Main account', 10000, 'main'],
      ['Savings', 50000, undefined],
    ]);
    const nameOfAccount = new Map(back.accounts.map((a) => [a.id, a.name]));
    const [lunch, out, into] = back.data.transactions;
    expect(nameOfAccount.get(lunch.accountId)).toBe('Main account');
    expect(lunch.transferId).toBeUndefined();
    expect([out.type, nameOfAccount.get(out.accountId), out.categoryIds, out.retired]).toEqual(['expense', 'Main account', [], []]);
    expect([into.type, nameOfAccount.get(into.accountId)]).toEqual(['income', 'Savings']);
    expect(out.transferId).toBeDefined();
    expect(into.transferId).toBe(out.transferId);
  });

  it('puts everything on one Main account when the files are from before Accounts', () => {
    const old = exportBackup(ledger(tx({ note: 'lunch' })), nameOf);

    const back = previewImport(old, newId);

    expect(old.accountsCsv).toBeNull();
    expect(old.transactionsCsv).toContain('date,type,amount,categories,note\r\n');
    expect(back.accountsInFile).toBe(false);
    expect(back.accounts).toEqual([expect.objectContaining({ name: 'Main account', defaultKey: 'main', openingCents: 0 })]);
    expect(back.data.transactions[0].accountId).toBe(back.accounts[0].id);
  });

  it('makes an Account for a name the accounts file did not list, and uses the first for rows that name none', () => {
    const csv = {
      ...files(ledger()),
      accountsCsv: '﻿name,opening_balance,default_key\r\nChecking,10.00,\r\n',
      transactionsCsv: 'date,type,amount,categories,note,account,transfer\r\n2026-11-01,expense,5.00,Food,a,,\r\n2026-11-02,expense,6.00,Food,b,TFR,\r\n',
    };

    const back = previewImport(csv, newId);

    expect(back.accounts.map((a) => [a.name, a.openingCents])).toEqual([['Checking', 1000], ['TFR', 0]]);
    expect(back.data.transactions.map((t) => t.accountId)).toEqual([back.accounts[0].id, back.accounts[1].id]);
  });

  it('skips a Transfer row whose other half is missing, or whose two halves do not match, and says so', () => {
    const csv = {
      ...files(ledger()),
      transactionsCsv: [
        'date,type,amount,categories,note,account,transfer',
        '2026-11-01,expense,5.00,,alone,Main account,1',
        '2026-11-02,expense,5.00,,a,Main account,2',
        '2026-11-02,income,6.00,,b,Savings,2',
        '2026-11-03,expense,5.00,,a,Main account,3',
        '2026-11-03,income,5.00,,b,Main account,3',
        '2026-11-04,expense,5.00,,fine,Main account,4',
        '2026-11-04,income,5.00,,fine,Savings,4',
        '',
      ].join('\r\n'),
    };

    const back = previewImport(csv, newId);

    expect(back.errors).toEqual([
      { file: 'transactions', row: 2, reason: 'invalidTransfer' },
      { file: 'transactions', row: 3, reason: 'invalidTransfer' },
      { file: 'transactions', row: 4, reason: 'invalidTransfer' },
      { file: 'transactions', row: 5, reason: 'invalidTransfer' },
      { file: 'transactions', row: 6, reason: 'invalidTransfer' },
    ]);
    expect(back.data.transactions.map((t) => t.note)).toEqual(['fine', 'fine']);
    expect(back.transactionRows).toEqual([7, 8]);
  });

  it('still asks for a Category on an ordinary row without a transfer number', () => {
    const csv = {
      ...files(ledger()),
      transactionsCsv: 'date,type,amount,categories,note,account,transfer\r\n2026-11-01,expense,5.00,,x,Main account,\r\n',
    };

    expect(previewImport(csv, newId).errors).toEqual([{ file: 'transactions', row: 2, reason: 'noCategories' }]);
  });

  it('reports a bad Opening balance and a duplicate name in the accounts file', () => {
    const csv = {
      ...files(ledger()),
      accountsCsv: '﻿name,opening_balance,default_key\r\nA,lots,\r\nB,1.00,\r\nb,2.00,\r\n',
    };

    expect(previewImport(csv, newId).errors).toEqual([
      { file: 'accounts', row: 2, reason: 'invalidOpening' },
      { file: 'accounts', row: 4, reason: 'duplicateName' },
    ]);
  });

  it('refuses an accounts file with the wrong columns', () => {
    expect(previewImport({ ...files(ledger()), accountsCsv: 'x,y\r\n' }, newId).fatal).toBe('accountsColumns');
  });
});
