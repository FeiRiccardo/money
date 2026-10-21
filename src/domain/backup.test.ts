import { describe, expect, it } from 'vitest';
import { exportBackup, previewImport } from './backup';
import type { Category, LedgerData, Transaction, TxType } from './types';

const cat = (id: string, type: TxType, name: string, defaultKey?: string): Category => ({
  id,
  type,
  name,
  defaultKey,
  lastUsedAt: 0,
});
const tx = (
  date: string,
  type: TxType,
  cents: number,
  categoryIds: string[],
  retired: string[] = [],
  note = '',
): Transaction => ({ id: `${date}-${cents}`, date, type, cents, categoryIds, retired, note });

const nameOf = (c: Category) => c.name;
const BOM = '﻿';

const sample: LedgerData = {
  categories: [
    cat('groceries', 'expense', 'Groceries', 'groceries'),
    cat('household', 'expense', 'Household'),
    cat('salary', 'income', 'Salary', 'salary'),
    { ...cat('savings', 'expense', 'Savings'), uncounted: true },
  ],
  transactions: [
    tx('2026-10-12', 'income', 180000, ['salary'], [], 'October salary'),
    tx('2026-10-17', 'expense', 6230, ['groceries', 'household'], [], 'Weekly shop, new pan'),
    tx('2026-10-18', 'expense', 450, [], ['Gym'], 'He said "hi"'),
  ],
};

describe('exportBackup: transactions.csv', () => {
  it('writes a BOM, the header, positive dot-decimal amounts, | between Categories and quoted notes', () => {
    const { transactionsCsv } = exportBackup(sample, nameOf);

    expect(transactionsCsv).toBe(
      BOM +
        'date,type,amount,categories,note\r\n' +
        '2026-10-12,income,1800.00,Salary,October salary\r\n' +
        '2026-10-17,expense,62.30,Groceries|Household,"Weekly shop, new pan"\r\n' +
        '2026-10-18,expense,4.50,Gym,"He said ""hi"""\r\n',
    );
  });
});

describe('exportBackup: categories.csv', () => {
  it('lists live Categories with their default key, and never a Retired label', () => {
    const { categoriesCsv } = exportBackup(sample, nameOf);

    expect(categoriesCsv).toBe(
      BOM +
        'type,name,default_key,not_counted\r\n' +
        'expense,Groceries,groceries,\r\n' +
        'expense,Household,,\r\n' +
        'income,Salary,salary,\r\n' +
        'expense,Savings,,yes\r\n',
    );
    expect(categoriesCsv).not.toContain('Gym');
  });

  it('writes the displayed name, so a translated default exports in the current language', () => {
    const italian = (c: Category) => (c.defaultKey === 'groceries' ? 'Spesa' : c.name);
    const { categoriesCsv, transactionsCsv } = exportBackup(sample, italian);

    expect(categoriesCsv).toContain('expense,Spesa,groceries');
    expect(transactionsCsv).toContain('Spesa|Household');
  });
});

let n = 0;
const seqId = () => `id${++n}`;

/** Describes imported data without depending on generated ids. */
function describeData(data: LedgerData) {
  const byId = new Map(data.categories.map((c) => [c.id, c]));
  return {
    categories: data.categories.map((c) => ({ type: c.type, name: c.name, defaultKey: c.defaultKey, uncounted: c.uncounted })),
    transactions: data.transactions.map((t) => ({
      date: t.date,
      type: t.type,
      cents: t.cents,
      note: t.note,
      categories: t.categoryIds.map((id) => byId.get(id)?.name),
      retired: t.retired,
    })),
  };
}

describe('previewImport', () => {
  it('round-trips an export: Categories, default keys, Retired labels, notes and amounts survive', () => {
    const preview = previewImport(exportBackup(sample, nameOf), seqId);

    expect(preview.errors).toEqual([]);
    expect(describeData(preview.data)).toEqual({
      categories: [
        { type: 'expense', name: 'Groceries', defaultKey: 'groceries', uncounted: undefined },
        { type: 'expense', name: 'Household', defaultKey: undefined, uncounted: undefined },
        { type: 'income', name: 'Salary', defaultKey: 'salary', uncounted: undefined },
        { type: 'expense', name: 'Savings', defaultKey: undefined, uncounted: true },
      ],
      transactions: [
        { date: '2026-10-12', type: 'income', cents: 180000, note: 'October salary', categories: ['Salary'], retired: [] },
        { date: '2026-10-17', type: 'expense', cents: 6230, note: 'Weekly shop, new pan', categories: ['Groceries', 'Household'], retired: [] },
        { date: '2026-10-18', type: 'expense', cents: 450, note: 'He said "hi"', categories: [], retired: ['Gym'] },
      ],
    });
  });
});

