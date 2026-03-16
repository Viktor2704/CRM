/**
 * Example Component: Demonstrates i18n usage patterns
 *
 * This file shows various ways to use internationalization in components.
 * Use these patterns when implementing i18n in other components.
 */

import { useTranslation } from 'react-i18next';
import { useI18nFormatters } from '@/hooks/useI18nFormatters';
import { useDirection } from '@/context/DirectionContext';

export default function I18nExampleComponent() {
  const { t, i18n } = useTranslation();
  const { formatDate, formatCurrency, formatNumber, formatRelativeTime } = useI18nFormatters();
  const { direction, isRTL } = useDirection();

  // Example data
  const exampleDate = new Date();
  const examplePrice = 1234.56;
  const exampleCount = 42;
  const examplePastDate = new Date(Date.now() - 3600000); // 1 hour ago

  return (
    <div className="space-y-6 p-6">
      {/* Basic Translation */}
      <section>
        <h2 className="text-lg font-semibold">{t('common.example')}</h2>
        <p>{t('common.description')}</p>
      </section>

      {/* Translation with Interpolation */}
      <section>
        <h3>{t('welcome.message', { name: 'John Doe' })}</h3>
      </section>

      {/* Pluralization */}
      <section>
        <p>{t('items.count', { count: 1 })}</p>
        <p>{t('items.count', { count: 5 })}</p>
        <p>{t('items.count', { count: 21 })}</p>
      </section>

      {/* Date Formatting */}
      <section>
        <h3>{t('common.date')}</h3>
        <p>{formatDate(exampleDate)}</p>
        <p>{formatRelativeTime(examplePastDate)}</p>
      </section>

      {/* Number and Currency Formatting */}
      <section>
        <h3>{t('common.numbers')}</h3>
        <p>{formatNumber(exampleCount)}</p>
        <p>{formatCurrency(examplePrice, 'RUB')}</p>
      </section>

      {/* RTL-aware Layout */}
      <section>
        <h3>{t('settings.language')}</h3>
        <p>Current language: {i18n.language}</p>
        <p>Direction: {direction}</p>
        <p>Is RTL: {isRTL ? 'Yes' : 'No'}</p>

        {/* Conditional styling based on direction */}
        <div className={`flex ${isRTL ? 'flex-row-reverse' : 'flex-row'} gap-2`}>
          <button className="px-4 py-2 bg-blue-500 text-white rounded">
            {t('common.save')}
          </button>
          <button className="px-4 py-2 bg-gray-500 text-white rounded">
            {t('common.cancel')}
          </button>
        </div>
      </section>

      {/* Nested Translation Keys */}
      <section>
        <h3>{t('nav.dashboard')}</h3>
        <ul>
          <li>{t('nav.users')}</li>
          <li>{t('nav.projects')}</li>
          <li>{t('nav.reports')}</li>
        </ul>
      </section>

      {/* Error and Success Messages */}
      <section>
        <div className="text-red-600">{t('errors.generic')}</div>
        <div className="text-green-600">{t('success.saved')}</div>
      </section>

      {/* Status and Priority Labels */}
      <section>
        <h3>{t('common.status')}</h3>
        <span className="badge">{t('status.inProgress')}</span>
        <span className="badge">{t('priority.high')}</span>
      </section>

      {/* Form Labels */}
      <section>
        <form>
          <label>
            {t('auth.email')}
            <input type="email" placeholder={t('auth.email')} />
          </label>
          <label>
            {t('auth.password')}
            <input type="password" placeholder={t('auth.password')} />
          </label>
          <button type="submit">{t('auth.loginButton')}</button>
        </form>
      </section>

      {/* Language Switcher Example */}
      <section>
        <h3>{t('settings.language')}</h3>
        <div className="flex gap-2">
          <button onClick={() => i18n.changeLanguage('ru')}>Русский</button>
          <button onClick={() => i18n.changeLanguage('en')}>English</button>
          <button onClick={() => i18n.changeLanguage('ar')}>العربية</button>
        </div>
      </section>
    </div>
  );
}

/**
 * USAGE PATTERNS:
 *
 * 1. Simple Translation:
 *    {t('common.save')}
 *
 * 2. With Variables:
 *    {t('welcome.message', { name: userName })}
 *
 * 3. With Count (Pluralization):
 *    {t('items.count', { count: itemCount })}
 *
 * 4. Date Formatting:
 *    {formatDate(date)}
 *    {formatDateTime(date)}
 *    {formatTime(date)}
 *
 * 5. Number Formatting:
 *    {formatNumber(value)}
 *    {formatCurrency(value, 'RUB')}
 *
 * 6. RTL-aware Styling:
 *    className={isRTL ? 'rtl-class' : 'ltr-class'}
 *
 * 7. Change Language:
 *    i18n.changeLanguage('en')
 *
 * 8. Get Current Language:
 *    i18n.language
 */
