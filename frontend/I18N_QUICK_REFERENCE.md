# i18n Quick Reference Guide

## Import and Use Translations

```typescript
import { useTranslation } from 'react-i18next';

function MyComponent() {
  const { t, i18n } = useTranslation();

  return (
    <div>
      <h1>{t('common.title')}</h1>
      <p>Current language: {i18n.language}</p>
    </div>
  );
}
```

## Common Translation Keys

### UI Elements
- `t('common.save')` - Save
- `t('common.cancel')` - Cancel
- `t('common.delete')` - Delete
- `t('common.edit')` - Edit
- `t('common.create')` - Create
- `t('common.loading')` - Loading...
- `t('common.search')` - Search
- `t('common.filter')` - Filter

### Navigation
- `t('nav.dashboard')` - Dashboard
- `t('nav.users')` - Users
- `t('nav.projects')` - Projects
- `t('nav.reports')` - Reports

### Messages
- `t('errors.generic')` - Generic error message
- `t('success.saved')` - Success message
- `t('errors.requiredField')` - Field validation

## Formatting Functions

```typescript
import { useI18nFormatters } from '@/hooks/useI18nFormatters';

function MyComponent() {
  const { formatDate, formatCurrency, formatNumber } = useI18nFormatters();

  return (
    <div>
      <p>{formatDate(new Date())}</p>
      <p>{formatCurrency(1234.56, 'RUB')}</p>
      <p>{formatNumber(1234567)}</p>
    </div>
  );
}
```

## Change Language

```typescript
const { i18n } = useTranslation();

// Change to English
i18n.changeLanguage('en');

// Change to Russian
i18n.changeLanguage('ru');

// Change to Arabic
i18n.changeLanguage('ar');
```

## RTL Support

```typescript
import { useDirection } from '@/context/DirectionContext';

function MyComponent() {
  const { direction, isRTL } = useDirection();

  return (
    <div className={isRTL ? 'flex-row-reverse' : 'flex-row'}>
      {/* Content */}
    </div>
  );
}
```

## Pluralization

```typescript
// In translation file:
{
  "items": {
    "count_one": "{{count}} item",
    "count_other": "{{count}} items"
  }
}

// In component:
const { t } = useTranslation();
<p>{t('items.count', { count: 5 })}</p> // "5 items"
```

## Interpolation

```typescript
// In translation file:
{
  "welcome": {
    "message": "Welcome, {{name}}!"
  }
}

// In component:
const { t } = useTranslation();
<p>{t('welcome.message', { name: 'John' })}</p> // "Welcome, John!"
```

## Supported Languages

- **ru** - Russian (Русский) - Default
- **en** - English
- **ar** - Arabic (العربية) - RTL

## File Locations

- **Translations**: `/src/i18n/locales/*.json`
- **Configuration**: `/src/i18n/index.ts`
- **Language Switcher**: `/src/components/LanguageSwitcher.tsx`
- **RTL Styles**: `/src/styles/rtl.css`
- **Documentation**: `/src/i18n/README.md`

## Adding New Translation Keys

1. Add key to all language files (ru.json, en.json, ar.json)
2. Use consistent structure across all files
3. Use descriptive key names (e.g., `users.deleteConfirm`)
4. Group related keys together

Example:
```json
{
  "myFeature": {
    "title": "My Feature",
    "description": "Feature description",
    "action": "Do something"
  }
}
```

## Best Practices

✅ Always use translation keys, never hardcode text
✅ Keep keys organized by feature/section
✅ Use descriptive key names
✅ Test with all supported languages
✅ Test RTL layout with Arabic
✅ Use formatters for dates, numbers, currency
✅ Handle pluralization properly
✅ Maintain consistency across language files
