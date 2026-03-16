import { useTranslation } from 'react-i18next';
import { formatDate, formatDateTime, formatTime, formatNumber, formatCurrency, formatRelativeTime } from '@/i18n';

export function useI18nFormatters() {
  const { i18n } = useTranslation();
  const locale = i18n.language;

  return {
    formatDate: (date: Date | string) => formatDate(date, locale),
    formatDateTime: (date: Date | string) => formatDateTime(date, locale),
    formatTime: (date: Date | string) => formatTime(date, locale),
    formatNumber: (value: number) => formatNumber(value, locale),
    formatCurrency: (value: number, currency?: string) => formatCurrency(value, currency, locale),
    formatRelativeTime: (date: Date | string) => formatRelativeTime(date, locale),
    locale,
  };
}
