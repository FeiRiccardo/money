import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { categoryComparison, monthlySeries, type ComparisonLine } from '../domain/charts';
import type { Language, TxType } from '../domain/types';
import { categoryName } from '../i18n';
import { formatMoney, monthLabel, monthOf, shiftMonth, todayISO } from './format';
import { useStore } from './store';

const SLICE_COLORS = 6;

export function ChartsScreen({ initialMonth, onBack }: { initialMonth: string; onBack: () => void }) {
  const { t } = useTranslation();
  const { data, language } = useStore();
  const [month, setMonth] = useState(initialMonth);
  const [type, setType] = useState<TxType>('expense');
  const [months, setMonths] = useState<6 | 12>(6);

  const money = (cents: number) => formatMoney(cents, language);
  const series = useMemo(() => monthlySeries(data, month, months), [data, month, months]);
  const lines = useMemo(() => categoryComparison(data, month, type, categoryName), [data, month, type]);
  const thisMonthLines = lines.filter((l) => l.cents > 0);

  return (
    <div className="screen">
      <header className="bar-head">
        <button className="icon-btn" onClick={onBack} aria-label={t('common.back')}>
          ←
        </button>
        <h1>{t('charts.title')}</h1>
        <span className="spacer" />
      </header>

      <div className="scroll charts">
        <div className="month-row">
          <button className="icon-btn" aria-label={t('home.previousMonth')} onClick={() => setMonth(shiftMonth(month, -1))}>
            ‹
          </button>
          <label className="month-pick">
            <strong>{monthLabel(month, language)}</strong>
            <input
              type="month"
              aria-label={t('charts.pickMonth')}
              value={month}
              max={monthOf(todayISO())}
              onChange={(e) => e.target.value && setMonth(e.target.value)}
            />
          </label>
          <button className="icon-btn" aria-label={t('home.nextMonth')} onClick={() => setMonth(shiftMonth(month, 1))}>
            ›
          </button>
        </div>

        <h3>{t('charts.trend')}</h3>
        <div className="seg" role="group" aria-label={t('charts.range')}>
          {([6, 12] as const).map((n) => (
            <button key={n} className={months === n ? 'on' : ''} onClick={() => setMonths(n)}>
              {t('charts.lastMonths', { count: n })}
            </button>
          ))}
        </div>
        <TrendChart series={series} selected={month} language={language} money={money} />
        <div className="legend">
          <span>
            <i className="dot income-bg" />
            {t('summary.income')}
          </span>
          <span>
            <i className="dot expense-bg" />
            {t('summary.expenses')}
          </span>
        </div>

        <h3>{t('charts.byCategory')}</h3>
        <div className="seg" role="group" aria-label={t('charts.type')}>
          {(['expense', 'income'] as const).map((value) => (
            <button key={value} className={type === value ? 'on' : ''} onClick={() => setType(value)}>
              {t(value === 'expense' ? 'summary.expenses' : 'summary.income')}
            </button>
          ))}
        </div>

        {thisMonthLines.length === 0 ? (
          <p className="empty" data-testid="chart-empty">
            {t('charts.noData')}
          </p>
        ) : (
          <Donut lines={thisMonthLines} money={money} />
        )}

        {lines.length > 0 && (
          <>
            <h3>{t('charts.vsLastMonth')}</h3>
            <ul className="compare">
              {lines.map((line) => (
                <li key={`${line.retired}:${line.name}`}>
                  <span>
                    {line.name} {line.retired && <span className="tag retired">{t('home.retiredTag')}</span>}
                  </span>
                  <span className="amount">{money(line.cents)}</span>
                  <Delta line={line} type={type} money={money} />
                </li>
              ))}
            </ul>
            <p className="muted small">{t('summary.overlap')}</p>
          </>
        )}
      </div>
    </div>
  );
}

function Delta({ line, type, money }: { line: ComparisonLine; type: TxType; money: (cents: number) => string }) {
  const { t } = useTranslation();
  const change = line.cents - line.previousCents;
  if (change === 0) return <span className="delta muted">{t('charts.same')}</span>;
  if (line.previousCents === 0) return <span className="delta muted">{t('charts.new')}</span>;
  // More spending is bad, more income is good.
  const good = type === 'expense' ? change < 0 : change > 0;
  return (
    <span className={'delta ' + (good ? 'income' : 'expense')} data-testid="delta">
      {change > 0 ? '▲' : '▼'} {money(Math.abs(change))}
    </span>
  );
}

