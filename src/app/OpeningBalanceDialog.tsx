import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { parseSignedAmount } from '../domain/rules';
import { accountName } from '../i18n';
import { centsToInput } from './format';
import { useStore } from './store';
import { Dialog } from './ui';

export function OpeningBalanceDialog({
  title,
  body,
  onClose,
}: {
  title: string;
  body: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { accounts, updateAccount } = useStore();
  // Asked after an import of an older backup, which has exactly one account.
  const account = accounts[0];
  const [text, setText] = useState(!account || account.openingCents === 0 ? '' : centsToInput(account.openingCents));
  const parsed = text.trim() === '' ? 0 : parseSignedAmount(text);

  async function save() {
    if (parsed === null || !account) return;
    await updateAccount(account.id, accountName(account), parsed);
    onClose();
  }

  return (
    <Dialog title={title} onClose={onClose}>
      <p className="muted">{body}</p>
      <label className="field">
        <span>{t('settings.openingBalance')} (€)</span>
        <input
          inputMode="decimal"
          value={text}
          placeholder="0.00"
          onChange={(e) => setText(e.target.value)}
          aria-label={t('settings.openingBalance')}
          autoFocus
        />
      </label>
      <div className="dialog-actions">
        <button className="btn" onClick={onClose}>
          {t('common.cancel')}
        </button>
        <button className="btn primary" disabled={parsed === null} onClick={() => void save()}>
          {t('common.save')}
        </button>
      </div>
    </Dialog>
  );
}
