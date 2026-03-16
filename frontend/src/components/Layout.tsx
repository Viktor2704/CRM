import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  BarChart3,
  Bell,
  BookOpen,
  Bot,
  Boxes,
  Building2,
  CalendarDays,
  ChevronDown,
  ClipboardList,
  Code2,
  Compass,
  FileText,
  FolderKanban,
  LayoutDashboard,
  LogOut,
  Mail,
  Menu,
  MessageSquare,
  Search,
  Settings,
  Shield,
  UserCircle2,
  Users,
  Wrench,
  X,
  Zap,
} from 'lucide-react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import type { LucideIcon } from 'lucide-react';
import NotificationBell from '@/components/NotificationBell';
import NotificationHistory from '@/components/NotificationHistory';
import ThemeToggle from '@/components/ThemeToggle';
import CommandPalette from '@/components/CommandPalette';
import BottomNav from '@/components/mobile/BottomNav';
import PWAInstallPrompt from '@/components/PWAInstallPrompt';
import { useAuth } from '@/auth/AuthContext';
import { UserRole } from '@/types';

type NavItem = {
  to: string;
  labelKey: string;
  icon: LucideIcon;
  roles?: UserRole[];
  dividerBefore?: boolean;
};

type NavGroup = {
  groupKey: string;
  icon: LucideIcon;
  roles?: UserRole[];
  dividerBefore?: boolean;
  children: NavItem[];
};

type NavEntry = NavItem | NavGroup;

function isNavGroup(entry: NavEntry): entry is NavGroup {
  return 'children' in entry;
}

const getPageTitle = (pathname: string, t: (key: string) => string): string => {
  const titleMap: Record<string, string> = {
    '/': t('nav.dashboard'),
    '/ai-chat': t('nav.aiChat'),
    '/service-requests': t('nav.serviceRequests'),
    '/maintenance-plans': t('nav.maintenancePlans'),
    '/installations': t('nav.installations'),
    '/projects': t('nav.projects'),
    '/directions': t('nav.directions'),
    '/service-chats': t('nav.serviceChats'),
    '/notifications': t('nav.notifications'),
    '/calendar': t('nav.calendar'),
    '/users': t('nav.users'),
    '/tenants': t('nav.tenants'),
    '/contracts': t('nav.contracts'),
    '/search': t('nav.search'),
    '/profile': t('nav.profile'),
    '/sppz-journal': t('nav.sppzJournal'),
    '/settings/email-queue': t('nav.emailQueue'),
    '/settings/email-templates': t('nav.emailTemplates'),
    '/settings/custom-fields': t('nav.customFields'),
    '/settings/workflow-automation': t('nav.workflowAutomation'),
    '/knowledge-base': t('nav.knowledgeBase'),
    '/reports': t('nav.reports'),
    '/analytics': t('nav.analytics'),
    '/api-docs-portal': t('nav.apiDocs'),
    '/modules': t('nav.modules'),
  };
  return titleMap[pathname] || titleMap[pathname.replace(/\/[^/]+$/, '')] || t('layout.companyName');
};

