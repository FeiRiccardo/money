import { describe, expect, it } from 'vitest';
import { EMPTY_QUERY, searchTransactions } from './search';
import type { Category, LedgerData, Transaction, TxType } from './types';

const cat = (id: string, type: TxType, name: string): Category => ({ id, type, name, lastUsedAt: 0 });
let n = 0;
const tx = (
  date: string,
  type: TxType,
  cents: number,
  categoryIds: string[],
  note = '',
  extra: Partial<Transaction> = {},
): Transaction => ({ id: `t${++n}`, accountId: 'a1', date, type, cents, categoryIds, retired: [], note, ...extra });

const nameOf = (c: Category) => c.name;
const categories = [
  cat('groceries', 'expense', 'Groceries'),
  cat('dining', 'expense', 'Dining out'),
  cat('salary', 'income', 'Salary'),
];

const ids = (list: Transaction[]) => list.map((t) => t.note);

describe('searchTransactions: ordering and totals', () => {
  const data: LedgerData = {
    categories,
    transactions: [
      tx('2026-10-10', 'expense', 7200, ['groceries'], 'rent-ish', { createdAt: 1 }),
      tx('2026-10-18', 'expense', 450, ['dining'], 'coffee', { createdAt: 2 }),
      tx('2026-10-18', 'expense', 800, ['dining'], 'lunch', { createdAt: 3 }),
      tx('2026-10-12', 'income', 180000, ['salary'], 'pay', { createdAt: 4 }),
    ],
  };

  it('with an empty query lists everything newest first, a later-recorded Transaction first within a day', () => {
    const result = searchTransactions(data, EMPTY_QUERY, nameOf);

    expect(ids(result.transactions)).toEqual(['lunch', 'coffee', 'pay', 'rent-ish']);
  });

  it('reports the real totals of the results', () => {
    const result = searchTransactions(data, EMPTY_QUERY, nameOf);

    expect(result.incomeCents).toBe(180000);
    expect(result.expenseCents).toBe(7200 + 450 + 800);
    expect(result.netCents).toBe(180000 - 8450);
  });
});

describe('searchTransactions: sort orders', () => {
  const data: LedgerData = {
    categories,
    transactions: [
      tx('2026-10-10', 'expense', 500, ['groceries'], 'a', { createdAt: 1 }),
      tx('2026-10-18', 'income', 900, ['salary'], 'b', { createdAt: 2 }),
      tx('2026-10-18', 'expense', 900, ['dining'], 'c', { createdAt: 3 }),
      tx('2026-10-12', 'expense', 100, ['dining'], 'd', { createdAt: 4 }),
    ],
  };
  const order = (sort: 'newest' | 'oldest' | 'largest' | 'smallest') =>
    ids(searchTransactions(data, { ...EMPTY_QUERY, sort }, nameOf).transactions);

  it('oldest first is the exact reverse of newest first, including the same-day tie', () => {
    expect(order('newest')).toEqual(['c', 'b', 'd', 'a']);
    expect(order('oldest')).toEqual(['a', 'd', 'b', 'c']);
  });

  it('largest amount first regardless of income or expense, ties broken by newest date', () => {
    expect(order('largest')).toEqual(['c', 'b', 'a', 'd']);
  });

  it('smallest amount first, ties broken by newest date', () => {
    expect(order('smallest')).toEqual(['d', 'a', 'c', 'b']);
  });

  it('does not change the order of the data it was given', () => {
    const before = data.transactions.map((t) => t.note);
    order('largest');
    expect(data.transactions.map((t) => t.note)).toEqual(before);
  });
});

