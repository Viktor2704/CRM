# Internationalization (i18n) Implementation

## Overview

This project uses `react-i18next` for internationalization, supporting multiple languages with full RTL (Right-to-Left) support.

## Supported Languages

- **Russian (ru)** - Default language
- **English (en)**
- **Arabic (ar)** - RTL support enabled

## Features

### 1. Translation System
- Comprehensive translation files for all UI components
- Organized translation keys by feature/section
- Automatic language detection from browser settings
- Language preference stored in localStorage

### 2. Language Switcher
- Visual language selector in the header
- Shows native language names
- Persists user selection across sessions
- Located in: `/src/components/LanguageSwitcher.tsx`

### 3. Formatting Functions

#### Date & Time Formatting
```typescript
import { formatDate, formatDateTime, formatTime } from '@/i18n';

// Format date according to locale
const date = formatDate(new Date(), 'ru'); // "12 марта 2024 г."

// Format date and time
const datetime = formatDateTime(new Date(), 'en'); // "March 12, 2024, 10:30 AM"

// Format time only
const time = formatTime(new Date(), 'ar'); // "١٠:٣٠"
```

#### Number & Currency Formatting
```typescript
import { formatNumber, formatCurrency } from '@/i18n';

// Format numbers with locale-specific separators
const number = formatNumber(1234567.89, 'en'); // "1,234,567.89"

// Format currency
const price = formatCurrency(1234.56, 'USD', 'en'); // "$1,234.56"
const rubles = formatCurrency(1234.56, 'RUB', 'ru'); // "1 234,56 ₽"
```

#### Relative Time Formatting
```typescript
import { formatRelativeTime } from '@/i18n';

const relative = formatRelativeTime(new Date(Date.now() - 3600000)); // "1 час назад"
```

### 4. RTL Support

The system automatically detects RTL languages and adjusts the layout:

```typescript
import { isRTL, getDirection } from '@/i18n';

// Check if language is RTL
if (isRTL('ar')) {
  // Apply RTL-specific styles
}

// Get text direction
const direction = getDirection('ar'); // 'rtl'
```

RTL languages supported: Arabic (ar), Hebrew (he), Persian (fa), Urdu (ur)

### 5. Pluralization

The system supports complex pluralization rules for different languages:

```typescript
// In translation file (ru.json)
{
  "search": {
    "resultsCount_one": "{{count}} результат",
    "resultsCount_few": "{{count}} результата",
    "resultsCount_many": "{{count}} результатов"
  }
}

// In component
const { t } = useTranslation();
const message = t('search.resultsCount', { count: 5 }); // "5 результатов"
```

## Usage in Components

### Basic Translation
```typescript
import { useTranslation } from 'react-i18next';

function MyComponent() {
  const { t } = useTranslation();

  return (
    <div>
      <h1>{t('common.title')}</h1>
      <button>{t('common.save')}</button>
    </div>
  );
}
```

### With Formatting
```typescript
import { useTranslation } from 'react-i18next';
import { useI18nFormatters } from '@/hooks/useI18nFormatters';

function MyComponent() {
  const { t } = useTranslation();
  const { formatDate, formatCurrency } = useI18nFormatters();

  return (
    <div>
      <p>{formatDate(new Date())}</p>
      <p>{formatCurrency(1234.56, 'RUB')}</p>
    </div>
  );
}
```

### Interpolation
```typescript
const { t } = useTranslation();

// With variables
const greeting = t('welcome.message', { name: 'John' });

// With count (pluralization)
const items = t('items.count', { count: 5 });
```

## Translation File Structure

```
src/i18n/
├── index.ts              # i18n configuration
├── locales/
│   ├── ru.json          # Russian translations
│   ├── en.json          # English translations
│   └── ar.json          # Arabic translations
```

### Translation Keys Organization

```json
{
  "common": {           // Common UI elements
    "save": "Save",
    "cancel": "Cancel",
    ...
  },
  "nav": {             // Navigation items
    "dashboard": "Dashboard",
    "users": "Users",
    ...
  },
  "auth": {            // Authentication
    "login": "Login",
    "logout": "Logout",
    ...
  },
  "errors": {          // Error messages
    "generic": "An error occurred",
    ...
  },
  "success": {         // Success messages
    "saved": "Saved",
    ...
  }
}
```

## Adding a New Language

1. Create a new translation file in `src/i18n/locales/`:
```bash
cp src/i18n/locales/en.json src/i18n/locales/fr.json
```

2. Translate all keys in the new file

3. Update `src/i18n/index.ts`:
```typescript
import fr from './locales/fr.json';

const resources = {
  en: { translation: en },
  ru: { translation: ru },
  ar: { translation: ar },
  fr: { translation: fr }, // Add new language
};

i18n.init({
  // ...
  supportedLngs: ['en', 'ru', 'ar', 'fr'], // Add to supported languages
});
```

4. Update `src/components/LanguageSwitcher.tsx`:
```typescript
const LANGUAGES: Language[] = [
  { code: 'ru', name: 'Russian', nativeName: 'Русский' },
  { code: 'en', name: 'English', nativeName: 'English' },
  { code: 'ar', name: 'Arabic', nativeName: 'العربية' },
  { code: 'fr', name: 'French', nativeName: 'Français' }, // Add new language
];
```

5. If the language is RTL, update the RTL detection in `src/i18n/index.ts`:
```typescript
export const isRTL = (locale?: string): boolean => {
  const lang = locale || i18n.language;
  const rtlLanguages = ['ar', 'he', 'fa', 'ur', 'your-rtl-lang'];
  return rtlLanguages.includes(lang);
};
```

## Testing

Run the i18n tests:
```bash
npm test
```

The test suite covers:
- Translation file structure consistency
- Formatting functions
- RTL support
- Pluralization rules
- Language detection

## Best Practices

1. **Always use translation keys** - Never hardcode text in components
2. **Keep keys organized** - Group related translations together
3. **Use descriptive keys** - Make keys self-documenting (e.g., `users.deleteConfirm`)
4. **Maintain consistency** - Ensure all language files have the same structure
5. **Test with RTL** - Always test UI with Arabic to ensure RTL support works
6. **Use formatters** - Always use locale-aware formatters for dates, numbers, and currency
7. **Handle pluralization** - Use proper pluralization keys for countable items

## Configuration

The i18n system is configured in `src/i18n/index.ts`:

- **fallbackLng**: 'ru' - Default language if detection fails
- **detection order**: localStorage → browser navigator
- **cache**: localStorage (key: 'i18nextLng')
- **suspense**: Enabled for React Suspense support

## Components Updated

The following components have been updated to use i18n:

- ✅ Layout.tsx - Navigation, header, sidebar
- ✅ App.tsx - Loading fallback
- ✅ LanguageSwitcher.tsx - Language selection UI

## Hooks

### useI18nFormatters
Custom hook that provides locale-aware formatting functions:

```typescript
const {
  formatDate,
  formatDateTime,
  formatTime,
  formatNumber,
  formatCurrency,
  formatRelativeTime,
  locale
} = useI18nFormatters();
```

## Future Enhancements

- [ ] Add more languages (French, German, Spanish, etc.)
- [ ] Implement translation management system
- [ ] Add context-aware translations
- [ ] Implement translation validation in CI/CD
- [ ] Add translation coverage reports
- [ ] Create translation extraction tool for new keys