const NAV_ENTRIES: NavEntry[] = [
  { to: '/', icon: LayoutDashboard, labelKey: 'nav.dashboard' },
  { to: '/ai-chat', icon: Bot, labelKey: 'nav.aiChat', roles: [UserRole.ADMIN, UserRole.MANAGER, UserRole.CURATOR, UserRole.DISPATCHER] },
  { to: '/service-requests', icon: ClipboardList, labelKey: 'nav.serviceRequests', dividerBefore: true },
  { to: '/maintenance-plans', icon: CalendarDays, labelKey: 'nav.maintenancePlans', roles: [UserRole.ADMIN, UserRole.MANAGER, UserRole.CURATOR, UserRole.DISPATCHER, UserRole.EXECUTOR] },
  { to: '/installations', icon: Wrench, labelKey: 'nav.installations' },
  { to: '/projects', icon: FolderKanban, labelKey: 'nav.projects' },
  { to: '/directions', icon: Compass, labelKey: 'nav.directions' },
  { to: '/service-chats', icon: MessageSquare, labelKey: 'nav.serviceChats' },
  { to: '/notifications', icon: Bell, labelKey: 'nav.notifications', dividerBefore: true },
  { to: '/calendar', icon: CalendarDays, labelKey: 'nav.calendar' },
  {
    to: '/users',
    icon: Users,
    labelKey: 'nav.users',
    roles: [UserRole.ADMIN, UserRole.MANAGER, UserRole.CURATOR, UserRole.DISPATCHER],
    dividerBefore: true,
  },
  {
    to: '/tenants',
    icon: Building2,
    labelKey: 'nav.tenants',
    roles: [UserRole.ADMIN, UserRole.MANAGER, UserRole.CURATOR, UserRole.DISPATCHER],
  },
  { to: '/contracts', icon: FileText, labelKey: 'nav.contracts' },
  {
    to: '/sppz-journal',
    icon: FileText,
    labelKey: 'nav.sppzJournal',
    roles: [UserRole.ADMIN, UserRole.MANAGER, UserRole.CURATOR, UserRole.DISPATCHER, UserRole.EXECUTOR],
  },
  // Инструменты — подменю
  {
    groupKey: 'nav.tools',
    icon: Search,
    roles: [UserRole.ADMIN, UserRole.MANAGER, UserRole.CURATOR, UserRole.DISPATCHER],
    dividerBefore: true,
    children: [
      { to: '/knowledge-base', icon: BookOpen, labelKey: 'nav.knowledgeBase', roles: [UserRole.ADMIN, UserRole.MANAGER, UserRole.CURATOR, UserRole.DISPATCHER] },
      { to: '/reports', icon: ClipboardList, labelKey: 'nav.reports', roles: [UserRole.ADMIN, UserRole.MANAGER] },
      { to: '/analytics', icon: BarChart3, labelKey: 'nav.analytics', roles: [UserRole.ADMIN, UserRole.MANAGER] },
      { to: '/search', icon: Search, labelKey: 'nav.search' },
    ],
  },
  // Настройки — подменю
  {
    groupKey: 'nav.settings',
    icon: Settings,
    roles: [UserRole.ADMIN, UserRole.MANAGER],
    dividerBefore: true,
    children: [
      { to: '/settings/email-queue', icon: Mail, labelKey: 'nav.emailQueue', roles: [UserRole.ADMIN, UserRole.MANAGER] },
      { to: '/settings/email-templates', icon: Mail, labelKey: 'nav.emailTemplates', roles: [UserRole.ADMIN, UserRole.MANAGER] },
      { to: '/settings/custom-fields', icon: Settings, labelKey: 'nav.customFields', roles: [UserRole.ADMIN] },
      { to: '/settings/workflow-automation', icon: Zap, labelKey: 'nav.workflowAutomation', roles: [UserRole.ADMIN, UserRole.MANAGER] },
      { to: '/modules', icon: Boxes, labelKey: 'nav.modules', roles: [UserRole.ADMIN] },
      { to: '/api-docs-portal', icon: Code2, labelKey: 'nav.apiDocs', roles: [UserRole.ADMIN] },
    ],
  },
];

