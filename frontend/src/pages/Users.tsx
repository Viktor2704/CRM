import { useEffect, useMemo, useState, type FormEvent, type MouseEvent } from 'react';
import { Download, Mail, Plus, Search, Trash2 } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import Modal from '@/components/Modal';
import PasswordInput from '@/components/PasswordInput';
import Breadcrumbs from '@/components/Breadcrumbs';
import ConfirmDialog from '@/components/ConfirmDialog';
import { SkeletonTable } from '@/components/Skeleton';
import { api, buildApiUrl, getAccessToken } from '@/api/client';
import { useToast } from '@/context/ToastContext';
import { UserRole, type User, type Direction } from '@/types';
import type { Tenant } from '@/types';
import { usePermissions } from '@/hooks/usePermissions';
import { useDebounce } from '@/hooks/useDebounce';

type UsersResponse = User[] | { items?: User[]; users?: User[]; data?: User[] };
type TenantsResponse = Tenant[] | { items?: Tenant[]; tenants?: Tenant[]; data?: Tenant[] };

type NewTenantForm = {
  name: string;
  brandName: string;
  inn: string;
  phone: string;
};

const INITIAL_NEW_TENANT: NewTenantForm = { name: '', brandName: '', inn: '', phone: '' };

type UserCreateForm = {
  fullName: string;
  email: string;
  role: string;
  counterpartyId: string;
  newTenant: NewTenantForm;
  directionIds: string[];
};

type UserEditForm = {
  fullName: string;
  email: string;
  role: string;
  status: string;
  password: string;
  counterpartyId: string;
  directionIds: string[];
};

const ROLE_LABELS: Record<string, string> = {
  admin: 'Администратор',
  manager: 'Менеджер',
  curator: 'Куратор',
  dispatcher: 'Диспетчер',
  executor: 'Исполнитель ТО',
  installer: 'Заказчик монтаж/проекты',
  client_manager: 'Менеджер клиента',
  client_user: 'Пользователь клиента',
  user: 'Базовый клиент',
};

const INTERNAL_GLOBAL_ROLES = new Set(['admin', 'manager', 'curator', 'dispatcher']);
const COUNTERPARTY_ROLES = new Set(['installer', 'client_manager', 'client_user', 'user']);
const DIRECTION_BINDING_ROLES = new Set(['curator', 'dispatcher', 'executor', 'installer']);
const CREATE_ROLE_OPTIONS = Object.entries(ROLE_LABELS).filter(([value]) => value !== UserRole.USER);

const STATUS_COLORS: Record<string, string> = {
  active: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  invited: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  blocked: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  deactivated: 'bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-300',
};

import { normalizeList } from '@/utils/normalize';


const INITIAL_CREATE_FORM: UserCreateForm = {
  fullName: '', email: '', role: UserRole.CLIENT_USER, counterpartyId: '', newTenant: INITIAL_NEW_TENANT, directionIds: [],
};

