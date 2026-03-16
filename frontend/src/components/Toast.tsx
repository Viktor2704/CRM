import { CheckCircle2, Info, XCircle } from 'lucide-react';

export type ToastType = 'success' | 'error' | 'info';

export type ToastItem = {
  id: string;
  message: string;
  type: ToastType;
};

interface ToastProps {
  items: ToastItem[];
  onClose: (id: string) => void;
}

const styles: Record<ToastType, { wrap: string; icon: JSX.Element }> = {
  success: {
    wrap: 'border-green-200 bg-green-50 text-green-800 dark:border-green-900/70 dark:bg-green-950/40 dark:text-green-200',
    icon: <CheckCircle2 size={16} />,
  },
  error: {
    wrap: 'border-red-200 bg-red-50 text-red-800 dark:border-red-900/70 dark:bg-red-950/40 dark:text-red-200',
    icon: <XCircle size={16} />,
  },
  info: {
    wrap: 'border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-900/70 dark:bg-blue-950/40 dark:text-blue-200',
    icon: <Info size={16} />,
  },
};

export default function Toast({ items, onClose }: ToastProps) {
  if (items.length === 0) return null;

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-[calc(100%-2rem)] max-w-sm flex-col gap-2" aria-live="polite">
      {items.map((item) => {
        const style = styles[item.type];
        return (
          <div
            key={item.id}
            className={[
              'pointer-events-auto flex items-start gap-2 rounded-lg border px-3 py-2 shadow-lg backdrop-blur',
              style.wrap,
            ].join(' ')}
            role="status"
          >
            <div className="mt-0.5 shrink-0">{style.icon}</div>
            <p className="min-w-0 flex-1 text-sm">{item.message}</p>
            <button
              type="button"
              onClick={() => onClose(item.id)}
              className="rounded p-1 opacity-70 transition hover:opacity-100"
              aria-label="Закрыть уведомление"
            >
              ×
            </button>
          </div>
        );
      })}
    </div>
  );
}