export default function Layout() {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});

  const handleGlobalSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const query = searchQuery.trim();
    if (!query) {
      navigate('/search');
      return;
    }
    navigate(`/search?q=${encodeURIComponent(query)}`);
  };

  useEffect(() => {
    if (location.pathname !== '/search') return;
    const params = new URLSearchParams(location.search);
    setSearchQuery(params.get('q') || '');
  }, [location.pathname, location.search]);

  // Auto-open group if current page is in it
  useEffect(() => {
    for (const entry of NAV_ENTRIES) {
      if (isNavGroup(entry)) {
        const isChildActive = entry.children.some((child) => location.pathname === child.to || location.pathname.startsWith(child.to + '/'));
        if (isChildActive) {
          setOpenGroups((prev) => ({ ...prev, [entry.groupKey]: true }));
        }
      }
    }
  }, [location.pathname]);

  const toggleGroup = (groupKey: string) => {
    setOpenGroups((prev) => ({ ...prev, [groupKey]: !prev[groupKey] }));
  };

  const canSeeEntry = (entry: { roles?: UserRole[] }) => {
    if (!entry.roles || entry.roles.length === 0) return true;
    if (!user?.role) return false;
    return entry.roles.includes(user.role as UserRole);
  };

  const pageTitle = getPageTitle(location.pathname, t);
  const closeMobileMenu = () => setIsMobileMenuOpen(false);

  const handleLogout = async () => {
    await logout();
    setIsMobileMenuOpen(false);
    navigate('/login', { replace: true });
  };

  const renderNavItem = (item: NavItem, onNavigate?: () => void) => {
    const Icon = item.icon;
    return (
      <NavLink
        to={item.to}
        end={item.to === '/'}
        onClick={onNavigate}
        className={({ isActive }) =>
          [
            'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
            isActive ? 'bg-brand-red/10 text-white border-l-2 border-brand-red' : 'text-slate-400 hover:bg-slate-800/50 hover:text-white',
          ].join(' ')
        }
      >
        <Icon size={18} />
        {t(item.labelKey)}
      </NavLink>
    );
  };

  const renderNav = (onNavigate?: () => void) => (
    <nav className="space-y-0.5 p-3">
      {NAV_ENTRIES.map((entry) => {
        if (isNavGroup(entry)) {
          if (!canSeeEntry(entry)) return null;
          const visibleChildren = entry.children.filter(canSeeEntry);
          if (visibleChildren.length === 0) return null;

          const isOpen = openGroups[entry.groupKey] ?? false;
          const isChildActive = visibleChildren.some((child) => location.pathname === child.to || location.pathname.startsWith(child.to + '/'));
          const GroupIcon = entry.icon;

          return (
            <div key={entry.groupKey}>
              {entry.dividerBefore && (
                <div className="my-2 border-t border-slate-700/60" />
              )}
              <button
                type="button"
                onClick={() => toggleGroup(entry.groupKey)}
                className={[
                  'flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                  isChildActive ? 'text-white' : 'text-slate-400 hover:bg-slate-800/50 hover:text-white',
                ].join(' ')}
              >
                <span className="flex items-center gap-3">
                  <GroupIcon size={18} />
                  {t(entry.groupKey)}
                </span>
                <ChevronDown
                  size={14}
                  className={[
                    'transition-transform duration-200',
                    isOpen ? 'rotate-180' : '',
                  ].join(' ')}
                />
              </button>
              {isOpen && (
                <div className="ml-3 mt-0.5 space-y-0.5 border-l border-slate-700/40 pl-2">
                  {visibleChildren.map((child) => (
                    <div key={child.to}>{renderNavItem(child, onNavigate)}</div>
                  ))}
                </div>
              )}
            </div>
          );
        }

        // Regular nav item
        if (!canSeeEntry(entry)) return null;
        return (
          <div key={entry.to}>
            {entry.dividerBefore && (
              <div className="my-2 border-t border-slate-700/60" />
            )}
            {renderNavItem(entry, onNavigate)}
          </div>
        );
      })}
    </nav>
  );

  const renderSidebarContent = (onNavigate?: () => void) => (
    <div className="flex h-full flex-col">
      <div className="border-b border-slate-800 px-5 py-5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-slate-800 p-2">
              <Shield size={20} className="text-brand-red" />
            </div>
            <div>
              <p className="text-lg font-bold leading-tight text-white">{t('layout.companyName')}</p>
              <p className="text-xs text-slate-400">{t('layout.companyTagline')}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={closeMobileMenu}
            className="rounded-md p-1 text-slate-400 transition hover:bg-slate-800 hover:text-white md:hidden"
            aria-label={t('layout.closeMenu')}
          >
            <X size={18} />
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">{renderNav(onNavigate)}</div>

      <div className="border-t border-slate-800 p-4">
        <div className="mb-3">
          <p className="truncate text-sm font-semibold text-white">{user?.fullName || t('common.profile')}</p>
          <p className="truncate text-xs uppercase text-slate-400">{user?.role || t('layout.userRole')}</p>
        </div>
        <NavLink
          to="/profile"
          className="mb-2 inline-flex w-full items-center justify-center gap-2 rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-200 transition hover:border-slate-500 hover:bg-slate-800"
        >
          <UserCircle2 size={16} />
          {t('common.profile')}
        </NavLink>
        <button
          type="button"
          onClick={() => void handleLogout()}
          className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-200 transition hover:border-slate-500 hover:bg-slate-800"
        >
          <LogOut size={16} />
          {t('common.logout')}
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <CommandPalette />
      <aside className="hidden md:fixed md:inset-y-0 md:z-30 md:flex md:w-60 md:flex-col md:bg-slate-900">
        {renderSidebarContent()}
      </aside>

      {isMobileMenuOpen ? (
        <div className="fixed inset-0 z-40 md:hidden">
          <button
            type="button"
            onClick={closeMobileMenu}
            className="absolute inset-0 h-full w-full bg-black/50"
            aria-label="Закрыть меню"
          />
          <aside className="relative z-50 h-full w-[85vw] max-w-[300px] bg-slate-900">{renderSidebarContent(closeMobileMenu)}</aside>
        </div>
      ) : null}

      <div className="flex min-h-screen flex-col md:pl-60">
        <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/90 px-4 py-3 backdrop-blur dark:border-slate-800 dark:bg-slate-900/90 sm:px-6">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setIsMobileMenuOpen(true)}
                  className="min-h-[44px] min-w-[44px] rounded-lg p-2 text-slate-600 transition hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-slate-100 md:hidden"
                  aria-label={t('layout.openMenu')}
                >
                  <Menu size={22} />
                </button>
                <div className="min-w-0">
                  <h1 className="truncate text-base font-semibold text-slate-900 dark:text-slate-100">{pageTitle}</h1>
                  <p className="hidden truncate text-xs text-slate-500 dark:text-slate-400 sm:block">
                    {t('layout.operatingSystem')}
                  </p>
                </div>
              </div>
            </div>
            <form onSubmit={handleGlobalSearch} className="hidden lg:block">
              <div className="relative w-80">
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500"
                  size={16}
                />
                <input
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder={t('layout.globalSearch')}
                  className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-8 pr-3 text-sm text-slate-900 outline-none ring-brand-red transition focus:border-brand-red focus:ring-2 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                />
              </div>
            </form>
            <div className="flex items-center gap-1">
              <ThemeToggle />
              <NotificationHistory />
              <NotificationBell />
            </div>
          </div>
        </header>

        <main className="min-h-[calc(100vh-64px)] flex-1 bg-slate-50 p-4 pb-20 dark:bg-slate-950 sm:p-6 md:pb-6">
          <Outlet />
        </main>

        <BottomNav onMenuClick={() => setIsMobileMenuOpen(true)} />
        <PWAInstallPrompt />
      </div>
    </div>
  );
}
