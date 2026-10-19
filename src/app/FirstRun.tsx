import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { parseSignedAmount } from '../domain/rules';
import type { Language } from '../domain/types';
import { useDrive } from './drive';
import { ImportFlow } from './ImportFlow';
import { useStore } from './store';

type Step = 'welcome' | 'starting' | 'import';

export function FirstRun() {
  const { t } = useTranslation();
  const store = useStore();
  const drive = useDrive();
  const [step, setStep] = useState<Step>('welcome');
  const [starting, setStarting] = useState('');
  const parsed = starting.trim() === '' ? 0 : parseSignedAmount(starting);

  if (step === 'starting') {
    return (
      <div className="screen first-run">
        <h1>{t('firstRun.startingTitle')}</h1>
        <p className="muted">{t('firstRun.startingHelp')}</p>
        <label className="amount-box">
          <span className="muted">€</span>
          <input
            autoFocus
            inputMode="decimal"
            value={starting}
            placeholder={t('firstRun.startingPlaceholder')}
            aria-label={t('firstRun.startingTitle')}
            onChange={(e) => setStarting(e.target.value)}
          />
        </label>
        <div className="first-actions">
          <button className="btn" onClick={() => void store.startFresh(0)}>
            {t('common.skip')}
          </button>
          <button className="btn primary" disabled={parsed === null} onClick={() => void store.startFresh(parsed ?? 0)}>
            {t('common.continue')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="screen first-run">
      <div className="logo" aria-hidden="true">€</div>
      <h1>{t('app.name')}</h1>
      <p className="muted">{t('firstRun.tagline')}</p>

      <div className="seg center" role="group">
        {(['en', 'it'] as Language[]).map((code) => (
          <button key={code} className={store.language === code ? 'on' : ''} onClick={() => void store.setLanguage(code)}>
            {t(code === 'en' ? 'settings.english' : 'settings.italian')}
          </button>
        ))}
      </div>

      <div className="first-actions">
        <button className="btn primary" onClick={() => setStep('starting')}>
          {t('firstRun.startFresh')}
        </button>
        <button className="btn" onClick={() => setStep('import')}>
          {t('firstRun.restore')}
        </button>
        {drive.status !== 'unavailable' && (
          <button className="btn" disabled={drive.busy} onClick={() => void drive.restore()}>
            {t('drive.restore')}
          </button>
        )}
      </div>

      {step === 'import' && <ImportFlow onClose={() => setStep('welcome')} />}
    </div>
  );
}
