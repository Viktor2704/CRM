import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Languages, Check } from 'lucide-react';

type Language = {
  code: string;
  name: string;
  nativeName: string;
};

const LANGUAGES: Language[] = [
  { code: 'ru', name: 'Russian', nativeName: 'Русский' },
  { code: 'en', name: 'English', nativeName: 'English' },
  { code: 'ar', name: 'Arabic', nativeName: 'العربية' },
];

export default function LanguageSwitcher() {
  const { i18n } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);

  const currentLanguage = LANGUAGES.find((lang) => lang.code === i18n.language) || LANGUAGES[0];

  const handleLanguageChange = (languageCode: string) => {
    i18n.changeLanguage(languageCode);
    setIsOpen(false);

    // Update document direction for RTL support
    const direction = ['ar', 'he', 'fa', 'ur'].includes(languageCode) ? 'rtl' : 'ltr';
    document.documentElement.dir = direction;
    document.documentElement.lang = languageCode;
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 transition hover:border-slate-400 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:border-slate-600 dark:hover:bg-slate-700"
        aria-label="Change language"
        aria-expanded={isOpen}
      >
        <Languages size={16} />
        <span className="hidden sm:inline">{currentLanguage.nativeName}</span>
        <span className="sm:hidden">{currentLanguage.code.toUpperCase()}</span>
      </button>

      {isOpen && (
        <>
          <button
            type="button"
            onClick={() => setIsOpen(false)}
            className="fixed inset-0 z-10"
            aria-label="Close language menu"
          />
          <div className="absolute right-0 top-full z-20 mt-2 w-48 rounded-lg border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-800">
            <div className="p-2">
              {LANGUAGES.map((language) => (
                <button
                  key={language.code}
                  type="button"
                  onClick={() => handleLanguageChange(language.code)}
                  className={`flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm transition ${
                    i18n.language === language.code
                      ? 'bg-brand-red/10 text-brand-red dark:bg-brand-red/20'
                      : 'text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700'
                  }`}
                >
                  <div>
                    <div className="font-medium">{language.nativeName}</div>
                    <div className="text-xs text-slate-500 dark:text-slate-400">{language.name}</div>
                  </div>
                  {i18n.language === language.code && <Check size={16} />}
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
