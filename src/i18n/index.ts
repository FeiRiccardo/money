import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './en.json';
import it from './it.json';
import type { Account, Category, Language } from '../domain/types';

void i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, it: { translation: it } },
  lng: 'en',
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
  returnNull: false,
});

/** Display name: a still-default Category is translated, any other Category shows its own name. */
export function categoryName(category: Category): string {
  return category.defaultKey
    ? i18n.t(`defaults.${category.defaultKey}`, { defaultValue: category.name })
    : category.name;
}

/** Display name of an Account: the starter one is translated until it is renamed. */
export function accountName(account: Account): string {
  return account.defaultKey
    ? i18n.t(`defaults.${account.defaultKey}`, { defaultValue: account.name })
    : account.name;
}

export function setLanguage(language: Language): void {
  void i18n.changeLanguage(language);
}

export default i18n;
