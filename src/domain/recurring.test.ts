import { describe, expect, it } from 'vitest';
import { dueOccurrences } from './recurring';
import type { Frequency, RecurringRule } from './types';

const rule = (
  frequency: Frequency,
  startDate: string,
  over: Partial<RecurringRule> = {},
): RecurringRule => ({
  id: 'r1',
  accountId: 'a1',
  type: 'expense',
  cents: 1000,
  categoryIds: [],
  retired: [],
  note: '',
  frequency,
  startDate,
  endDate: null,
  nextDate: startDate,
  ...over,
});

describe('dueOccurrences: monthly', () => {
  it('uses the last day of shorter months without drifting off the 31st', () => {
    const result = dueOccurrences(rule('monthly', '2026-01-31'), '2026-05-15');

    expect(result.dates).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
    expect(result.nextDate).toBe('2026-05-31');
  });
});

describe('dueOccurrences: weekly and yearly', () => {
  it('weekly: every 7 days from the start, ending with the first date after today as next', () => {
    const result = dueOccurrences(rule('weekly', '2026-10-01'), '2026-10-15');

    expect(result.dates).toEqual(['2026-10-01', '2026-10-08', '2026-10-15']);
    expect(result.nextDate).toBe('2026-10-22');
  });

  it('weekly: crosses month and year boundaries', () => {
    const result = dueOccurrences(rule('weekly', '2026-12-25'), '2027-01-08');

    expect(result.dates).toEqual(['2026-12-25', '2027-01-01', '2027-01-08']);
  });

  it('yearly: same day each year, and a leap-day start falls back to Feb 28 in other years', () => {
    const result = dueOccurrences(rule('yearly', '2024-02-29'), '2028-03-01');

    expect(result.dates).toEqual(['2024-02-29', '2025-02-28', '2026-02-28', '2027-02-28', '2028-02-29']);
    expect(result.nextDate).toBe('2029-02-28');
  });
});

describe('dueOccurrences: where it starts and where it stops', () => {
  it('creates nothing before the next date is reached, and keeps the next date', () => {
    const result = dueOccurrences(rule('monthly', '2026-01-15', { nextDate: '2026-11-15' }), '2026-10-31');

    expect(result).toEqual({ dates: [], nextDate: '2026-11-15' });
  });

  it('resumes from the next date, so occurrences already created are not created again', () => {
    const result = dueOccurrences(rule('monthly', '2026-01-01', { nextDate: '2026-03-01' }), '2026-04-15');

    expect(result.dates).toEqual(['2026-03-01', '2026-04-01']);
    expect(result.nextDate).toBe('2026-05-01');
  });

  it('includes the end date itself, then creates nothing more however long it has been', () => {
    const ended = rule('monthly', '2026-01-01', { endDate: '2026-03-01' });

    const first = dueOccurrences(ended, '2026-12-31');
    expect(first.dates).toEqual(['2026-01-01', '2026-02-01', '2026-03-01']);

    const again = dueOccurrences({ ...ended, nextDate: first.nextDate }, '2027-12-31');
    expect(again.dates).toEqual([]);
  });

  it('creates nothing when the end date is already before the next date', () => {
    const result = dueOccurrences(rule('weekly', '2026-01-01', { endDate: '2026-01-10', nextDate: '2026-01-15' }), '2026-12-31');

    expect(result.dates).toEqual([]);
  });
});