describe('searchTransactions: text', () => {
  const data: LedgerData = {
    categories,
    transactions: [
      tx('2026-10-01', 'expense', 450, ['dining'], 'Caffè al bar'),
      tx('2026-10-02', 'expense', 6230, ['groceries'], 'Weekly shop, new pan'),
      tx('2026-10-03', 'expense', 1500, ['dining'], 'Weekly lunch'),
    ],
  };
  const find = (text: string) => ids(searchTransactions(data, { ...EMPTY_QUERY, text }, nameOf).transactions);

  it('ignores upper and lower case and accents', () => {
    expect(find('CAFFE')).toEqual(['Caffè al bar']);
    expect(find('caffè')).toEqual(['Caffè al bar']);
  });

  it('needs every word to match, in the note or the Category name', () => {
    expect(find('weekly groceries')).toEqual(['Weekly shop, new pan']);
    expect(find('weekly')).toEqual(['Weekly lunch', 'Weekly shop, new pan']);
    expect(find('weekly nonsense')).toEqual([]);
  });

  it('ignores extra spaces and finds Category names even when the note does not mention them', () => {
    expect(find('  dining   OUT ')).toEqual(['Weekly lunch', 'Caffè al bar']);
  });
});

describe('searchTransactions: retired labels and amounts', () => {
  const data: LedgerData = {
    categories,
    transactions: [
      { ...tx('2026-10-01', 'expense', 3500, [], 'Monthly pass'), retired: ['Gym'] },
      tx('2026-10-02', 'expense', 1250, ['dining'], 'Pizza'),
      tx('2026-10-03', 'expense', 1200, ['dining'], 'Cinema'),
      tx('2026-10-04', 'expense', 999, ['groceries'], 'Bought 12 eggs'),
    ],
  };
  const find = (text: string) => ids(searchTransactions(data, { ...EMPTY_QUERY, text }, nameOf).transactions);

  it('finds a Transaction by the Retired label it still carries', () => {
    expect(find('gym')).toEqual(['Monthly pass']);
  });

  it('a number also matches that exact amount, with a comma or a dot', () => {
    expect(find('12,50')).toEqual(['Pizza']);
    expect(find('12.5')).toEqual(['Pizza']);
  });

  it('a whole number matches that exact amount and notes containing it, not other amounts', () => {
    expect(find('12')).toEqual(['Bought 12 eggs', 'Cinema']);
  });
});

describe('searchTransactions: filters', () => {
  const data: LedgerData = {
    categories,
    transactions: [
      tx('2026-09-30', 'expense', 100, ['groceries'], 'sep'),
      tx('2026-10-01', 'expense', 200, ['dining'], 'oct1'),
      tx('2026-10-15', 'income', 300, ['salary'], 'pay'),
      { ...tx('2026-10-31', 'expense', 400, ['groceries'], 'oct31'), retired: ['Gym'] },
      tx('2026-11-01', 'expense', 500, ['dining', 'groceries'], 'nov'),
    ],
  };
  const find = (query: Partial<typeof EMPTY_QUERY>) =>
    ids(searchTransactions(data, { ...EMPTY_QUERY, sort: 'oldest', ...query }, nameOf).transactions);

  it('filters by type', () => {
    expect(find({ type: 'income' })).toEqual(['pay']);
    expect(find({ type: 'expense' })).toEqual(['sep', 'oct1', 'oct31', 'nov']);
  });

  it('keeps a Transaction that has any one of the chosen Categories', () => {
    expect(find({ categories: ['c:dining'] })).toEqual(['oct1', 'nov']);
    expect(find({ categories: ['c:dining', 'c:salary'] })).toEqual(['oct1', 'pay', 'nov']);
  });

  it('can filter by a Retired label', () => {
    expect(find({ categories: ['r:Gym'] })).toEqual(['oct31']);
  });

  it('keeps a date range inclusive at both ends, and either end may be open', () => {
    expect(find({ from: '2026-10-01', to: '2026-10-31' })).toEqual(['oct1', 'pay', 'oct31']);
    expect(find({ from: '2026-10-31' })).toEqual(['oct31', 'nov']);
    expect(find({ to: '2026-09-30' })).toEqual(['sep']);
  });

  it('combines every filter and the text with AND, and totals only what is left', () => {
    const result = searchTransactions(
      data,
      { ...EMPTY_QUERY, type: 'expense', categories: ['c:groceries'], from: '2026-10-01', text: 'oct' },
      nameOf,
    );

    expect(ids(result.transactions)).toEqual(['oct31']);
    expect(result.expenseCents).toBe(400);
    expect(result.netCents).toBe(-400);
  });
});
