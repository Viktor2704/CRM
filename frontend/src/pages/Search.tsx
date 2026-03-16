import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Search, Sparkles } from 'lucide-react';
import Breadcrumbs from '@/components/Breadcrumbs';
import { api } from '@/api/client';
import { useAuth } from '@/auth/AuthContext';

type AnyRecord = Record<string, unknown>;
type ListResponse<T> = T[] | { items?: T[]; data?: T[] };

type SearchGroup = {
  key: string;
  title: string;
  items: { id: string; title: string; subtitle?: string; href: string }[];
};

type AiExpandResponse = {
  expandedTerms?: string[];
  systemTypes?: string[];
  originalQuery?: string;
};

import { normalizeList } from '@/utils/normalize';

const readString = (record: AnyRecord, ...keys: string[]) => {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string') return value;
  }
  return '';
};

const includesTerm = (value: string, term: string) => value.toLowerCase().includes(term.toLowerCase());
const AI_FEATURE_ENABLED = String(import.meta.env.VITE_AI_ENABLED ?? 'true').toLowerCase() !== 'false';
const SEARCH_RESULT_LIMIT = 8;
const SEARCH_VARIANT_LIMIT = 4;
const SEARCH_SYSTEM_TYPE_LIMIT = 3;

const buildSearchTerms = (query: string, expandedTerms: string[]) => (
  Array.from(new Set([query, ...expandedTerms].map((value) => String(value || '').trim()).filter(Boolean))).slice(0, SEARCH_VARIANT_LIMIT)
);

const buildQueryString = (params: Record<string, string | number | undefined>) => {
  const searchParams = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return;
    searchParams.set(key, String(value));
  });
  return searchParams.toString();
};

const mergeRecordsById = (batches: AnyRecord[][]) => {
  const unique = new Map<string, AnyRecord>();
  batches.flat().forEach((item) => {
    const id = readString(item, 'id');
    if (!id || unique.has(id)) return;
    unique.set(id, item);
  });
  return Array.from(unique.values());
};

