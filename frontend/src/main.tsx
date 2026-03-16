import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from '@/App';
import { AuthProvider } from '@/auth/AuthContext';
import { NotificationStreamProvider } from '@/context/NotificationStreamContext';
import { ToastProvider } from '@/context/ToastContext';
import { DirectionProvider } from '@/context/DirectionContext';
import '@/i18n';
import '@/styles/globals.css';
import '@/styles/mobile.css';
import '@/styles/rtl.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <DirectionProvider>
          <NotificationStreamProvider>
            <ToastProvider>
              <App />
            </ToastProvider>
          </NotificationStreamProvider>
        </DirectionProvider>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>
);

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js?v=20260312-mobile-optimized').catch(() => {});
  });
}
