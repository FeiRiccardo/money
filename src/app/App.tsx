import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Transaction } from '../domain/types';
import { CategoriesScreen } from './CategoriesScreen';
import { ChartsScreen } from './ChartsScreen';
import { FirstRun } from './FirstRun';
import { Home } from './Home';
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

  return (
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
}

export default function App() {
  const { t } = useTranslation();
  const store = useStore();

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
    <div className="app">
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
