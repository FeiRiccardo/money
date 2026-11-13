import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { parseAmount } from '../domain/rules';
import type { Transaction } from '../domain/types';
import { accountName } from '../i18n';
import { centsToInput, todayISO } from './format';
import { useStore } from './store';

interface Props {
  /** One half of the Transfer to edit; omit for a new one. */
  transaction?: Transaction;
  onClose: () => void;
  /** Back to the Expense / Income form (a new Transfer only). */
  onSwitch: () => void;
}

/** Moves money from one account to another. Stored as two linked Transactions, left out of the summary and charts. */
export function TransferForm({ transaction, onClose, onSwitch }: Props) {
  const { t } = useTranslation();
  const store = useStore();
  const { accounts } = store;
  const transferId = transaction?.transferId;
  const halves = transferId === undefined ? [] : store.data.transactions.filter((x) => x.transferId === transferId);
  const source = halves.find((x) => x.type === 'expense');
  const target = halves.find((x) => x.type === 'income');
  const editing = transferId !== undefined;

  const [from, setFrom] = useState(source?.accountId ?? store.accountFilter ?? accounts[0]?.id ?? '');
  const [to, setTo] = useState(target?.accountId ?? accounts.find((a) => a.id !== (source?.accountId ?? store.accountFilter ?? accounts[0]?.id))?.id ?? '');
  const [amount, setAmount] = useState(transaction ? centsToInput(transaction.cents) : '');
  const [date, setDate] = useState(transaction?.date ?? todayISO());
  const [note, setNote] = useState(transaction?.note ?? '');
  const [saving, setSaving] = useState(false);

  const cents = parseAmount(amount);
  const sameAccount = from === to;
  const canSave = cents !== null && date !== '' && !sameAccount && from !== '' && to !== '' && !saving;

  async function save() {
    if (!canSave || cents === null) return;
    setSaving(true);
    const input = { date, cents, fromAccountId: from, toAccountId: to, note: note.trim() };
    const ok = editing ? await store.updateTransfer(transferId, input) : await store.addTransfer(input);
    setSaving(false);
    if (ok) onClose();
  }

  async function remove() {
    if (!editing) return;
    await store.deleteTransfer(transferId);
    onClose();
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.querySelector('.dialog')) onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const options = accounts.map((a) => (
    <option key={a.id} value={a.id}>
      {accountName(a)}
    </option>
  ));

  return (
    <div className="overlay" role="dialog" aria-label={editing ? t('transfer.titleEdit') : t('transfer.titleNew')}>
      <div className="form-head">
        <button className="icon-btn" onClick={onClose} aria-label={t('common.close')}>
          ✕
        </button>
        {editing ? (
          <b>{t('transfer.titleEdit')}</b>
        ) : (
          <div className="seg" role="group">
            <button onClick={onSwitch}>{t('form.expense')}</button>
            <button onClick={onSwitch}>{t('form.income')}</button>
            <button className="on">{t('form.transfer')}</button>
          </div>
        )}
        {editing ? (
          <button className="link danger" onClick={() => void remove()}>
            {t('common.delete')}
          </button>
        ) : (
          <span className="spacer" />
        )}
      </div>

      <div className="form-body">
        <p className="muted small">{t('transfer.help')}</p>
        <label className="amount-box">
          <span className="muted">€</span>
          <input
            autoFocus
            inputMode="decimal"
            autoComplete="off"
            placeholder="0.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            aria-label={t('form.amount')}
          />
        </label>

        <div className="row-fields">
          <label className="field">
            <span>{t('transfer.from')}</span>
            <select value={from} onChange={(e) => setFrom(e.target.value)} aria-label={t('transfer.from')}>
              {options}
            </select>
          </label>
          <label className="field">
            <span>{t('transfer.to')}</span>
            <select value={to} onChange={(e) => setTo(e.target.value)} aria-label={t('transfer.to')}>
              {options}
            </select>
          </label>
          {sameAccount && <div className="error">{t('transfer.sameAccount')}</div>}
          <label className="field">
            <span>{t('form.date')}</span>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <label className="field">
            <span>{t('form.note')}</span>
            <input value={note} placeholder={t('form.notePlaceholder')} onChange={(e) => setNote(e.target.value)} />
          </label>
        </div>
      </div>

      <div className="form-foot">
        <button className="btn primary wide" disabled={!canSave} onClick={() => void save()}>
          {editing ? t('form.saveChanges') : t('common.save')}
        </button>
      </div>
    </div>
  );
}
