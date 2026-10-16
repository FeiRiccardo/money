import type { TFunction } from 'i18next';
import { buildPdf, type PdfRow } from '../domain/pdf';
import type { MonthReport } from '../domain/report';
import type { SummaryLine } from '../domain/summary';
import type { Language } from '../domain/types';
import { dayLabel, formatMoney, monthLabel } from './format';

/** The monthly report as the lines of a PDF, in the same order as the report screen. */
export function reportRows(report: MonthReport, language: Language, t: TFunction, today: string): PdfRow[] {
  const money = (cents: number) => formatMoney(cents, language);
  const rows: PdfRow[] = [
    { left: t('report.heading', { month: monthLabel(report.month, language) }), style: 'title' },
    { left: t('report.generated', { date: today }), style: 'muted' },
    { left: t('report.startBalance'), right: money(report.startBalanceCents), space: 10 },
    { left: t('summary.income'), right: money(report.incomeCents) },
    { left: t('summary.expenses'), right: money(report.expenseCents) },
    { left: t('summary.net'), right: money(report.netCents) },
    { left: t('report.endBalance'), right: money(report.endBalanceCents), style: 'strong' },
  ];

  if (report.days.length === 0) return [...rows, { left: t('report.empty'), style: 'muted', space: 14 }];

  const lines = (title: string, list: SummaryLine[]) =>
    list.length === 0
      ? []
      : [
          { left: title, style: 'heading' as const, space: 14 },
          ...list.map((l) => ({
            left: l.retired ? `${l.name} (${t('home.retiredTag')})` : l.name,
            middle: String(l.count),
            right: money(l.cents),
          })),
        ];
  rows.push(...lines(t('summary.expensesByCategory'), report.expenseLines));
  rows.push(...lines(t('summary.incomeByCategory'), report.incomeLines));
  rows.push({ left: t('summary.overlap'), style: 'muted', space: 6 });

  rows.push({ left: t('report.transactions'), style: 'heading', space: 14 });
  for (const day of report.days) {
    rows.push({ left: dayLabel(day.date, language), right: money(day.netCents), style: 'strong', space: 6 });
    for (const item of day.items) {
      rows.push({
        left: item.note || item.categories[0] || '',
        middle: item.categories.join(', '),
        right: (item.type === 'income' ? '+' : '-') + money(item.cents),
      });
    }
  }
  return rows;
}

export function reportPdf(report: MonthReport, language: Language, t: TFunction, today: string): Uint8Array {
  return buildPdf(reportRows(report, language, t, today));
}
