import { describe, expect, it } from 'vitest';
import { buildReport } from './report';
import type { Category, LedgerData, Transaction, TxType } from './types';

const cat = (id: string, type: TxType, name: string): Category => ({ id, type, name, lastUsedAt: 0 });
const tx = (
  id: string,
  date: string,
  type: TxType,
  cents: number,
  categoryIds: string[],
  note = '',
  retired: string[] = [],
  createdAt = 0,
): Transaction => ({ id, date, type, cents, categoryIds, retired, note, createdAt });
const nameOf = (c: Category) => c.name;

const data: LedgerData = {
  categories: [cat('food', 'expense', 'Food'), cat('fun', 'expense', 'Fun'), cat('pay', 'income', 'Pay')],
  transactions: [
    tx('old1', '2026-08-30', 'income', 100000, ['pay']),
    tx('old2', '2026-09-15', 'expense', 20000, ['food']),
    tx('a', '2026-10-03', 'expense', 1500, ['food', 'fun'], 'Pizza', [], 1),
    tx('b', '2026-10-03', 'expense', 700, [], 'Gym', ['Sport'], 2),
    tx('c', '2026-10-01', 'income', 50000, ['pay'], 'October pay'),
    tx('later', '2026-11-02', 'expense', 9999, ['food']),
  ],
};

describe('buildReport', () => {
  it('gives the month totals and the Balance at the start and the end of the month', () => {
    const report = buildReport(data, '2026-10', 10000, nameOf);

    expect(report.month).toBe('2026-10');
    expect(report.incomeCents).toBe(50000);
    expect(report.expenseCents).toBe(2200);
    expect(report.netCents).toBe(47800);
    // Opening 100.00 + 1000.00 income - 200.00 expense, before October.
    expect(report.startBalanceCents).toBe(90000);
    expect(report.endBalanceCents).toBe(137800);
  });

  it('lists the month Transactions by day, oldest day first, each with its Category names', () => {
    const report = buildReport(data, '2026-10', 0, nameOf);

    expect(report.days.map((d) => [d.date, d.netCents])).toEqual([
      ['2026-10-01', 50000],
      ['2026-10-03', -2200],
    ]);
    expect(report.days[1].items.map((i) => [i.note, i.type, i.cents, i.categories])).toEqual([
      ['Pizza', 'expense', 1500, ['Food', 'Fun']],
      ['Gym', 'expense', 700, ['Sport']],
    ]);
  });

  it('carries the per-Category lines the summary shows', () => {
    const report = buildReport(data, '2026-10', 0, nameOf);

    expect(report.expenseLines.map((l) => [l.name, l.cents])).toEqual([
      ['Food', 1500],
      ['Fun', 1500],
      ['Sport', 700],
    ]);
    expect(report.incomeLines.map((l) => [l.name, l.cents])).toEqual([['Pay', 50000]]);
  });

  it('is empty, not broken, for a month with no Transactions', () => {
    const report = buildReport(data, '2026-12', 0, nameOf);

    expect(report.days).toEqual([]);
    expect(report.netCents).toBe(0);
    expect(report.startBalanceCents).toBe(report.endBalanceCents);
  });
});
