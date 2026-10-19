import type { Category, LedgerData, Transaction } from './types';

/**
 * How many Transactions a newer copy adds and removes compared with this one. Ids do not survive a backup,
 * so Transactions are matched by what they say (date, type, amount, Categories, note); an edit therefore
 * counts as one removed and one new.
 */
export function countChanges(
  before: LedgerData,
  after: LedgerData,
  nameOf: (category: Category) => string,
): { added: number; removed: number } {
  const remaining = tally(before, nameOf);
  let added = 0;
  for (const key of keys(after, nameOf)) {
    const left = remaining.get(key) ?? 0;
    if (left > 0) remaining.set(key, left - 1);
    else added++;
  }
  const removed = [...remaining.values()].reduce((sum, n) => sum + n, 0);
  return { added, removed };
}

function keys(data: LedgerData, nameOf: (category: Category) => string): string[] {
  const byId = new Map(data.categories.map((c) => [c.id, c]));
  const names = (t: Transaction) =>
    [...t.categoryIds.flatMap((id) => (byId.has(id) ? [nameOf(byId.get(id)!)] : [])), ...t.retired].sort().join('|');
  return data.transactions.map((t) => JSON.stringify([t.date, t.type, t.cents, names(t), t.note]));
}

function tally(data: LedgerData, nameOf: (category: Category) => string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const key of keys(data, nameOf)) counts.set(key, (counts.get(key) ?? 0) + 1);
  return counts;
}
