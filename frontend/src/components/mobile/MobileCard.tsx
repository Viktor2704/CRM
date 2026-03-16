import type { ReactNode } from 'react';

type MobileCardProps = {
  children: ReactNode;
  onClick?: () => void;
  className?: string;
};

export default function MobileCard({ children, onClick, className = '' }: MobileCardProps) {
  return (
    <div
      onClick={onClick}
      className={`rounded-lg border border-slate-200 bg-white p-4 shadow-sm transition-shadow dark:border-slate-800 dark:bg-slate-900 ${
        onClick ? 'active:shadow-md' : ''
      } ${className}`}
      style={{ minHeight: '44px' }}
    >
      {children}
    </div>
  );
}
