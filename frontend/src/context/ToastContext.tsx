import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import Toast, { type ToastItem, type ToastType } from '@/components/Toast';

type ToastContextValue = {
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
  showToast: (message: string, type: ToastType) => void;
};

const MAX_TOASTS = 3;
const TOAST_LIFETIME_MS = 3000;

const ToastContext = createContext<ToastContextValue | null>(null);

const createToastId = () => Math.random().toString(36).slice(2, 10);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const timersRef = useRef<Record<string, number>>({});

  const removeToast = useCallback((id: string) => {
    setItems((prev) => prev.filter((item) => item.id !== id));
    const timer = timersRef.current[id];
    if (timer) {
      window.clearTimeout(timer);
      delete timersRef.current[id];
    }
  }, []);

  const push = useCallback(
    (type: ToastType, message: string) => {
      const id = createToastId();
      setItems((prev) => {
        const next = [{ id, type, message }, ...prev];
        return next.slice(0, MAX_TOASTS);
      });
      timersRef.current[id] = window.setTimeout(() => {
        removeToast(id);
      }, TOAST_LIFETIME_MS);
    },
    [removeToast]
  );

  const value = useMemo<ToastContextValue>(
    () => ({
      success: (message) => push('success', message),
      error: (message) => push('error', message),
      info: (message) => push('info', message),
      showToast: (message, type) => push(type, message),
    }),
    [push]
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <Toast items={items} onClose={removeToast} />
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used inside ToastProvider');
  }
  return context;
}
