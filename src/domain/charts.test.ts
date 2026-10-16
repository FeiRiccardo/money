import { describe, expect, it } from 'vitest';
import { categoryComparison, monthlySeries } from './charts';
import type { Category, LedgerData, Transaction, TxType } from './types';

const cat = (id: string, type: TxType, name: string): Category => ({ id, type, name, lastUsedAt: 0 });
const tx = (date: string, type: TxType, cents: number, categoryIds: string[], retired: string[] = []): Transaction => ({
  id: `${date}-${cents}-${categoryIds.join()}`,
  date,
  type,
  cents,
  categoryIds,
  retired,
  note: '',
});

const categories = [cat('food', 'expense', 'Food'), cat('rent', 'expense', 'Rent'), cat('pay', 'income', 'Pay')];

describe('monthlySeries', () => {
  it('gives one point per month ending at the chosen month, oldest first, with empty months as zero', () => {
    const data: LedgerData = {
      categories,
      transactions: [
        tx('2026-08-10', 'expense', 1000, ['food']),
        tx('2026-10-01', 'income', 200000, ['pay']),
        tx('2026-10-05', 'expense', 3000, ['food']),
        tx('2026-10-06', 'expense', 500, ['food']),
        tx('2026-07-31', 'expense', 9999, ['food']),
      ],
    };

    expect(monthlySeries(data, '2026-10', 3)).toEqual([
      { month: '2026-08', incomeCents: 0, expenseCents: 1000 },
      { month: '2026-09', incomeCents: 0, expenseCents: 0 },
      { month: '2026-10', incomeCents: 200000, expenseCents: 3500 },
    ]);
  });

  it('crosses a year boundary', () => {
    const data: LedgerData = { categories, transactions: [tx('2025-12-31', 'expense', 100, ['food'])] };

    expect(monthlySeries(data, '2026-01', 2).map((p) => p.month)).toEqual(['2025-12', '2026-01']);
    expect(monthlySeries(data, '2026-01', 2)[0].expenseCents).toBe(100);
  });
});

describe('categoryComparison', () => {
  const nameOf = (c: Category) => c.name;

  it('lists each Category of the type with this month, last month and the change, biggest first', () => {
    const data: LedgerData = {
      categories,
      transactions: [
        tx('2026-10-05', 'expense', 3000, ['food']),
        tx('2026-10-06', 'expense', 50000, ['rent']),
        tx('2026-09-05', 'expense', 2000, ['food']),
        tx('2026-10-07', 'income', 99999, ['pay']),
      ],
    };

    expect(categoryComparison(data, '2026-10', 'expense', nameOf)).toEqual([
      { name: 'Rent', cents: 50000, previousCents: 0, retired: false },
      { name: 'Food', cents: 3000, previousCents: 2000, retired: false },
    ]);
  });

  it('keeps a Category that only had spending last month, with zero this month', () => {
    const data: LedgerData = { categories, transactions: [tx('2026-09-05', 'expense', 2000, ['food'])] };

    expect(categoryComparison(data, '2026-10', 'expense', nameOf)).toEqual([
      { name: 'Food', cents: 0, previousCents: 2000, retired: false },
    ]);
  });

  it('includes Retired labels', () => {
    const data: LedgerData = { categories, transactions: [tx('2026-10-05', 'expense', 700, [], ['Old'])] };

    expect(categoryComparison(data, '2026-10', 'expense', nameOf)).toEqual([
      { name: 'Old', cents: 700, previousCents: 0, retired: true },
    ]);
  });
});
