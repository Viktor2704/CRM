import { useEffect, useState, useCallback, useRef, type KeyboardEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search,
  Building2,
  FolderKanban,
  Wrench,
  ClipboardList,
  Compass,
  Users,
  X,
  Clock,
  Sparkles,
} from 'lucide-react';
import { api } from '@/api/client';
import { useAuth } from '@/auth/AuthContext';

type SearchResult = {
  id: string;
  type: 'tenant' | 'project' | 'installation' | 'service_request' | 'direction' | 'user';
  title: string;
  subtitle?: string;
  description?: string;
  rank: number;
};

type RecentItem = {
  id: string;
  type: string;
  title: string;
  path: string;
  timestamp: number;
};

const RECENT_ITEMS_KEY = 'commandPalette:recentItems';
const MAX_RECENT_ITEMS = 5;

const TYPE_ICONS = {
  tenant: Building2,
  project: FolderKanban,
  installation: Wrench,
  service_request: ClipboardList,
  direction: Compass,
  user: Users,
};

const TYPE_LABELS = {
  tenant: 'Контрагент',
  project: 'Проект',
  installation: 'Монтаж',
  service_request: 'Заявка',
  direction: 'Направление',
  user: 'Пользователь',
};

const QUICK_ACTIONS = [
  { id: 'new-service-request', title: 'Создать заявку', path: '/service-requests?action=new', icon: ClipboardList },
  { id: 'new-project', title: 'Создать проект', path: '/projects?action=new', icon: FolderKanban },
  { id: 'calendar', title: 'Открыть календарь', path: '/calendar', icon: Clock },
  { id: 'ai-chat', title: 'AI-ассистент', path: '/ai-chat', icon: Sparkles },
];

