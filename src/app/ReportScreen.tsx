import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { buildReport } from '../domain/report';
import type { SummaryLine } from '../domain/summary';
import { categoryName } from '../i18n';
import { dayLabel, formatMoney, monthLabel } from './format';
import { saveReportPdf } from './platform';
import { reportPdf } from './reportPdf';
import { useStore } from './store';

/** A print-ready monthly report. "Print / Save as PDF" opens the browser's print dialog. */
export function ReportScreen({ month, onBack }: { month: string; onBack: () => void }) {
  const { t } = useTranslation();
  const { data, settings, language, notify } = useStore();
  const [saving, setSaving] = useState(false);
  const report = useMemo(() => buildReport(data, month, settings.openingCents, categoryName), [data, month, settings.openingCents]);
  const money = (cents: number) => formatMoney(cents, language);
  const today = new Intl.DateTimeFormat(language === 'it' ? 'it-IT' : 'en-IE', { dateStyle: 'long' }).format(new Date());

  async function downloadPdf() {
    setSaving(true);
    try {
      const done = await saveReportPdf(reportPdf(report, language, t, today), month, t('report.title'));
      if (done) notify({ kind: 'success', message: t('report.saved') });
    } catch {
      notify({ kind: 'error', message: t('report.failed') });
    } finally {
      setSaving(false);
    }
  }
  const signedMoney = (type: 'income' | 'expense', cents: number) => (type === 'income' ? '+' : '−') + money(cents);

  return (
    <div className="screen report-screen">
      <header className="bar-head no-print">
        <button className="icon-btn back" onClick={onBack} aria-label={t('common.back')}>
          ←
        </button>
        <h1>{t('report.title')}</h1>
        <span className="spacer" />
      </header>

      <div className="scroll">
        <div className="report-actions no-print">
          <button className="btn primary" disabled={saving} onClick={() => void downloadPdf()}>
            {t('report.download')}
          </button>
          <button className="btn" onClick={() => window.print()}>
            {t('report.print')}
          </button>
        </div>
        <article className="report" data-testid="report">
          <h1 className="report-title">{t('report.heading', { month: monthLabel(month, language) })}</h1>
          <p className="muted small">{t('report.generated', { date: today })}</p>

          <table className="report-table totals-table">
            <tbody>
              <tr>
                <th scope="row">{t('report.startBalance')}</th>
                <td className="amount" data-testid="report-start">{money(report.startBalanceCents)}</td>
              </tr>
              <tr>
                <th scope="row">{t('summary.income')}</th>
                <td className="amount income" data-testid="report-income">{money(report.incomeCents)}</td>
              </tr>
              <tr>
                <th scope="row">{t('summary.expenses')}</th>
                <td className="amount expense" data-testid="report-expenses">{money(report.expenseCents)}</td>
              </tr>
              <tr>
                <th scope="row">{t('summary.net')}</th>
                <td className="amount" data-testid="report-net">{money(report.netCents)}</td>
              </tr>
              <tr className="strong">
                <th scope="row">{t('report.endBalance')}</th>
                <td className="amount" data-testid="report-end">{money(report.endBalanceCents)}</td>
              </tr>
            </tbody>
          </table>

          {report.days.length === 0 ? (
            <p className="empty">{t('report.empty')}</p>
          ) : (
            <>
              <LineTable title={t('summary.expensesByCategory')} lines={report.expenseLines} money={money} />
              <LineTable title={t('summary.incomeByCategory')} lines={report.incomeLines} money={money} />
              <p className="muted small">{t('summary.overlap')}</p>

              <h3>{t('report.transactions')}</h3>
              <table className="report-table list-table">
                <tbody>
                  {report.days.map((day) => (
                    <DayRows key={day.date}>
                      <tr className="day-row">
                        <th colSpan={2} scope="colgroup">{dayLabel(day.date, language)}</th>
                        <td className="amount">{money(day.netCents)}</td>
                      </tr>
                      {day.items.map((item) => (
                        <tr key={item.id} data-testid="report-row">
                          <td>{item.note || item.categories[0]}</td>
                          <td className="muted small">{item.categories.join(', ')}</td>
                          <td className={'amount ' + item.type}>{signedMoney(item.type, item.cents)}</td>
                        </tr>
                      ))}
                    </DayRows>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </article>
      </div>
    </div>
  );
}

/** Groups table rows without adding an element (a fragment with a key). */
function DayRows({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

function LineTable({ title, lines, money }: { title: string; lines: SummaryLine[]; money: (cents: number) => string }) {
  const { t } = useTranslation();
  if (lines.length === 0) return null;
  return (
    <>
      <h3>{title}</h3>
      <table className="report-table">
        <tbody>
          {lines.map((line) => (
            <tr key={`${line.retired}:${line.name}`}>
              <td>
                {line.name} {line.retired && <span className="muted">({t('home.retiredTag')})</span>}
              </td>
              <td className="muted small">{line.count}</td>
              <td className="amount">{money(line.cents)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
