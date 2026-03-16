import { Download, X } from 'lucide-react';
import { useState, useEffect } from 'react';
import { usePWAInstall } from '@/hooks/usePWAInstall';

export default function PWAInstallPrompt() {
  const { isInstallable, promptInstall } = usePWAInstall();
  const [isDismissed, setIsDismissed] = useState(false);

  useEffect(() => {
    const dismissed = localStorage.getItem('pwa-install-dismissed');
    if (dismissed) {
      setIsDismissed(true);
    }
  }, []);

  const handleInstall = async () => {
    const installed = await promptInstall();
    if (installed) {
      setIsDismissed(true);
    }
  };

  const handleDismiss = () => {
    setIsDismissed(true);
    localStorage.setItem('pwa-install-dismissed', 'true');
  };

  if (!isInstallable || isDismissed) {
    return null;
  }

  return (
    <div className="fixed bottom-20 left-4 right-4 z-40 rounded-lg border border-slate-200 bg-white p-4 shadow-lg dark:border-slate-800 dark:bg-slate-900 md:bottom-4 md:left-auto md:right-4 md:w-80">
      <button
        type="button"
        onClick={handleDismiss}
        className="absolute right-2 top-2 rounded-full p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-300"
        aria-label="Закрыть"
      >
        <X size={16} />
      </button>
      <div className="mb-3 pr-6">
        <h3 className="mb-1 font-semibold text-slate-900 dark:text-slate-100">
          Установить приложение
        </h3>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Установите Новинжстрой на главный экран для быстрого доступа
        </p>
      </div>
      <button
        type="button"
        onClick={() => void handleInstall()}
        className="flex w-full items-center justify-center gap-2 rounded-lg bg-brand-red px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700"
      >
        <Download size={16} />
        Установить
      </button>
    </div>
  );
}
