import { describe, expect, it } from 'vitest';
import { countChanges } from './changes';
import type { Category, LedgerData, Transaction } from './types';

const nameOf = (c: Category) => c.name;
const groceries: Category = { id: 'g', type: 'expense', name: 'Groceries', lastUsedAt: 0 };

function tx(id: string, note: string, cents = 1000, categoryId = 'g'): Transaction {
  return { id, date: '2026-10-01', type: 'expense', cents, categoryIds: [categoryId], retired: [], note };
}
const ledger = (...transactions: Transaction[]): LedgerData => ({ categories: [groceries], transactions });

describe('countChanges', () => {
  it('counts Transactions only the newer copy has as new, whatever their ids', () => {
    const before = ledger(tx('a', 'Bread'));
    // A copy from Drive gets fresh ids on import, and its Category ids differ too.
    const after: LedgerData = {
      categories: [{ ...groceries, id: 'g2' }],
      transactions: [tx('x', 'Bread', 1000, 'g2'), tx('y', 'Milk', 1000, 'g2'), tx('z', 'Eggs', 1000, 'g2')],
    };
    expect(countChanges(before, after, nameOf)).toEqual({ added: 2, removed: 0 });
  });

  it('counts Transactions the newer copy no longer has as removed', () => {
    expect(countChanges(ledger(tx('a', 'Bread'), tx('b', 'Milk')), ledger(tx('x', 'Bread')), nameOf)).toEqual({ added: 0, removed: 1 });
  });

  it('sees an edited Transaction as one removed and one new', () => {
    expect(countChanges(ledger(tx('a', 'Bread', 1000)), ledger(tx('x', 'Bread', 1250)), nameOf)).toEqual({ added: 1, removed: 1 });
  });

  it('keeps identical Transactions apart, so a second coffee counts', () => {
    expect(countChanges(ledger(tx('a', 'Coffee')), ledger(tx('x', 'Coffee'), tx('y', 'Coffee')), nameOf)).toEqual({ added: 1, removed: 0 });
  });
});
