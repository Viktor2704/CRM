import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import ru from './locales/ru.json';

const resources = {
  ru: { translation: ru },
};

i18n
  .use(initReactI18next)
  .init({
    resources,
    lng: 'ru',
    fallbackLng: 'ru',
    supportedLngs: ['ru'],
    debug: false,
    interpolation: {
      escapeValue: false,
    },
    detection: {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
      lookupLocalStorage: 'i18nextLng',
    },
    react: {
      useSuspense: true,
    },
  });

export default i18n;

// Helper functions for formatting
export const formatDate = (date: Date | string, locale?: string): string => {
  const dateObj = typeof date === 'string' ? new Date(date) : date;
  const lang = locale || i18n.language;

  return new Intl.DateTimeFormat(lang, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(dateObj);
};

export const formatDateTime = (date: Date | string, locale?: string): string => {
  const dateObj = typeof date === 'string' ? new Date(date) : date;
  const lang = locale || i18n.language;

  return new Intl.DateTimeFormat(lang, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(dateObj);
};

export const formatTime = (date: Date | string, locale?: string): string => {
  const dateObj = typeof date === 'string' ? new Date(date) : date;
  const lang = locale || i18n.language;

  return new Intl.DateTimeFormat(lang, {
    hour: '2-digit',
    minute: '2-digit',
  }).format(dateObj);
};

export const formatNumber = (value: number, locale?: string): string => {
  const lang = locale || i18n.language;
  return new Intl.NumberFormat(lang).format(value);
};

export const formatCurrency = (
  value: number,
  currency: string = 'RUB',
  locale?: string
): string => {
  const lang = locale || i18n.language;
  return new Intl.NumberFormat(lang, {
    style: 'currency',
    currency,
  }).format(value);
};

export const formatRelativeTime = (date: Date | string, locale?: string): string => {
  const dateObj = typeof date === 'string' ? new Date(date) : date;
  const now = new Date();
  const diffInSeconds = Math.floor((now.getTime() - dateObj.getTime()) / 1000);
  const lang = locale || i18n.language;

  if (diffInSeconds < 60) {
    return i18n.t('time.justNow');
  }

  const diffInMinutes = Math.floor(diffInSeconds / 60);
  if (diffInMinutes < 60) {
    return `${diffInMinutes} ${i18n.t('time.minutes')} ${i18n.t('time.ago')}`;
  }

  const diffInHours = Math.floor(diffInMinutes / 60);
  if (diffInHours < 24) {
    return `${diffInHours} ${i18n.t('time.hours')} ${i18n.t('time.ago')}`;
  }

  const diffInDays = Math.floor(diffInHours / 24);
  if (diffInDays < 7) {
    return `${diffInDays} ${i18n.t('time.days')} ${i18n.t('time.ago')}`;
  }

  return formatDate(dateObj, lang);
};

// RTL support
export const isRTL = (locale?: string): boolean => {
  const lang = locale || i18n.language;
  const rtlLanguages = ['ar', 'he', 'fa', 'ur'];
  return rtlLanguages.includes(lang);
};

export const getDirection = (locale?: string): 'ltr' | 'rtl' => {
  return isRTL(locale) ? 'rtl' : 'ltr';
};
