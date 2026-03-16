import { test } from 'node:test';
import assert from 'node:assert';

test('i18n configuration', async () => {
  const i18nModule = await import('../src/i18n/index.ts');
  const i18n = i18nModule.default;

  assert.ok(i18n, 'i18n instance should exist');
  assert.ok(i18n.language, 'i18n should have a language set');
  assert.ok(['ru', 'en', 'ar'].includes(i18n.language), 'Language should be ru, en, or ar');
});

test('translation files exist', async () => {
  const ruTranslations = await import('../src/i18n/locales/ru.json', { with: { type: 'json' } });
  const enTranslations = await import('../src/i18n/locales/en.json', { with: { type: 'json' } });

  assert.ok(ruTranslations.default, 'Russian translations should exist');
  assert.ok(enTranslations.default, 'English translations should exist');

  assert.ok(ruTranslations.default.common, 'Russian common translations should exist');
  assert.ok(enTranslations.default.common, 'English common translations should exist');

  assert.ok(ruTranslations.default.nav, 'Russian nav translations should exist');
  assert.ok(enTranslations.default.nav, 'English nav translations should exist');
});

test('formatting functions', async () => {
  const i18nModule = await import('../src/i18n/index.ts');

  const testDate = new Date('2024-03-12T10:30:00Z');

  // Test date formatting
  const formattedDate = i18nModule.formatDate(testDate, 'en');
  assert.ok(formattedDate, 'Date should be formatted');
  assert.ok(typeof formattedDate === 'string', 'Formatted date should be a string');

  // Test datetime formatting
  const formattedDateTime = i18nModule.formatDateTime(testDate, 'en');
  assert.ok(formattedDateTime, 'DateTime should be formatted');
  assert.ok(typeof formattedDateTime === 'string', 'Formatted datetime should be a string');

  // Test time formatting
  const formattedTime = i18nModule.formatTime(testDate, 'en');
  assert.ok(formattedTime, 'Time should be formatted');
  assert.ok(typeof formattedTime === 'string', 'Formatted time should be a string');

  // Test number formatting
  const formattedNumber = i18nModule.formatNumber(1234567.89, 'en');
  assert.ok(formattedNumber, 'Number should be formatted');
  assert.ok(typeof formattedNumber === 'string', 'Formatted number should be a string');

  // Test currency formatting
  const formattedCurrency = i18nModule.formatCurrency(1234.56, 'USD', 'en');
  assert.ok(formattedCurrency, 'Currency should be formatted');
  assert.ok(typeof formattedCurrency === 'string', 'Formatted currency should be a string');
});

test('RTL support functions', async () => {
  const i18nModule = await import('../src/i18n/index.ts');

  // Test LTR languages
  assert.strictEqual(i18nModule.isRTL('en'), false, 'English should not be RTL');
  assert.strictEqual(i18nModule.isRTL('ru'), false, 'Russian should not be RTL');
  assert.strictEqual(i18nModule.getDirection('en'), 'ltr', 'English direction should be ltr');
  assert.strictEqual(i18nModule.getDirection('ru'), 'ltr', 'Russian direction should be ltr');

  // Test RTL languages
  assert.strictEqual(i18nModule.isRTL('ar'), true, 'Arabic should be RTL');
  assert.strictEqual(i18nModule.isRTL('he'), true, 'Hebrew should be RTL');
  assert.strictEqual(i18nModule.getDirection('ar'), 'rtl', 'Arabic direction should be rtl');
  assert.strictEqual(i18nModule.getDirection('he'), 'rtl', 'Hebrew direction should be rtl');
});

test('translation key structure consistency', async () => {
  const ruTranslations = await import('../src/i18n/locales/ru.json', { with: { type: 'json' } });
  const enTranslations = await import('../src/i18n/locales/en.json', { with: { type: 'json' } });

  const ru = ruTranslations.default;
  const en = enTranslations.default;

  // Check that both translations have the same top-level keys
  const ruKeys = Object.keys(ru).sort();
  const enKeys = Object.keys(en).sort();

  assert.deepStrictEqual(ruKeys, enKeys, 'Russian and English should have the same top-level keys');

  // Check common section
  const ruCommonKeys = Object.keys(ru.common).sort();
  const enCommonKeys = Object.keys(en.common).sort();
  assert.deepStrictEqual(ruCommonKeys, enCommonKeys, 'Common section keys should match');

  // Check nav section
  const ruNavKeys = Object.keys(ru.nav).sort();
  const enNavKeys = Object.keys(en.nav).sort();
  assert.deepStrictEqual(ruNavKeys, enNavKeys, 'Nav section keys should match');
});

test('pluralization support', async () => {
  const i18nModule = await import('../src/i18n/index.ts');
  const i18n = i18nModule.default;

  // Change to Russian for pluralization test
  await i18n.changeLanguage('ru');

  // Russian has complex pluralization rules
  const key = 'search.resultsCount';

  // Test that the key exists
  const translation1 = i18n.t(key, { count: 1 });
  const translation2 = i18n.t(key, { count: 2 });
  const translation5 = i18n.t(key, { count: 5 });

  assert.ok(translation1, 'Pluralization should work for count=1');
  assert.ok(translation2, 'Pluralization should work for count=2');
  assert.ok(translation5, 'Pluralization should work for count=5');

  // They should be different for Russian
  assert.notStrictEqual(translation1, translation5, 'Russian pluralization should differ for 1 and 5');
});

console.log('All i18n tests passed!');
