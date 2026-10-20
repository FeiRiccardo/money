import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Transaction } from '../domain/types';
import { CategoriesScreen } from './CategoriesScreen';
import { ChartsScreen } from './ChartsScreen';
import { FirstRun } from './FirstRun';
import { dateTimeLabel, monthOf, todayISO } from './format';
import { Home } from './Home';
import { useDesktop } from './layout';
import { OpeningBalanceDialog } from './OpeningBalanceDialog';
import { RecurringScreen } from './RecurringScreen';
import { ReportScreen } from './ReportScreen';
import { SearchScreen } from './SearchScreen';
import { SettingsScreen } from './SettingsScreen';
import { useStore } from './store';
import { TransactionForm, type Prefill } from './TransactionForm';
import { SaveFailedDialog, ToastView } from './ui';

type Screen = 'home' | 'settings' | 'categories' | 'recurring' | 'search' | 'charts' | 'report';

interface FormState {
  transaction?: Transaction;
  prefill?: Prefill;
  /** Changes when a new form replaces the open one (Duplicate), so the fields start over. */
  key: number;
}

function Shell() {
  const [screen, setScreen] = useState<Screen>('home');
  const [chartMonth, setChartMonth] = useState('');
  const [reportMonth, setReportMonth] = useState('');
  const [form, setForm] = useState<FormState | null>(null);
  const open = (next: Omit<FormState, 'key'>) => setForm((current) => ({ ...next, key: (current?.key ?? 0) + 1 }));
  const desktop = useDesktop();

  // Wide screen keyboard shortcuts: N adds a Transaction, / opens Search. Ignored while typing or with the form open.
  useEffect(() => {
    if (!desktop || form) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
      const target = e.target instanceof Element ? e.target : null;
      if (target?.closest('input, textarea, select, [contenteditable="true"]') || document.querySelector('.dialog')) return;
      if (e.key === 'n' || e.key === 'N') {
        e.preventDefault();
        open({});
      } else if (e.key === '/') {
        e.preventDefault();
        setScreen('search');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [desktop, form]);

  const screens = (
    <>
      {screen === 'home' && (
        <Home
          onAdd={() => open({})}
          onEdit={(transaction) => open({ transaction })}
          onSettings={() => setScreen('settings')}
          onSearch={() => setScreen('search')}
          onReport={(month) => {
            setReportMonth(month);
            setScreen('report');
          }}
          onCharts={(month) => {
            setChartMonth(month);
            setScreen('charts');
          }}
        />
      )}
      {screen === 'report' && <ReportScreen month={reportMonth} onBack={() => setScreen('home')} />}
      {screen === 'charts' && <ChartsScreen initialMonth={chartMonth} onBack={() => setScreen('home')} />}
      {screen === 'search' && <SearchScreen onBack={() => setScreen('home')} onEdit={(transaction) => open({ transaction })} />}
      {screen === 'settings' && (
        <SettingsScreen
          onBack={() => setScreen('home')}
          onCategories={() => setScreen('categories')}
          onRecurring={() => setScreen('recurring')}
        />
      )}
      {screen === 'categories' && <CategoriesScreen onBack={() => setScreen('settings')} />}
      {screen === 'recurring' && <RecurringScreen onBack={() => setScreen('settings')} />}
      {/* On a wide screen the form is a panel over the page: this dims and blocks the rest. */}
      {form && desktop && <div className="form-backdrop" />}
      {form && (
        <TransactionForm
          key={form.key}
          transaction={form.transaction}
          prefill={form.prefill}
          onClose={() => setForm(null)}
          onDuplicate={(prefill) => open({ prefill })}
        />
      )}
    </>
  );

  if (!desktop) return screens;
  return (
    <div className="desk">
      <Sidebar
        current={screen}
        onGo={(next) => {
          if (next === 'charts') setChartMonth(monthOf(todayISO()));
          setScreen(next);
        }}
      />
      <main className="desk-main">{screens}</main>
    </div>
  );
}

/** Line icons for the sidebar, drawn on a 24px grid. */
const ICONS: Record<Screen, string> = {
  home: 'M4 11l8-7 8 7M6 9.5V20h12V9.5',
  search: 'M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM15.5 15.5L20 20',
  charts: 'M5 20V10M12 20V4M19 20v-7',
  recurring: 'M20 12a8 8 0 0 1-14 5.3M4 12a8 8 0 0 1 14-5.3M18 3v4h-4M6 21v-4h4',
  categories: 'M3 12V4h8l10 10-8 8L3 12zM7.5 8.5h.01',
  settings: 'M4 7h9M17 7h3M4 17h3M11 17h9M15 5v4M9 15v4',
  report: '',
};

/** The wide-screen menu: every screen one click away, in place of the phone's icons and back buttons. */
function Sidebar({ current, onGo }: { current: Screen; onGo: (screen: Screen) => void }) {
  const { t } = useTranslation();
  const store = useStore();
  const items: Array<[Screen, string, string?]> = [
    ['home', t('nav.home')],
    ['search', t('home.search'), '/'],
    ['charts', t('charts.open')],
    ['recurring', t('settings.recurring')],
    ['categories', t('settings.categories')],
    ['settings', t('settings.title')],
  ];
  // The report belongs to Home.
  const active = current === 'report' ? 'home' : current;
  return (
    <nav className="side" aria-label={t('nav.menu')}>
      <div className="side-brand">
        <span className="side-logo" aria-hidden="true">€</span>
        {t('app.name')}
      </div>
      {items.map(([screen, label, key]) => (
        <button
          key={screen}
          className={active === screen ? 'on' : ''}
          aria-current={active === screen ? 'page' : undefined}
          title={key ? t('nav.shortcut', { key }) : undefined}
          onClick={() => onGo(screen)}
        >
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
            <path d={ICONS[screen]} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {label}
          {key && <kbd aria-hidden="true">{key}</kbd>}
        </button>
      ))}
      <span className="spacer" />
      <p className="side-foot muted small">
        {t('settings.lastBackup')}:{' '}
        {store.settings.lastBackupAt === null ? t('settings.never') : dateTimeLabel(store.settings.lastBackupAt, store.language)}
      </p>
    </nav>
  );
}

export default function App() {
  const { t } = useTranslation();
  const store = useStore();
  const desktop = useDesktop();

  let body;
  if (!store.ready && store.waitingForOtherCopy)
    body = (
      <div className="screen first-run">
        <h1>{t('app.updating')}</h1>
        <p>{t('app.updatingBody')}</p>
      </div>
    );
  else if (!store.ready) body = <div className="splash" aria-busy="true" />;
  else if (store.storageError)
    body = (
      <div className="screen first-run">
        <h1>{t('form.saveFailedTitle')}</h1>
        <p>{t('form.saveFailedBody')}</p>
      </div>
    );
  else if (!store.settings.onboarded) body = <FirstRun />;
  else body = <Shell />;

  return (
    <div className={desktop ? 'app desktop' : 'app'}>
      {body}
      {store.openingCheck && (
        <OpeningBalanceDialog
          title={t('import.openingCheckTitle')}
          body={t('import.openingCheckBody')}
          onClose={store.dismissOpeningCheck}
        />
      )}
      <SaveFailedDialog />
      <ToastView />
    </div>
  );
}
