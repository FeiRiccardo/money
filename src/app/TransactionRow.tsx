import { useTranslation } from 'react-i18next';
import type { LedgerData, SortOrder, Transaction } from '../domain/types';
import { categoryName } from '../i18n';
import { dayLabel, formatMoney } from './format';
import { useStore } from './store';

export function categoryChips(tx: Transaction, data: LedgerData) {
  const byId = new Map(data.categories.map((c) => [c.id, c]));
  return [
    ...tx.categoryIds.flatMap((id) => {
      const c = byId.get(id);
      return c ? [{ key: id, name: categoryName(c), retired: false }] : [];
    }),
    ...tx.retired.map((name) => ({ key: `r:${name}`, name, retired: true })),
  ];
}

/** One Transaction in a list. `showDate` adds the date (used when the list is not grouped by day). */
export function TransactionRow({ tx, onOpen, showDate = false }: { tx: Transaction; onOpen: (tx: Transaction) => void; showDate?: boolean }) {
  const { t } = useTranslation();
  const { data, language, photoCounts } = useStore();
  const photos = photoCounts[tx.id] ?? 0;
  const chips = categoryChips(tx, data);
  return (
    <button className="tx-row" onClick={() => onOpen(tx)}>
      <span className={`tx-avatar ${tx.type}`} aria-hidden="true">
        {(chips[0]?.name ?? tx.note).charAt(0).toUpperCase()}
      </span>
      <div className="tx-main">
        <div className="tx-title">
          {tx.ruleId && (
            <span className="repeat-mark" role="img" aria-label={t('recurring.mark')} title={t('recurring.mark')}>
              ↻{' '}
            </span>
          )}
          {tx.note || chips[0]?.name}
          {photos > 0 && (
            <span className="photo-mark" role="img" aria-label={t('photos.attached', { count: photos })} title={t('photos.attached', { count: photos })}>
              {' '}
              📎
            </span>
          )}
        </div>
        {showDate && <div className="muted small tx-date">{dayLabel(tx.date, language)} {tx.date.slice(0, 4)}</div>}
        <div className="tags">
          {chips.map((c) => (
            <span key={c.key} className={`tag ${c.retired ? 'retired' : ''}`}>
              {c.name}
            </span>
          ))}
        </div>
      </div>
      <div className={`amount ${tx.type}`}>
        {tx.type === 'income' ? '+' : '−'}
        {formatMoney(tx.cents, language)}
      </div>
    </button>
  );
}

export function SortSelect({ value, onChange }: { value: SortOrder; onChange: (order: SortOrder) => void }) {
  const { t } = useTranslation();
  return (
    <label className="sort-select">
      <span className="muted small">{t('sort.label')}</span>
      <select value={value} onChange={(e) => onChange(e.target.value as SortOrder)} aria-label={t('sort.label')}>
        {(['newest', 'oldest', 'largest', 'smallest'] as SortOrder[]).map((order) => (
          <option key={order} value={order}>
            {t(`sort.${order}`)}
          </option>
        ))}
      </select>
    </label>
  );
}