describe('previewImport: validation', () => {
  const categoriesCsv = 'type,name,default_key\r\nexpense,Groceries,\r\nincome,Salary,\r\n';

  it('skips invalid Transaction rows, reports row number and reason, and imports the valid ones', () => {
    const transactionsCsv =
      'date,type,amount,categories,note\r\n' +
      '2026-10-01,expense,10.00,Groceries,ok\r\n' + // row 2: valid
      '2026-13-45,expense,10.00,Groceries,\r\n' + // row 3: impossible date
      '2026-10-02,spend,10.00,Groceries,\r\n' + // row 4: bad type
      '2026-10-03,expense,0,Groceries,\r\n' + // row 5: amount not above zero
      '2026-10-04,expense,1.234,Groceries,\r\n' + // row 6: too many decimals
      '2026-10-05,expense,10.00,,\r\n' + // row 7: no categories
      '2026-10-06,income,2000,Salary,\r\n'; // row 8: valid

    const preview = previewImport({ transactionsCsv, categoriesCsv }, seqId);

    expect(preview.data.transactions.map((t) => t.date)).toEqual(['2026-10-01', '2026-10-06']);
    expect(preview.errors).toEqual([
      { file: 'transactions', row: 3, reason: 'invalidDate' },
      { file: 'transactions', row: 4, reason: 'invalidType' },
      { file: 'transactions', row: 5, reason: 'invalidAmount' },
      { file: 'transactions', row: 6, reason: 'invalidAmount' },
      { file: 'transactions', row: 7, reason: 'noCategories' },
    ]);
  });

  it('rejects a file whose header is not the expected columns', () => {
    const preview = previewImport(
      { transactionsCsv: 'when,what\r\n2026-10-01,x\r\n', categoriesCsv },
      seqId,
    );

    expect(preview.fatal).toBe('transactionsColumns');
    expect(preview.data).toEqual({ categories: [], transactions: [] });
  });
});

describe('previewImport: Categories validation', () => {
  const transactionsCsv = 'date,type,amount,categories,note\r\n';

  it('skips invalid Category rows and reports them', () => {
    const categoriesCsv =
      'type,name,default_key\r\n' +
      'expense,Groceries,groceries\r\n' + // row 2: valid
      'spend,Food,\r\n' + // row 3: bad type
      'expense,,\r\n' + // row 4: empty name
      'expense,Food|Drink,\r\n' + // row 5: pipe in name
      `expense,${'a'.repeat(31)},\r\n` + // row 6: too long
      'expense, groceries ,\r\n' + // row 7: duplicate of row 2 (case and spacing ignored)
      'income,Groceries,\r\n'; // row 8: same name, other type: valid

    const preview = previewImport({ transactionsCsv, categoriesCsv }, seqId);

    expect(preview.data.categories.map((c) => `${c.type}:${c.name}`)).toEqual([
      'expense:Groceries',
      'income:Groceries',
    ]);
    expect(preview.errors).toEqual([
      { file: 'categories', row: 3, reason: 'invalidType' },
      { file: 'categories', row: 4, reason: 'invalidName' },
      { file: 'categories', row: 5, reason: 'invalidName' },
      { file: 'categories', row: 6, reason: 'invalidName' },
      { file: 'categories', row: 7, reason: 'duplicateName' },
    ]);
  });

  it('turns a Transaction name that points at a skipped Category into a Retired label', () => {
    const preview = previewImport(
      {
        transactionsCsv: transactionsCsv + '2026-10-01,expense,5.00,Food|Drink,\r\n',
        categoriesCsv: 'type,name,default_key\r\nexpense,Food|Drink,\r\n',
      },
      seqId,
    );

    expect(preview.data.transactions[0]?.retired).toEqual(['Food', 'Drink']);
  });

  it('still reads a Categories file from before the not_counted column: every Category counts', () => {
    const preview = previewImport({ transactionsCsv, categoriesCsv: 'type,name,default_key\r\nexpense,Food,\r\n' }, seqId);

    expect(preview.fatal).toBeUndefined();
    expect(preview.data.categories.map((c) => [c.name, c.uncounted])).toEqual([['Food', undefined]]);
  });

  it('rejects a Categories file whose header is not the expected columns', () => {
    const preview = previewImport({ transactionsCsv, categoriesCsv: 'kind,label\r\nexpense,Food\r\n' }, seqId);

    expect(preview.fatal).toBe('categoriesColumns');
  });
});