export default function CommandPalette() {
  const navigate = useNavigate();
  const { user: _user } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [recentItems, setRecentItems] = useState<RecentItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Load recent items from localStorage
  useEffect(() => {
    try {
      const stored = localStorage.getItem(RECENT_ITEMS_KEY);
      if (stored) {
        const items = JSON.parse(stored) as RecentItem[];
        setRecentItems(items.slice(0, MAX_RECENT_ITEMS));
      }
    } catch {
      // Ignore errors
    }
  }, []);

  // Save recent item
  const saveRecentItem = useCallback((item: RecentItem) => {
    try {
      const stored = localStorage.getItem(RECENT_ITEMS_KEY);
      const existing = stored ? (JSON.parse(stored) as RecentItem[]) : [];
      const filtered = existing.filter((i) => i.id !== item.id || i.type !== item.type);
      const updated = [item, ...filtered].slice(0, MAX_RECENT_ITEMS);
      localStorage.setItem(RECENT_ITEMS_KEY, JSON.stringify(updated));
      setRecentItems(updated);
    } catch {
      // Ignore errors
    }
  }, []);

  // Handle Cmd+K / Ctrl+K
  useEffect(() => {
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'k') {
        event.preventDefault();
        setIsOpen((prev) => !prev);
      }
      if (event.key === 'Escape' && isOpen) {
        setIsOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  // Focus input when opened
  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  // Reset state when closed
  useEffect(() => {
    if (!isOpen) {
      setQuery('');
      setResults([]);
      setSelectedIndex(0);
    }
  }, [isOpen]);

  // Search with debounce
  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      setLoading(false);
      return;
    }

    setLoading(true);

    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    searchTimeoutRef.current = setTimeout(() => {
      api
        .getT<{ results: SearchResult[] }>(`/search?q=${encodeURIComponent(query)}&limit=10`)
        .then((data) => {
          setResults(data.results || []);
          setSelectedIndex(0);
        })
        .catch(() => {
          setResults([]);
        })
        .finally(() => {
          setLoading(false);
        });
    }, 300);

    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, [query]);

  const getItemPath = (item: SearchResult): string => {
    switch (item.type) {
      case 'tenant':
        return `/tenants?focus=${encodeURIComponent(item.id)}`;
      case 'project':
        return `/projects?focus=${encodeURIComponent(item.id)}`;
      case 'installation':
        return `/installations/${encodeURIComponent(item.id)}`;
      case 'service_request':
        return `/service-requests?focus=${encodeURIComponent(item.id)}`;
      case 'direction':
        return `/directions?focus=${encodeURIComponent(item.id)}`;
      case 'user':
        return `/users?focus=${encodeURIComponent(item.id)}`;
      default:
        return '/';
    }
  };

  const handleSelectResult = (item: SearchResult) => {
    const path = getItemPath(item);
    saveRecentItem({
      id: item.id,
      type: item.type,
      title: item.title,
      path,
      timestamp: Date.now(),
    });
    navigate(path);
    setIsOpen(false);
  };

  const handleSelectRecent = (item: RecentItem) => {
    navigate(item.path);
    setIsOpen(false);
  };

  const handleSelectAction = (action: typeof QUICK_ACTIONS[0]) => {
    navigate(action.path);
    setIsOpen(false);
  };

  const allItems = query.trim()
    ? results
    : [...QUICK_ACTIONS.map((a) => ({ ...a, type: 'action' as const })), ...recentItems.map((r) => ({ ...r, type: 'recent' as const }))];

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setSelectedIndex((prev) => (prev + 1) % Math.max(allItems.length, 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setSelectedIndex((prev) => (prev - 1 + Math.max(allItems.length, 1)) % Math.max(allItems.length, 1));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const selected = allItems[selectedIndex];
      if (!selected) return;

      if ('path' in selected && selected.type === 'action') {
        handleSelectAction(selected as typeof QUICK_ACTIONS[0]);
      } else if ('path' in selected && selected.type === 'recent') {
        handleSelectRecent(selected as RecentItem);
      } else if ('rank' in selected) {
        handleSelectResult(selected as SearchResult);
      }
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-2 pt-[10vh] sm:p-4 sm:pt-[20vh]">
      <div
        className="absolute inset-0"
        onClick={() => setIsOpen(false)}
        aria-label="Закрыть"
      />
      <div className="relative w-full max-w-2xl rounded-xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900 max-h-[85vh] flex flex-col">
        <div className="flex-shrink-0 flex items-center gap-3 border-b border-slate-200 px-4 py-3 dark:border-slate-700">
          <Search size={18} className="text-slate-400" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Поиск или команда..."
            className="flex-1 bg-transparent text-sm text-slate-900 outline-none placeholder:text-slate-400 dark:text-slate-100"
          />
          {loading && (
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-brand-red" />
          )}
          <button
            type="button"
            onClick={() => setIsOpen(false)}
            className="rounded-md p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-300"
            aria-label="Закрыть"
          >
            <X size={16} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {query.trim() ? (
            results.length === 0 && !loading ? (
              <div className="p-8 text-center text-sm text-slate-500 dark:text-slate-400">
                Ничего не найдено
              </div>
            ) : (
              <div className="p-2">
                {results.map((item, index) => {
                  const Icon = TYPE_ICONS[item.type] || Search;
                  return (
                    <button
                      key={`${item.type}-${item.id}`}
                      type="button"
                      onClick={() => handleSelectResult(item)}
                      className={[
                        'flex w-full items-start gap-3 rounded-lg px-3 py-2 text-left transition',
                        selectedIndex === index
                          ? 'bg-brand-red/10 text-slate-900 dark:text-slate-100'
                          : 'text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800',
                      ].join(' ')}
                    >
                      <Icon size={18} className="mt-0.5 flex-shrink-0 text-slate-400" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="truncate text-sm font-medium">{item.title}</p>
                          <span className="flex-shrink-0 rounded bg-slate-200 px-1.5 py-0.5 text-xs text-slate-600 dark:bg-slate-700 dark:text-slate-400">
                            {TYPE_LABELS[item.type]}
                          </span>
                        </div>
                        {item.subtitle && (
                          <p className="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400">
                            {item.subtitle}
                          </p>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            )
          ) : (
            <div className="p-2">
              {QUICK_ACTIONS.length > 0 && (
                <div className="mb-2">
                  <p className="mb-1 px-3 text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">
                    Быстрые действия
                  </p>
                  {QUICK_ACTIONS.map((action, index) => {
                    const Icon = action.icon;
                    return (
                      <button
                        key={action.id}
                        type="button"
                        onClick={() => handleSelectAction(action)}
                        className={[
                          'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition',
                          selectedIndex === index
                            ? 'bg-brand-red/10 text-slate-900 dark:text-slate-100'
                            : 'text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800',
                        ].join(' ')}
                      >
                        <Icon size={18} className="flex-shrink-0 text-slate-400" />
                        <p className="text-sm font-medium">{action.title}</p>
                      </button>
                    );
                  })}
                </div>
              )}

              {recentItems.length > 0 && (
                <div>
                  <p className="mb-1 px-3 text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">
                    Недавние
                  </p>
                  {recentItems.map((item, index) => {
                    const Icon = TYPE_ICONS[item.type as keyof typeof TYPE_ICONS] || Clock;
                    const adjustedIndex = index + QUICK_ACTIONS.length;
                    return (
                      <button
                        key={`${item.type}-${item.id}`}
                        type="button"
                        onClick={() => handleSelectRecent(item)}
                        className={[
                          'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition',
                          selectedIndex === adjustedIndex
                            ? 'bg-brand-red/10 text-slate-900 dark:text-slate-100'
                            : 'text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800',
                        ].join(' ')}
                      >
                        <Icon size={18} className="flex-shrink-0 text-slate-400" />
                        <p className="truncate text-sm font-medium">{item.title}</p>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex-shrink-0 border-t border-slate-200 px-4 py-2 dark:border-slate-700 hidden sm:block">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <div className="flex items-center gap-4">
              <span>
                <kbd className="rounded bg-slate-100 px-1.5 py-0.5 font-mono dark:bg-slate-800">↑↓</kbd> навигация
              </span>
              <span>
                <kbd className="rounded bg-slate-100 px-1.5 py-0.5 font-mono dark:bg-slate-800">Enter</kbd> выбрать
              </span>
              <span>
                <kbd className="rounded bg-slate-100 px-1.5 py-0.5 font-mono dark:bg-slate-800">Esc</kbd> закрыть
              </span>
            </div>
            <span>
              <kbd className="rounded bg-slate-100 px-1.5 py-0.5 font-mono dark:bg-slate-800">⌘K</kbd>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