export default function UsersPage() {
  const toast = useToast();
  const { isAdminOrManager } = usePermissions();
  const canEditUsers = isAdminOrManager;
  const [searchParams, setSearchParams] = useSearchParams();
  const search = searchParams.get('search') || '';
  const debouncedSearch = useDebounce(search);
  const roleFilter = searchParams.get('role') || '';

  const [users, setUsers] = useState<User[]>([]);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [directions, setDirections] = useState<Direction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<User | null>(null);
  const [createForm, setCreateForm] = useState<UserCreateForm>(INITIAL_CREATE_FORM);
  const [editForm, setEditForm] = useState<UserEditForm>({
    fullName: '', email: '', role: UserRole.CLIENT_USER, status: 'active', password: '', counterpartyId: '', directionIds: [],
  });
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [sendingInvite, setSendingInvite] = useState<string | null>(null);

  const downloadCsv = async () => {
    setExporting(true);
    try {
      const token = getAccessToken();
      const res = await fetch(buildApiUrl('/users/export-xlsx'), {
        headers: { Authorization: `Bearer ${token ?? ''}` },
        credentials: 'include',
      });
      if (!res.ok) throw new Error('export failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'users.xlsx'; a.click();
      URL.revokeObjectURL(url);
    } catch { toast.error('Не удалось скачать Excel'); } finally { setExporting(false); }
  };

  const updateFilter = (key: string, value: string) => {
    const params = new URLSearchParams(searchParams);
    if (value.trim()) { params.set(key, value); } else { params.delete(key); }
    setSearchParams(params, { replace: true });
  };

  const loadUsers = async () => {
    setError('');
    const response = await api.getT<UsersResponse>('/users');
    setUsers(normalizeList(response));
  };

  const loadTenants = async () => {
    const r = await api.getT<TenantsResponse>('/tenants');
    setTenants(normalizeList(r));
  };

  const loadDirections = async () => {
    const r = await api.getT<Direction[] | { items?: Direction[]; data?: Direction[] }>('/directions');
    setDirections(normalizeList(r));
  };

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      loadUsers(),
      loadTenants().catch(() => {}),
      loadDirections().catch(() => {}),
    ])
      .catch(() => { if (!cancelled) { setError('Не удалось загрузить пользователей.'); toast.error('Не удалось загрузить пользователей.'); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [toast]);

  const filteredUsers = useMemo(() => {
    const term = debouncedSearch.trim().toLowerCase();
    return users.filter((user) => {
      if (roleFilter && user.role !== roleFilter) return false;
      if (!term) return true;
      return (
        String(user.fullName || '').toLowerCase().includes(term) ||
        String(user.email || '').toLowerCase().includes(term)
      );
    });
  }, [users, debouncedSearch, roleFilter]);

  const buildPayload = (form: { counterpartyId: string; role: string; directionIds?: string[] }, extra: Record<string, unknown>) => {
    const payload: Record<string, unknown> = { ...extra };
    const directionIds = DIRECTION_BINDING_ROLES.has(form.role) ? (form.directionIds ?? []) : [];
    if (COUNTERPARTY_ROLES.has(form.role)) {
      payload.bindings = { counterpartyId: form.counterpartyId || null, isGlobal: false, directionIds };
    } else {
      payload.bindings = { counterpartyId: null, isGlobal: INTERNAL_GLOBAL_ROLES.has(form.role), directionIds };
    }
    return payload;
  };

  const onCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      let counterpartyId = createForm.counterpartyId;
      if (createForm.role === 'installer') {
        const tenant = await api.postT<Tenant>('/tenants', {
          name: createForm.newTenant.name,
          brandName: createForm.newTenant.brandName || undefined,
          inn: createForm.newTenant.inn || undefined,
          type: 'tenant',
          contacts: (createForm.newTenant.phone || createForm.email) ? [{
            email: createForm.email || '',
            phone: createForm.newTenant.phone || '',
          }] : undefined,
        });
        counterpartyId = tenant.id;
        await loadTenants();
      }
      const payload = buildPayload({ ...createForm, counterpartyId }, {
        fullName: createForm.fullName,
        email: createForm.email,
        role: createForm.role,
        status: 'invited',
        mustChangePassword: true,
      });
      const user = await api.postT<User>('/users', payload);
      setCreateForm(INITIAL_CREATE_FORM);
      setIsCreateOpen(false);
      await loadUsers();
      try {
        await api.postT('/users/invitations', { userId: user.id });
        toast.success('Пользователь создан. Приглашение отправлено на почту.');
      } catch {
        toast.success('Пользователь создан. Не удалось отправить приглашение — отправьте вручную.');
      }
    } catch {
      setError('Не удалось создать пользователя.');
      toast.error('Не удалось создать пользователя.');
    } finally {
      setSaving(false);
    }
  };

  const onSendInvite = async (user: User) => {
    setSendingInvite(user.id);
    try {
      await api.postT('/users/invitations', { userId: user.id });
      toast.success(`Приглашение отправлено на ${user.email}`);
    } catch { toast.error('Не удалось отправить приглашение.'); } finally { setSendingInvite(null); }
  };

  const onRowClick = (user: User) => {
    setSelectedUser(user);
    setEditForm({
      fullName: user.fullName || '',
      email: user.email || '',
      role: user.role || UserRole.USER,
      status: user.status || 'active',
      password: '',
      counterpartyId: user.bindings?.counterpartyId ?? '',
      directionIds: user.bindings?.directionIds ?? [],
    });
    setIsEditOpen(true);
  };

  const onUpdate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedUser || !canEditUsers) return;
    setSaving(true);
    setError('');
    try {
      const payload = buildPayload(editForm, {
        fullName: editForm.fullName,
        email: editForm.email,
        role: editForm.role,
        status: editForm.status,
        ...(editForm.password.trim() ? { password: editForm.password.trim() } : {}),
      });
      await api.patchT(`/users/${selectedUser.id}`, payload);
      setIsEditOpen(false);
      setSelectedUser(null);
      await loadUsers();
      toast.success('Пользователь обновлён.');
    } catch {
      setError('Не удалось обновить пользователя.');
      toast.error('Не удалось обновить пользователя.');
    } finally {
      setSaving(false);
    }
  };

  const onDeleteClick = (event: MouseEvent, user: User) => {
    event.stopPropagation();
    setDeleteTarget(user);
  };

  const onConfirmDelete = async () => {
    if (!deleteTarget) return;
    setError('');
    try {
      await api.delT(`/users/${deleteTarget.id}`);
      await loadUsers();
      toast.success('Пользователь удалён.');
    } catch {
      setError('Не удалось удалить пользователя.');
      toast.error('Не удалось удалить пользователя.');
    } finally {
      setDeleteTarget(null);
    }
  };

  const counterpartyField = (
    role: string,
    value: string,
    onChange: (v: string) => void,
    newTenant?: NewTenantForm,
    onNewTenant?: (fn: (p: NewTenantForm) => NewTenantForm) => void,
    disabled = false,
  ) => {
    if (!COUNTERPARTY_ROLES.has(role)) return null;

    if (role === 'installer' && onNewTenant && newTenant) {
      return (
        <div className="space-y-3 rounded-lg border border-blue-200 bg-blue-50 p-3 dark:border-blue-900/40 dark:bg-blue-950/20">
          <p className="text-xs font-semibold text-blue-700 dark:text-blue-300">Новый заказчик (монтаж/проекты)</p>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">Юр. лицо заказчика *</label>
            <input required disabled={disabled} value={newTenant.name} onChange={(e) => onNewTenant((p) => ({ ...p, name: e.target.value }))}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 outline-none ring-brand-red transition focus:border-brand-red focus:ring-2 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100" />
          </div>
          <div className="grid grid-cols-1 gap-3 xs:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">Бренд</label>
              <input disabled={disabled} value={newTenant.brandName} onChange={(e) => onNewTenant((p) => ({ ...p, brandName: e.target.value }))}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 outline-none ring-brand-red transition focus:border-brand-red focus:ring-2 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100" />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">ИНН</label>
              <input disabled={disabled} value={newTenant.inn} onChange={(e) => onNewTenant((p) => ({ ...p, inn: e.target.value }))}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 outline-none ring-brand-red transition focus:border-brand-red focus:ring-2 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100" />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">Телефон</label>
            <input disabled={disabled} value={newTenant.phone} onChange={(e) => onNewTenant((p) => ({ ...p, phone: e.target.value }))}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 outline-none ring-brand-red transition focus:border-brand-red focus:ring-2 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100" />
          </div>
        </div>
      );
    }

    const filtered = tenants.filter((t) => t.type !== 'contractor');
    return (
      <div>
        <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
          {role === 'installer' ? 'Компания заказчика' : 'Клиентская компания'}
        </label>
        <select disabled={disabled} value={value} onChange={(e) => onChange(e.target.value)}
          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 outline-none ring-brand-red transition focus:border-brand-red focus:ring-2 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100">
          <option value="">— не выбран —</option>
          {filtered.map((t) => (
            <option key={t.id} value={t.id}>{t.name}{t.brandName && t.brandName !== t.name ? ` (${t.brandName})` : ''}</option>
          ))}
        </select>
      </div>
    );
  };

  const directionBindingsField = (
    role: string,
    selectedIds: string[],
    onChange: (ids: string[]) => void,
    disabled = false,
  ) => {
    if (!DIRECTION_BINDING_ROLES.has(role) || directions.length === 0) return null;
    const toggleDirection = (directionId: string) => {
      if (selectedIds.includes(directionId)) {
        onChange(selectedIds.filter((id) => id !== directionId));
      } else {
        onChange([...selectedIds, directionId]);
      }
    };
    return (
      <div>
        <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
          Направления (объекты ТО)
        </label>
        <div className="max-h-48 overflow-y-auto rounded-lg border border-slate-300 bg-white p-2 dark:border-slate-700 dark:bg-slate-800">
          {directions.map((d) => (
            <label key={d.id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm text-slate-700 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-700/50">
              <input
                type="checkbox"
                disabled={disabled}
                checked={selectedIds.includes(d.id)}
                onChange={() => toggleDirection(d.id)}
                className="h-4 w-4 rounded border-slate-300 text-red-600 focus:ring-red-500 dark:border-slate-600"
              />
              <span className="truncate">{d.name}</span>
              {d.address ? <span className="ml-auto shrink-0 text-xs text-slate-400">{d.address}</span> : null}
            </label>
          ))}
        </div>
        {selectedIds.length === 0 && (
          <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">Без привязки пользователь не увидит записи СППЗ</p>
        )}
      </div>
    );
  };

  const tenantName = (counterpartyId?: string | null) => {
    if (!counterpartyId) return null;
    const t = tenants.find((x) => x.id === counterpartyId);
    return t ? (t.brandName || t.name) : null;
  };

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ label: 'Панель', to: '/' }, { label: 'Пользователи' }]} />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100 sm:text-2xl">Пользователи</h2>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <button type="button" onClick={() => void downloadCsv()} disabled={exporting}
            className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 sm:w-auto">
            <Download size={16} />{exporting ? 'Скачиваю...' : 'Скачать Excel'}
          </button>
          {isAdminOrManager ? (
            <button type="button" onClick={() => setIsCreateOpen(true)}
              className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-700 sm:w-auto">
              <Plus size={16} />Создать
            </button>
          ) : null}
        </div>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative w-full">
          <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500" size={17} />
          <input value={search} onChange={(e) => updateFilter('search', e.target.value)} placeholder="Поиск по имени и email..."
            className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm text-slate-900 outline-none ring-brand-red transition focus:border-brand-red focus:ring-2 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100" />
        </div>
        <select value={roleFilter} onChange={(e) => updateFilter('role', e.target.value)}
          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none ring-brand-red transition focus:border-brand-red focus:ring-2 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 sm:w-auto">
          <option value="">Все роли</option>
          {Object.entries(ROLE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </div>

      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300">{error}</div>
      ) : null}

      {/* Mobile card layout */}
      <div className="space-y-3 md:hidden">
        {loading ? (
          Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-28 animate-pulse rounded-xl bg-slate-200 dark:bg-slate-800" />
          ))
        ) : filteredUsers.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-xl border border-slate-200 bg-white p-8 text-center dark:border-slate-800 dark:bg-slate-900">
            <Search size={32} className="text-slate-300 dark:text-slate-600" />
            <p className="text-sm text-slate-500 dark:text-slate-400">Ничего не найдено</p>
            <p className="text-xs text-slate-400 dark:text-slate-500">Попробуйте изменить фильтры</p>
          </div>
        ) : (
          filteredUsers.map((user) => (
            <button key={user.id} type="button" onClick={() => onRowClick(user)}
              className="w-full rounded-xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:border-slate-300 active:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-700 dark:active:bg-slate-800">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">{user.fullName || '-'}</p>
                  <p className="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400">{user.email || '-'}</p>
                </div>
                <span className={['shrink-0 inline-flex rounded-full px-2.5 py-1 text-xs font-semibold', STATUS_COLORS[user.status] || 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300'].join(' ')}>
                  {user.status || '-'}
                </span>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
                <span>{ROLE_LABELS[user.role] || user.role}</span>
                {tenantName(user.bindings?.counterpartyId) ? (
                  <span className="truncate">{tenantName(user.bindings?.counterpartyId)}</span>
                ) : null}
              </div>
              {isAdminOrManager ? (
                <div className="mt-3 flex items-center gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
                  {user.status === 'invited' ? (
                    <button type="button" onClick={(e) => { e.stopPropagation(); void onSendInvite(user); }} disabled={sendingInvite === user.id}
                      className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium text-blue-600 transition hover:bg-blue-50 disabled:opacity-60 dark:text-blue-400 dark:hover:bg-blue-950/40">
                      <Mail size={14} />{sendingInvite === user.id ? '...' : 'Пригласить'}
                    </button>
                  ) : null}
                  <button type="button" onClick={(e) => onDeleteClick(e, user)}
                    className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium text-red-600 transition hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40">
                    <Trash2 size={14} />Удалить
                  </button>
                </div>
              ) : null}
            </button>
          ))
        )}
      </div>

      {/* Desktop table layout */}
      <div className="hidden overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900 md:block">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-800">
                <th className="px-5 py-3 text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">ФИО</th>
                <th className="px-5 py-3 text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">Email</th>
                <th className="px-5 py-3 text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">Роль</th>
                <th className="px-5 py-3 text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">Контрагент</th>
                <th className="px-5 py-3 text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">Статус</th>
                <th className="px-5 py-3 text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">Действия</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {loading ? <SkeletonTable rows={5} cols={6} /> : (
                <>
                  {filteredUsers.map((user) => (
                    <tr key={user.id} className="cursor-pointer transition-colors hover:bg-slate-50 dark:hover:bg-slate-800" onClick={() => onRowClick(user)}>
                      <td className="px-5 py-3 text-sm font-medium text-slate-900 dark:text-slate-100">{user.fullName || '-'}</td>
                      <td className="px-5 py-3 text-sm text-slate-700 dark:text-slate-300">{user.email || '-'}</td>
                      <td className="px-5 py-3 text-sm text-slate-700 dark:text-slate-300">{ROLE_LABELS[user.role] || user.role}</td>
                      <td className="px-5 py-3 text-sm text-slate-700 dark:text-slate-300">
                        {tenantName(user.bindings?.counterpartyId) ?? <span className="text-slate-400">—</span>}
                      </td>
                      <td className="px-5 py-3 text-sm">
                        <span className={['inline-flex rounded-full px-2.5 py-1 text-xs font-semibold', STATUS_COLORS[user.status] || 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300'].join(' ')}>
                          {user.status || '-'}
                        </span>
                      </td>
                      <td className="px-5 py-3">
                        {isAdminOrManager ? (
                          <div className="flex items-center gap-1">
                            {user.status === 'invited' ? (
                              <button type="button" onClick={(e) => { e.stopPropagation(); void onSendInvite(user); }} disabled={sendingInvite === user.id}
                                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-slate-500 transition hover:bg-blue-50 hover:text-blue-600 disabled:opacity-60 dark:text-slate-400 dark:hover:bg-blue-950/40 dark:hover:text-blue-300">
                                <Mail size={14} />{sendingInvite === user.id ? '...' : 'Пригласить'}
                              </button>
                            ) : null}
                            <button type="button" onClick={(e) => onDeleteClick(e, user)}
                              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-slate-500 transition hover:bg-red-50 hover:text-red-600 dark:text-slate-400 dark:hover:bg-red-950/40 dark:hover:text-red-300">
                              <Trash2 size={14} />Удалить
                            </button>
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                  {filteredUsers.length === 0 ? (
                    <tr><td colSpan={6} className="px-5 py-12 text-center"><Search size={32} className="mx-auto mb-2 text-slate-300 dark:text-slate-600" /><p className="text-sm text-slate-500 dark:text-slate-400">Ничего не найдено</p><p className="text-xs text-slate-400 dark:text-slate-500">Попробуйте изменить фильтры</p></td></tr>
                  ) : null}
                </>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Modal isOpen={isCreateOpen} onClose={() => setIsCreateOpen(false)} title="Создание пользователя">
        <form onSubmit={onCreate} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">ФИО</label>
            <input required value={createForm.fullName} onChange={(e) => setCreateForm((p) => ({ ...p, fullName: e.target.value }))} placeholder="Иванов Иван Иванович"
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 outline-none ring-brand-red transition focus:border-brand-red focus:ring-2 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100" />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">Email</label>
            <input required type="email" value={createForm.email} onChange={(e) => setCreateForm((p) => ({ ...p, email: e.target.value }))} placeholder="user@example.com"
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 outline-none ring-brand-red transition focus:border-brand-red focus:ring-2 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100" />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">Роль</label>
            <select value={createForm.role} onChange={(e) => setCreateForm((p) => ({ ...p, role: e.target.value, counterpartyId: '' }))}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 outline-none ring-brand-red transition focus:border-brand-red focus:ring-2 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100">
              {CREATE_ROLE_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </div>
          {counterpartyField(createForm.role, createForm.counterpartyId, (v) => setCreateForm((p) => ({ ...p, counterpartyId: v })), createForm.newTenant, (fn) => setCreateForm((p) => ({ ...p, newTenant: fn(p.newTenant) })))}
          {directionBindingsField(createForm.role, createForm.directionIds, (ids) => setCreateForm((p) => ({ ...p, directionIds: ids })))}
          <p className="text-xs text-slate-500 dark:text-slate-400">После создания на почту пользователя будет отправлено приглашение.</p>
          <button type="submit" disabled={saving}
            className="inline-flex min-h-[44px] w-full items-center justify-center rounded-lg bg-red-600 px-4 py-2.5 font-semibold text-white transition hover:bg-red-700 disabled:opacity-60">
            {saving ? 'Сохранение...' : 'Создать'}
          </button>
        </form>
      </Modal>

      <Modal isOpen={isEditOpen} onClose={() => setIsEditOpen(false)} title={canEditUsers ? 'Редактирование пользователя' : 'Просмотр пользователя'}>
        <form onSubmit={onUpdate} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">ФИО</label>
            <input required disabled={!canEditUsers} value={editForm.fullName} onChange={(e) => setEditForm((p) => ({ ...p, fullName: e.target.value }))} placeholder="Иванов Иван Иванович"
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 outline-none ring-brand-red transition focus:border-brand-red focus:ring-2 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100" />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">Email</label>
            <input required disabled={!canEditUsers} type="email" value={editForm.email} onChange={(e) => setEditForm((p) => ({ ...p, email: e.target.value }))} placeholder="user@example.com"
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 outline-none ring-brand-red transition focus:border-brand-red focus:ring-2 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100" />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">Роль</label>
              <select disabled={!canEditUsers} value={editForm.role} onChange={(e) => setEditForm((p) => ({ ...p, role: e.target.value, counterpartyId: '' }))}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 outline-none ring-brand-red transition focus:border-brand-red focus:ring-2 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100">
                {Object.entries(ROLE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">Статус</label>
              <select disabled={!canEditUsers} value={editForm.status} onChange={(e) => setEditForm((p) => ({ ...p, status: e.target.value }))}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 outline-none ring-brand-red transition focus:border-brand-red focus:ring-2 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100">
                <option value="active">active</option>
                <option value="invited">invited</option>
                <option value="blocked">blocked</option>
                <option value="deactivated">deactivated</option>
              </select>
            </div>
          </div>
          {counterpartyField(editForm.role, editForm.counterpartyId, (v) => setEditForm((p) => ({ ...p, counterpartyId: v })), undefined, undefined, !canEditUsers)}
          {directionBindingsField(editForm.role, editForm.directionIds, (ids) => setEditForm((p) => ({ ...p, directionIds: ids })), !canEditUsers)}
          {canEditUsers ? (
            <>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">Новый пароль (опционально)</label>
                <PasswordInput value={editForm.password} onChange={(e) => setEditForm((p) => ({ ...p, password: e.target.value }))}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 pr-10 text-slate-900 outline-none ring-brand-red transition focus:border-brand-red focus:ring-2 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100" />
              </div>
              <button type="submit" disabled={saving}
                className="inline-flex min-h-[44px] w-full items-center justify-center rounded-lg bg-red-600 px-4 py-2.5 font-semibold text-white transition hover:bg-red-700 disabled:opacity-60">
                {saving ? 'Сохранение...' : 'Сохранить'}
              </button>
            </>
          ) : (
            <p className="text-xs text-slate-500 dark:text-slate-400">Для этой роли доступен только просмотр карточки пользователя.</p>
          )}
        </form>
      </Modal>

      <ConfirmDialog isOpen={Boolean(deleteTarget)} onCancel={() => setDeleteTarget(null)}
        onConfirm={() => void onConfirmDelete()} title="Удалить пользователя?" message="Это действие нельзя отменить."
        confirmLabel="Удалить" confirmColor="red" />
    </div>
  );
}
