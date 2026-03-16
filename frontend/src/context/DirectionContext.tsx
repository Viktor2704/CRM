import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { getDirection } from '@/i18n';

type DirectionContextType = {
  direction: 'ltr' | 'rtl';
  isRTL: boolean;
};

const DirectionContext = createContext<DirectionContextType>({
  direction: 'ltr',
  isRTL: false,
});

export function DirectionProvider({ children }: { children: ReactNode }) {
  const { i18n } = useTranslation();
  const direction = getDirection(i18n.language);
  const isRTL = direction === 'rtl';

  useEffect(() => {
    // Update document direction and lang attribute
    document.documentElement.dir = direction;
    document.documentElement.lang = i18n.language;
  }, [direction, i18n.language]);

  return (
    <DirectionContext.Provider value={{ direction, isRTL }}>
      {children}
    </DirectionContext.Provider>
  );
}

export function useDirection() {
  const context = useContext(DirectionContext);
  if (!context) {
    throw new Error('useDirection must be used within DirectionProvider');
  }
  return context;
}
