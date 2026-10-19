import { useTranslation } from 'react-i18next';
import { useDrive } from './drive';
import { dateTimeLabel } from './format';
import { useStore } from './store';

/** The Google Drive rows in Settings. Hidden when the build has no Google client ID. */
export function DriveSection() {
  const { t } = useTranslation();
  const drive = useDrive();
  const { settings, language } = useStore();
  if (drive.status === 'unavailable') return null;

  if (drive.status === 'disconnected') {
    return (
      <section>
        <h3>{t('drive.title')}</h3>
        <button className="list-row" onClick={drive.connect}>
          <span>
            {t('drive.connect')}
            <small className="muted block">{t('drive.connectHelp')}</small>
          </span>
        </button>
        <button className="list-row" disabled={drive.busy} onClick={() => void drive.restore()}>
          <span>{t('drive.restore')}</span>
        </button>
      </section>
    );
  }

  return (
    <section>
      <h3>{t('drive.title')}</h3>
      {drive.conflict ? (
        <div className="pad-x">
          <p className="warn">{t('drive.conflict')}</p>
          <div className="dialog-actions">
            <button className="btn" disabled={drive.busy} onClick={() => void drive.restore()}>
              {t('drive.conflictRestore')}
            </button>
            <button className="btn danger" disabled={drive.busy} onClick={() => void drive.saveNow(true)}>
              {t('drive.conflictReplace')}
            </button>
          </div>
        </div>
      ) : drive.status === 'expired' ? (
        <button className="list-row" onClick={drive.connect}>
          <span>
            {t('drive.reconnect')}
            <small className="muted block">{t('drive.expiredHelp')}</small>
          </span>
        </button>
      ) : (
        <button className="list-row" disabled={drive.busy} onClick={() => void drive.saveNow()}>
          <span>
            {t('drive.saveNow')}
            <small className="muted block">{t('drive.autoHelp')}</small>
          </span>
        </button>
      )}
      {!drive.conflict && (
        <button className="list-row" disabled={drive.busy} onClick={() => void drive.restore()}>
          <span>{t('drive.restore')}</span>
        </button>
      )}
      <button className="list-row" onClick={() => void drive.disconnect()}>
        <span>{t('drive.disconnect')}</span>
      </button>
      <p className="muted small pad-x" data-testid="drive-saved-at">
        {t('drive.lastSaved')}:{' '}
        {settings.driveSavedAt === null ? t('settings.never') : dateTimeLabel(settings.driveSavedAt, language)}
      </p>
    </section>
  );
}
