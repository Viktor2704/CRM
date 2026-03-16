import { NavLink } from 'react-router-dom';
import { LayoutDashboard, ClipboardList, Bell, UserCircle2, Menu } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

type NavItem = {
  to: string;
  label: string;
  icon: LucideIcon;
};

const NAV_ITEMS: NavItem[] = [
  { to: '/', icon: LayoutDashboard, label: 'Панель' },
  { to: '/service-requests', icon: ClipboardList, label: 'Заявки' },
  { to: '/notifications', icon: Bell, label: 'Уведомления' },
  { to: '/profile', icon: UserCircle2, label: 'Профиль' },
];

type BottomNavProps = {
  onMenuClick?: () => void;
};

export default function BottomNav({ onMenuClick }: BottomNavProps) {
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-30 border-t border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 md:hidden">
      <div className="flex items-center justify-around">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                [
                  'flex min-h-[44px] flex-1 flex-col items-center justify-center gap-1 py-2 text-xs transition-colors',
                  isActive
                    ? 'text-brand-red'
                    : 'text-slate-500 dark:text-slate-400',
                ].join(' ')
              }
            >
              {({ isActive }) => (
                <>
                  <Icon size={20} strokeWidth={isActive ? 2.5 : 2} />
                  <span className="font-medium">{item.label}</span>
                </>
              )}
            </NavLink>
          );
        })}
        <button
          type="button"
          onClick={onMenuClick}
          className="flex min-h-[44px] flex-1 flex-col items-center justify-center gap-1 py-2 text-xs text-slate-500 transition-colors dark:text-slate-400"
        >
          <Menu size={20} />
          <span className="font-medium">Меню</span>
        </button>
      </div>
    </nav>
  );
}