describe('exportBackup: recurring.csv', () => {
  const rule = {
    id: 'r1',
    type: 'expense' as const,
    cents: 72000,
    categoryIds: ['groceries'],
    retired: ['Gym'],
    note: 'Rent, flat 3',
    frequency: 'monthly' as const,
    startDate: '2026-01-31',
    endDate: null,
    nextDate: '2026-05-31',
  };

  it('is not written at all when there are no rules', () => {
    expect(exportBackup(sample, nameOf, []).recurringCsv).toBeNull();
    expect(exportBackup(sample, nameOf).recurringCsv).toBeNull();
  });

  it('lists each rule with its schedule and next date, Categories separated by |', () => {
    const { recurringCsv } = exportBackup(sample, nameOf, [rule, { ...rule, id: 'r2', type: 'income', cents: 5000, categoryIds: ['salary'], retired: [], note: '', frequency: 'weekly', startDate: '2026-02-01', endDate: '2026-12-31', nextDate: '2026-10-25' }]);

    expect(recurringCsv).toBe(
      BOM +
        'type,amount,categories,note,frequency,start_date,end_date,next_date\r\n' +
        'expense,720.00,Groceries|Gym,"Rent, flat 3",monthly,2026-01-31,,2026-05-31\r\n' +
        'income,50.00,Salary,,weekly,2026-02-01,2026-12-31,2026-10-25\r\n',
    );
  });
});

describe('exportBackup: order', () => {
  it('lists Transactions by date, and within a day by when they were recorded', () => {
    const data: LedgerData = {
      categories: [cat('c', 'expense', 'Food')],
      transactions: [
        { ...tx('2026-10-18', 'expense', 100, ['c'], [], 'second'), createdAt: 20 },
        { ...tx('2026-10-01', 'expense', 100, ['c'], [], 'first'), createdAt: 99 },
        { ...tx('2026-10-18', 'expense', 100, ['c'], [], 'earlier same day'), createdAt: 10 },
      ],
    };

    const notes = exportBackup(data, nameOf).transactionsCsv.split('\r\n').slice(1, 4).map((l) => l.split(',').pop());

    expect(notes).toEqual(['first', 'earlier same day', 'second']);
  });
});

describe('previewImport: recurring rules', () => {
  const rules = [
    {
      id: 'r1', type: 'expense' as const, cents: 72000, categoryIds: ['groceries'], retired: ['Gym'],
      note: 'Rent, flat 3', frequency: 'monthly' as const, startDate: '2026-01-31', endDate: null, nextDate: '2026-05-31',
    },
    {
      id: 'r2', type: 'income' as const, cents: 5000, categoryIds: ['salary'], retired: [],
      note: '', frequency: 'weekly' as const, startDate: '2026-02-01', endDate: '2026-12-31', nextDate: '2026-10-25',
    },
  ];

  it('round-trips the rules, mapping Categories by name and keeping Retired labels', () => {
    const files = exportBackup(sample, nameOf, rules);

    const preview = previewImport(files, seqId);

    expect(preview.errors).toEqual([]);
    const byId = new Map(preview.data.categories.map((c) => [c.id, c.name]));
    expect(
      preview.rules.map((r) => ({
        type: r.type, cents: r.cents, note: r.note, frequency: r.frequency, startDate: r.startDate,
        endDate: r.endDate, nextDate: r.nextDate, categories: r.categoryIds.map((id) => byId.get(id)), retired: r.retired,
      })),
    ).toEqual([
      { type: 'expense', cents: 72000, note: 'Rent, flat 3', frequency: 'monthly', startDate: '2026-01-31', endDate: null, nextDate: '2026-05-31', categories: ['Groceries'], retired: ['Gym'] },
      { type: 'income', cents: 5000, note: '', frequency: 'weekly', startDate: '2026-02-01', endDate: '2026-12-31', nextDate: '2026-10-25', categories: ['Salary'], retired: [] },
    ]);
  });

  it('works without the recurring file: no rules', () => {
    const { transactionsCsv, categoriesCsv } = exportBackup(sample, nameOf);

    expect(previewImport({ transactionsCsv, categoriesCsv }, seqId).rules).toEqual([]);
  });
});

