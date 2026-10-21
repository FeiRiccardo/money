import { sortTransactions } from './search';
import { summarize, type MonthSummary, type SummaryLine } from './summary';
import type { Category, LedgerData, TxType } from './types';

export interface ReportItem {
  id: string;
  type: TxType;
  cents: number;
  note: string;
  /** Live Category names first, then Retired labels. */
  categories: string[];
}

export interface ReportDay {
  date: string;
  netCents: number;
  items: ReportItem[];
}

export interface MonthReport {
  month: string;
  incomeCents: number;
  expenseCents: number;
  netCents: number;
  /** The Balance the day before the month starts. */
  startBalanceCents: number;
  /** The Balance at the end of the month, counting only Transactions up to then. */
  endBalanceCents: number;
  expenseLines: SummaryLine[];
  incomeLines: SummaryLine[];
  /** Not-counted Transactions by Category: outside the totals, inside the Balance. */
  uncountedLines: MonthSummary['uncountedLines'];
  /** Days with Transactions, oldest first. */
  days: ReportDay[];
}

const signed = (t: { type: TxType; cents: number }) => (t.type === 'income' ? t.cents : -t.cents);

/** Everything the printed monthly report shows, ready to lay out. */
export function buildReport(
  data: LedgerData,
  month: string,
  openingCents: number,
  nameOf: (category: Category) => string,
): MonthReport {
  const summary = summarize(data, month, nameOf);
  const byId = new Map(data.categories.map((c) => [c.id, c]));
  const before = data.transactions.filter((t) => t.date.slice(0, 7) < month);
  const startBalanceCents = before.reduce((sum, t) => sum + signed(t), openingCents);

  const inMonth = sortTransactions(
    data.transactions.filter((t) => t.date.startsWith(month)),
    'oldest',
  );
  const days: ReportDay[] = [];
  for (const t of inMonth) {
    let day = days[days.length - 1];
    if (!day || day.date !== t.date) {
      day = { date: t.date, netCents: 0, items: [] };
      days.push(day);
    }
    day.netCents += signed(t);
    day.items.push({
      id: t.id,
      type: t.type,
      cents: t.cents,
      note: t.note,
      categories: [...t.categoryIds.flatMap((id) => (byId.has(id) ? [nameOf(byId.get(id)!)] : [])), ...t.retired],
    });
  }

  return {
    month,
    incomeCents: summary.incomeCents,
    expenseCents: summary.expenseCents,
    netCents: summary.netCents,
    startBalanceCents,
    // Every Transaction moves the Balance, Not-counted ones too.
    endBalanceCents: startBalanceCents + inMonth.reduce((sum, t) => sum + signed(t), 0),
    expenseLines: summary.expenseLines,
    incomeLines: summary.incomeLines,
    uncountedLines: summary.uncountedLines,
    days,
  };
}
