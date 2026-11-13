import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { scopeTo } from '../domain/accounts';
import { parseSignedAmount, type NameError } from '../domain/rules';
import { balance } from '../domain/summary';
import type { Account } from '../domain/types';
import { accountName } from '../i18n';
import { centsToInput, formatMoney } from './format';
import { useStore } from './store';
import { Dialog } from './ui';

export function AccountsScreen({ onBack }: { onBack: () => void }) {
  const { t } = useTranslation();
  const { data, accounts, language } = useStore();
  const [editing, setEditing] = useState<Account | 'new' | null>(null);
  const money = (cents: number) => formatMoney(cents, language);
  const balances = accounts.map((a) => ({ account: a, cents: balance(scopeTo(data, a.id), a.openingCents) }));
  const total = balances.reduce((sum, b) => sum + b.cents, 0);

  return (
    <div className="screen">
      <header className="bar-head">
        <button className="icon-btn back" onClick={onBack} aria-label={t('common.back')}>
          ←
        </button>
        <h1>{t('accounts.title')}</h1>
        <span className="spacer" />
      </header>

      <div className="scroll">
        <p className="muted small pad-x">{t('accounts.help')}</p>
        <ul className="plain-list">
          {balances.map(({ account, cents }) => (
            <li key={account.id}>
              <button className="list-row" onClick={() => setEditing(account)}>
                <span>{accountName(account)}</span>
                <span className="amount" data-testid="account-balance">
                  {money(cents)}
                </span>
              </button>
            </li>
          ))}
          {accounts.length > 1 && (
            <li>
              <div className="list-row">
                <b>{t('accounts.total')}</b>
                <b className="amount" data-testid="accounts-total">
                  {money(total)}
                </b>
              </div>
            </li>
          )}
        </ul>
        <div className="pad">
          <button className="btn wide" onClick={() => setEditing('new')}>
            {t('accounts.newButton')}
          </button>
        </div>
      </div>

      {editing && <AccountDialog account={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function AccountDialog({ account, onClose }: { account: Account | null; onClose: () => void }) {
  const { t } = useTranslation();
  const store = useStore();
  const [name, setName] = useState(account ? accountName(account) : '');
  const [opening, setOpening] = useState(account && account.openingCents !== 0 ? centsToInput(account.openingCents) : '');
  const [error, setError] = useState<NameError | 'opening' | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const own = account ? store.data.transactions.filter((tx) => tx.accountId === account.id) : [];
  const hasTransfers = own.some((tx) => tx.transferId !== undefined);
  const onlyOne = store.accounts.length <= 1;

  async function save() {
    const cents = opening.trim() === '' ? 0 : parseSignedAmount(opening);
    if (cents === null) return setError('opening');
    const result = account ? await store.updateAccount(account.id, name, cents) : await store.createAccount(name, cents);
    if (!result.ok) return setError(result.reason);
    onClose();
  }

  async function remove() {
    if (!account) return;
    await store.deleteAccount(account.id);
    onClose();
  }

  return (
    <Dialog title={account ? t('accounts.editTitle') : t('accounts.newTitle')} onClose={onClose}>
      <label className="field">
        <span>{t('accounts.name')}</span>
        <input
          autoFocus
          value={name}
          maxLength={40}
          onChange={(e) => {
            setName(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => e.key === 'Enter' && void save()}
        />
      </label>
      <label className="field">
        <span>{t('accounts.opening')}</span>
        <input
          inputMode="decimal"
          value={opening}
          placeholder="0.00"
          aria-label={t('accounts.opening')}
          onChange={(e) => {
            setOpening(e.target.value);
            setError(null);
          }}
        />
      </label>
      <p className="muted small">{t('accounts.openingHelp')}</p>
      {error === 'opening' ? <div className="error">{t('accounts.invalidOpening')}</div> : error && <div className="error">{t(`accounts.errors.${error}`)}</div>}

      {account && onlyOne && <p className="muted small">{t('accounts.lastOne')}</p>}
      {account && confirmDelete && (
        <p className="warn">
          {own.length === 0 ? t('accounts.deleteInfoNone') : t('accounts.deleteInfo', { count: own.length })}
          {hasTransfers && <> {t('accounts.deleteTransfers')}</>}
        </p>
      )}

      <div className="dialog-actions">
        {account &&
          !onlyOne &&
          (confirmDelete ? (
            <button className="btn danger" onClick={() => void remove()}>
              {t('common.delete')}
            </button>
          ) : (
            <button className="btn danger-outline" onClick={() => setConfirmDelete(true)}>
              {t('common.delete')}
            </button>
          ))}
        <span className="spacer" />
        <button className="btn" onClick={onClose}>
          {t('common.cancel')}
        </button>
        <button className="btn primary" onClick={() => void save()}>
          {t('common.save')}
        </button>
      </div>
    </Dialog>
  );
}