describe('previewImport: order', () => {
  it('gives imported Transactions increasing recorded-at values in file order, so a same-day order survives', () => {
    const preview = previewImport(
      {
        transactionsCsv: 'date,type,amount,categories,note\r\n2026-10-18,expense,1.00,Food,first\r\n2026-10-18,expense,2.00,Food,second\r\n',
        categoriesCsv: 'type,name,default_key\r\nexpense,Food,\r\n',
      },
      seqId,
    );

    const [first, second] = preview.data.transactions;
    expect(second!.createdAt!).toBeGreaterThan(first!.createdAt!);
  });
});

describe('previewImport: recurring validation', () => {
  const base = { categoriesCsv: 'type,name,default_key\r\nexpense,Food,\r\nincome,Pay,\r\n', transactionsCsv: 'date,type,amount,categories,note\r\n' };
  const HEADER = 'type,amount,categories,note,frequency,start_date,end_date,next_date\r\n';
  const run = (rows: string) => previewImport({ ...base, recurringCsv: HEADER + rows }, seqId);

  it('skips bad rows with a row number and a reason, and keeps the good ones', () => {
    const preview = run(
      'expense,10.00,Food,ok,monthly,2026-01-15,,2026-02-15\r\n' + // row 2: valid
        'spend,10.00,Food,,monthly,2026-01-15,,2026-02-15\r\n' + // row 3: bad type
        'expense,0,Food,,monthly,2026-01-15,,2026-02-15\r\n' + // row 4: bad amount
        'expense,10.00,,,monthly,2026-01-15,,2026-02-15\r\n' + // row 5: no categories
        'expense,10.00,Food,,daily,2026-01-15,,2026-02-15\r\n' + // row 6: bad frequency
        'expense,10.00,Food,,monthly,2026-13-40,,2026-02-15\r\n' + // row 7: bad start date
        'expense,10.00,Food,,monthly,2026-01-15,not-a-date,2026-02-15\r\n' + // row 8: bad end date
        'expense,10.00,Food,,monthly,2026-01-15,2025-12-31,2026-02-15\r\n', // row 9: ends before it starts
    );

    expect(preview.rules.map((r) => r.note)).toEqual(['ok']);
    expect(preview.errors).toEqual([
      { file: 'recurring', row: 3, reason: 'invalidType' },
      { file: 'recurring', row: 4, reason: 'invalidAmount' },
      { file: 'recurring', row: 5, reason: 'noCategories' },
      { file: 'recurring', row: 6, reason: 'invalidFrequency' },
      { file: 'recurring', row: 7, reason: 'invalidDate' },
      { file: 'recurring', row: 8, reason: 'invalidDate' },
      { file: 'recurring', row: 9, reason: 'invalidDateRange' },
    ]);
  });

  it('treats a blank next_date as the start date', () => {
    const preview = run('expense,10.00,Food,,weekly,2026-03-02,,\r\n');

    expect(preview.errors).toEqual([]);
    expect(preview.rules[0]!.nextDate).toBe('2026-03-02');
  });

  it('rejects a recurring file whose header is not the expected columns', () => {
    const preview = previewImport({ ...base, recurringCsv: 'a,b\r\n1,2\r\n' }, seqId);

    expect(preview.fatal).toBe('recurringColumns');
    expect(preview.rules).toEqual([]);
  });
});
