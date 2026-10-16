import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { activeBanner } from '../domain/reminders';
import { sortTransactions } from '../domain/search';
import { balance, summarize, type SummaryLine } from '../domain/summary';
import type { Transaction } from '../domain/types';
import { categoryName } from '../i18n';
import { dayLabel, formatMoney, monthLabel, monthOf, shiftMonth, todayISO } from './format';
import { isIos, isStandalone } from './platform';
import { useStore } from './store';
import { SortSelect, TransactionRow } from './TransactionRow';

type Tab = 'transactions' | 'summary';

interface HomeProps {
  onAdd: () => void;
  onEdit: (t: Transaction) => void;
  onSettings: () => void;
  onSearch: () => void;
  onCharts: (month: string) => void;
  onReport: (month: string) => void;
}

export function Home({ onAdd, onEdit, onSettings, onSearch, onCharts, onReport }: HomeProps) {
  const { t } = useTranslation();
  const store = useStore();
  const { data, settings, language } = store;
  const [month, setMonth] = useState(() => monthOf(todayISO()));
  const [tab, setTab] = useState<Tab>('transactions');

  const money = (cents: number) => formatMoney(cents, language);
  const monthTransactions = useMemo(
    () => sortTransactions(data.transactions.filter((tx) => tx.date.startsWith(month)), settings.sortOrder),
    [data.transactions, month, settings.sortOrder],
  );
  const summary = useMemo(() => summarize(data, month, categoryName), [data, month]);
  const byDate = settings.sortOrder === 'newest' || settings.sortOrder === 'oldest';
  const days = byDate ? [...new Set(monthTransactions.map((tx) => tx.date))] : [];

  const banner = activeBanner({
    backup: {
      now: Date.now(),
      lastBackupAt: settings.lastBackupAt,
      changesSinceBackup: settings.changesSinceBackup,
      transactionCount: data.transactions.length,
      hiddenUntil: settings.backupBannerHiddenUntil,
    },
    install: {
      now: Date.now(),
      isIos: isIos(),
      isStandalone: isStandalone(),
      transactionCount: data.transactions.length,
      hiddenUntil: settings.installNudgeHiddenUntil,
    },
  });

  const noTransactionsAtAll = data.transactions.length === 0;

  return (
    <div className="screen">
      <header className="home-head">
        <div className="month-row">
          <button className="icon-btn" aria-label={t('home.previousMonth')} onClick={() => setMonth(shiftMonth(month, -1))}>
            ‹
          </button>
          <strong>{monthLabel(month, language)}</strong>
          <button className="icon-btn" aria-label={t('home.nextMonth')} onClick={() => setMonth(shiftMonth(month, 1))}>
            ›
          </button>
        </div>
        <div className="balance-row">
          <div>
            <small className="muted">{t('home.balance')}</small>
            <b className="balance" data-testid="balance">
              {money(balance(data, settings.openingCents))}
            </b>
          </div>
          <div className="head-actions">
            <button className="icon-btn" aria-label={t('home.search')} onClick={onSearch}>
              ⌕
            </button>
            <button className="icon-btn" aria-label={t('charts.open')} onClick={() => onCharts(month)}>
              <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
                <path d="M5 20V10M12 20V4M19 20v-7" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
              </svg>
            </button>
            <button className="icon-btn" aria-label={t('home.settings')} onClick={onSettings}>
              ⚙
            </button>
          </div>
        </div>
      </header>

      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'transactions'} className={tab === 'transactions' ? 'on' : ''} onClick={() => setTab('transactions')}>
          {t('home.tabTransactions')}
        </button>
        <button role="tab" aria-selected={tab === 'summary'} className={tab === 'summary' ? 'on' : ''} onClick={() => setTab('summary')}>
          {t('home.tabSummary')}
        </button>
      </div>

      <div className="scroll">
        {tab === 'transactions' && banner === 'install' && (
          <div className="banner">
            <b>{t('banner.installTitle')}</b>
            <p>{t('banner.installBody')}</p>
            <div className="banner-actions">
              <button className="btn" onClick={() => void store.dismissBanner('install')}>
                {t('banner.dismiss')}
              </button>
            </div>
          </div>
        )}
        {tab === 'transactions' && banner === 'backup' && (
          <div className="banner">
            <b>
              {settings.lastBackupAt === null
                ? t('banner.backupNever')
                : t('banner.backupTitle', { count: settings.changesSinceBackup })}
            </b>
            <div className="banner-actions">
              <button className="btn" onClick={() => void store.dismissBanner('backup')}>
                {t('banner.dismiss')}
              </button>
              <button className="btn primary" onClick={() => void store.exportBackup()}>
                {t('banner.backUpNow')}
              </button>
            </div>
          </div>
        )}

        {tab === 'transactions' && (
          <div className="list">
            {monthTransactions.length > 0 && (
              <div className="list-tools">
                <SortSelect value={settings.sortOrder} onChange={(order) => void store.setSortOrder(order)} />
              </div>
            )}
            {monthTransactions.length === 0 && (
              <p className="empty">{noTransactionsAtAll ? t('home.emptyNone') : t('home.emptyMonth')}</p>
            )}

            {byDate &&
              days.map((day) => {
                const dayTx = monthTransactions.filter((tx) => tx.date === day);
                const net = dayTx.reduce((sum, tx) => sum + (tx.type === 'income' ? tx.cents : -tx.cents), 0);
                return (
                  <section key={day}>
                    <div className="day-head">
                      <span>{day === todayISO() ? t('home.today') : dayLabel(day, language)}</span>
                      <span>{money(net)}</span>
                    </div>
                    {dayTx.map((tx) => (
                      <TransactionRow key={tx.id} tx={tx} onOpen={onEdit} />
                    ))}
                  </section>
                );
              })}

            {!byDate && monthTransactions.map((tx) => <TransactionRow key={tx.id} tx={tx} onOpen={onEdit} showDate />)}
          </div>
        )}

        {tab === 'summary' && (
          <div className="summary">
            {monthTransactions.length === 0 ? (
              <p className="empty">{t('home.emptySummary')}</p>
            ) : (
              <>
                <div className="totals">
                  <div>
                    <small className="muted">{t('summary.income')}</small>
                    <b className="income amount" data-testid="sum-income">{money(summary.incomeCents)}</b>
                  </div>
                  <div>
                    <small className="muted">{t('summary.expenses')}</small>
                    <b className="expense amount" data-testid="sum-expenses">{money(summary.expenseCents)}</b>
                  </div>
                  <div>
                    <small className="muted">{t('summary.net')}</small>
                    <b className="amount" data-testid="sum-net">{money(summary.netCents)}</b>
                  </div>
                </div>
                <h3>{t('summary.expensesByCategory')}</h3>
                <Lines lines={summary.expenseLines} money={money} />
                <h3>{t('summary.incomeByCategory')}</h3>
                <Lines lines={summary.incomeLines} money={money} />
                <p className="muted small">{t('summary.overlap')}</p>
                <button className="btn wide" onClick={() => onReport(month)}>
                  {t('home.report')}
                </button>
              </>
            )}
          </div>
        )}
      </div>

      <button className="fab" aria-label={t('home.add')} onClick={onAdd}>
        <svg className="fab-icon" viewBox="0 0 24 24" width="28" height="28" aria-hidden="true">
          <path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}

function Lines({ lines, money }: { lines: SummaryLine[]; money: (cents: number) => string }) {
  const { t } = useTranslation();
  if (lines.length === 0) return <p className="muted">{t('summary.nothing')}</p>;
  const max = Math.max(1, ...lines.map((l) => l.cents));
  return (
    <>
      {lines.map((line) => (
        <div className="cat-line" key={`${line.retired}:${line.name}`}>
          <div className="cat-line-head">
            <span>
              {line.name} {line.retired && <span className="tag retired">{t('home.retiredTag')}</span>}{' '}
              <span className="muted">· {line.count}</span>
            </span>
            <span className="amount">{money(line.cents)}</span>
          </div>
          <div className="bar">
            <div className="bar-fill" style={{ width: `${(line.cents / max) * 100}%` }} />
          </div>
        </div>
      ))}
    </>
  );
}
