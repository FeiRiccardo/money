import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Language } from '../domain/types';
import { DriveSection } from './DriveSection';
import { dateTimeLabel, formatMoney } from './format';
import { ImportFlow } from './ImportFlow';
import { OpeningBalanceDialog } from './OpeningBalanceDialog';
import { canPromptInstall, isIos, isPersisted, isStandalone, promptInstall } from './platform';
import { useStore } from './store';
import { Dialog } from './ui';
import { APP_VERSION } from './version';

type Overlay = null | 'opening' | 'import' | 'erase';

export function SettingsScreen({ onBack, onCategories, onRecurring }: { onBack: () => void; onCategories: () => void; onRecurring: () => void }) {
  const { t } = useTranslation();
  const store = useStore();
  const { settings, language } = store;
  const [overlay, setOverlay] = useState<Overlay>(null);
  const [persisted, setPersisted] = useState<boolean | null>(null);

  useEffect(() => {
    void isPersisted().then(setPersisted);
  }, [settings.persistRequested]);

  const installable = canPromptInstall();
  const iosTab = isIos() && !isStandalone();

  return (
    <div className="screen">
      <header className="bar-head">
        <button className="icon-btn" onClick={onBack} aria-label={t('common.back')}>
          ←
        </button>
        <h1>{t('settings.title')}</h1>
        <span className="spacer" />
      </header>

      <div className="scroll settings">
        <section>
          <h3>{t('settings.language')}</h3>
          <div className="seg" role="group">
            {(['en', 'it'] as Language[]).map((code) => (
              <button key={code} className={language === code ? 'on' : ''} onClick={() => void store.setLanguage(code)}>
                {t(code === 'en' ? 'settings.english' : 'settings.italian')}
              </button>
            ))}
          </div>
        </section>

        <section>
          <button className="list-row" onClick={() => setOverlay('opening')}>
            <span>{t('settings.openingBalance')}</span>
            <span className="muted" data-testid="opening-value">
              {formatMoney(settings.openingCents, language)}
            </span>
          </button>
          <button className="list-row" onClick={onCategories}>
            <span>{t('settings.categories')}</span>
            <span className="muted">›</span>
          </button>
          <button className="list-row" onClick={onRecurring}>
            <span>
              {t('settings.recurring')}
              <small className="muted block">{t('settings.recurringHelp')}</small>
            </span>
            <span className="muted">›</span>
          </button>
        </section>

        <section>
          <h3>{t('settings.backup')}</h3>
          <button className="list-row" onClick={() => void store.exportBackup()}>
            <span>
              {t('settings.export')}
              <small className="muted block">{t('settings.exportHelp')}</small>
            </span>
          </button>
          <button className="list-row" onClick={() => void store.exportZip()}>
            <span>
              {t('settings.exportZip')}
              <small className="muted block">{t('settings.exportZipHelp')}</small>
            </span>
          </button>
          <button className="list-row" onClick={() => setOverlay('import')}>
            <span>
              {t('settings.import')}
              <small className="muted block">{t('settings.importHelp')}</small>
            </span>
          </button>
          <p className="muted small pad-x">
            {t('settings.lastBackup')}:{' '}
            {settings.lastBackupAt === null ? t('settings.never') : dateTimeLabel(settings.lastBackupAt, language)}
          </p>
          <p className="muted small pad-x">{t('settings.openingNote')}</p>
        </section>

        <DriveSection />

        <section>
          <h3>{t('settings.storage')}</h3>
          <div className="pad-x">
            <b data-testid="storage-status">
              {persisted === null
                ? t('settings.storageUnknown')
                : persisted
                  ? t('settings.storageProtected')
                  : t('settings.storageNotGuaranteed')}
            </b>
            <p className="muted small">
              {persisted ? t('settings.storageProtectedHelp') : t('settings.storageNotGuaranteedHelp')}
            </p>
          </div>
          {installable && (
            <button className="list-row" onClick={() => void promptInstall().then(() => setPersisted(null))}>
              {t('settings.install')}
            </button>
          )}
          {iosTab && <p className="muted small pad-x">{t('settings.installIos')}</p>}
        </section>

        <section>
          <button className="list-row danger" onClick={() => setOverlay('erase')}>
            <span>
              {t('settings.erase')}
              <small className="muted block">{t('settings.eraseHelp')}</small>
            </span>
          </button>
        </section>

        <footer className="footer">
          <p>{t('settings.privacy')}</p>
          <p className="muted">{t('settings.version', { version: APP_VERSION })}</p>
        </footer>
      </div>

      {overlay === 'opening' && (
        <OpeningBalanceDialog
          title={t('settings.openingBalanceTitle')}
          body={t('settings.openingBalanceHelp')}
          onClose={() => setOverlay(null)}
        />
      )}
      {overlay === 'import' && <ImportFlow onClose={() => setOverlay(null)} />}
      {overlay === 'erase' && (
        <Dialog title={t('settings.eraseTitle')} onClose={() => setOverlay(null)}>
          <p>{t('settings.eraseBody')}</p>
          <div className="dialog-actions">
            <button className="btn" onClick={() => void store.exportBackup()}>
              {t('settings.eraseExportFirst')}
            </button>
            <span className="spacer" />
            <button className="btn" onClick={() => setOverlay(null)}>
              {t('common.cancel')}
            </button>
            <button
              className="btn danger"
              onClick={() => {
                setOverlay(null);
                void store.eraseAll();
              }}
            >
              {t('settings.eraseConfirm')}
            </button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