function TrendChart({
  series,
  selected,
  language,
  money,
}: {
  series: ReturnType<typeof monthlySeries>;
  selected: string;
  language: Language;
  money: (cents: number) => string;
}) {
  const { t } = useTranslation();
  const W = 320;
  const H = 150;
  const base = H - 22;
  const top = 8;
  const max = Math.max(1, ...series.flatMap((p) => [p.incomeCents, p.expenseCents]));
  const slot = W / series.length;
  const bar = Math.min(14, slot / 2 - 2);
  const h = (cents: number) => (cents > 0 ? Math.max(2, ((base - top) * cents) / max) : 0);
  const short = (m: string) =>
    new Intl.DateTimeFormat(language === 'it' ? 'it-IT' : 'en-IE', { month: 'short' }).format(
      new Date(Number(m.slice(0, 4)), Number(m.slice(5)) - 1, 1),
    );

  return (
    <svg className="trend" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t('charts.trend')} data-testid="trend-chart">
      <line x1="0" x2={W} y1={base} y2={base} stroke="var(--line)" />
      {series.map((p, i) => {
        const cx = slot * i + slot / 2;
        return (
          <g key={p.month} data-month={p.month} opacity={p.month === selected ? 1 : 0.55}>
            <title>{`${monthLabel(p.month, language)}: ${t('summary.income')} ${money(p.incomeCents)}, ${t('summary.expenses')} ${money(p.expenseCents)}`}</title>
            <rect x={cx - bar - 1} y={base - h(p.incomeCents)} width={bar} height={h(p.incomeCents)} rx="2" fill="var(--income)" data-testid="bar-income" />
            <rect x={cx + 1} y={base - h(p.expenseCents)} width={bar} height={h(p.expenseCents)} rx="2" fill="var(--expense)" data-testid="bar-expense" />
            <text x={cx} y={H - 6} textAnchor="middle" fontSize="10" fill="var(--muted)">
              {short(p.month)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function Donut({ lines, money }: { lines: ComparisonLine[]; money: (cents: number) => string }) {
  const { t } = useTranslation();
  // The biggest five get their own colour; everything else is folded into one grey slice.
  const shown = lines.length > SLICE_COLORS ? lines.slice(0, SLICE_COLORS - 1) : lines;
  const restCents = lines.slice(shown.length).reduce((sum, l) => sum + l.cents, 0);
  const slices = [
    ...shown.map((l) => ({ name: l.name, cents: l.cents })),
    ...(restCents > 0 ? [{ name: t('charts.other'), cents: restCents }] : []),
  ];
  const total = slices.reduce((sum, s) => sum + s.cents, 0);
  const colorOf = (i: number) => (i === shown.length && restCents > 0 ? 'var(--muted)' : `var(--c${i + 1})`);
  const R = 42;
  const C = 2 * Math.PI * R;
  let offset = 0;

  return (
    <div className="donut-wrap">
      <svg className="donut" viewBox="0 0 120 120" role="img" aria-label={t('charts.byCategory')} data-testid="donut-chart">
        {slices.map((s, i) => {
          const length = (s.cents / total) * C;
          const circle = (
            <circle
              key={s.name}
              cx="60"
              cy="60"
              r={R}
              fill="none"
              strokeWidth="18"
              stroke={colorOf(i)}
              strokeDasharray={`${length} ${C - length}`}
              strokeDashoffset={-offset}
              transform="rotate(-90 60 60)"
              data-testid="donut-slice"
            >
              <title>{`${s.name}: ${money(s.cents)}`}</title>
            </circle>
          );
          offset += length;
          return circle;
        })}
      </svg>
      <ul className="donut-legend">
        {slices.map((s, i) => (
          <li key={s.name}>
            <i className="dot" style={{ background: colorOf(i) }} />
            <span>{s.name}</span>
            <span className="muted">{Math.round((s.cents / total) * 100)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
