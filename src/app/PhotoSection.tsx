import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Attachment, AttachmentInput } from '../domain/types';
import { MAX_PHOTOS, photoUrl, shrinkImage } from './photos';
import { useStore } from './store';
import { Dialog } from './ui';

export interface PhotoDraft {
  added: Array<{ key: number; input: AttachmentInput }>;
  removedIds: string[];
}

export const NO_PHOTO_CHANGES: PhotoDraft = { added: [], removedIds: [] };

interface Shown {
  key: string;
  url: string;
  /** Set for a photo that is already stored. */
  storedId?: string;
  addedKey?: number;
}

/** The receipt photos of one Transaction: thumbnails, add, remove and a full-size view. Changes wait for Save. */
export function PhotoSection({
  transactionId,
  draft,
  onChange,
}: {
  transactionId?: string;
  draft: PhotoDraft;
  onChange: (draft: PhotoDraft) => void;
}) {
  const { t } = useTranslation();
  const store = useStore();
  const [stored, setStored] = useState<Attachment[]>([]);
  const [viewing, setViewing] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const nextKey = useRef(1);

  useEffect(() => {
    if (!transactionId) return;
    let cancelled = false;
    void store.attachmentsOf(transactionId).then((found) => !cancelled && setStored(found));
    return () => {
      cancelled = true;
    };
    // The stored photos only change through this form, so they are read once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transactionId]);

  const shown = useMemo<Shown[]>(
    () => [
      ...stored
        .filter((a) => !draft.removedIds.includes(a.id))
        .map((a) => ({ key: a.id, url: photoUrl(a), storedId: a.id })),
      ...draft.added.map((a) => ({ key: `new-${a.key}`, url: photoUrl(a.input), addedKey: a.key })),
    ],
    [stored, draft],
  );
  useEffect(() => () => shown.forEach((s) => URL.revokeObjectURL(s.url)), [shown]);

  async function pick(files: FileList | null) {
    setFailed(false);
    if (!files) return;
    const room = MAX_PHOTOS - shown.length;
    const added: PhotoDraft['added'] = [];
    for (const file of [...files].slice(0, Math.max(0, room))) {
      try {
        added.push({ key: nextKey.current++, input: await shrinkImage(file) });
      } catch {
        setFailed(true);
      }
    }
    if (added.length > 0) onChange({ ...draft, added: [...draft.added, ...added] });
  }

  function remove(photo: Shown) {
    if (photo.storedId) onChange({ ...draft, removedIds: [...draft.removedIds, photo.storedId] });
    else onChange({ ...draft, added: draft.added.filter((a) => a.key !== photo.addedKey) });
  }

  const full = shown.length >= MAX_PHOTOS;
  const viewed = shown.find((s) => s.key === viewing);

  return (
    <div className="photos">
      <div className="label">
        {t('photos.title')} <span className="hint">({t('photos.limit', { count: MAX_PHOTOS })})</span>
      </div>
      <div className="thumbs">
        {shown.map((photo) => (
          <div className="thumb" key={photo.key} data-testid="photo-thumb">
            <button type="button" className="thumb-img" aria-label={t('photos.view')} onClick={() => setViewing(photo.key)}>
              <img src={photo.url} alt="" />
            </button>
            <button type="button" className="thumb-remove" aria-label={t('photos.remove')} onClick={() => remove(photo)}>
              ✕
            </button>
          </div>
        ))}
        {!full && (
          <label className="thumb add-photo">
            <span>＋ {t('photos.add')}</span>
            <input
              type="file"
              accept="image/*"
              multiple
              data-testid="photo-input"
              aria-label={t('photos.add')}
              onChange={(e) => {
                void pick(e.target.files);
                e.target.value = '';
              }}
            />
          </label>
        )}
      </div>
      {failed && <div className="error">{t('photos.unreadable')}</div>}

      {viewed && (
        <Dialog title={t('photos.title')} onClose={() => setViewing(null)}>
          <img className="photo-full" src={viewed.url} alt={t('photos.title')} />
          <div className="dialog-actions">
            <button className="btn" onClick={() => setViewing(null)}>
              {t('common.close')}
            </button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
