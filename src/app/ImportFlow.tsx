import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { importArchive } from '../domain/archive';
import { previewImport, type ImportPreview } from '../domain/backup';
import type { DriveFile } from '../domain/types';
import { useStore, type ImportExtras } from './store';
import { Dialog } from './ui';

const stripBom = (text: string) => (text.startsWith('﻿') ? text.slice(1) : text);
const firstLine = (text: string) => stripBom(text).split(/\r?\n/, 1)[0] ?? '';

export interface ChosenFiles {
  transactionsCsv: string;
  categoriesCsv: string;
  /** Optional: backups made before recurring rules existed do not have it. */
  recurringCsv?: string;
}

/** Picks the files out of the selection by their header row. Transactions and Categories are required. */
export function classifyFiles(texts: string[]): ChosenFiles | null {
  const transactionsCsv = texts.find((text) => firstLine(text).startsWith('date,'));
  const categoriesCsv = texts.find((text) => firstLine(text).startsWith('type,name'));
  const recurringCsv = texts.find((text) => firstLine(text).startsWith('type,amount'));
  if (transactionsCsv === undefined || categoriesCsv === undefined) return null;
  return { transactionsCsv, categoriesCsv, recurringCsv };
}

/**
 * The import dialog: pick files, see the preview, confirm. With `source` (a ZIP downloaded from Google Drive)
 * the picker is skipped and the preview opens straight away.
 */
export function ImportFlow({
  onClose,
  source,
  onImported,
}: {
  onClose: () => void;
  source?: { bytes: Uint8Array; file: DriveFile };
  onImported?: () => void;
}) {
  const { t } = useTranslation();
  const store = useStore();
  const [problem, setProblem] = useState<string | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [busy, setBusy] = useState(false);
  /** Set when the chosen file was a ZIP: its settings and photos come along. */
  const [extras, setExtras] = useState<ImportExtras | null>(null);

  function openArchive(bytes: Uint8Array, driveFile?: DriveFile) {
    const archive = importArchive(bytes);
    if (!archive.ok) setProblem(t(`import.zip.${archive.reason}`));
    else if (archive.preview.fatal) setProblem(t(`import.fatal.${archive.preview.fatal}`));
    else {
      setPreview(archive.preview);
      setExtras({ settings: archive.settings, photos: archive.attachments, driveFile });
    }
  }

  useEffect(() => {
    if (source) openArchive(source.bytes, source.file);
    // Only the source given when the dialog opened.
  }, []);

  async function choose(files: FileList | null) {
    setProblem(null);
    setPreview(null);
    setExtras(null);
    if (!files || files.length === 0) return;
    const zip = [...files].find((file) => /\.zip$/i.test(file.name));
    if (zip) {
      let bytes: Uint8Array;
      try {
        bytes = new Uint8Array(await zip.arrayBuffer());
      } catch {
        setProblem(t('import.unreadable'));
        return;
      }
      openArchive(bytes);
      return;
    }
    let texts: string[];
    try {
      texts = await Promise.all([...files].map((file) => file.text()));
    } catch {
      setProblem(t('import.unreadable'));
      return;
    }
    const chosen = classifyFiles(texts);
    if (!chosen) {
      setProblem(t('import.needBoth'));
      return;
    }
    const result = previewImport(chosen);
    if (result.fatal) setProblem(t(`import.fatal.${result.fatal}`));
    else setPreview(result);
  }

  async function confirm() {
    if (!preview) return;
    setBusy(true);
    await store.applyImport(preview.data, preview.rules, extras ?? undefined);
    setBusy(false);
    onImported?.();
    onClose();
  }

  const fileLabel = { transactions: 'import.fileTransactions', categories: 'import.fileCategories', recurring: 'import.fileRecurring' } as const;

  return (
    <Dialog title={t(source ? 'drive.restoreTitle' : 'import.title')} onClose={onClose}>
      {!source && (
        <>
          <label className="field">
            <span>{t('import.chooseFiles')}</span>
            <input
              type="file"
              accept=".csv,text/csv,.zip,application/zip"
              multiple
              data-testid="import-files"
              onChange={(e) => void choose(e.target.files)}
            />
          </label>
          <p className="muted small">{t('import.chooseHelp')}</p>
        </>
      )}
      {problem && <div className="error">{problem}</div>}

      {preview && (
        <div className="preview">
          <h3>{t('import.previewTitle')}</h3>
          <p>
            {t('import.rowsToImport', {
              transactions: preview.data.transactions.length,
              categories: preview.data.categories.length,
            })}
          </p>
          {preview.rules.length > 0 && <p>{t('import.rulesToImport', { count: preview.rules.length })}</p>}
          {extras && extras.photos.size > 0 && (
            <p>{t('import.photosToImport', { count: [...extras.photos.values()].reduce((n, files) => n + files.length, 0) })}</p>
          )}
          {preview.errors.length > 0 && (
            <>
              <h3>{t('import.errorsTitle', { count: preview.errors.length })}</h3>
              <ul className="error-list">
                {preview.errors.slice(0, 20).map((e, i) => (
                  <li key={i}>
                    {t('import.errorRow', {
                      file: t(fileLabel[e.file]),
                      row: e.row,
                      reason: t(`import.reasons.${e.reason}`),
                    })}
                  </li>
                ))}
                {preview.errors.length > 20 && <li>…</li>}
              </ul>
            </>
          )}
          <p className="warn">{t('import.exportFirst')}</p>
        </div>
      )}

      <div className="dialog-actions">
        <button className="btn" onClick={onClose}>
          {t('common.cancel')}
        </button>
        <button className="btn danger" disabled={!preview || busy} onClick={() => void confirm()}>
          {t('import.replace')}
        </button>
      </div>
    </Dialog>
  );
}