export default function SearchPage() {
  const { user } = useAuth();
  const role = user?.role || '';
  const canSearchTenants = ['admin', 'manager', 'curator', 'dispatcher'].includes(role);
  const canSearchUsers = ['admin', 'manager', 'curator', 'dispatcher'].includes(role);
  const canSearchDirections = ['admin', 'manager', 'curator', 'dispatcher', 'executor', 'installer', 'client_manager', 'client_user', 'user'].includes(role);
  const [searchParams, setSearchParams] = useSearchParams();
  const query = (searchParams.get('q') || '').trim();
  const [input, setInput] = useState(query);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [projects, setProjects] = useState<AnyRecord[]>([]);
  const [requests, setRequests] = useState<AnyRecord[]>([]);
  const [tenants, setTenants] = useState<AnyRecord[]>([]);
  const [directions, setDirections] = useState<AnyRecord[]>([]);
  const [users, setUsers] = useState<AnyRecord[]>([]);
  const [aiExpandedTerms, setAiExpandedTerms] = useState<string[]>([]);
  const [aiSystemTypes, setAiSystemTypes] = useState<string[]>([]);
  const searchPlaceholder = useMemo(() => {
    const parts = ['проектам', 'заявкам'];
    if (canSearchTenants) parts.push('контрагентам');
    if (canSearchDirections) parts.push('направлениям');
    if (canSearchUsers) parts.push('пользователям');
    return `Поиск по ${parts.join(', ')}...`;
  }, [canSearchDirections, canSearchTenants, canSearchUsers]);

  useEffect(() => {
    setInput(query);
  }, [query]);

  useEffect(() => {
    if (!query) {
      setProjects([]);
      setRequests([]);
      setTenants([]);
      setDirections([]);
      setUsers([]);
      setAiExpandedTerms([]);
      setAiSystemTypes([]);
      setError('');
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError('');

    const load = async () => {
      const aiResult = AI_FEATURE_ENABLED
        ? await api.postT<AiExpandResponse>('/ai/expand-search', { query }).catch(() => ({ expandedTerms: [], systemTypes: [] } satisfies AiExpandResponse))
        : { expandedTerms: [], systemTypes: [] };
      const expandedTerms = Array.isArray(aiResult?.expandedTerms)
        ? aiResult.expandedTerms.map((value) => String(value || '').trim()).filter(Boolean)
        : [];
      const systemTypes = Array.isArray(aiResult?.systemTypes)
        ? aiResult.systemTypes.map((value) => String(value || '').trim()).filter(Boolean)
        : [];

      if (cancelled) return;

      setAiExpandedTerms(Array.from(new Set(expandedTerms)).slice(0, 15));
      setAiSystemTypes(Array.from(new Set(systemTypes)).slice(0, 12));

      const terms = buildSearchTerms(query, expandedTerms);
      const systemTypeVariants = Array.from(new Set(systemTypes)).slice(0, SEARCH_SYSTEM_TYPE_LIMIT);
      const collectSettledLists = (results: PromiseSettledResult<ListResponse<AnyRecord>>[]) => ({
        items: mergeRecordsById(
          results
            .filter((result): result is PromiseFulfilledResult<ListResponse<AnyRecord>> => result.status === 'fulfilled')
            .map((result) => normalizeList<AnyRecord>(result.value))
        ),
        hasSuccess: results.some((result) => result.status === 'fulfilled'),
      });
      const fetchVariantLists = async (loadVariant: (term: string) => Promise<ListResponse<AnyRecord>>) => (
        terms.length > 0 ? collectSettledLists(await Promise.allSettled(terms.map((term) => loadVariant(term)))) : { items: [], hasSuccess: false }
      );
      const fetchSystemTypeLists = async (loadVariant: (systemType: string) => Promise<ListResponse<AnyRecord>>) => (
        systemTypeVariants.length > 0 ? collectSettledLists(await Promise.allSettled(systemTypeVariants.map((systemType) => loadVariant(systemType)))) : { items: [], hasSuccess: false }
      );

      const [projectSearchResult, projectSystemTypeResult, requestSearchResult, requestSystemTypeResult, tenantResult, directionResult, userResult] = await Promise.all([
        fetchVariantLists((term) => api.getT<ListResponse<AnyRecord>>(`/projects?${buildQueryString({ search: term, limit: SEARCH_RESULT_LIMIT })}`)),
        fetchSystemTypeLists((systemType) => api.getT<ListResponse<AnyRecord>>(`/projects?${buildQueryString({ system_type: systemType, limit: SEARCH_RESULT_LIMIT })}`)),
        fetchVariantLists((term) => api.getT<ListResponse<AnyRecord>>(`/service-requests?${buildQueryString({ search: term, limit: SEARCH_RESULT_LIMIT })}`)),
        fetchSystemTypeLists((systemType) => api.getT<ListResponse<AnyRecord>>(`/service-requests?${buildQueryString({ system_type: systemType, limit: SEARCH_RESULT_LIMIT })}`)),
        canSearchTenants
          ? fetchVariantLists((term) => api.getT<ListResponse<AnyRecord>>(`/tenants?${buildQueryString({ search: term, limit: SEARCH_RESULT_LIMIT })}`))
          : Promise.resolve({ items: [], hasSuccess: false }),
        canSearchDirections
          ? fetchVariantLists((term) => api.getT<ListResponse<AnyRecord>>(`/directions?${buildQueryString({ search: term, limit: SEARCH_RESULT_LIMIT })}`))
          : Promise.resolve({ items: [], hasSuccess: false }),
        canSearchUsers
          ? fetchVariantLists((term) => api.getT<ListResponse<AnyRecord>>(`/users?${buildQueryString({ q: term, pageSize: SEARCH_RESULT_LIMIT })}`))
          : Promise.resolve({ items: [], hasSuccess: false }),
      ]);

      if (cancelled) return;

      const nextProjects = mergeRecordsById([projectSearchResult.items, projectSystemTypeResult.items]);
      const nextRequests = mergeRecordsById([requestSearchResult.items, requestSystemTypeResult.items]);
      setProjects(nextProjects);
      setRequests(nextRequests);
      setTenants(tenantResult.items);
      setDirections(directionResult.items);
      setUsers(userResult.items);

      const anySuccessfulSearch =
        projectSearchResult.hasSuccess ||
        projectSystemTypeResult.hasSuccess ||
        requestSearchResult.hasSuccess ||
        requestSystemTypeResult.hasSuccess ||
        tenantResult.hasSuccess ||
        directionResult.hasSuccess ||
        userResult.hasSuccess;
      setError(anySuccessfulSearch ? '' : 'Не удалось выполнить глобальный поиск.');
    };

    void load().finally(() => {
      if (!cancelled) setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [canSearchDirections, canSearchTenants, canSearchUsers, query]);

  const groups = useMemo<SearchGroup[]>(() => {
    if (!query) return [];
    const terms = Array.from(
      new Set(
        [query, ...aiExpandedTerms]
          .map((value) => String(value || '').trim().toLowerCase())
          .filter((value) => value.length > 0)
      )
    );
    const systemTypeSet = new Set(aiSystemTypes.map((value) => String(value || '').trim().toLowerCase()).filter(Boolean));
    const matchesAny = (value: string) => terms.some((term) => includesTerm(value || '', term));

    const groupData: SearchGroup[] = [
      {
        key: 'projects',
        title: 'Проекты',
        items: projects
          .filter((item) => {
            const title = readString(item, 'title');
            const description = readString(item, 'description');
            const systemType = readString(item, 'systemType', 'system_type').toLowerCase();
            return matchesAny(title) || matchesAny(description) || (systemTypeSet.size > 0 && systemTypeSet.has(systemType));
          })
          .map((item) => ({
            id: readString(item, 'id'),
            title: readString(item, 'title') || 'Без названия',
            subtitle: readString(item, 'status'),
            href: `/projects?focus=${encodeURIComponent(readString(item, 'id'))}`,
          })),
      },
      {
        key: 'requests',
        title: 'Сервисные заявки',
        items: requests
          .filter((item) => {
            const title = readString(item, 'title');
            const description = readString(item, 'description');
            const systemType = readString(item, 'systemType', 'system_type').toLowerCase();
            return matchesAny(title) || matchesAny(description) || (systemTypeSet.size > 0 && systemTypeSet.has(systemType));
          })
          .map((item) => ({
            id: readString(item, 'id'),
            title: readString(item, 'title') || 'Без названия',
            subtitle: readString(item, 'status'),
            href: `/service-requests?focus=${encodeURIComponent(readString(item, 'id'))}`,
          })),
      },
      ...(canSearchTenants ? [{
        key: 'tenants',
        title: 'Контрагенты',
        items: tenants
          .filter((item) => matchesAny(readString(item, 'name', 'brandName', 'brand_name')) || matchesAny(readString(item, 'inn')))
          .map((item) => ({
            id: readString(item, 'id'),
            title: readString(item, 'brandName', 'brand_name', 'name') || 'Без названия',
            subtitle: readString(item, 'inn'),
            href: `/tenants?focus=${encodeURIComponent(readString(item, 'id'))}`,
          })),
      }] : []),
      ...(canSearchDirections ? [{
        key: 'directions',
        title: 'Направления',
        items: directions
          .filter((item) => matchesAny(readString(item, 'name')) || matchesAny(readString(item, 'address')))
          .map((item) => ({
            id: readString(item, 'id'),
            title: readString(item, 'name') || 'Без названия',
            subtitle: readString(item, 'address'),
            href: `/directions?focus=${encodeURIComponent(readString(item, 'id'))}`,
          })),
      }] : []),
      ...(canSearchUsers ? [{
        key: 'users',
        title: 'Пользователи',
        items: users
          .filter((item) => matchesAny(readString(item, 'fullName', 'full_name')) || matchesAny(readString(item, 'email')))
          .map((item) => ({
            id: readString(item, 'id'),
            title: readString(item, 'fullName', 'full_name') || readString(item, 'email') || 'Без имени',
            subtitle: readString(item, 'email'),
            href: `/users?focus=${encodeURIComponent(readString(item, 'id'))}`,
          })),
      }] : []),
    ];

    return groupData.filter((group) => group.items.length > 0);
  }, [aiExpandedTerms, aiSystemTypes, canSearchDirections, canSearchTenants, canSearchUsers, directions, projects, query, requests, tenants, users]);

  const totalResults = groups.reduce((sum, group) => sum + group.items.length, 0);

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = input.trim();
    const params = new URLSearchParams(searchParams);
    if (value) {
      params.set('q', value);
    } else {
      params.delete('q');
    }
    setSearchParams(params, { replace: true });
  };

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ label: 'Панель', to: '/' }, { label: 'Поиск' }]} />

      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <form onSubmit={onSubmit} className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
          <input
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder={searchPlaceholder}
            className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm text-slate-900 outline-none ring-brand-red transition focus:border-brand-red focus:ring-2 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
          />
        </form>
      </div>

      {AI_FEATURE_ENABLED && (aiExpandedTerms.length > 0 || aiSystemTypes.length > 0) ? (
        <div className="rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-700 shadow-sm dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
          <div className="flex flex-wrap items-center gap-2">
            <Sparkles size={14} className="text-brand-red" />
            <span className="font-semibold">AI расширил поиск:</span>
            {aiExpandedTerms.slice(0, 8).map((term) => (
              <span
                key={`term-${term}`}
                className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700 dark:bg-slate-800 dark:text-slate-300"
              >
                {term}
              </span>
            ))}
            {aiSystemTypes.map((code) => (
              <span
                key={`sys-${code}`}
                className="rounded-full bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-700 dark:bg-red-950/30 dark:text-red-300"
              >
                {code}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {loading ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-slate-200 bg-white p-10 dark:border-slate-800 dark:bg-slate-900">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-slate-300 border-t-brand-red" />
          <p className="text-sm text-slate-500 dark:text-slate-400">Поиск...</p>
        </div>
      ) : error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300">
          {error}
        </div>
      ) : !query ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-slate-200 bg-white p-10 dark:border-slate-800 dark:bg-slate-900">
          <Search size={36} className="text-slate-300 dark:text-slate-600" />
          <p className="text-sm text-slate-500 dark:text-slate-400">Введите запрос для поиска</p>
        </div>
      ) : totalResults === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-slate-200 bg-white p-10 dark:border-slate-800 dark:bg-slate-900">
          <Search size={36} className="text-slate-300 dark:text-slate-600" />
          <p className="text-sm text-slate-500 dark:text-slate-400">Ничего не найдено</p>
          <p className="text-xs text-slate-400 dark:text-slate-500">Попробуйте изменить запрос</p>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-slate-500 dark:text-slate-400">Найдено: {totalResults}</p>
          {groups.map((group) => (
            <section
              key={group.key}
              className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900"
            >
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{group.title}</h3>
              <div className="mt-3 space-y-2">
                {group.items.map((item) => (
                  <Link
                    key={`${group.key}-${item.id}`}
                    to={item.href}
                    className="block rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 transition hover:border-slate-300 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:hover:border-slate-600 dark:hover:bg-slate-700"
                  >
                    <p className="text-sm font-medium text-slate-900 dark:text-slate-100">{item.title}</p>
                    {item.subtitle ? (
                      <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{item.subtitle}</p>
                    ) : null}
                  </Link>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
