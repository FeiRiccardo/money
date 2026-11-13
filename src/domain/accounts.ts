import { validateCategoryName, type NameResult } from './rules';
import type { Account, LedgerData, RecurringRule, Transaction } from './types';

/** The Transactions of one Account, or all of them when `accountId` is null. */
export function scopeTo(data: LedgerData, accountId: string | null): LedgerData {
  if (accountId === null) return data;
  return { ...data, transactions: data.transactions.filter((t) => t.accountId === accountId) };
}

/** The Opening balance of one Account, or of all of them added together when `accountId` is null. */
export function openingOf(accounts: Account[], accountId: string | null): number {
  return accounts.filter((a) => accountId === null || a.id === accountId).reduce((sum, a) => sum + a.openingCents, 0);
}

/** An Account's name is checked like a Category's (not empty, at most 30 characters, no "|", unique). */
export function validateAccountName(name: string, others: string[]): NameResult {
  return validateCategoryName(name, { existing: others, retired: [] });
}

/** True for either half of a Transfer. */
export const isTransfer = (t: Pick<Transaction, 'transferId'>): boolean => t.transferId !== undefined;

/** The two halves of a Transfer, source first: the Expense on the Account the money left, then the Income. */
export function transferHalves(transactions: Transaction[], transferId: string): { from?: Transaction; to?: Transaction } {
  const halves = transactions.filter((t) => t.transferId === transferId);
  return { from: halves.find((t) => t.type === 'expense'), to: halves.find((t) => t.type === 'income') };
}

/** What a deleted Account took with it, for Undo. */
export interface AccountDeletion {
  account: Account;
  /** Its own Transactions as they were. */
  transactions: Transaction[];
  /** The other half of each Transfer it was part of, as it was before it became an ordinary Transaction. */
  partners: Transaction[];
  rules: RecurringRule[];
}
