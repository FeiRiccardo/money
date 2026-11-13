import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import type { LedgerData, SortOrder, Transaction } from '../domain/types';
import { accountName, categoryName } from '../i18n';
import { dayLabel, formatMoney } from './format';
import { useStore } from './store';

/** A hue (0 to 359) that is always the same for the same text, so each Category keeps its own colour. */
export function hueOf(text: string): number {
  let hash = 0;
  for (const ch of text.toLowerCase()) hash = (hash * 31 + ch.codePointAt(0)!) % 360;
  return hash;
}

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

/**
 * One Transaction in a list. `showDate` adds the date (used when the list is not grouped by day).
 * `showAccount` names its account (when the list mixes accounts); it defaults to whenever there is more than one.
 */
export function TransactionRow({
  tx,
  onOpen,
  showDate = false,
  showAccount,
}: {
  tx: Transaction;
  onOpen: (tx: Transaction) => void;
  showDate?: boolean;
  showAccount?: boolean;
}) {
  const { t } = useTranslation();
  const { data, accounts, language, photoCounts } = useStore();
  const photos = photoCounts[tx.id] ?? 0;
  const chips = categoryChips(tx, data);
  const own = accounts.find((a) => a.id === tx.accountId);
  const accountTag = (showAccount ?? accounts.length > 1) && own ? accountName(own) : null;
  // The other end of a Transfer: where the money went to (on the Expense half) or came from (on the Income half).
  const other = tx.transferId === undefined ? undefined : data.transactions.find((x) => x.transferId === tx.transferId && x.id !== tx.id);
  const otherAccount = other ? accounts.find((a) => a.id === other.accountId) : undefined;
  const transferTitle = t(tx.type === 'expense' ? 'transfer.toAccount' : 'transfer.fromAccount', {
    account: otherAccount ? accountName(otherAccount) : '…',
  });
  return (
    <button className="tx-row" onClick={() => onOpen(tx)}>
      <span
        className={`tx-avatar ${tx.type}`}
        aria-hidden="true"
        style={{ '--hue': tx.transferId === undefined ? hueOf(chips[0]?.name ?? tx.note) : 285 } as CSSProperties}
      >
        {tx.transferId === undefined ? (chips[0]?.name ?? tx.note).charAt(0).toUpperCase() : '⇄'}
      </span>
      <div className="tx-main">
        <div className="tx-title">
          {tx.ruleId && (
            <span className="repeat-mark" role="img" aria-label={t('recurring.mark')} title={t('recurring.mark')}>
              ↻{' '}
            </span>
          )}
          {tx.transferId === undefined ? tx.note || chips[0]?.name : transferTitle}
          {photos > 0 && (
            <span className="photo-mark" role="img" aria-label={t('photos.attached', { count: photos })} title={t('photos.attached', { count: photos })}>
              {' '}
              📎
            </span>
          )}
        </div>
        {showDate && <div className="muted small tx-date">{dayLabel(tx.date, language)} {tx.date.slice(0, 4)}</div>}
        {tx.transferId !== undefined && tx.note && <div className="muted small">{tx.note}</div>}
        <div className="tags">
          {tx.transferId !== undefined && <span className="tag">{t('transfer.label')}</span>}
          {accountTag && <span className="tag account-tag">{accountTag}</span>}
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
