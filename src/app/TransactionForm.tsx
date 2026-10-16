import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { parseAmount, type NameError } from '../domain/rules';
import { sortTransactions } from '../domain/search';
import type { Frequency, Transaction, TxType } from '../domain/types';
import { categoryName } from '../i18n';
import { centsToInput, formatMoney, todayISO } from './format';
import { NO_PHOTO_CHANGES, PhotoSection, type PhotoDraft } from './PhotoSection';
import { frequencyLabel, RuleDialog } from './RecurringScreen';
import { useStore } from './store';
import { Dialog } from './ui';

/** Values copied into a new Transaction by Duplicate or a Recent chip (the date is always today). */
export interface Prefill {
  type: TxType;
  cents: number;
  categoryIds: string[];
  note: string;
}

const FREQUENCIES: Frequency[] = ['weekly', 'monthly', 'yearly'];

interface Props {
  transaction?: Transaction;
  prefill?: Prefill;
  onClose: () => void;
  onDuplicate: (prefill: Prefill) => void;
}

export function TransactionForm({ transaction, prefill, onClose, onDuplicate }: Props) {
  const { t } = useTranslation();
  const store = useStore();
  const { language } = store;
  const editing = transaction !== undefined;
  const liveIds = useMemo(() => new Set(store.data.categories.map((c) => c.id)), [store.data.categories]);
  const source = transaction ?? prefill;

  const [type, setType] = useState<TxType>(source?.type ?? 'expense');
  const [amount, setAmount] = useState(source ? centsToInput(source.cents) : '');
  const [date, setDate] = useState(transaction?.date ?? todayISO());
  const [note, setNote] = useState(source?.note ?? '');
  const [selected, setSelected] = useState<string[]>((source?.categoryIds ?? []).filter((id) => liveIds.has(id)));
  const [retired, setRetired] = useState<string[]>(transaction?.retired ?? []);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [nameError, setNameError] = useState<NameError | null>(null);
  const [saving, setSaving] = useState(false);
  /** A new Category is being saved: ignore further taps so it is neither created twice nor reopened by mistake. */
  const [creating, setCreating] = useState(false);
  const [repeat, setRepeat] = useState<Frequency | 'never'>('never');
  const [repeatEnd, setRepeatEnd] = useState('');
  const [editingRule, setEditingRule] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [photos, setPhotos] = useState<PhotoDraft>(NO_PHOTO_CHANGES);

  const rule = transaction?.ruleId ? store.rules.find((r) => r.id === transaction.ruleId) : undefined;
  const cents = parseAmount(amount);
  const repeatEndOk = repeat === 'never' || repeatEnd === '' || repeatEnd >= date;
  const canSave = cents !== null && selected.length + retired.length > 0 && date !== '' && repeatEndOk && !saving;

  // Picker order: most recently used first.
  const choices = useMemo(
    () => store.data.categories.filter((c) => c.type === type).sort((a, b) => b.lastUsedAt - a.lastUsedAt),
    [store.data.categories, type],
  );

  // The last five different Transactions, for one-tap re-entry. Retired labels are never copied.
  const recents = useMemo(() => {
    if (editing) return [];
    const seen = new Set<string>();
    const out: Array<{ tx: Transaction; live: string[] }> = [];
    for (const tx of sortTransactions(store.data.transactions, 'newest')) {
      const live = tx.categoryIds.filter((id) => liveIds.has(id));
      if (live.length === 0) continue;
      const key = [tx.type, tx.cents, tx.note, live.join()].join('|');
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ tx, live });
      if (out.length === 5) break;
    }
    return out;
  }, [editing, store.data.transactions, liveIds]);

  function switchType(next: TxType) {
    if (next === type) return;
    setType(next);
    setSelected([]);
    setRetired([]);
    setAdding(false);
    setNameError(null);
  }

  function useRecent(tx: Transaction, live: string[]) {
    setType(tx.type);
    setAmount(centsToInput(tx.cents));
    setSelected(live);
    setRetired([]);
    setNote(tx.note);
    setAdding(false);
    setNameError(null);
  }

  const toggle = (id: string) =>
    setSelected((current) => (current.includes(id) ? current.filter((x) => x !== id) : [...current, id]));

  async function addCategory() {
    if (creating) return;
    setCreating(true);
    try {
      const result = await store.createCategory(type, newName);
      if (result.ok) {
        setSelected((current) => [...current, result.category.id]);
        setAdding(false);
        setNewName('');
        setNameError(null);
      } else setNameError(result.reason);
    } finally {
      setCreating(false);
    }
  }

  async function save() {
    if (!canSave || cents === null) return;
    setSaving(true);
    const input = { date, type, cents, categoryIds: selected, retired, note: note.trim() };
    const schedule = !rule && repeat !== 'never' ? { frequency: repeat, endDate: repeatEnd === '' ? null : repeatEnd } : undefined;
    const changes = { added: photos.added.map((a) => a.input), removedIds: photos.removedIds };
    const ok = editing
      ? await store.updateTransaction(transaction.id, input, schedule, changes)
      : await store.addTransaction(input, schedule, changes);
    setSaving(false);
    if (ok) onClose();
  }

  async function remove() {
    if (!editing) return;
    await store.deleteTransaction(transaction.id);
    onClose();
  }

  async function stopRepeating() {
    if (!rule) return;
    await store.stopRule(rule.id);
    onClose();
  }

  return (
    <div className="overlay" role="dialog" aria-label={editing ? t('form.titleEdit') : t('form.titleAdd')}>
      <div className="form-head">
        <button className="icon-btn" onClick={onClose} aria-label={t('common.close')}>
          ✕
        </button>
        <div className="seg" role="group">
          <button className={type === 'expense' ? 'on' : ''} onClick={() => switchType('expense')}>
            {t('form.expense')}
          </button>
          <button className={type === 'income' ? 'on' : ''} onClick={() => switchType('income')}>
            {t('form.income')}
          </button>
        </div>
        {editing ? (
          <button className="link danger" onClick={() => void remove()}>
            {t('common.delete')}
          </button>
        ) : (
          <span className="spacer" />
        )}
      </div>

      <div className="form-body">
        {recents.length > 0 && (
          <div className="recent">
            <div className="label">
              {t('form.recent')} <span className="hint">({t('form.recentHelp')})</span>
            </div>
            <div className="recent-chips">
              {recents.map(({ tx, live }) => {
                const first = store.data.categories.find((c) => c.id === live[0]);
                return (
                  <button key={tx.id} className="chip recent-chip" onClick={() => useRecent(tx, live)}>
                    {tx.note || (first ? categoryName(first) : '')} · {formatMoney(tx.cents, language)}
                  </button>
                );
              })}
            </div>
          </div>
        )}

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

        <div className="label">
          {t('form.categories')} <span className="hint">({t('form.pickHint')})</span>
        </div>
        <div className="chips">
          {retired.map((name) => (
            <button
              key={`r:${name}`}
              className="chip sel retired"
              title={t('form.retiredHint')}
              onClick={() => setRetired((current) => current.filter((x) => x !== name))}
            >
              {name} ✕
            </button>
          ))}
          {choices.map((c) => (
            <button
              key={c.id}
              className={`chip ${selected.includes(c.id) ? 'sel' : ''}`}
              aria-pressed={selected.includes(c.id)}
              onClick={() => toggle(c.id)}
            >
              {categoryName(c)}
            </button>
          ))}
          <button className="chip add" disabled={creating} onClick={() => setAdding((v) => !v)}>
            {t('form.newCategory')}
          </button>
        </div>
        {adding && (
          <div className="inline-add">
            <input
              autoFocus
              value={newName}
              maxLength={40}
              placeholder={t('form.newCategoryPlaceholder')}
              aria-label={t('form.newCategoryPlaceholder')}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void addCategory()}
            />
            <button className="chip sel" disabled={creating} onClick={() => void addCategory()}>
              {t('common.add')}
            </button>
          </div>
        )}
        {nameError && <div className="error">{t(`categories.errors.${nameError}`)}</div>}

        <div className="row-fields">
          <label className="field">
            <span>{t('form.date')}</span>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <label className="field">
            <span>{t('form.note')}</span>
            <input value={note} placeholder={t('form.notePlaceholder')} onChange={(e) => setNote(e.target.value)} />
          </label>

          {rule ? (
            <div className="rule-info">
              <b>{t('recurring.repeats', { frequency: frequencyLabel(rule.frequency, t).toLowerCase() })}</b>
              <div className="rule-actions">
                <button className="btn" onClick={() => setEditingRule(true)}>
                  {t('recurring.editRule')}
                </button>
                <button className="btn danger-outline" onClick={() => setStopping(true)}>
                  {t('recurring.stopRepeating')}
                </button>
              </div>
            </div>
          ) : (
            <>
              <label className="field">
                <span>{t('recurring.repeat')}</span>
                <select value={repeat} onChange={(e) => setRepeat(e.target.value as Frequency | 'never')} aria-label={t('recurring.repeat')}>
                  <option value="never">{t('recurring.never')}</option>
                  {FREQUENCIES.map((f) => (
                    <option key={f} value={f}>
                      {frequencyLabel(f, t)}
                    </option>
                  ))}
                </select>
              </label>
              {repeat !== 'never' && (
                <label className="field">
                  <span>{t('recurring.endDate')}</span>
                  <input type="date" value={repeatEnd} min={date} onChange={(e) => setRepeatEnd(e.target.value)} aria-label={t('recurring.endDate')} />
                </label>
              )}
            </>
          )}
        </div>

        <PhotoSection transactionId={transaction?.id} draft={photos} onChange={setPhotos} />
      </div>

      <div className="form-foot">
        {editing && (
          <button
            className="btn"
            onClick={() => onDuplicate({ type: transaction.type, cents: transaction.cents, categoryIds: transaction.categoryIds, note: transaction.note })}
          >
            {t('form.duplicate')}
          </button>
        )}
        <button className="btn primary wide" disabled={!canSave} onClick={() => void save()}>
          {editing ? t('form.saveChanges') : t('common.save')}
        </button>
      </div>

      {editingRule && rule && <RuleDialog rule={rule} onClose={() => setEditingRule(false)} />}
      {stopping && (
        <Dialog title={t('recurring.stopTitle')} onClose={() => setStopping(false)}>
          <p>{t('recurring.stopBody')}</p>
          <div className="dialog-actions">
            <button className="btn" onClick={() => setStopping(false)}>
              {t('common.cancel')}
            </button>
            <button className="btn danger" onClick={() => void stopRepeating()}>
              {t('recurring.stopRepeating')}
            </button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
