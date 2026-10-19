import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { NameError } from '../domain/rules';
import type { Category, TxType } from '../domain/types';
import { categoryName } from '../i18n';
import { useStore } from './store';
import { Dialog } from './ui';

export function CategoriesScreen({ onBack }: { onBack: () => void }) {
  const { t } = useTranslation();
  const { data } = useStore();
  const [type, setType] = useState<TxType>('expense');
  const [editing, setEditing] = useState<Category | 'new' | null>(null);

  const list = data.categories
    .filter((c) => c.type === type)
    .sort((a, b) => categoryName(a).localeCompare(categoryName(b)));

  return (
    <div className="screen">
      <header className="bar-head">
        <button className="icon-btn back" onClick={onBack} aria-label={t('common.back')}>
          ←
        </button>
        <h1>{t('categories.title')}</h1>
        <span className="spacer" />
      </header>

      <div className="seg center" role="group">
        <button className={type === 'expense' ? 'on' : ''} onClick={() => setType('expense')}>
          {t('categories.expense')}
        </button>
        <button className={type === 'income' ? 'on' : ''} onClick={() => setType('income')}>
          {t('categories.income')}
        </button>
      </div>

      <div className="scroll">
        {list.length === 0 && <p className="empty">{t('categories.empty')}</p>}
        <ul className="plain-list">
          {list.map((c) => (
            <li key={c.id}>
              <button className="list-row" onClick={() => setEditing(c)}>
                {categoryName(c)}
                <span className="muted">›</span>
              </button>
            </li>
          ))}
        </ul>
        <div className="pad">
          <button className="btn wide" onClick={() => setEditing('new')}>
            {t('categories.newButton')}
          </button>
        </div>
      </div>

      {editing && <CategoryDialog type={type} category={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function CategoryDialog({ type, category, onClose }: { type: TxType; category: Category | null; onClose: () => void }) {
  const { t } = useTranslation();
  const store = useStore();
  const [name, setName] = useState(category ? categoryName(category) : '');
  const [error, setError] = useState<NameError | null>(null);
  const affected = category
    ? store.data.transactions.filter((tx) => tx.categoryIds.includes(category.id)).length
    : 0;
  const [confirmDelete, setConfirmDelete] = useState(false);

  async function save() {
    const unchanged = category !== null && name.trim() === categoryName(category);
    if (unchanged) return onClose();
    const result = category ? await store.renameCategory(category.id, name) : await store.createCategory(type, name);
    if (result.ok) onClose();
    else setError(result.reason);
  }

  async function remove() {
    if (!category) return;
    await store.deleteCategory(category.id);
    onClose();
  }

  return (
    <Dialog title={category ? t('categories.renameTitle') : t('categories.newTitle')} onClose={onClose}>
      <label className="field">
        <span>{t('categories.name')}</span>
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
      {error && <div className="error">{t(`categories.errors.${error}`)}</div>}

      {category && confirmDelete && (
        <p className="warn">{affected === 0 ? t('categories.deleteInfoNone') : t('categories.deleteInfo', { count: affected })}</p>
      )}

      <div className="dialog-actions">
        {category &&
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
