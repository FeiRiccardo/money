const pad = (n: number) => String(n).padStart(2, '0');

/** Moves a YYYY-MM month forwards or backwards by whole months. */
export function shiftMonth(month: string, delta: number): string {
  const total = Number(month.slice(0, 4)) * 12 + (Number(month.slice(5)) - 1) + delta;
  return `${Math.floor(total / 12)}-${pad((total % 12) + 1)}`;
}
