import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { parseAmount } from '../domain/rules';
import type { Frequency, RecurringRule } from '../domain/types';
import { categoryName } from '../i18n';
import { centsToInput, dayLabel, formatMoney } from './format';
import { useStore } from './store';
import { Dialog } from './ui';

const FREQUENCIES: Frequency[] = ['weekly', 'monthly', 'yearly'];

export const frequencyLabel = (frequency: Frequency, t: (key: string) => string) => t(`recurring.${frequency}`);
const isEnded = (rule: RecurringRule) => rule.endDate !== null && rule.nextDate > rule.endDate;

export function RecurringScreen({ onBack }: { onBack: () => void }) {
  const { t } = useTranslation();
  const { rules, data, language } = useStore();
  const [editing, setEditing] = useState<RecurringRule | null>(null);
  const byId = useMemo(() => new Map(data.categories.map((c) => [c.id, c])), [data.categories]);

  const title = (rule: RecurringRule) => {
    if (rule.note) return rule.note;
    const first = rule.categoryIds.map((id) => byId.get(id)).find(Boolean);
    return first ? categoryName(first) : (rule.retired[0] ?? '');
  };

  return (
    <div className="screen">
      <header className="bar-head">
        <button className="icon-btn back" onClick={onBack} aria-label={t('common.back')}>
          ←
        </button>
        <h1>{t('recurring.title')}</h1>
        <span className="spacer" />
      </header>

      <div className="scroll">
        {rules.length === 0 && <p className="empty">{t('recurring.empty')}</p>}
        <ul className="plain-list">
          {[...rules].sort((a, b) => a.nextDate.localeCompare(b.nextDate)).map((rule) => (
            <li key={rule.id}>
              <button className="tx-row" onClick={() => setEditing(rule)}>
                <div>
                  <div className="tx-title">↻ {title(rule)}</div>
                  <div className="muted small">
                    {frequencyLabel(rule.frequency, t)} ·{' '}
                    {isEnded(rule) ? t('recurring.ended') : t('recurring.next', { date: `${dayLabel(rule.nextDate, language)} ${rule.nextDate.slice(0, 4)}` })}
                  </div>
                </div>
                <div className={`amount ${rule.type}`}>
                  {rule.type === 'income' ? '+' : '−'}
                  {formatMoney(rule.cents, language)}
                </div>
              </button>
            </li>
          ))}
        </ul>
      </div>

      {editing && <RuleDialog rule={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

/** Edit one rule. Changes apply to future Transactions only; stopping keeps the ones already created. */
export function RuleDialog({ rule, onClose }: { rule: RecurringRule; onClose: () => void }) {
  const { t } = useTranslation();
  const store = useStore();
  const [amount, setAmount] = useState(centsToInput(rule.cents));
  const [note, setNote] = useState(rule.note);
  const [selected, setSelected] = useState<string[]>(rule.categoryIds);
  const [retired, setRetired] = useState<string[]>(rule.retired);
  const [frequency, setFrequency] = useState<Frequency>(rule.frequency);
  const [endDate, setEndDate] = useState(rule.endDate ?? '');
  const [confirmStop, setConfirmStop] = useState(false);

  const cents = parseAmount(amount);
  const choices = store.data.categories.filter((c) => c.type === rule.type).sort((a, b) => b.lastUsedAt - a.lastUsedAt);
  const valid = cents !== null && selected.length + retired.length > 0 && (endDate === '' || endDate >= rule.startDate);

  async function save() {
    if (!valid || cents === null) return;
    const ok = await store.updateRule(rule.id, {
      type: rule.type, cents, categoryIds: selected, retired, note: note.trim(), frequency,
      startDate: rule.startDate, endDate: endDate === '' ? null : endDate, nextDate: rule.nextDate,
    });
    if (ok) onClose();
  }

  async function stop() {
    await store.stopRule(rule.id);
    onClose();
  }

  if (confirmStop) {
    return (
      <Dialog title={t('recurring.stopTitle')} onClose={() => setConfirmStop(false)}>
        <p>{t('recurring.stopBody')}</p>
        <div className="dialog-actions">
          <button className="btn" onClick={() => setConfirmStop(false)}>
            {t('common.cancel')}
          </button>
          <button className="btn danger" onClick={() => void stop()}>
            {t('recurring.stopRepeating')}
          </button>
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog title={t('recurring.ruleTitle')} onClose={onClose}>
      <p className="muted small">{t('recurring.ruleHelp')}</p>
      <label className="field">
        <span>{t('form.amount')} (€)</span>
        <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} aria-label={t('form.amount')} />
      </label>
      <label className="field">
        <span>{t('form.note')}</span>
        <input value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      <div className="label">{t('form.categories')}</div>
      <div className="chips">
        {retired.map((name) => (
          <button key={`r:${name}`} className="chip sel retired" title={t('form.retiredHint')} onClick={() => setRetired(retired.filter((x) => x !== name))}>
            {name} ✕
          </button>
        ))}
        {choices.map((c) => (
          <button
            key={c.id}
            className={`chip ${selected.includes(c.id) ? 'sel' : ''}`}
            aria-pressed={selected.includes(c.id)}
            onClick={() => setSelected(selected.includes(c.id) ? selected.filter((x) => x !== c.id) : [...selected, c.id])}
          >
            {categoryName(c)}
          </button>
        ))}
      </div>
      <label className="field">
        <span>{t('recurring.repeat')}</span>
        <select value={frequency} onChange={(e) => setFrequency(e.target.value as Frequency)} aria-label={t('recurring.repeat')}>
          {FREQUENCIES.map((f) => (
            <option key={f} value={f}>
              {frequencyLabel(f, t)}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>{t('recurring.endDate')}</span>
        <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
      </label>
      <div className="dialog-actions">
        <button className="btn danger-outline" onClick={() => setConfirmStop(true)}>
          {t('recurring.stopRepeating')}
        </button>
        <span className="spacer" />
        <button className="btn" onClick={onClose}>
          {t('common.cancel')}
        </button>
        <button className="btn primary" disabled={!valid} onClick={() => void save()}>
          {t('common.save')}
        </button>
      </div>
    </Dialog>
  );
}
