import { useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';

const THEME_KEY = 'theme';

const getInitialDarkState = () => {
  if (typeof window === 'undefined') return false;
  const saved = window.localStorage.getItem(THEME_KEY);
  if (saved) return saved === 'dark';
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
};

export default function ThemeToggle() {
  const [dark, setDark] = useState<boolean>(getInitialDarkState);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    window.localStorage.setItem(THEME_KEY, dark ? 'dark' : 'light');
  }, [dark]);

  return (
    <button
      type="button"
      role="switch"
      aria-checked={dark}
      onClick={() => setDark((value) => !value)}
      className="rounded-lg p-2 text-slate-500 transition hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
      title={dark ? 'Светлая тема' : 'Тёмная тема'}
      aria-label={dark ? 'Светлая тема' : 'Тёмная тема'}
    >
      {dark ? <Sun size={18} /> : <Moon size={18} />}
    </button>
  );
}
