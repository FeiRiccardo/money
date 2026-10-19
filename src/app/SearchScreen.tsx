import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { EMPTY_QUERY, searchTransactions, type SearchQuery } from '../domain/search';
import type { Transaction, TxType } from '../domain/types';
import { categoryName } from '../i18n';
import { formatMoney, monthOf, shiftMonth, todayISO } from './format';
import { useStore } from './store';
import { SortSelect, TransactionRow } from './TransactionRow';
import { Dialog } from './ui';

type DatePreset = 'allTime' | 'thisMonth' | 'lastMonth' | 'thisYear' | 'custom';

function presetRange(preset: DatePreset): { from: string | null; to: string | null } {
  const month = monthOf(todayISO());
  if (preset === 'thisMonth') return { from: `${month}-01`, to: `${month}-31` };
  if (preset === 'lastMonth') {
    const last = shiftMonth(month, -1);
    return { from: `${last}-01`, to: `${last}-31` };
  }
  if (preset === 'thisYear') return { from: `${month.slice(0, 4)}-01-01`, to: `${month.slice(0, 4)}-12-31` };
  return { from: null, to: null };
}

export function SearchScreen({ onBack, onEdit }: { onBack: () => void; onEdit: (t: Transaction) => void }) {
  const { t } = useTranslation();
  const { data, settings, language, setSortOrder } = useStore();
  const [text, setText] = useState('');
  const [type, setType] = useState<SearchQuery['type']>('all');
  const [categories, setCategories] = useState<string[]>([]);
  const [preset, setPreset] = useState<DatePreset>('allTime');
  const [custom, setCustom] = useState<{ from: string; to: string }>({ from: '', to: '' });
  const [choosing, setChoosing] = useState(false);

  const range = preset === 'custom' ? { from: custom.from || null, to: custom.to || null } : presetRange(preset);
  const query: SearchQuery = { ...EMPTY_QUERY, text, type, categories, ...range, sort: settings.sortOrder };
  const result = useMemo(
    () => searchTransactions(data, query, categoryName),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, text, type, categories, range.from, range.to, settings.sortOrder],
  );

  const filtering = text.trim() !== '' || type !== 'all' || categories.length > 0 || preset !== 'allTime';
  const clear = () => {
    setText('');
    setType('all');
    setCategories([]);
    setPreset('allTime');
    setCustom({ from: '', to: '' });
  };

  return (
    <div className="screen">
      <header className="bar-head">
        <button className="icon-btn back" onClick={onBack} aria-label={t('common.back')}>
          ←
        </button>
        <input
          className="search-input"
          type="search"
          autoFocus
          value={text}
          placeholder={t('search.placeholder')}
          aria-label={t('search.title')}
          onChange={(e) => setText(e.target.value)}
        />
      </header>

      <div className="filters">
        <div className="seg" role="group" aria-label={t('search.type')}>
          {(['all', 'expense', 'income'] as const).map((value) => (
            <button key={value} className={type === value ? 'on' : ''} onClick={() => setType(value)}>
              {t(value === 'all' ? 'search.all' : value === 'expense' ? 'search.expenses' : 'search.income')}
            </button>
          ))}
        </div>

        <div className="filter-row">
          <button className={`chip ${categories.length > 0 ? 'sel' : ''}`} onClick={() => setChoosing(true)}>
            {categories.length === 0 ? t('search.anyCategory') : t('search.selectedCategories', { count: categories.length })}
          </button>
          <label className="sort-select">
            <span className="muted small">{t('search.date')}</span>
            <select value={preset} onChange={(e) => setPreset(e.target.value as DatePreset)} aria-label={t('search.date')}>
              {(['allTime', 'thisMonth', 'lastMonth', 'thisYear', 'custom'] as DatePreset[]).map((p) => (
                <option key={p} value={p}>
                  {t(`search.${p}`)}
                </option>
              ))}
            </select>
          </label>
          <SortSelect value={settings.sortOrder} onChange={(order) => void setSortOrder(order)} />
        </div>

        {preset === 'custom' && (
          <div className="custom-range">
            <label className="field">
              <span>{t('search.from')}</span>
              <input type="date" value={custom.from} onChange={(e) => setCustom({ ...custom, from: e.target.value })} />
            </label>
            <label className="field">
              <span>{t('search.to')}</span>
              <input type="date" value={custom.to} onChange={(e) => setCustom({ ...custom, to: e.target.value })} />
            </label>
          </div>
        )}
      </div>

      <div className="results-head">
        <span data-testid="result-count">{t('search.count', { count: result.transactions.length })}</span>
        <span className="muted" data-testid="result-net">
          {t('search.net', { amount: formatMoney(result.netCents, language) })}
        </span>
        {filtering && (
          <button className="link" onClick={clear}>
            {t('search.clear')}
          </button>
        )}
      </div>

      <div className="scroll">
        {result.transactions.length === 0 ? (
          <p className="empty">{t('search.empty')}</p>
        ) : (
          <div className="list">
            {result.transactions.map((tx) => (
              <TransactionRow key={tx.id} tx={tx} onOpen={onEdit} showDate />
            ))}
          </div>
        )}
      </div>

      {choosing && <CategoryChooser selected={categories} onChange={setCategories} onClose={() => setChoosing(false)} />}
    </div>
  );
}

function CategoryChooser({ selected, onChange, onClose }: { selected: string[]; onChange: (keys: string[]) => void; onClose: () => void }) {
  const { t } = useTranslation();
  const { data } = useStore();
  const toggle = (key: string) => onChange(selected.includes(key) ? selected.filter((k) => k !== key) : [...selected, key]);

  const section = (type: TxType, title: string) => {
    const live = data.categories.filter((c) => c.type === type).sort((a, b) => categoryName(a).localeCompare(categoryName(b)));
    const retired = [...new Set(data.transactions.filter((tx) => tx.type === type).flatMap((tx) => tx.retired))].sort();
    if (live.length + retired.length === 0) return null;
    return (
      <div key={type}>
        <div className="label">{title}</div>
        <div className="chips">
          {live.map((c) => (
            <button key={c.id} className={`chip ${selected.includes(`c:${c.id}`) ? 'sel' : ''}`} aria-pressed={selected.includes(`c:${c.id}`)} onClick={() => toggle(`c:${c.id}`)}>
              {categoryName(c)}
            </button>
          ))}
          {retired.map((name) => (
            <button key={`r:${type}:${name}`} className={`chip retired ${selected.includes(`r:${name}`) ? 'sel' : ''}`} aria-pressed={selected.includes(`r:${name}`)} onClick={() => toggle(`r:${name}`)}>
              {name}
            </button>
          ))}
        </div>
      </div>
    );
  };

  return (
    <Dialog title={t('search.chooseCategories')} onClose={onClose}>
      {section('expense', t('search.expenseCategories'))}
      {section('income', t('search.incomeCategories'))}
      <div className="dialog-actions">
        {selected.length > 0 && (
          <button className="btn" onClick={() => onChange([])}>
            {t('search.clear')}
          </button>
        )}
        <button className="btn primary" onClick={onClose}>
          {t('search.done')}
        </button>
      </div>
    </Dialog>
  );
}
