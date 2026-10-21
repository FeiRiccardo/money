import type { Category, LedgerData, Transaction, TxType } from './types';

export interface SummaryLine {
  name: string;
  cents: number;
  count: number;
  retired: boolean;
}

export interface MonthSummary {
  incomeCents: number;
  expenseCents: number;
  netCents: number;
  expenseLines: SummaryLine[];
  incomeLines: SummaryLine[];
  /** Transactions with a Not-counted Category, by Category: shown apart, outside the totals. */
  uncountedLines: Array<SummaryLine & { type: TxType }>;
}

/** False when any of the Transaction's Categories is Not counted: it then stays out of the totals. */
export function isCounted(t: Pick<Transaction, 'categoryIds'>, byId: Map<string, Category>): boolean {
  return !t.categoryIds.some((id) => byId.get(id)?.uncounted);
}

export function summarize(
  data: LedgerData,
  month: string,
  nameOf: (category: Category) => string,
): MonthSummary {
  const byId = new Map(data.categories.map((c) => [c.id, c]));
  const lines: Record<TxType, Map<string, SummaryLine>> = { expense: new Map(), income: new Map() };
  const uncounted = new Map<string, SummaryLine & { type: TxType }>();
  let incomeCents = 0;
  let expenseCents = 0;

  for (const t of data.transactions) {
    if (!t.date.startsWith(month)) continue;
    const counted = isCounted(t, byId);
    const add = (key: string, name: string, retired: boolean) => {
      const target = counted ? lines[t.type] : uncounted;
      const fullKey = counted ? key : `${t.type}:${key}`;
      const line = target.get(fullKey) ?? { name, cents: 0, count: 0, retired, ...(counted ? {} : { type: t.type }) };
      line.cents += t.cents;
      line.count += 1;
      target.set(fullKey, line as SummaryLine & { type: TxType });
    };
    if (counted && t.type === 'income') incomeCents += t.cents;
    else if (counted) expenseCents += t.cents;

    for (const id of t.categoryIds) {
      const category = byId.get(id);
      if (category) add(`c:${id}`, nameOf(category), false);
    }
    for (const label of t.retired) add(`r:${label}`, label, true);
  }

  const sorted = <T extends SummaryLine>(values: Iterable<T>) => [...values].sort((a, b) => b.cents - a.cents);
  return {
    incomeCents,
    expenseCents,
    netCents: incomeCents - expenseCents,
    expenseLines: sorted(lines.expense.values()),
    incomeLines: sorted(lines.income.values()),
    uncountedLines: sorted(uncounted.values()),
  };
}

/** All-time Balance: the Opening balance plus all Income minus all Expenses, Not-counted ones included. */
export function balance(data: LedgerData, openingCents: number): number {
  return data.transactions.reduce((sum, t) => sum + (t.type === 'income' ? t.cents : -t.cents), openingCents);
}
