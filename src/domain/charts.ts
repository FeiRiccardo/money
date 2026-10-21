import { shiftMonth } from './months';
import { isCounted, summarize, type SummaryLine } from './summary';
import type { Category, LedgerData, TxType } from './types';

export interface MonthPoint {
  month: string;
  incomeCents: number;
  expenseCents: number;
}

/** Income and expenses for `count` months ending at `endMonth`, oldest first; empty months are zero. Not-counted Transactions are left out. */
export function monthlySeries(data: LedgerData, endMonth: string, count: number): MonthPoint[] {
  const points = Array.from({ length: count }, (_, i) => ({
    month: shiftMonth(endMonth, i - count + 1),
    incomeCents: 0,
    expenseCents: 0,
  }));
  const byMonth = new Map(points.map((p) => [p.month, p]));
  const byId = new Map(data.categories.map((c) => [c.id, c]));
  for (const t of data.transactions) {
    const point = byMonth.get(t.date.slice(0, 7));
    if (!point || !isCounted(t, byId)) continue;
    if (t.type === 'income') point.incomeCents += t.cents;
    else point.expenseCents += t.cents;
  }
  return points;
}

export interface ComparisonLine {
  name: string;
  cents: number;
  previousCents: number;
  retired: boolean;
}

/** Each Category of one type with this month's total beside the month before, biggest this month first. */
export function categoryComparison(
  data: LedgerData,
  month: string,
  type: TxType,
  nameOf: (category: Category) => string,
): ComparisonLine[] {
  const linesOf = (m: string) => {
    const s = summarize(data, m, nameOf);
    return type === 'expense' ? s.expenseLines : s.incomeLines;
  };
  const key = (l: SummaryLine) => `${l.retired}:${l.name}`;
  const previous = new Map(linesOf(shiftMonth(month, -1)).map((l) => [key(l), l.cents]));
  const merged = new Map<string, ComparisonLine>();
  for (const l of linesOf(month)) {
    merged.set(key(l), { name: l.name, cents: l.cents, previousCents: previous.get(key(l)) ?? 0, retired: l.retired });
  }
  for (const l of linesOf(shiftMonth(month, -1))) {
    if (!merged.has(key(l))) merged.set(key(l), { name: l.name, cents: 0, previousCents: l.cents, retired: l.retired });
  }
  return [...merged.values()].sort((a, b) => b.cents - a.cents || b.previousCents - a.previousCents);
}
