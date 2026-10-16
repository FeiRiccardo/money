import type { Language } from '../domain/types';

const LOCALE: Record<Language, string> = { en: 'en-IE', it: 'it-IT' };

export function formatMoney(cents: number, language: Language): string {
  return new Intl.NumberFormat(LOCALE[language], { style: 'currency', currency: 'EUR' }).format(cents / 100);
}

/** Cents to the text shown in the amount field (dot decimal, always accepted back by parseAmount). */
export function centsToInput(cents: number): string {
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Today's calendar date in the device's local time, YYYY-MM-DD. */
export function todayISO(now: Date = new Date()): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export const monthOf = (date: string): string => date.slice(0, 7);

export { shiftMonth } from '../domain/months';

export function monthLabel(month: string, language: Language): string {
  const date = new Date(Number(month.slice(0, 4)), Number(month.slice(5)) - 1, 1);
  const text = new Intl.DateTimeFormat(LOCALE[language], { month: 'long', year: 'numeric' }).format(date);
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function dayLabel(date: string, language: Language): string {
  const d = new Date(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)));
  return new Intl.DateTimeFormat(LOCALE[language], { weekday: 'short', day: 'numeric', month: 'short' }).format(d);
}

export function dateTimeLabel(timestamp: number, language: Language): string {
  return new Intl.DateTimeFormat(LOCALE[language], { dateStyle: 'medium' }).format(new Date(timestamp));
}
