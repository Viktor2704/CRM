import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  ArrowLeft,
  CalendarClock,
  CheckCheck,
  AlertCircle,
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  Eye,
  FileDown,
  Filter,
  Flame,
  Building2,
  ChevronLeft,
  Lock,
  MailWarning,
  Pencil,
  Plus,
  Printer,
  QrCode,
  Search,
  ShieldCheck,
  FilePen,
  Trash2,
  X,
} from 'lucide-react';
import { buildApiUrl, getAccessToken } from '@/api/client';
import { Link } from 'react-router-dom';
import { ApiError, api } from '@/api/client';
import { useAuth } from '@/auth/AuthContext';
import { normalizeList } from '@/utils/normalize';
import SppzCheckCalendar from '@/components/SppzCheckCalendar';
import SppzExtinguishersTab from '@/components/SppzExtinguishersTab';
import { UserRole, type Direction, type MaintenanceItem, type Tenant } from '@/types';

const TENANT_DIRECTORY_ROLES = new Set<string>([
  UserRole.ADMIN,
  UserRole.MANAGER,
  UserRole.CURATOR,
  UserRole.DISPATCHER,
]);

type JournalSection = 'aps' | 'soue' | 'aupt' | 'vpv' | 'fire_extinguishers' | 'custom';
type JournalRecordType =
  | 'maintenance'
  | 'repair'
  | 'testing'
  | 'functional_control'
  | 'shutdown'
  | 'fault'
  | 'false_trigger'
  | 'trigger'
  | 'other';
type SignatureMode = 'kep' | 'contract';
type EntryStatus = 'draft' | 'executor_signed' | 'fully_signed';
type LicenseCheckStatus = 'active' | 'suspended' | 'expired' | 'unknown';

type LicenseCheckSnapshot = {
  checkId: string;
  checkedAt: string;
  source: string;
  status: LicenseCheckStatus;
  message: string;
  licenseNumber?: string;
  contractorInn?: string;
  contractorName?: string;
};

type JournalAuditRow = {
  id: string;
  entryId: string;
  action: string;
  actorId: string;
  actorRole: string;
  payload: Record<string, unknown>;
  createdAt: string;
};

type JournalEntry = {
  id: string;
  eventDateTime: string;
  entryTimestamp: string;
  directionId?: string;
  maintenanceItemId?: string;
  contractorId?: string;
  objectKey?: string;
  objectName: string;
  address: string;
  section: JournalSection;
  sections?: JournalSection[];
  zone: string;
  recordType: JournalRecordType;
  description: string;
  contractor: string;
  contractorInn?: string;
  executorOrganization: string;
  executorName: string;
  contractNumber: string;
  licenseNumber: string;
  licenseStatus: 'active' | 'suspended' | 'expired';
  licenseCheckSnapshot?: LicenseCheckSnapshot;
  signatureMode: SignatureMode;
  allowUnepByContract?: boolean;
  mchdId: string;
  attachments: string[];
  status: EntryStatus;
  correctionOfId?: string;
  executorSignedAt?: string;
  executorSignedById?: string;
  customerSignedAt?: string;
  customerSignedById?: string;
  customerSignerFio?: string;
  customerSignerOrderNumber?: string;
  customerSignedVia?: string;
};

type EntryFormState = {
  eventDateTime: string;
  directionId: string;
  objectKey: string;
  sections: JournalSection[];
  zone: string;
  recordType: JournalRecordType;
  description: string;
  contractorId: string;
  executorName: string;
  contractNumber: string;
  licenseNumber: string;
  licenseStatus: JournalEntry['licenseStatus'];
  allowUnepByContract: boolean;
  signatureMode: SignatureMode;
  mchdId: string;
  attachmentsInput: string;
  licenseCheckSnapshot?: LicenseCheckSnapshot;
};

type FilterState = {
  query: string;
  section: JournalSection | 'all';
  status: EntryStatus | 'all';
  contractorId: string;
  directionId: string;
};

type DirectionItemsResponse = MaintenanceItem[] | { items?: MaintenanceItem[]; data?: MaintenanceItem[] };

type DirectionObjectNode = {
  key: string;
  directionId: string;
  maintenanceItemId?: string;
  name: string;
  address: string;
  contractNumber?: string;
  tenantId?: string;
  source: 'item' | 'legacy' | 'direction';
};

const SECTION_LABELS: Record<JournalSection, string> = {
  aps: 'СПС',
  soue: 'СОУЭ',
  aupt: 'АУПТ',
  vpv: 'ВПВ',
  fire_extinguishers: 'Огнетушители',
  custom: 'Прочее',
};

const RECORD_TYPE_LABELS: Record<JournalRecordType, string> = {
  maintenance: 'ТО',
  repair: 'Ремонт',
  testing: 'Испытания',
  functional_control: 'Контроль функционирования',
  shutdown: 'Отключение',
  fault: 'Неисправность',
  false_trigger: 'Ложное срабатывание',
  trigger: 'Срабатывание',
  other: 'Прочее',
};

const SIGNATURE_MODE_LABELS: Record<SignatureMode, string> = {
  kep: 'УКЭП',
  contract: 'ЭП по договору',
};

const STATUS_LABELS: Record<EntryStatus, string> = {
  draft: 'Черновик',
  executor_signed: 'Подписано исполнителем',
  fully_signed: 'Подписано обеими сторонами',
};

const STATUS_BADGE_CLASS: Record<EntryStatus, string> = {
  draft: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200',
  executor_signed: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  fully_signed: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
};

const MONTH_LABELS = [
  'Январь',
  'Февраль',
  'Март',
  'Апрель',
  'Май',
  'Июнь',
  'Июль',
  'Август',
  'Сентябрь',
  'Октябрь',
  'Ноябрь',
  'Декабрь',
];

const DEFAULT_EXECUTOR_ORGANIZATION = 'ООО Новинжстрой';
const DESCRIPTION_MIN_LENGTH = 50;

const SECTION_SIGNATURE_RULES: Record<JournalSection, { defaultMode: SignatureMode; note: string }> = {
  aps: {
    defaultMode: 'contract',
    note: 'Для СПС тип ЭП определяется договором.',
  },
  soue: {
    defaultMode: 'contract',
    note: 'Для СОУЭ тип ЭП определяется договором.',
  },
  aupt: {
    defaultMode: 'contract',
    note: 'Для АУПТ требуется двустороннее подписание.',
  },
  vpv: {
    defaultMode: 'contract',
    note: 'Для ВПВ запись должна быть заверена ЭП.',
  },
  fire_extinguishers: {
    defaultMode: 'kep',
    note: 'Для огнетушителей по умолчанию применяется УКЭП (УНЭП только по договору).',
  },
  custom: {
    defaultMode: 'contract',
    note: 'Для пользовательского раздела режим ЭП определяется локальным регламентом.',
  },
};

const STAFF_ROLES = new Set<UserRole>([
  UserRole.ADMIN,
  UserRole.MANAGER,
  UserRole.CURATOR,
  UserRole.DISPATCHER,
  UserRole.EXECUTOR,
  UserRole.INSTALLER,
]);
const EXECUTOR_SIGN_ROLES = new Set<UserRole>([
  UserRole.ADMIN,
  UserRole.MANAGER,
  UserRole.CURATOR,
  UserRole.DISPATCHER,
  UserRole.EXECUTOR,
  UserRole.INSTALLER,
]);
const CUSTOMER_SIGN_ROLES = new Set<UserRole>([UserRole.ADMIN, UserRole.MANAGER, UserRole.CURATOR]);

const toInputDateTime = (date: Date) => {
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return localDate.toISOString().slice(0, 16);
};

const nowInputDateTime = () => toInputDateTime(new Date());

const formatDateTime = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'n/a';
  return date.toLocaleString('ru-RU');
};

const formatMonthYear = (year: number, monthIndex: number) => `${MONTH_LABELS[monthIndex]} ${year}`;

const monthKeyFromParts = (year: number, monthIndex: number) => `${year}-${String(monthIndex + 1).padStart(2, '0')}`;

const toMonthKey = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return monthKeyFromParts(date.getFullYear(), date.getMonth());
};

const buildMonthDateTime = (year: number, monthIndex: number) => toInputDateTime(new Date(year, monthIndex, 1, 10, 0, 0));
const getEntrySections = (entry: JournalEntry): JournalSection[] =>
  entry.sections && entry.sections.length > 0 ? entry.sections : [entry.section];
const getDefaultSignatureModeBySections = (sections: JournalSection[]): SignatureMode =>
  sections.includes('fire_extinguishers') ? 'kep' : 'contract';
const getExecutorOrganization = (entry: JournalEntry) =>
  entry.executorOrganization || DEFAULT_EXECUTOR_ORGANIZATION;
const toFileToken = (value: string) => {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9а-яё]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return normalized || 'object';
};

const createId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const entryBelongsToDirection = (entry: JournalEntry, direction: Direction) =>
  entry.directionId === direction.id || entry.objectName === direction.name;

const INITIAL_FORM_STATE: EntryFormState = {
  eventDateTime: nowInputDateTime(),
  directionId: '',
  objectKey: '',
  sections: ['aps'],
  zone: '',
  recordType: 'maintenance',
  description: '',
  contractorId: '',
  executorName: '',
  contractNumber: '',
  licenseNumber: '',
  licenseStatus: 'active',
  allowUnepByContract: false,
  signatureMode: SECTION_SIGNATURE_RULES.aps.defaultMode,
  mchdId: '',
  attachmentsInput: '',
  licenseCheckSnapshot: undefined,
};

const INITIAL_FILTERS: FilterState = {
  query: '',
  section: 'all',
  status: 'all',
  contractorId: '',
  directionId: '',
};

const INITIAL_ENTRIES: JournalEntry[] = [];

const toJournalSection = (value: unknown): JournalSection =>
  typeof value === 'string' && value in SECTION_LABELS ? (value as JournalSection) : 'custom';

const toJournalRecordType = (value: unknown): JournalRecordType =>
  typeof value === 'string' && value in RECORD_TYPE_LABELS ? (value as JournalRecordType) : 'other';

const toSignatureMode = (value: unknown): SignatureMode =>
  typeof value === 'string' && value in SIGNATURE_MODE_LABELS ? (value as SignatureMode) : 'contract';

const toEntryStatus = (value: unknown): EntryStatus =>
  value === 'executor_signed' || value === 'fully_signed' ? value : 'draft';

const toLicenseStatus = (value: unknown): JournalEntry['licenseStatus'] =>
  value === 'suspended' || value === 'expired' ? value : 'active';

const normalizeJournalEntryFromApi = (raw: unknown): JournalEntry | null => {
  if (!raw || typeof raw !== 'object') return null;
  const source = raw as Partial<JournalEntry> & Record<string, unknown>;

  const normalizedSections = Array.isArray(source.sections)
    ? source.sections.map((item) => toJournalSection(item)).filter(Boolean)
    : [];
  const section = toJournalSection(source.section);
  const sections = normalizedSections.length > 0 ? normalizedSections : [section];

  const id = String(source.id || '').trim();
  if (!id) return null;

  return {
    id,
    eventDateTime: String(source.eventDateTime || ''),
    entryTimestamp: String(source.entryTimestamp || ''),
    directionId: source.directionId ? String(source.directionId) : undefined,
    maintenanceItemId: source.maintenanceItemId ? String(source.maintenanceItemId) : undefined,
    contractorId: source.contractorId ? String(source.contractorId) : undefined,
    objectKey: source.objectKey ? String(source.objectKey) : undefined,
    objectName: String(source.objectName || ''),
    address: String(source.address || ''),
    section,
    sections,
    zone: String(source.zone || ''),
    recordType: toJournalRecordType(source.recordType),
    description: String(source.description || ''),
    contractor: String(source.contractor || ''),
    contractorInn: source.contractorInn ? String(source.contractorInn) : '',
    executorOrganization: String(source.executorOrganization || DEFAULT_EXECUTOR_ORGANIZATION),
    executorName: String(source.executorName || ''),
    contractNumber: String(source.contractNumber || ''),
    licenseNumber: String(source.licenseNumber || ''),
    licenseStatus: toLicenseStatus(source.licenseStatus),
    licenseCheckSnapshot:
      source.licenseCheckSnapshot && typeof source.licenseCheckSnapshot === 'object'
        ? {
            checkId: String((source.licenseCheckSnapshot as Record<string, unknown>).checkId || ''),
            checkedAt: String((source.licenseCheckSnapshot as Record<string, unknown>).checkedAt || ''),
            source: String((source.licenseCheckSnapshot as Record<string, unknown>).source || ''),
            status: ['active', 'suspended', 'expired', 'unknown'].includes(
              String((source.licenseCheckSnapshot as Record<string, unknown>).status || ''),
            )
              ? (String((source.licenseCheckSnapshot as Record<string, unknown>).status) as LicenseCheckStatus)
              : 'unknown',
            message: String((source.licenseCheckSnapshot as Record<string, unknown>).message || ''),
            licenseNumber: String((source.licenseCheckSnapshot as Record<string, unknown>).licenseNumber || ''),
            contractorInn: String((source.licenseCheckSnapshot as Record<string, unknown>).contractorInn || ''),
            contractorName: String((source.licenseCheckSnapshot as Record<string, unknown>).contractorName || ''),
          }
        : undefined,
    signatureMode: toSignatureMode(source.signatureMode),
    allowUnepByContract: source.allowUnepByContract === true,
    mchdId: String(source.mchdId || ''),
    attachments: Array.isArray(source.attachments)
      ? source.attachments
          .map((item) => (typeof item === 'string' ? item.trim() : ''))
          .filter(Boolean)
      : [],
    status: toEntryStatus(source.status),
    correctionOfId: source.correctionOfId ? String(source.correctionOfId) : undefined,
    executorSignedAt: source.executorSignedAt ? String(source.executorSignedAt) : undefined,
    executorSignedById: source.executorSignedById ? String(source.executorSignedById) : undefined,
    customerSignedAt: source.customerSignedAt ? String(source.customerSignedAt) : undefined,
    customerSignedById: source.customerSignedById ? String(source.customerSignedById) : undefined,
    customerSignerFio: source.customerSignerFio ? String(source.customerSignerFio) : undefined,
    customerSignerOrderNumber: source.customerSignerOrderNumber
      ? String(source.customerSignerOrderNumber)
      : undefined,
    customerSignedVia: source.customerSignedVia ? String(source.customerSignedVia) : undefined,
  };
};

function downloadFile(filename: string, data: string, mimeType: string) {
  const blob = new Blob([data], { type: mimeType });
  const href = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = href;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(href);
}

export default function SppzJournalIsolatedPage() {
  const { user } = useAuth();
  const canOpenTenantDirectory = TENANT_DIRECTORY_ROLES.has(user?.role ?? '');

  const [entries, setEntries] = useState<JournalEntry[]>(INITIAL_ENTRIES);
  const [selectedId, setSelectedId] = useState<string>('');
  const [filters, setFilters] = useState<FilterState>(INITIAL_FILTERS);
  const [form, setForm] = useState<EntryFormState>(INITIAL_FORM_STATE);
  const [formError, setFormError] = useState('');
  const [entriesLoading, setEntriesLoading] = useState(true);
  const [entriesError, setEntriesError] = useState('');
  const [entryMutationInFlight, setEntryMutationInFlight] = useState(false);
  const [actionMessage, setActionMessage] = useState('');
  const [licenseCheckInFlight, setLicenseCheckInFlight] = useState(false);
  const [auditByEntryId, setAuditByEntryId] = useState<Record<string, JournalAuditRow[]>>({});
  const [auditLoading, setAuditLoading] = useState(false);
  const [inspectorModalOpen, setInspectorModalOpen] = useState(false);
  const [inspectorLink, setInspectorLink] = useState('');
  const [inspectorLoading, setInspectorLoading] = useState(false);
  const [inspectorError, setInspectorError] = useState('');
  const [inspectorPeriodFrom, setInspectorPeriodFrom] = useState('');
  const [inspectorPeriodTo, setInspectorPeriodTo] = useState('');
  const [inspectorExpiresHours, setInspectorExpiresHours] = useState(48);
  const [inspectorCopied, setInspectorCopied] = useState(false);
  const [groupedCreation, setGroupedCreation] = useState(false);
  const [pageTab, setPageTab] = useState<'journal' | 'extinguishers' | 'protected_objects'>('journal');

  // Pagination state
  const [paginationPage, setPaginationPage] = useState(1);
  const [paginationTotal, setPaginationTotal] = useState(0);
  const [paginationTotalPages, setPaginationTotalPages] = useState(1);
  const ENTRIES_PER_PAGE = 50;

  // Protected Objects state
  type ProtectedObject = {
    id: string; directionId: string; orgName: string; orgInn: string; orgOgrn: string;
    legalAddress: string; physicalAddress: string; directorName: string;
    fireResponsibleName: string; fireResponsibleOrderNumber: string; fireResponsibleOrderDate: string | null;
    fireClass: string; contactPhone: string; contactEmail: string;
    createdBy: string | null; createdAt: string; updatedAt: string;
  };
  type FireSystem = {
    id: string; objectId: string; typeCode: string; model: string;
    commissioningDate: string | null; contractorId: string | null;
    contractorLicense: string; contractorLicenseValidTo: string | null;
    checkPeriodDays: number | null; nextCheckDate: string | null;
    status: string; createdAt: string; updatedAt: string;
  };
  const FIRE_SYSTEM_TYPE_LABELS: Record<string, string> = {
    aps: 'АПС (пожарная сигнализация)',
    aupt: 'АУПТ (пожаротушение)',
    soue: 'СОУЭ (оповещение и эвакуация)',
    pdv: 'ПДВ (противодымная вентиляция)',
    vpv: 'ВПВ (внутренний противопож. водопровод)',
    npv: 'НПВ (наружный противопож. водопровод)',
    ogn: 'Огнезащита',
    ext: 'Огнетушители',
    pl: 'Пожарные лестницы',
    door: 'Противопожарные двери/ворота',
    sizod: 'СИЗОД',
  };
  const FIRE_CLASS_LABELS: Record<string, string> = {
    f1: 'Ф1 - проживание и врем. пребывание',
    f2: 'Ф2 - зрелищные и культурные',
    f3: 'Ф3 - обслуживание населения',
    f4: 'Ф4 - учебные и научные',
    f5: 'Ф5 - производственные и складские',
  };
  const [protectedObjects, setProtectedObjects] = useState<ProtectedObject[]>([]);
  const [protectedObjectsLoading, setProtectedObjectsLoading] = useState(false);
  const [protectedObjectsError, setProtectedObjectsError] = useState('');
  const [selectedProtectedObjectId, setSelectedProtectedObjectId] = useState('');
  const [protObjFormOpen, setProtObjFormOpen] = useState(false);
  const [protObjEditId, setProtObjEditId] = useState('');
  const [protectedObjectForm, setProtectedObjectForm] = useState({
    directionId: '', orgName: '', orgInn: '', orgOgrn: '', legalAddress: '', physicalAddress: '',
    directorName: '', fireResponsibleName: '', fireResponsibleOrderNumber: '', fireResponsibleOrderDate: '',
    fireClass: '', contactPhone: '', contactEmail: '',
  });
  const [protectedObjectFormError, setProtectedObjectFormError] = useState('');
  const [protectedObjectMutating, setProtectedObjectMutating] = useState(false);
  const [fireSystemsByObjectId, setFireSystemsByObjectId] = useState<Record<string, FireSystem[]>>({});
  const [sysFormOpen, setSysFormOpen] = useState(false);
  const [sysEditId, setSysEditId] = useState('');
  const [fireSystemForm, setFireSystemForm] = useState({
    typeCode: '', model: '', commissioningDate: '', contractorLicense: '',
    contractorLicenseValidTo: '', checkPeriodDays: '', nextCheckDate: '', status: 'active',
  });
  const [fireSystemFormError, setFireSystemFormError] = useState('');

  const [directions, setDirections] = useState<Direction[]>([]);
  const [contractors, setContractors] = useState<Tenant[]>([]);
  const [directionItemsById, setDirectionItemsById] = useState<Record<string, MaintenanceItem[]>>({});
  const [referenceLoading, setReferenceLoading] = useState(true);
  const [referenceError, setReferenceError] = useState('');
  const [objectSearch, setObjectSearch] = useState('');
  const [expandedDirectionId, setExpandedDirectionId] = useState<string | null>(null);
  const [expandedObjectRef, setExpandedObjectRef] = useState<string | null>(null);
  const [plannerYear, setPlannerYear] = useState(() => new Date().getFullYear());
  const [showOnlyWithGaps, setShowOnlyWithGaps] = useState(false);

  const buildFallbackContractors = (items: Direction[]) => {
    const map = new Map<string, Tenant>();
    items.forEach((direction) => {
      const tenantId = String(direction.tenantId || '').trim();
      if (!tenantId || map.has(tenantId)) return;
      const tenantName = String(direction.tenantName || '').trim() || `Контрагент ${tenantId}`;
      map.set(tenantId, {
        id: tenantId,
        name: tenantName,
        brandName: tenantName,
        type: 'contractor',
      });
    });
    return Array.from(map.values());
  };

  useEffect(() => {
    let cancelled = false;

    const loadReferenceData = async () => {
      setReferenceLoading(true);
      setReferenceError('');

      try {
        const [directionsRaw, tenantsRaw] = await Promise.all([
          api.getT<unknown>('/directions'),
          canOpenTenantDirectory
            ? api.getT<unknown>('/tenants').catch(() => ({ items: [] as Tenant[] }))
            : Promise.resolve({ items: [] as Tenant[] }),
        ]);

        if (cancelled) return;

        let loadedDirections = normalizeList<Direction>(directionsRaw);
        const userRole = user?.role ?? '';
        const isAdminOrManager = userRole === UserRole.ADMIN || userRole === UserRole.MANAGER;
        if (!isAdminOrManager && user?.bindings?.directionIds && user.bindings.directionIds.length > 0) {
          const allowedIds = new Set(user.bindings.directionIds);
          loadedDirections = loadedDirections.filter((d) => allowedIds.has(d.id));
        } else if (!isAdminOrManager && (!user?.bindings?.directionIds || user.bindings.directionIds.length === 0)) {
          loadedDirections = [];
        }
        const loadedTenants = normalizeList<Tenant>(tenantsRaw);
        const loadedContractors = loadedTenants.filter((tenant) => tenant.type === 'contractor');
        const fallbackContractors = buildFallbackContractors(loadedDirections);

        setDirections(loadedDirections);
        setContractors(
          loadedContractors.length > 0
            ? loadedContractors
            : loadedTenants.length > 0
              ? loadedTenants
              : fallbackContractors,
        );
      } catch {
        if (!cancelled) {
          setReferenceError('Не удалось загрузить объекты и контрагентов.');
        }
      } finally {
        if (!cancelled) {
          setReferenceLoading(false);
        }
      }
    };

    void loadReferenceData();

    return () => {
      cancelled = true;
    };
  }, [canOpenTenantDirectory]);

  useEffect(() => {
    if (directions.length === 0) return;
    setForm((prev) => {
      if (prev.directionId) return prev;
      return { ...prev, directionId: directions[0].id, objectKey: `direction:${directions[0].id}` };
    });
  }, [directions]);

  useEffect(() => {
    if (contractors.length === 0) return;
    setForm((prev) => {
      if (prev.contractorId) return prev;
      const directionId = prev.directionId || directions[0]?.id || '';
      if (directionId) {
        const linkedByDirection = directions.find((direction) => direction.id === directionId)?.tenantId;
        if (linkedByDirection) {
          const matched = contractors.find((contractor) => contractor.id === linkedByDirection);
          if (matched) return { ...prev, contractorId: matched.id };
        }
      }
      return { ...prev, contractorId: contractors[0].id };
    });
  }, [contractors, directions]);

  useEffect(() => {
    let cancelled = false;

    const loadEntries = async () => {
      setEntriesLoading(true);
      setEntriesError('');

      try {
        const raw = await api.getT<unknown>('/sppz-journal/entries');
        if (cancelled) return;

        const loadedEntries = normalizeList<unknown>(raw)
          .map((entry) => normalizeJournalEntryFromApi(entry))
          .filter((entry): entry is JournalEntry => Boolean(entry));

        setEntries(loadedEntries);
        setSelectedId((prev) => {
          if (prev && loadedEntries.some((entry) => entry.id === prev)) return prev;
          return loadedEntries[0]?.id ?? '';
        });
      } catch {
        if (!cancelled) {
          setEntries([]);
          setEntriesError('Не удалось загрузить записи журнала из БД.');
        }
      } finally {
        if (!cancelled) {
          setEntriesLoading(false);
        }
      }
    };

    void loadEntries();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (directions.length === 0) return;
    setEntries((prev) => {
      let changed = false;
      const next = prev.map((entry) => {
        if (entry.directionId) return entry;
        const direction = directions.find((item) => item.name === entry.objectName);
        if (!direction) return entry;
        changed = true;
        return {
          ...entry,
          directionId: direction.id,
          address: direction.address || entry.address,
          objectName: direction.name || entry.objectName,
        };
      });
      return changed ? next : prev;
    });
  }, [directions]);

  useEffect(() => {
    if (directions.length === 0) {
      setDirectionItemsById({});
      return;
    }

    let cancelled = false;

    const loadDirectionItems = async () => {
      const pairs = await Promise.all(
        directions.map(async (direction) => {
          try {
            const raw = await api.getMaintenanceItem<DirectionItemsResponse>(`/directions/${direction.id}/items`);
            return [direction.id, normalizeList<MaintenanceItem>(raw)] as [string, MaintenanceItem[]];
          } catch {
            return [direction.id, [] as MaintenanceItem[]] as [string, MaintenanceItem[]];
          }
        }),
      );

      if (cancelled) return;
      const next: Record<string, MaintenanceItem[]> = {};
      pairs.forEach(([directionId, items]) => {
        next[directionId] = items;
      });
      setDirectionItemsById(next);
    };

    void loadDirectionItems();

    return () => {
      cancelled = true;
    };
  }, [directions]);

  useEffect(() => {
    if (entries.length === 0) return;
    setContractors((prev) => {
      const next = new Map<string, Tenant>();
      prev.forEach((contractor) => {
        next.set(contractor.id, contractor);
      });
      let changed = false;
      entries.forEach((entry) => {
        const contractorId = String(entry.contractorId || '').trim();
        const contractorName = String(entry.contractor || '').trim();
        if (!contractorId || !contractorName || next.has(contractorId)) return;
        next.set(contractorId, {
          id: contractorId,
          name: contractorName,
          brandName: contractorName,
          type: 'contractor',
        });
        changed = true;
      });
      return changed ? Array.from(next.values()) : prev;
    });
  }, [entries]);

  const directionById = useMemo(() => {
    const map = new Map<string, Direction>();
    directions.forEach((direction) => map.set(direction.id, direction));
    return map;
  }, [directions]);

  const directionIdByName = useMemo(() => {
    const map = new Map<string, string>();
    directions.forEach((direction) => map.set(direction.name, direction.id));
    return map;
  }, [directions]);

  const contractorById = useMemo(() => {
    const map = new Map<string, Tenant>();
    contractors.forEach((contractor) => map.set(contractor.id, contractor));
    return map;
  }, [contractors]);

  const entriesByDirection = useMemo(() => {
    const map = new Map<string, JournalEntry[]>();
    directions.forEach((direction) => map.set(direction.id, []));

    entries.forEach((entry) => {
      const resolvedDirectionId = entry.directionId || directionIdByName.get(entry.objectName);
      if (!resolvedDirectionId) return;
      const objectEntries = map.get(resolvedDirectionId);
      if (!objectEntries) return;
      objectEntries.push(entry);
    });

    map.forEach((objectEntries) => {
      objectEntries.sort((left, right) => {
        const leftTime = new Date(left.eventDateTime).getTime();
        const rightTime = new Date(right.eventDateTime).getTime();
        if (Number.isNaN(leftTime) && Number.isNaN(rightTime)) return 0;
        if (Number.isNaN(leftTime)) return 1;
        if (Number.isNaN(rightTime)) return -1;
        return rightTime - leftTime;
      });
    });

    return map;
  }, [directions, entries, directionIdByName]);

  const directionObjectsById = useMemo(() => {
    const map = new Map<string, DirectionObjectNode[]>();

    directions.forEach((direction) => {
      const directionItems = directionItemsById[direction.id] || [];
      const objectEntries = entriesByDirection.get(direction.id) || [];

      const objects: DirectionObjectNode[] = directionItems.map((item) => ({
        key: `item:${item.id}`,
        directionId: direction.id,
        maintenanceItemId: item.id,
        name: item.name || `Объект ${item.positionNumber || item.id}`,
        address: item.address || direction.address || '',
        contractNumber: item.contractNumber || '',
        tenantId: item.tenantId || direction.tenantId,
        source: 'item',
      }));

      const objectKeys = new Set(objects.map((object) => object.key));
      const objectNameSet = new Set(objects.map((object) => object.name.trim().toLowerCase()).filter(Boolean));
      let needDirectionObject = objects.length === 0;
      const directionNameNormalized = direction.name.trim().toLowerCase();

      objectEntries.forEach((entry) => {
        if (entry.maintenanceItemId) {
          const objectKey = `item:${entry.maintenanceItemId}`;
          if (!objectKeys.has(objectKey)) {
            objects.push({
              key: objectKey,
              directionId: direction.id,
              maintenanceItemId: entry.maintenanceItemId,
              name: entry.objectName || `Объект ${entry.maintenanceItemId}`,
              address: entry.address || direction.address || '',
              contractNumber: entry.contractNumber || '',
              source: 'item',
            });
            objectKeys.add(objectKey);
            objectNameSet.add((entry.objectName || '').trim().toLowerCase());
          }
          return;
        }

        const objectName = (entry.objectName || '').trim();
        if (!objectName) return;

        const normalizedName = objectName.toLowerCase();
        if (normalizedName === directionNameNormalized) {
          needDirectionObject = true;
          return;
        }

        if (objectNameSet.has(normalizedName)) return;

        const objectKey = `legacy:${normalizedName}`;
        if (!objectKeys.has(objectKey)) {
          objects.push({
            key: objectKey,
            directionId: direction.id,
            name: objectName,
            address: entry.address || direction.address || '',
            contractNumber: entry.contractNumber || '',
            source: 'legacy',
          });
          objectKeys.add(objectKey);
          objectNameSet.add(normalizedName);
        }
      });

      if (needDirectionObject) {
        const directionObjectKey = `direction:${direction.id}`;
        if (!objectKeys.has(directionObjectKey)) {
          objects.unshift({
            key: directionObjectKey,
            directionId: direction.id,
            name: direction.name || direction.id,
            address: direction.address || '',
            contractNumber: '',
            tenantId: direction.tenantId,
            source: 'direction',
          });
        }
      }

      objects.sort((left, right) => left.name.localeCompare(right.name, 'ru'));
      map.set(direction.id, objects);
    });

    return map;
  }, [directions, directionItemsById, entriesByDirection]);

  useEffect(() => {
    if (!form.directionId) return;
    const objects = directionObjectsById.get(form.directionId) || [];
    if (objects.length === 0) return;

    setForm((prev) => {
      if (!prev.directionId) return prev;
      if (prev.directionId !== form.directionId) return prev;
      if (prev.objectKey && objects.some((object) => object.key === prev.objectKey)) return prev;
      return { ...prev, objectKey: objects[0].key };
    });
  }, [form.directionId, directionObjectsById]);

  const resolveEntryObjectKey = (entry: JournalEntry, directionId: string, objects: DirectionObjectNode[]) => {
    if (entry.maintenanceItemId) {
      return `item:${entry.maintenanceItemId}`;
    }

    const objectName = (entry.objectName || '').trim().toLowerCase();
    const direction = directionById.get(directionId);
    const directionName = (direction?.name || '').trim().toLowerCase();

    if (!objectName || objectName === directionName) {
      return `direction:${directionId}`;
    }

    const matchedItem = objects.find(
      (object) => object.maintenanceItemId && object.name.trim().toLowerCase() === objectName,
    );
    if (matchedItem) return matchedItem.key;

    return `legacy:${objectName}`;
  };

  const entryObjectMetaById = useMemo(() => {
    const map = new Map<string, { directionId: string; objectKey: string }>();

    entries.forEach((entry) => {
      const directionId = entry.directionId || directionIdByName.get(entry.objectName);
      if (!directionId) return;
      const objects = directionObjectsById.get(directionId) || [];
      const objectKey = resolveEntryObjectKey(entry, directionId, objects);
      map.set(entry.id, { directionId, objectKey });
    });

    return map;
  }, [entries, directionIdByName, directionObjectsById]);

  const entriesByDirectionObject = useMemo(() => {
    const map = new Map<string, JournalEntry[]>();

    entries.forEach((entry) => {
      const meta = entryObjectMetaById.get(entry.id);
      if (!meta) return;
      const key = `${meta.directionId}|${meta.objectKey}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key)?.push(entry);
    });

    map.forEach((objectEntries) => {
      objectEntries.sort((left, right) => {
        const leftTime = new Date(left.eventDateTime).getTime();
        const rightTime = new Date(right.eventDateTime).getTime();
        if (Number.isNaN(leftTime) && Number.isNaN(rightTime)) return 0;
        if (Number.isNaN(leftTime)) return 1;
        if (Number.isNaN(rightTime)) return -1;
        return rightTime - leftTime;
      });
    });

    return map;
  }, [entries, entryObjectMetaById]);

  const entriesByDirectionObjectMonth = useMemo(() => {
    const map = new Map<string, JournalEntry>();

    entries.forEach((entry) => {
      const meta = entryObjectMetaById.get(entry.id);
      const monthKey = toMonthKey(entry.eventDateTime);
      if (!meta || !monthKey) return;

      const composedKey = `${meta.directionId}|${meta.objectKey}|${monthKey}`;
      const current = map.get(composedKey);
      if (!current) {
        map.set(composedKey, entry);
        return;
      }

      const currentTime = new Date(current.eventDateTime).getTime();
      const nextTime = new Date(entry.eventDateTime).getTime();
      if (Number.isNaN(nextTime)) return;
      if (Number.isNaN(currentTime) || nextTime > currentTime) {
        map.set(composedKey, entry);
      }
    });

    return map;
  }, [entries, entryObjectMetaById]);

  const filteredEntries = useMemo(() => {
    const query = filters.query.trim().toLowerCase();

    return entries.filter((entry) => {
      if (filters.section !== 'all' && !getEntrySections(entry).includes(filters.section)) return false;
      if (filters.status !== 'all' && entry.status !== filters.status) return false;

      if (filters.directionId) {
        const filteredDirection = directionById.get(filters.directionId);
        const sameDirection = filteredDirection ? entryBelongsToDirection(entry, filteredDirection) : false;
        const legacyMatch = filteredDirection ? entry.objectName === filteredDirection.name : false;
        if (!sameDirection && !legacyMatch) return false;
      }

      if (filters.contractorId) {
        const filteredContractor = contractorById.get(filters.contractorId);
        const sameContractor = entry.contractorId === filters.contractorId;
        const legacyMatch = filteredContractor ? entry.contractor === filteredContractor.name : false;
        if (!sameContractor && !legacyMatch) return false;
      }

      if (!query) return true;
      return [
        entry.objectName,
        entry.address,
        entry.zone,
        entry.contractor,
        entry.executorName,
        entry.contractNumber,
        entry.description,
      ].some((field) => field.toLowerCase().includes(query));
    });
  }, [entries, filters, directionById, contractorById]);

  const selectedEntry = useMemo(
    () => filteredEntries.find((entry) => entry.id === selectedId) ?? filteredEntries[0] ?? null,
    [filteredEntries, selectedId],
  );
  const currentRole = (user?.role as UserRole) || UserRole.USER;
  const canSignAsExecutorByRole = EXECUTOR_SIGN_ROLES.has(currentRole);
  const canSignAsCustomerByRole = CUSTOMER_SIGN_ROLES.has(currentRole);
  const canSignExecutorAction = Boolean(
    selectedEntry && selectedEntry.status === 'draft' && canSignAsExecutorByRole && !entryMutationInFlight,
  );
  const canSignCustomerAction = Boolean(
    selectedEntry && selectedEntry.status === 'executor_signed' && canSignAsCustomerByRole && !entryMutationInFlight,
  );
  const canResendCustomerSignLinkAction = Boolean(
    selectedEntry && selectedEntry.status === 'executor_signed' && !entryMutationInFlight,
  );
  const canCreateCorrectionAction = Boolean(selectedEntry && selectedEntry.status === 'fully_signed' && !entryMutationInFlight);

  useEffect(() => {
    if (filteredEntries.length === 0) return;
    if (filteredEntries.some((entry) => entry.id === selectedId)) return;
    setSelectedId(filteredEntries[0].id);
  }, [filteredEntries, selectedId]);
  useEffect(() => {
    const profileName = (user?.fullName || '').trim();
    if (!profileName) return;
    setForm((prev) => (prev.executorName.trim() ? prev : { ...prev, executorName: profileName }));
  }, [user?.fullName]);
  useEffect(() => {
    setActionMessage('');
  }, [selectedId]);

  useEffect(() => {
    if (!selectedEntry?.id) return;
    if (auditByEntryId[selectedEntry.id]) return;

    let cancelled = false;
    const loadAudit = async () => {
      setAuditLoading(true);
      try {
        const raw = await api.getT<unknown>(`/sppz-journal/audit?entryId=${encodeURIComponent(selectedEntry.id)}&limit=100`);
        if (cancelled) return;
        const items = normalizeList<unknown>(raw)
          .map((row) => {
            if (!row || typeof row !== 'object') return null;
            const source = row as Record<string, unknown>;
            return {
              id: String(source.id || ''),
              entryId: String(source.entryId || ''),
              action: String(source.action || ''),
              actorId: String(source.actorId || ''),
              actorRole: String(source.actorRole || ''),
              payload:
                source.payload && typeof source.payload === 'object'
                  ? (source.payload as Record<string, unknown>)
                  : {},
              createdAt: String(source.createdAt || ''),
            } satisfies JournalAuditRow;
          })
          .filter((row): row is JournalAuditRow => Boolean(row));

        setAuditByEntryId((prev) => ({ ...prev, [selectedEntry.id]: items }));
      } catch {
        if (!cancelled) {
          setAuditByEntryId((prev) => ({ ...prev, [selectedEntry.id]: [] }));
        }
      } finally {
        if (!cancelled) {
          setAuditLoading(false);
        }
      }
    };

    void loadAudit();
    return () => {
      cancelled = true;
    };
  }, [selectedEntry?.id, auditByEntryId]);

  const pendingCustomerSign = useMemo(
    () => entries.filter((entry) => entry.status === 'executor_signed').length,
    [entries],
  );
  const draftCount = useMemo(() => entries.filter((entry) => entry.status === 'draft').length, [entries]);
  const lockedCount = useMemo(() => entries.filter((entry) => entry.status === 'fully_signed').length, [entries]);

  const selectedSectionRules = form.sections.map((section) => SECTION_SIGNATURE_RULES[section]);

  const directionJournalStats = useMemo(() => {
    const query = objectSearch.trim().toLowerCase();
    const now = new Date();
    const currentMonthIndex = now.getMonth();
    const selectedYear = plannerYear;

    return directions
      .map((direction) => {
        const objects = directionObjectsById.get(direction.id) || [];

        const objectStats = objects
          .map((object) => {
            const objectRef = `${direction.id}|${object.key}`;
            const objectEntries = entriesByDirectionObject.get(objectRef) || [];
            const lastEntry = objectEntries[0] || null;
            const lastEntryTime = lastEntry ? new Date(lastEntry.eventDateTime).getTime() : 0;
            const filledMonthsInPlannerYear = MONTH_LABELS.reduce((count, _monthLabel, monthIndex) => {
              const hasEntry = entriesByDirectionObjectMonth.has(
                `${direction.id}|${object.key}|${monthKeyFromParts(selectedYear, monthIndex)}`,
              );
              return hasEntry ? count + 1 : count;
            }, 0);
            const nextMissingMonthIndex = MONTH_LABELS.findIndex(
              (_monthLabel, monthIndex) =>
                !entriesByDirectionObjectMonth.has(`${direction.id}|${object.key}|${monthKeyFromParts(selectedYear, monthIndex)}`),
            );
            const hasCurrentMonthEntry = entriesByDirectionObjectMonth.has(
              `${direction.id}|${object.key}|${monthKeyFromParts(selectedYear, currentMonthIndex)}`,
            );

            return {
              ...object,
              objectRef,
              total: objectEntries.length,
              drafts: objectEntries.filter((entry) => entry.status === 'draft').length,
              pending: objectEntries.filter((entry) => entry.status === 'executor_signed').length,
              locked: objectEntries.filter((entry) => entry.status === 'fully_signed').length,
              lastEntryDateTime: lastEntry?.eventDateTime || '',
              lastEntryTime: Number.isNaN(lastEntryTime) ? 0 : lastEntryTime,
              filledMonthsInPlannerYear,
              nextMissingMonthIndex,
              hasCurrentMonthEntry,
            };
          })
          .sort((left, right) => {
            if (right.lastEntryTime !== left.lastEntryTime) {
              return right.lastEntryTime - left.lastEntryTime;
            }
            return left.name.localeCompare(right.name, 'ru');
          });

        const filteredObjectStats = showOnlyWithGaps
          ? objectStats.filter((object) => object.filledMonthsInPlannerYear < 12)
          : objectStats;

        const directionTotals = objectStats.reduce(
          (acc, object) => {
            acc.total += object.total;
            acc.drafts += object.drafts;
            acc.pending += object.pending;
            acc.locked += object.locked;
            acc.lastEntryTime = Math.max(acc.lastEntryTime, object.lastEntryTime);
            return acc;
          },
          { total: 0, drafts: 0, pending: 0, locked: 0, lastEntryTime: 0 },
        );
        const directionLastEntry = objectStats.find((object) => object.lastEntryDateTime);

        return {
          directionId: direction.id,
          name: direction.name || direction.id,
          address: direction.address || '',
          total: directionTotals.total,
          drafts: directionTotals.drafts,
          pending: directionTotals.pending,
          locked: directionTotals.locked,
          lastEntryDateTime: directionLastEntry?.lastEntryDateTime || '',
          lastEntryTime: directionTotals.lastEntryTime,
          objectStats: filteredObjectStats,
        };
      })
      .filter((stat) => {
        if (stat.objectStats.length === 0) return false;
        if (!query) return true;
        const directionMatch = [stat.name, stat.address].some((value) => value.toLowerCase().includes(query));
        if (directionMatch) return true;
        return stat.objectStats.some((object) =>
          [object.name, object.address].some((value) => value.toLowerCase().includes(query)),
        );
      })
      .sort((left, right) => {
        if (right.lastEntryTime !== left.lastEntryTime) {
          return right.lastEntryTime - left.lastEntryTime;
        }
        return left.name.localeCompare(right.name, 'ru');
      });
  }, [directions, directionObjectsById, entriesByDirectionObject, entriesByDirectionObjectMonth, objectSearch, plannerYear, showOnlyWithGaps]);

  const groupedEntries = useMemo(() => {
    const groups = new Map<
      string,
      {
        key: string;
        name: string;
        address: string;
        items: JournalEntry[];
      }
    >();

    filteredEntries.forEach((entry) => {
      const direction = entry.directionId ? directionById.get(entry.directionId) : null;
      const groupKey = entry.maintenanceItemId
        ? `${entry.directionId || 'legacy'}|item:${entry.maintenanceItemId}`
        : `${entry.directionId || 'legacy'}|name:${(entry.objectName || 'объект').toLowerCase()}`;
      const groupName = entry.objectName || direction?.name || 'Объект не указан';
      const groupAddress = entry.address || direction?.address || '';

      if (!groups.has(groupKey)) {
        groups.set(groupKey, {
          key: groupKey,
          name: groupName,
          address: groupAddress,
          items: [],
        });
      }

      groups.get(groupKey)?.items.push(entry);
    });

    return Array.from(groups.values()).sort((left, right) => left.name.localeCompare(right.name, 'ru'));
  }, [filteredEntries, directionById]);

  const selectedDirection = directionById.get(form.directionId);
  const selectedContractor = contractorById.get(form.contractorId);
  const selectedPlannerYear = plannerYear;

  const getDirectionObjects = (directionId: string) => directionObjectsById.get(directionId) || [];
  const getDirectionObject = (directionId: string, objectKey: string) =>
    getDirectionObjects(directionId).find((object) => object.key === objectKey) || null;
  const getDefaultObjectKey = (directionId: string) => {
    const firstObject = getDirectionObjects(directionId)[0];
    if (firstObject) return firstObject.key;
    return directionId ? `direction:${directionId}` : '';
  };
  const selectedDirectionObject =
    getDirectionObject(form.directionId, form.objectKey || getDefaultObjectKey(form.directionId)) || null;

  const getAutoContractorIdForDirection = (
    directionId: string,
    currentContractorId?: string,
    preferredTenantId?: string,
  ) => {
    if (!directionId) {
      if (currentContractorId && contractorById.has(currentContractorId)) return currentContractorId;
      return contractors[0]?.id || '';
    }

    if (preferredTenantId && contractorById.has(preferredTenantId)) {
      return preferredTenantId;
    }

    const direction = directionById.get(directionId);

    // Primary binding from object card to counterparty (if this id exists in available contractors list).
    if (direction?.tenantId && contractorById.has(direction.tenantId)) {
      return direction.tenantId;
    }

    // Fallback to the latest contractor used for this object in existing journal entries.
    const objectEntries = entriesByDirection.get(directionId) || [];
    const byContractorId = objectEntries.find((entry) => entry.contractorId && contractorById.has(entry.contractorId));
    if (byContractorId?.contractorId) return byContractorId.contractorId;

    const byContractorName = objectEntries.find((entry) =>
      contractors.some((contractor) => contractor.name.toLowerCase() === entry.contractor.toLowerCase()),
    );
    if (byContractorName) {
      const matched = contractors.find(
        (contractor) => contractor.name.toLowerCase() === byContractorName.contractor.toLowerCase(),
      );
      if (matched) return matched.id;
    }

    if (currentContractorId && contractorById.has(currentContractorId)) return currentContractorId;
    return contractors[0]?.id || '';
  };

  const applyDirectionContext = (directionId: string) => {
    setFilters((prev) => ({ ...prev, directionId }));
    if (directionId) {
      const objectKey = getDefaultObjectKey(directionId);
      const selectedObject = getDirectionObject(directionId, objectKey);
      setForm((prev) => ({
        ...prev,
        directionId,
        objectKey,
        contractNumber: selectedObject?.contractNumber || '',
        contractorId: getAutoContractorIdForDirection(directionId, prev.contractorId, selectedObject?.tenantId),
      }));
    }
  };

  const handleFormDirectionChange = (directionId: string) => {
    const objectKey = getDefaultObjectKey(directionId);
    const selectedObject = getDirectionObject(directionId, objectKey);
    setForm((prev) => ({
      ...prev,
      directionId,
      objectKey,
      contractNumber: selectedObject?.contractNumber || '',
      contractorId: getAutoContractorIdForDirection(directionId, prev.contractorId, selectedObject?.tenantId),
    }));
  };

  const handleFormObjectChange = (objectKey: string) => {
    setForm((prev) => {
      const selectedObject = getDirectionObject(prev.directionId, objectKey);
      return {
        ...prev,
        objectKey,
        contractNumber: selectedObject?.contractNumber || '',
        contractorId: getAutoContractorIdForDirection(prev.directionId, prev.contractorId, selectedObject?.tenantId),
      };
    });
  };

  const getDirectionObjectMonthEntry = (directionId: string, objectKey: string, year: number, monthIndex: number) =>
    entriesByDirectionObjectMonth.get(`${directionId}|${objectKey}|${monthKeyFromParts(year, monthIndex)}`) || null;

  const handleDirectionCardClick = (directionId: string) => {
    const nextExpanded = expandedDirectionId === directionId ? null : directionId;
    applyDirectionContext(directionId);
    setExpandedDirectionId(nextExpanded);
    if (!nextExpanded) {
      setExpandedObjectRef(null);
    }
  };

  const handleObjectCardClick = (directionId: string, objectRef: string) => {
    applyDirectionContext(directionId);
    const objectKey = objectRef.split('|').slice(1).join('|');
    if (objectKey) {
      const selectedObject = getDirectionObject(directionId, objectKey);
      setForm((prev) => ({
        ...prev,
        directionId,
        objectKey,
        contractNumber: selectedObject?.contractNumber || '',
        contractorId: getAutoContractorIdForDirection(directionId, prev.contractorId, selectedObject?.tenantId),
      }));
    }
    setExpandedDirectionId(directionId);
    setExpandedObjectRef((prev) => (prev === objectRef ? null : objectRef));
  };

  const handleObjectMonthCreateClick = (
    directionId: string,
    objectKey: string,
    monthIndex: number,
    objectName: string,
    objectTenantId?: string,
  ) => {
    const direction = directionById.get(directionId);
    if (!direction) return;
    const autoContractorId = getAutoContractorIdForDirection(directionId, form.contractorId, objectTenantId);

    const monthEntry = getDirectionObjectMonthEntry(directionId, objectKey, selectedPlannerYear, monthIndex);
    applyDirectionContext(directionId);

    if (monthEntry) {
      setSelectedId(monthEntry.id);
      setFormError(
        `По объекту "${objectName || direction.name}" уже есть запись за ${formatMonthYear(selectedPlannerYear, monthIndex)}. Разрешена одна запись в месяц.`,
      );
      return;
    }

    setForm((prev) => ({
      ...prev,
      directionId,
      objectKey,
      contractNumber: getDirectionObject(directionId, objectKey)?.contractNumber || '',
      contractorId: autoContractorId,
      eventDateTime: buildMonthDateTime(selectedPlannerYear, monthIndex),
    }));
    setFormError('');

    document.getElementById('sppz-entry-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const updateForm = <K extends keyof EntryFormState>(key: K, value: EntryFormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const handleSectionToggle = (section: JournalSection) => {
    setForm((prev) => {
      const hasSection = prev.sections.includes(section);
      const nextSections = hasSection ? prev.sections.filter((item) => item !== section) : [...prev.sections, section];
      const normalizedSections = nextSections.length > 0 ? nextSections : prev.sections;
      const hasFireExtinguishers = normalizedSections.includes('fire_extinguishers');
      return {
        ...prev,
        sections: normalizedSections,
        signatureMode: getDefaultSignatureModeBySections(normalizedSections),
        allowUnepByContract: hasFireExtinguishers ? prev.allowUnepByContract : false,
      };
    });
  };

  const checkContractorLicense = async () => {
    const contractor = contractorById.get(form.contractorId);
    const licenseNumber = form.licenseNumber.trim();
    const contractorInn = (contractor?.inn || '').trim();
    const contractorName = (contractor?.name || '').trim();

    if (!licenseNumber && !contractorInn) {
      setActionMessage('Для проверки лицензии укажите номер лицензии или ИНН контрагента.');
      return;
    }

    setLicenseCheckInFlight(true);
    setActionMessage('');
    try {
      const resultRaw = await api.postT<unknown>('/sppz-journal/license-check', {
        licenseNumber,
        contractorInn,
        contractorName,
      });
      const source = resultRaw && typeof resultRaw === 'object' ? (resultRaw as Record<string, unknown>) : {};
      const snapshot: LicenseCheckSnapshot = {
        checkId: String(source.checkId || ''),
        checkedAt: String(source.checkedAt || new Date().toISOString()),
        source: String(source.source || 'manual'),
        status: ['active', 'suspended', 'expired', 'unknown'].includes(String(source.status || ''))
          ? (String(source.status) as LicenseCheckStatus)
          : 'unknown',
        message: String(source.message || ''),
        licenseNumber: String(source.licenseNumber || licenseNumber),
        contractorInn: String(source.contractorInn || contractorInn),
        contractorName: String(source.contractorName || contractorName),
      };

      setForm((prev) => ({
        ...prev,
        licenseCheckSnapshot: snapshot,
        licenseStatus:
          snapshot.status === 'active' || snapshot.status === 'suspended' || snapshot.status === 'expired'
            ? snapshot.status
            : prev.licenseStatus,
      }));

      setActionMessage(
        snapshot.status === 'unknown'
          ? `Проверка выполнена: ${snapshot.message || 'статус не определен автоматически.'}`
          : `Проверка выполнена: статус лицензии "${snapshot.status}".`,
      );
    } catch (error) {
      if (error instanceof ApiError) {
        setActionMessage(error.message || 'Не удалось проверить лицензию.');
      } else {
        setActionMessage('Не удалось проверить лицензию.');
      }
    } finally {
      setLicenseCheckInFlight(false);
    }
  };

  const resetForm = () => {
    const defaultDirectionId = directions[0]?.id || form.directionId;
    const defaultObjectKey = getDefaultObjectKey(defaultDirectionId);
    const defaultObject = getDirectionObject(defaultDirectionId, defaultObjectKey);
    const autoContractorId = getAutoContractorIdForDirection(defaultDirectionId, form.contractorId, defaultObject?.tenantId);

    setForm((prev) => ({
      ...INITIAL_FORM_STATE,
      eventDateTime: nowInputDateTime(),
      directionId: defaultDirectionId,
      objectKey: defaultObjectKey,
      contractNumber: defaultObject?.contractNumber || '',
      contractorId: autoContractorId || contractors[0]?.id || prev.contractorId,
      signatureMode: getDefaultSignatureModeBySections(INITIAL_FORM_STATE.sections),
      executorName: (user?.fullName || '').trim(),
    }));
    setFormError('');
  };

  const createInspectorAccess = async () => {
    if (!form.directionId) {
      setInspectorError('Выберите направление для предоставления доступа.');
      return;
    }
    setInspectorLoading(true);
    setInspectorError('');
    setInspectorLink('');
    setInspectorCopied(false);
    try {
      const result = await api.postT<{ inspectUrl?: string }>('/sppz-journal/inspector-access', {
        directionId: form.directionId,
        periodFrom: inspectorPeriodFrom || undefined,
        periodTo: inspectorPeriodTo || undefined,
        expiresInHours: inspectorExpiresHours,
      });
      const url = (result as any)?.inspectUrl || '';
      if (!url) throw new Error('No URL returned');
      setInspectorLink(url);
    } catch (error) {
      if (error instanceof ApiError) {
        setInspectorError(error.message || 'Не удалось создать ссылку.');
      } else {
        setInspectorError('Не удалось создать ссылку для проверки.');
      }
    } finally {
      setInspectorLoading(false);
    }
  };

  const copyInspectorLink = async () => {
    if (!inspectorLink) return;
    try {
      await navigator.clipboard.writeText(inspectorLink);
      setInspectorCopied(true);
      setTimeout(() => setInspectorCopied(false), 2000);
    } catch {
      setInspectorError('Не удалось скопировать ссылку.');
    }
  };

  const handleCreateEntry = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError('');
    setActionMessage('');

    const direction = directionById.get(form.directionId);
    const contractor = contractorById.get(form.contractorId);

    if (!direction || !contractor) {
      setFormError('Выберите объект и контрагента из справочников.');
      return;
    }

    if (form.sections.length === 0 || !form.recordType || !form.description.trim() || !form.executorName.trim()) {
      setFormError('Заполните обязательные поля: раздел, тип записи, исполнитель (ФИО) и описание.');
      return;
    }
    if (form.description.trim().length < DESCRIPTION_MIN_LENGTH) {
      setFormError('Укажите конкретно: какие узлы проверены, какие операции выполнены');
      return;
    }
    if (form.sections.includes('fire_extinguishers') && form.signatureMode !== 'kep' && !form.allowUnepByContract) {
      setFormError('Для раздела "Огнетушители" требуется УКЭП либо отметка "УНЭП разрешена по договору".');
      return;
    }

    const monthKey = toMonthKey(form.eventDateTime);
    if (!monthKey) {
      setFormError('Некорректная дата/время события.');
      return;
    }

    const selectedObject =
      getDirectionObject(direction.id, form.objectKey || getDefaultObjectKey(direction.id)) || null;
    const objectKey = selectedObject?.key || getDefaultObjectKey(direction.id);
    const objectName = selectedObject?.name || direction.name || direction.id;
    const objectAddress = selectedObject?.address || direction.address || '';

    const duplicateEntry = entriesByDirectionObjectMonth.get(`${direction.id}|${objectKey}|${monthKey}`);
    if (duplicateEntry) {
      const eventDate = new Date(form.eventDateTime);
      setSelectedId(duplicateEntry.id);
      setFormError(
        `По объекту "${objectName}" уже есть запись за ${formatMonthYear(eventDate.getFullYear(), eventDate.getMonth())}. Разрешена одна запись в месяц.`,
      );
      return;
    }

    const newEntry: JournalEntry = {
      id: createId(),
      eventDateTime: form.eventDateTime,
      entryTimestamp: new Date().toISOString(),
      directionId: direction.id,
      maintenanceItemId: selectedObject?.maintenanceItemId,
      contractorId: contractor.id,
      objectKey,
      objectName,
      address: objectAddress,
      section: form.sections[0],
      sections: form.sections,
      zone: form.zone.trim(),
      recordType: form.recordType,
      description: form.description.trim(),
      contractor: contractor.name || contractor.id,
      contractorInn: contractor.inn || '',
      executorOrganization: DEFAULT_EXECUTOR_ORGANIZATION,
      executorName: form.executorName.trim(),
      contractNumber: form.contractNumber.trim() || 'Не указан',
      licenseNumber: form.licenseNumber.trim() || 'Не указана',
      licenseStatus: form.licenseStatus,
      licenseCheckSnapshot: form.licenseCheckSnapshot,
      signatureMode: form.signatureMode,
      allowUnepByContract: form.allowUnepByContract,
      mchdId: form.mchdId.trim() || 'Не указана',
      attachments: form.attachmentsInput
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean),
      status: 'draft',
    };

    setEntryMutationInFlight(true);
    try {
      const requestBody = groupedCreation && form.sections.length > 1
        ? { ...newEntry, groupedSections: form.sections }
        : newEntry;
      const createdRaw = await api.postT<unknown>('/sppz-journal/entries', requestBody);
      const createdItems = Array.isArray(createdRaw) ? createdRaw : [createdRaw];
      const createdEntries = createdItems
        .map((item) => normalizeJournalEntryFromApi(item))
        .filter((entry): entry is JournalEntry => Boolean(entry));
      if (createdEntries.length === 0) {
        throw new Error('Invalid entry payload');
      }
      setEntries((prev) => [...createdEntries, ...prev]);
      setSelectedId(createdEntries[0].id);
      resetForm();
      setEntriesError('');
    } catch (error) {
      if (error instanceof ApiError) {
        setFormError(error.message || 'Не удалось сохранить запись в БД.');
      } else {
        setFormError('Не удалось сохранить запись в БД.');
      }
    } finally {
      setEntryMutationInFlight(false);
    }
  };

  const signAsExecutor = async (entryId: string) => {
    setActionMessage('');
    if (!canSignAsExecutorByRole) {
      setActionMessage('Недостаточно прав: подпись исполнителя доступна только штатным ролям исполнителя.');
      return;
    }
    const currentEntry = entries.find((entry) => entry.id === entryId);
    if (!currentEntry || currentEntry.status !== 'draft') {
      setActionMessage('Подпись исполнителя доступна только для записи в статусе "Черновик".');
      return;
    }

    setEntryMutationInFlight(true);
    try {
      const signedRaw = await api.postT<unknown>(`/sppz-journal/entries/${encodeURIComponent(entryId)}/sign-executor`);
      const signedEntry = normalizeJournalEntryFromApi(signedRaw);
      if (!signedEntry) {
        throw new Error('Invalid entry payload');
      }
      setEntries((prev) => prev.map((entry) => (entry.id === entryId ? signedEntry : entry)));
      setSelectedId(entryId);
      setEntriesError('');
      const dispatch =
        signedRaw && typeof signedRaw === 'object'
          ? (signedRaw as { customerSigningDispatch?: { status?: string; email?: string; pendingCount?: number } })
              .customerSigningDispatch
          : undefined;
      const status = dispatch?.status || '';
      if (status === 'sent') {
        setActionMessage(
          `Ссылка на подпись отправлена на ${dispatch?.email || 'email контрагента'}. Ожидают подпись: ${dispatch?.pendingCount ?? 0}.`,
        );
      } else if (status === 'missing_email') {
        setActionMessage('Подпись исполнителя сохранена, но у контрагента не заполнен email в карточке.');
      } else if (status === 'email_disabled') {
        setActionMessage('Подпись исполнителя сохранена, но SMTP не настроен: email-ссылка не отправлена.');
      } else if (status === 'missing_contractor' || status === 'contractor_not_found') {
        setActionMessage('Подпись исполнителя сохранена, но контрагент не привязан корректно.');
      } else if (status === 'send_failed') {
        setActionMessage('Подпись исполнителя сохранена, но отправка email завершилась ошибкой.');
      } else {
        setActionMessage('Запись подписана исполнителем.');
      }
    } catch (error) {
      if (error instanceof ApiError) {
        setActionMessage(error.message || 'Не удалось подписать запись исполнителем.');
      } else {
        setActionMessage('Не удалось подписать запись исполнителем.');
      }
    } finally {
      setEntryMutationInFlight(false);
    }
  };

  const signAsCustomer = async (entryId: string) => {
    setActionMessage('');
    if (!canSignAsCustomerByRole) {
      setActionMessage('Недостаточно прав: подпись заказчика доступна только уполномоченным ролям.');
      return;
    }
    const currentEntry = entries.find((entry) => entry.id === entryId);
    if (!currentEntry || currentEntry.status !== 'executor_signed') {
      setActionMessage('Подпись заказчика доступна только после подписи исполнителя.');
      return;
    }

    setEntryMutationInFlight(true);
    try {
      const signedRaw = await api.postT<unknown>(`/sppz-journal/entries/${encodeURIComponent(entryId)}/sign-customer`);
      const signedEntry = normalizeJournalEntryFromApi(signedRaw);
      if (!signedEntry) {
        throw new Error('Invalid entry payload');
      }
      setEntries((prev) => prev.map((entry) => (entry.id === entryId ? signedEntry : entry)));
      setSelectedId(entryId);
      setEntriesError('');
    } catch (error) {
      if (error instanceof ApiError) {
        setActionMessage(error.message || 'Не удалось подписать запись заказчиком.');
      } else {
        setActionMessage('Не удалось подписать запись заказчиком.');
      }
    } finally {
      setEntryMutationInFlight(false);
    }
  };

  const resendCustomerSignLink = async (entryId: string) => {
    setActionMessage('');
    const currentEntry = entries.find((entry) => entry.id === entryId);
    if (!currentEntry || currentEntry.status !== 'executor_signed') {
      setActionMessage('Повторная отправка доступна только для записей в статусе "Подписано исполнителем".');
      return;
    }

    setEntryMutationInFlight(true);
    try {
      const resendRaw = await api.postT<unknown>(
        `/sppz-journal/entries/${encodeURIComponent(entryId)}/resend-customer-sign-link`,
      );
      const updatedEntry = normalizeJournalEntryFromApi(resendRaw);
      if (updatedEntry) {
        setEntries((prev) => prev.map((entry) => (entry.id === entryId ? updatedEntry : entry)));
      }

      const dispatch =
        resendRaw && typeof resendRaw === 'object'
          ? (resendRaw as { customerSigningDispatch?: { status?: string; email?: string; pendingCount?: number } })
              .customerSigningDispatch
          : undefined;
      const status = dispatch?.status || '';
      if (status === 'sent') {
        setActionMessage(
          `Ссылка отправлена повторно на ${dispatch?.email || 'email контрагента'}. Ожидают подпись: ${dispatch?.pendingCount ?? 0}.`,
        );
      } else if (status === 'missing_email') {
        setActionMessage('У контрагента не заполнен email в карточке.');
      } else if (status === 'email_disabled') {
        setActionMessage('SMTP не настроен: email-ссылка не отправлена.');
      } else if (status === 'missing_contractor' || status === 'contractor_not_found') {
        setActionMessage('Контрагент не привязан корректно к записи.');
      } else if (status === 'send_failed') {
        setActionMessage('Не удалось отправить письмо повторно.');
      } else {
        setActionMessage('Запрос на повторную отправку выполнен.');
      }
    } catch (error) {
      if (error instanceof ApiError) {
        setActionMessage(error.message || 'Не удалось отправить ссылку повторно.');
      } else {
        setActionMessage('Не удалось отправить ссылку повторно.');
      }
    } finally {
      setEntryMutationInFlight(false);
    }
  };

  const createCorrection = async (entry: JournalEntry) => {
    setActionMessage('');
    if (entry.status !== 'fully_signed') {
      setActionMessage('Исправление можно создать только для locked записи (после двух подписей).');
      return;
    }

    const correctionPayload = {
      id: createId(),
      eventDateTime: nowInputDateTime(),
      entryTimestamp: new Date().toISOString(),
      executorName: (user?.fullName || '').trim() || entry.executorName || 'Не указан',
      description: `Исправление к записи ${entry.id}: ${entry.description}`,
    };

    setEntryMutationInFlight(true);
    try {
      const correctionRaw = await api.postT<unknown>(
        `/sppz-journal/entries/${encodeURIComponent(entry.id)}/correction`,
        correctionPayload,
      );
      const correctionEntry = normalizeJournalEntryFromApi(correctionRaw);
      if (!correctionEntry) {
        throw new Error('Invalid entry payload');
      }
      setEntries((prev) => [correctionEntry, ...prev]);
      setSelectedId(correctionEntry.id);
      setEntriesError('');
    } catch (error) {
      if (error instanceof ApiError) {
        setActionMessage(error.message || 'Не удалось создать исправление.');
      } else {
        setActionMessage('Не удалось создать исправление.');
      }
    } finally {
      setEntryMutationInFlight(false);
    }
  };

  const exportEvidencePackageForEntries = (entryList: JournalEntry[], filenamePrefix: string, scope: string) => {
    const payload = {
      exportedAt: new Date().toISOString(),
      scope,
      entryCount: entryList.length,
      entries: entryList,
    };
    downloadFile(
      `${filenamePrefix}-${new Date().toISOString().slice(0, 10)}.json`,
      JSON.stringify(payload, null, 2),
      'application/json',
    );
  };

  const exportCsvForEntries = (entryList: JournalEntry[], filenamePrefix: string) => {
    const header = [
      'ID',
      'EventDateTime',
      'EntryTimestamp',
      'Object',
      'Section',
      'RecordType',
      'Contractor',
      'ContractorINN',
      'ExecutorOrganization',
      'ExecutorFIO',
      'CustomerSignerFIO',
      'CustomerSignerOrderNumber',
      'CustomerSignedVia',
      'SignatureMode',
      'Status',
    ].join(';');

    const lines = entryList.map((entry) =>
      [
        entry.id,
        entry.eventDateTime,
        entry.entryTimestamp,
        entry.objectName,
        getEntrySections(entry).map((section) => SECTION_LABELS[section]).join(', '),
        RECORD_TYPE_LABELS[entry.recordType],
        entry.contractor,
        entry.contractorInn || '',
        getExecutorOrganization(entry),
        entry.executorName,
        entry.customerSignerFio || '',
        entry.customerSignerOrderNumber || '',
        entry.customerSignedVia || '',
        SIGNATURE_MODE_LABELS[entry.signatureMode],
        STATUS_LABELS[entry.status],
      ]
        .map((value) => `"${String(value).replaceAll('"', '""')}"`)
        .join(';'),
    );

    downloadFile(`${filenamePrefix}-${new Date().toISOString().slice(0, 10)}.csv`, [header, ...lines].join('\n'), 'text/csv');
  };

  const exportXlsForEntries = (entryList: JournalEntry[], filenamePrefix: string) => {
    const columns = [
      'ID',
      'EventDateTime',
      'EntryTimestamp',
      'Object',
      'Section',
      'RecordType',
      'Contractor',
      'ContractorINN',
      'ExecutorOrganization',
      'ExecutorFIO',
      'CustomerSignerFIO',
      'CustomerSignerOrderNumber',
      'CustomerSignedVia',
      'SignatureMode',
      'Status',
    ];

    const escapeHtml = (value: string) =>
      String(value)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');

    const rows = entryList.map((entry) => [
      entry.id,
      entry.eventDateTime,
      entry.entryTimestamp,
      entry.objectName,
      getEntrySections(entry).map((section) => SECTION_LABELS[section]).join(', '),
      RECORD_TYPE_LABELS[entry.recordType],
      entry.contractor,
      entry.contractorInn || '',
      getExecutorOrganization(entry),
      entry.executorName,
      entry.customerSignerFio || '',
      entry.customerSignerOrderNumber || '',
      entry.customerSignedVia || '',
      SIGNATURE_MODE_LABELS[entry.signatureMode],
      STATUS_LABELS[entry.status],
    ]);

    const html = `<!doctype html>
<html>
<head><meta charset="utf-8" /></head>
<body>
<table border="1">
  <thead>
    <tr>${columns.map((column) => `<th>${escapeHtml(column)}</th>`).join('')}</tr>
  </thead>
  <tbody>
    ${rows
      .map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`)
      .join('')}
  </tbody>
</table>
</body>
</html>`;

    downloadFile(
      `${filenamePrefix}-${new Date().toISOString().slice(0, 10)}.xls`,
      `\ufeff${html}`,
      'application/vnd.ms-excel;charset=utf-8',
    );
  };

  const exportEvidencePackage = () => {
    exportEvidencePackageForEntries(filteredEntries, 'sppz-evidence', 'filtered');
  };

  const exportCsv = () => {
    exportCsvForEntries(filteredEntries, 'sppz-journal');
  };

  const exportXls = () => {
    exportXlsForEntries(filteredEntries, 'sppz-journal');
  };

  const exportObjectEvidencePackage = (directionId: string, objectKey: string, objectName: string) => {
    const objectEntries = entriesByDirectionObject.get(`${directionId}|${objectKey}`) || [];
    exportEvidencePackageForEntries(
      objectEntries,
      `sppz-evidence-object-${toFileToken(`${directionId}-${objectName}`)}`,
      `object:${objectName}`,
    );
  };

  const exportObjectCsv = (directionId: string, objectKey: string, objectName: string) => {

  /* ── PDF Export (F-060) ── */
  const [pdfExportLoading, setPdfExportLoading] = useState(false);
  const [reportLoading, setReportLoading] = useState(false);

  const exportPdf = async () => {
    setPdfExportLoading(true);
    try {
      const params = new URLSearchParams();
      if (filters.directionId) params.set('directionId', filters.directionId);
      if (filters.section !== 'all') params.set('section', filters.section);
      if (filters.status !== 'all') params.set('status', filters.status);
      const qs = params.toString();
      const url = buildApiUrl(`/sppz-journal/export/pdf${qs ? `?${qs}` : ''}`);
      const token = getAccessToken();
      const headers: Record<string, string> = {};
      if (token) headers.Authorization = `Bearer ${token}`;
      const resp = await fetch(url, { headers, credentials: 'include' });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const blob = await resp.blob();
      const href = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = href;
      link.download = `sppz-journal-${new Date().toISOString().slice(0, 10)}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(href);
    } catch (error) {
      setActionMessage('Не удалось сформировать PDF.');
    } finally {
      setPdfExportLoading(false);
    }
  };

  const exportSummaryReport = async () => {
    setReportLoading(true);
    try {
      const params = new URLSearchParams();
      if (filters.directionId) params.set('directionId', filters.directionId);
      const qs = params.toString();
      const url = buildApiUrl(`/sppz-journal/report${qs ? `?${qs}` : ''}`);
      const token = getAccessToken();
      const headers: Record<string, string> = {};
      if (token) headers.Authorization = `Bearer ${token}`;
      const resp = await fetch(url, { headers, credentials: 'include' });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const blob = await resp.blob();
      const href = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = href;
      link.download = `sppz-report-${new Date().toISOString().slice(0, 10)}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(href);
    } catch (error) {
      setActionMessage('Не удалось сформировать сводный отчёт.');
    } finally {
      setReportLoading(false);
    }
  };
    const objectEntries = entriesByDirectionObject.get(`${directionId}|${objectKey}`) || [];
    exportCsvForEntries(objectEntries, `sppz-journal-object-${toFileToken(`${directionId}-${objectName}`)}`);
  };

  const exportObjectXls = (directionId: string, objectKey: string, objectName: string) => {
    const objectEntries = entriesByDirectionObject.get(`${directionId}|${objectKey}`) || [];
    exportXlsForEntries(objectEntries, `sppz-journal-object-${toFileToken(`${directionId}-${objectName}`)}`);
  };


  // ── Protected Objects data loading ──────────────────────────────────
  useEffect(() => {
    if (pageTab !== 'protected_objects') return;
    let cancelled = false;
    const load = async () => {
      setProtectedObjectsLoading(true);
      setProtectedObjectsError('');
      try {
        const raw = await api.getT<unknown>('/sppz-journal/objects');
        if (cancelled) return;
        const items = normalizeList<ProtectedObject>(raw);
        setProtectedObjects(items);
        if (items.length > 0 && !selectedProtectedObjectId) {
          setSelectedProtectedObjectId(items[0].id);
        }
      } catch {
        if (!cancelled) setProtectedObjectsError('Не удалось загрузить объекты защиты.');
      } finally {
        if (!cancelled) setProtectedObjectsLoading(false);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [pageTab]);

  // Load fire systems for selected protected object
  useEffect(() => {
    if (!selectedProtectedObjectId) return;
    if (fireSystemsByObjectId[selectedProtectedObjectId]) return;
    let cancelled = false;
    const load = async () => {
      try {
        const raw = await api.getT<unknown>(`/sppz-journal/objects/${selectedProtectedObjectId}/systems`);
        if (cancelled) return;
        const items = normalizeList<FireSystem>(raw);
        setFireSystemsByObjectId(prev => ({ ...prev, [selectedProtectedObjectId]: items }));
      } catch {
        if (!cancelled) setFireSystemsByObjectId(prev => ({ ...prev, [selectedProtectedObjectId]: [] }));
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [selectedProtectedObjectId, fireSystemsByObjectId]);

  const handleCreateProtectedObject = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setProtectedObjectFormError('');
    const f = protectedObjectForm;
    if (!f.directionId) { setProtectedObjectFormError('Выберите направление.'); return; }
    if (!f.orgName.trim()) { setProtectedObjectFormError('Укажите наименование организации.'); return; }
    setProtectedObjectMutating(true);
    try {
      const payload = { ...f, orgName: f.orgName.trim(), orgInn: f.orgInn.trim(), orgOgrn: f.orgOgrn.trim(), legalAddress: f.legalAddress.trim(), physicalAddress: f.physicalAddress.trim(), directorName: f.directorName.trim(), fireResponsibleName: f.fireResponsibleName.trim(), fireResponsibleOrderNumber: f.fireResponsibleOrderNumber.trim(), fireResponsibleOrderDate: f.fireResponsibleOrderDate || null, contactPhone: f.contactPhone.trim(), contactEmail: f.contactEmail.trim() };
      if (protObjEditId) {
        const updated = await api.putT<ProtectedObject>(`/sppz-journal/objects/${protObjEditId}`, payload);
        setProtectedObjects(prev => prev.map(o => o.id === protObjEditId ? (updated as ProtectedObject) : o));
      } else {
        const created = await api.postT<ProtectedObject>('/sppz-journal/objects', payload);
        setProtectedObjects(prev => [(created as ProtectedObject), ...prev]);
        setSelectedProtectedObjectId((created as ProtectedObject).id);
      }
      setProtObjFormOpen(false);
      setProtObjEditId('');
      setProtectedObjectForm({ directionId: '', orgName: '', orgInn: '', orgOgrn: '', legalAddress: '', physicalAddress: '', directorName: '', fireResponsibleName: '', fireResponsibleOrderNumber: '', fireResponsibleOrderDate: '', fireClass: '', contactPhone: '', contactEmail: '' });
    } catch (error) {
      setProtectedObjectFormError(error instanceof ApiError ? error.message : 'Не удалось сохранить объект защиты.');
    } finally {
      setProtectedObjectMutating(false);
    }
  };

  const handleDeleteProtectedObject = async (id: string) => {
    if (!confirm('Удалить объект защиты? Все связанные системы также будут удалены.')) return;
    try {
      await api.delT(`/sppz-journal/objects/${id}`);
      setProtectedObjects(prev => prev.filter(o => o.id !== id));
      if (selectedProtectedObjectId === id) setSelectedProtectedObjectId('');
      setFireSystemsByObjectId(prev => { const n = { ...prev }; delete n[id]; return n; });
    } catch { /* ignore */ }
  };

  const startEditProtectedObject = (obj: ProtectedObject) => {
    setProtObjEditId(obj.id);
    setProtectedObjectForm({
      directionId: obj.directionId, orgName: obj.orgName, orgInn: obj.orgInn, orgOgrn: obj.orgOgrn,
      legalAddress: obj.legalAddress, physicalAddress: obj.physicalAddress, directorName: obj.directorName,
      fireResponsibleName: obj.fireResponsibleName, fireResponsibleOrderNumber: obj.fireResponsibleOrderNumber,
      fireResponsibleOrderDate: obj.fireResponsibleOrderDate ?? '', fireClass: obj.fireClass,
      contactPhone: obj.contactPhone, contactEmail: obj.contactEmail,
    });
    setProtObjFormOpen(true);
  };

  const handleCreateFireSystem = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setFireSystemFormError('');
    if (!selectedProtectedObjectId) return;
    const f = fireSystemForm;
    if (!f.typeCode) { setFireSystemFormError('Выберите тип системы.'); return; }
    try {
      const payload = { typeCode: f.typeCode, model: f.model.trim(), commissioningDate: f.commissioningDate || null, contractorLicense: f.contractorLicense.trim(), contractorLicenseValidTo: f.contractorLicenseValidTo || null, checkPeriodDays: f.checkPeriodDays ? Number(f.checkPeriodDays) : null, nextCheckDate: f.nextCheckDate || null, status: f.status };
      if (sysEditId) {
        const updated = await api.putT<FireSystem>(`/sppz-journal/objects/${selectedProtectedObjectId}/systems/${sysEditId}`, payload);
        setFireSystemsByObjectId(prev => ({ ...prev, [selectedProtectedObjectId]: (prev[selectedProtectedObjectId] || []).map(s => s.id === sysEditId ? (updated as FireSystem) : s) }));
      } else {
        const created = await api.postT<FireSystem>(`/sppz-journal/objects/${selectedProtectedObjectId}/systems`, payload);
        setFireSystemsByObjectId(prev => ({ ...prev, [selectedProtectedObjectId]: [(created as FireSystem), ...(prev[selectedProtectedObjectId] || [])] }));
      }
      setSysFormOpen(false);
      setSysEditId('');
      setFireSystemForm({ typeCode: '', model: '', commissioningDate: '', contractorLicense: '', contractorLicenseValidTo: '', checkPeriodDays: '', nextCheckDate: '', status: 'active' });
    } catch (error) {
      setFireSystemFormError(error instanceof ApiError ? error.message : 'Не удалось сохранить систему.');
    }
  };

  const handleDeleteFireSystem = async (objectId: string, systemId: string) => {
    if (!confirm('Удалить систему пожарной защиты?')) return;
    try {
      await api.delT(`/sppz-journal/objects/${objectId}/systems/${systemId}`);
      setFireSystemsByObjectId(prev => ({ ...prev, [objectId]: (prev[objectId] || []).filter(s => s.id !== systemId) }));
    } catch { /* ignore */ }
  };

  const startEditFireSystem = (sys: FireSystem) => {
    setSysEditId(sys.id);
    setFireSystemForm({
      typeCode: sys.typeCode, model: sys.model, commissioningDate: sys.commissioningDate ?? '',
      contractorLicense: sys.contractorLicense, contractorLicenseValidTo: sys.contractorLicenseValidTo ?? '',
      checkPeriodDays: sys.checkPeriodDays != null ? String(sys.checkPeriodDays) : '',
      nextCheckDate: sys.nextCheckDate ?? '', status: sys.status,
    });
    setSysFormOpen(true);
  };

  const selectedProtectedObject = protectedObjects.find(o => o.id === selectedProtectedObjectId) ?? null;
  const selectedObjectSystems = selectedProtectedObjectId ? (fireSystemsByObjectId[selectedProtectedObjectId] || []) : [];

  const isStaffVisible = STAFF_ROLES.has((user?.role as UserRole) || UserRole.USER);
  const isAdmin = currentRole === UserRole.ADMIN;

  if (!isStaffVisible) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100 p-6 dark:bg-slate-950">
        <div className="w-full max-w-xl rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <h1 className="text-2xl font-semibold">Доступ ограничен</h1>
          <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">
            Эта страница доступна только сотрудникам штатных ролей.
          </p>
          <Link
            to="/"
            className="mt-5 inline-flex items-center gap-2 rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium transition hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
          >
            <ArrowLeft size={14} />
            Вернуться на панель
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100 px-4 py-6 dark:bg-slate-950 sm:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-[1600px] space-y-6">
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="bg-gradient-to-r from-slate-900 to-slate-800 px-6 py-6 text-slate-100">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="space-y-2">
                <Link
                  to="/"
                  className="inline-flex items-center gap-2 text-xs text-slate-300 transition hover:text-white"
                >
                  <ArrowLeft size={14} />
                  Вернуться в основную систему
                </Link>
                <h1 className="text-2xl font-semibold">Электронный журнал эксплуатации СППЗ</h1>
                <p className="text-sm text-slate-300">
                  Изолированная страница журнала: объекты и контрагенты подтягиваются из справочников, доступ только
                  для штатных ролей.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={exportCsv}
                  className="inline-flex items-center gap-2 rounded-lg border border-slate-600 px-3 py-2 text-sm font-medium transition hover:border-slate-400 hover:bg-slate-700/40"
                >
                  <FileDown size={16} />
                  Экспорт CSV (по фильтру)
                </button>
                <button
                  type="button"
                  onClick={exportXls}
                  className="inline-flex items-center gap-2 rounded-lg border border-slate-600 px-3 py-2 text-sm font-medium transition hover:border-slate-400 hover:bg-slate-700/40"
                >
                  <FileDown size={16} />
                  Экспорт XLS (по фильтру)
                </button>
                <button
                  type="button"
                  onClick={exportEvidencePackage}
                  className="inline-flex items-center gap-2 rounded-lg border border-emerald-500/60 bg-emerald-500/10 px-3 py-2 text-sm font-medium text-emerald-200 transition hover:bg-emerald-500/20"
                >
                  <Download size={16} />
                  Пакет доказательств (по фильтру)
                </button>
                <button
                  type="button"
                  onClick={exportPdf}
                  disabled={pdfExportLoading}
                  className="inline-flex items-center gap-2 rounded-lg border border-blue-500/60 bg-blue-500/10 px-3 py-2 text-sm font-medium text-blue-200 transition hover:bg-blue-500/20 disabled:opacity-50"
                >
                  <FileDown size={16} />
                  {pdfExportLoading ? 'Формирование...' : 'Выгрузка PDF (по фильтру)'}
                </button>
                <button
                  type="button"
                  onClick={exportSummaryReport}
                  disabled={reportLoading}
                  className="inline-flex items-center gap-2 rounded-lg border border-violet-500/60 bg-violet-500/10 px-3 py-2 text-sm font-medium text-violet-200 transition hover:bg-violet-500/20 disabled:opacity-50"
                >
                  <FileDown size={16} />
                  {reportLoading ? 'Формирование...' : 'Сводный отчёт'}
                </button>
                {isAdmin ? (
                  <button
                    type="button"
                    onClick={() => { setInspectorModalOpen(true); setInspectorLink(''); setInspectorError(''); setInspectorCopied(false); }}
                    className="inline-flex items-center gap-2 rounded-lg border border-sky-500/60 bg-sky-500/10 px-3 py-2 text-sm font-medium text-sky-200 transition hover:bg-sky-500/20"
                  >
                    <Eye size={16} />
                    Доступ для проверки
                  </button>
                ) : null}
              </div>
            </div>
          </div>
          <div className="grid gap-3 border-t border-slate-200 px-6 py-4 dark:border-slate-800 md:grid-cols-3">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/40">
              <p className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">Черновики</p>
              <p className="mt-1 text-2xl font-semibold">{draftCount}</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/40">
              <p className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">Ожидают подпись заказчика</p>
              <p className="mt-1 text-2xl font-semibold">{pendingCustomerSign}</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/40">
              <p className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">Locked записи</p>
              <p className="mt-1 text-2xl font-semibold">{lockedCount}</p>
            </div>
          </div>
          {entriesError ? (
            <div className="border-t border-red-200 bg-red-50 px-6 py-3 text-xs text-red-700 dark:border-red-900/40 dark:bg-red-950/40 dark:text-red-300">
              {entriesError}
            </div>
          ) : null}
        </section>

        {/* F-070: Page tabs - Journal / Extinguishers */}
        <div className="flex gap-1 rounded-xl border border-slate-200 bg-white p-1 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <button
            type="button"
            onClick={() => setPageTab('journal')}
            className={`inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition ${
              pageTab === 'journal'
                ? 'bg-slate-900 text-white shadow dark:bg-slate-100 dark:text-slate-900'
                : 'text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800'
            }`}
          >
            <FilePen size={16} />
            Журнал СППЗ
          </button>
          <button
            type="button"
            onClick={() => setPageTab('extinguishers')}
            className={`inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition ${
              pageTab === 'extinguishers'
                ? 'bg-slate-900 text-white shadow dark:bg-slate-100 dark:text-slate-900'
                : 'text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800'
            }`}
          >
            <Flame size={16} />
            Огнетушители
          </button>
          <button
            type="button"
            onClick={() => setPageTab('protected_objects')}
            className={`inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition ${
              pageTab === 'protected_objects'
                ? 'bg-slate-900 text-white shadow dark:bg-slate-100 dark:text-slate-900'
                : 'text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800'
            }`}
          >
            <Building2 size={16} />
            Объекты защиты
          </button>
        </div>

        {pageTab === 'extinguishers' ? (
          <SppzExtinguishersTab directions={directions} referenceLoading={referenceLoading} />
        ) : null}

        {pageTab === 'protected_objects' ? (
          <section className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Объекты защиты</h2>
              <button
                type="button"
                onClick={() => { setProtObjFormOpen(true); setProtObjEditId(''); setProtectedObjectForm({ directionId: directions[0]?.id || '', orgName: '', orgInn: '', orgOgrn: '', legalAddress: '', physicalAddress: '', directorName: '', fireResponsibleName: '', fireResponsibleOrderNumber: '', fireResponsibleOrderDate: '', fireClass: '', contactPhone: '', contactEmail: '' }); setProtectedObjectFormError(''); }}
                className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-200"
              >
                <Plus size={16} />
                Добавить объект
              </button>
            </div>

            {protectedObjectsLoading ? (
              <p className="text-sm text-slate-500">Загрузка объектов защиты...</p>
            ) : protectedObjectsError ? (
              <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-950/40 dark:text-red-300">{protectedObjectsError}</div>
            ) : protectedObjects.length === 0 ? (
              <p className="text-sm text-slate-500">Объекты защиты пока не добавлены. Создайте первый объект.</p>
            ) : (
              <div className="grid gap-4 lg:grid-cols-[360px_1fr]">
                {/* Object list */}
                <div className="space-y-2">
                  {protectedObjects.map(obj => {
                    const dir = directions.find(d => d.id === obj.directionId);
                    return (
                      <div
                        key={obj.id}
                        onClick={() => { setSelectedProtectedObjectId(obj.id); }}
                        className={`cursor-pointer rounded-xl border p-3 transition ${selectedProtectedObjectId === obj.id ? 'border-blue-500 bg-blue-50 dark:border-blue-400 dark:bg-blue-950/30' : 'border-slate-200 bg-white hover:border-slate-300 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-slate-600'}`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <p className="text-sm font-medium">{obj.orgName || 'Без названия'}</p>
                            <p className="text-xs text-slate-500">{dir?.name || obj.directionId}</p>
                            {obj.fireClass ? <span className="mt-1 inline-block rounded bg-orange-100 px-1.5 py-0.5 text-xs font-medium text-orange-700 dark:bg-orange-900/30 dark:text-orange-300">{FIRE_CLASS_LABELS[obj.fireClass] || obj.fireClass}</span> : null}
                          </div>
                          <div className="flex gap-1">
                            <button type="button" onClick={(e) => { e.stopPropagation(); startEditProtectedObject(obj); }} className="rounded p-1 text-slate-400 hover:text-slate-600"><Pencil size={14} /></button>
                            <button type="button" onClick={(e) => { e.stopPropagation(); void handleDeleteProtectedObject(obj.id); }} className="rounded p-1 text-slate-400 hover:text-red-500"><Trash2 size={14} /></button>
                          </div>
                        </div>
                        {obj.orgInn ? <p className="mt-1 text-xs text-slate-500">ИНН: {obj.orgInn}</p> : null}
                        {obj.physicalAddress ? <p className="text-xs text-slate-500">{obj.physicalAddress}</p> : null}
                      </div>
                    );
                  })}
                </div>

                {/* Object card detail + fire systems */}
                {selectedProtectedObject ? (
                  <div className="space-y-4">
                    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                      <h3 className="text-base font-semibold">{selectedProtectedObject.orgName || 'Карточка объекта'}</h3>
                      <div className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
                        <div><span className="text-slate-500">ИНН:</span> {selectedProtectedObject.orgInn || '-'}</div>
                        <div><span className="text-slate-500">ОГРН:</span> {selectedProtectedObject.orgOgrn || '-'}</div>
                        <div><span className="text-slate-500">Юр. адрес:</span> {selectedProtectedObject.legalAddress || '-'}</div>
                        <div><span className="text-slate-500">Факт. адрес:</span> {selectedProtectedObject.physicalAddress || '-'}</div>
                        <div><span className="text-slate-500">Руководитель:</span> {selectedProtectedObject.directorName || '-'}</div>
                        <div><span className="text-slate-500">Класс пожарной опасности:</span> {selectedProtectedObject.fireClass ? (FIRE_CLASS_LABELS[selectedProtectedObject.fireClass] || selectedProtectedObject.fireClass) : '-'}</div>
                        <div><span className="text-slate-500">Ответственный за ПБ:</span> {selectedProtectedObject.fireResponsibleName || '-'}</div>
                        <div><span className="text-slate-500">Приказ ответственного:</span> {selectedProtectedObject.fireResponsibleOrderNumber ? `${selectedProtectedObject.fireResponsibleOrderNumber}${selectedProtectedObject.fireResponsibleOrderDate ? ` от ${selectedProtectedObject.fireResponsibleOrderDate}` : ''}` : '-'}</div>
                        <div><span className="text-slate-500">Телефон:</span> {selectedProtectedObject.contactPhone || '-'}</div>
                        <div><span className="text-slate-500">Email:</span> {selectedProtectedObject.contactEmail || '-'}</div>
                      </div>
                    </div>

                    {/* Fire systems list */}
                    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                      <div className="flex items-center justify-between">
                        <h3 className="text-base font-semibold">Системы пожарной защиты</h3>
                        <button
                          type="button"
                          onClick={() => { setSysFormOpen(true); setSysEditId(''); setFireSystemForm({ typeCode: '', model: '', commissioningDate: '', contractorLicense: '', contractorLicenseValidTo: '', checkPeriodDays: '', nextCheckDate: '', status: 'active' }); setFireSystemFormError(''); }}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium transition hover:bg-slate-50 dark:border-slate-600 dark:hover:bg-slate-800"
                        >
                          <Plus size={14} />
                          Добавить систему
                        </button>
                      </div>

                      {selectedObjectSystems.length === 0 ? (
                        <p className="mt-3 text-sm text-slate-500">Системы пожарной защиты не добавлены.</p>
                      ) : (
                        <div className="mt-3 space-y-2">
                          {selectedObjectSystems.map(sys => (
                            <div key={sys.id} className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                              <div className="flex items-start justify-between gap-2">
                                <div>
                                  <p className="text-sm font-medium">{FIRE_SYSTEM_TYPE_LABELS[sys.typeCode] || sys.typeCode}</p>
                                  {sys.model ? <p className="text-xs text-slate-500">Модель: {sys.model}</p> : null}
                                  <div className="mt-1 flex flex-wrap gap-3 text-xs text-slate-500">
                                    {sys.commissioningDate ? <span>Ввод: {sys.commissioningDate}</span> : null}
                                    {sys.contractorLicense ? <span>Лицензия: {sys.contractorLicense}</span> : null}
                                    {sys.checkPeriodDays ? <span>Период проверки: {sys.checkPeriodDays} дн.</span> : null}
                                    {sys.nextCheckDate ? <span>Следующая проверка: {sys.nextCheckDate}</span> : null}
                                  </div>
                                </div>
                                <div className="flex gap-1">
                                  <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${sys.status === 'active' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' : sys.status === 'inactive' ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-600'}`}>{sys.status === 'active' ? 'Активна' : sys.status === 'inactive' ? 'Неактивна' : 'Выведена'}</span>
                                  <button type="button" onClick={() => startEditFireSystem(sys)} className="rounded p-1 text-slate-400 hover:text-slate-600"><Pencil size={14} /></button>
                                  <button type="button" onClick={() => void handleDeleteFireSystem(selectedProtectedObjectId, sys.id)} className="rounded p-1 text-slate-400 hover:text-red-500"><Trash2 size={14} /></button>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Fire system form modal */}
                      {sysFormOpen ? (
                        <div className="mt-4 rounded-xl border border-slate-300 bg-slate-50 p-4 dark:border-slate-600 dark:bg-slate-800">
                          <h4 className="text-sm font-semibold">{sysEditId ? 'Редактировать систему' : 'Новая система'}</h4>
                          <form onSubmit={handleCreateFireSystem} className="mt-3 grid gap-3 sm:grid-cols-2">
                            <label className="block text-xs">
                              <span className="text-slate-600 dark:text-slate-400">Тип системы *</span>
                              <select value={fireSystemForm.typeCode} onChange={e => setFireSystemForm(p => ({ ...p, typeCode: e.target.value }))} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900">
                                <option value="">-- Выберите --</option>
                                {Object.entries(FIRE_SYSTEM_TYPE_LABELS).map(([code, label]) => <option key={code} value={code}>{label}</option>)}
                              </select>
                            </label>
                            <label className="block text-xs"><span className="text-slate-600 dark:text-slate-400">Модель / марка</span><input type="text" value={fireSystemForm.model} onChange={e => setFireSystemForm(p => ({ ...p, model: e.target.value }))} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900" /></label>
                            <label className="block text-xs"><span className="text-slate-600 dark:text-slate-400">Дата ввода в эксплуатацию</span><input type="date" value={fireSystemForm.commissioningDate} onChange={e => setFireSystemForm(p => ({ ...p, commissioningDate: e.target.value }))} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900" /></label>
                            <label className="block text-xs"><span className="text-slate-600 dark:text-slate-400">Лицензия подрядчика</span><input type="text" value={fireSystemForm.contractorLicense} onChange={e => setFireSystemForm(p => ({ ...p, contractorLicense: e.target.value }))} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900" /></label>
                            <label className="block text-xs"><span className="text-slate-600 dark:text-slate-400">Лицензия действует до</span><input type="date" value={fireSystemForm.contractorLicenseValidTo} onChange={e => setFireSystemForm(p => ({ ...p, contractorLicenseValidTo: e.target.value }))} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900" /></label>
                            <label className="block text-xs"><span className="text-slate-600 dark:text-slate-400">Период проверки (дни)</span><input type="number" value={fireSystemForm.checkPeriodDays} onChange={e => setFireSystemForm(p => ({ ...p, checkPeriodDays: e.target.value }))} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900" /></label>
                            <label className="block text-xs"><span className="text-slate-600 dark:text-slate-400">Следующая проверка</span><input type="date" value={fireSystemForm.nextCheckDate} onChange={e => setFireSystemForm(p => ({ ...p, nextCheckDate: e.target.value }))} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900" /></label>
                            <label className="block text-xs">
                              <span className="text-slate-600 dark:text-slate-400">Статус</span>
                              <select value={fireSystemForm.status} onChange={e => setFireSystemForm(p => ({ ...p, status: e.target.value }))} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900">
                                <option value="active">Активна</option>
                                <option value="inactive">Неактивна</option>
                                <option value="decommissioned">Выведена из эксплуатации</option>
                              </select>
                            </label>
                            {fireSystemFormError ? <div className="col-span-full text-xs text-red-600">{fireSystemFormError}</div> : null}
                            <div className="col-span-full flex gap-2">
                              <button type="submit" className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900">{sysEditId ? 'Сохранить' : 'Добавить'}</button>
                              <button type="button" onClick={() => { setSysFormOpen(false); setSysEditId(''); }} className="rounded-lg border border-slate-300 px-4 py-2 text-sm transition hover:bg-slate-100 dark:border-slate-600 dark:hover:bg-slate-800">Отмена</button>
                            </div>
                          </form>
                        </div>
                      ) : null}
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-slate-500">Выберите объект из списка слева.</p>
                )}
              </div>
            )}

            {/* Protected object create/edit form */}
            {protObjFormOpen ? (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
                <div className="w-full max-w-2xl rounded-2xl border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-700 dark:bg-slate-900">
                  <div className="flex items-center justify-between">
                    <h3 className="text-lg font-semibold">{protObjEditId ? 'Редактировать объект защиты' : 'Новый объект защиты'}</h3>
                    <button type="button" onClick={() => setProtObjFormOpen(false)} className="rounded p-1 text-slate-400 hover:text-slate-600"><X size={18} /></button>
                  </div>
                  <form onSubmit={handleCreateProtectedObject} className="mt-4 grid gap-3 sm:grid-cols-2">
                    <label className="block text-xs">
                      <span className="text-slate-600 dark:text-slate-400">Направление *</span>
                      <select value={protectedObjectForm.directionId} onChange={e => setProtectedObjectForm(p => ({ ...p, directionId: e.target.value }))} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900">
                        <option value="">-- Выберите --</option>
                        {directions.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                      </select>
                    </label>
                    <label className="block text-xs"><span className="text-slate-600 dark:text-slate-400">Наименование организации *</span><input type="text" value={protectedObjectForm.orgName} onChange={e => setProtectedObjectForm(p => ({ ...p, orgName: e.target.value }))} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900" /></label>
                    <label className="block text-xs"><span className="text-slate-600 dark:text-slate-400">ИНН</span><input type="text" value={protectedObjectForm.orgInn} onChange={e => setProtectedObjectForm(p => ({ ...p, orgInn: e.target.value }))} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900" /></label>
                    <label className="block text-xs"><span className="text-slate-600 dark:text-slate-400">ОГРН</span><input type="text" value={protectedObjectForm.orgOgrn} onChange={e => setProtectedObjectForm(p => ({ ...p, orgOgrn: e.target.value }))} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900" /></label>
                    <label className="block text-xs"><span className="text-slate-600 dark:text-slate-400">Юридический адрес</span><input type="text" value={protectedObjectForm.legalAddress} onChange={e => setProtectedObjectForm(p => ({ ...p, legalAddress: e.target.value }))} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900" /></label>
                    <label className="block text-xs"><span className="text-slate-600 dark:text-slate-400">Фактический адрес</span><input type="text" value={protectedObjectForm.physicalAddress} onChange={e => setProtectedObjectForm(p => ({ ...p, physicalAddress: e.target.value }))} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900" /></label>
                    <label className="block text-xs"><span className="text-slate-600 dark:text-slate-400">Руководитель</span><input type="text" value={protectedObjectForm.directorName} onChange={e => setProtectedObjectForm(p => ({ ...p, directorName: e.target.value }))} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900" /></label>
                    <label className="block text-xs">
                      <span className="text-slate-600 dark:text-slate-400">Класс пожарной опасности</span>
                      <select value={protectedObjectForm.fireClass} onChange={e => setProtectedObjectForm(p => ({ ...p, fireClass: e.target.value }))} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900">
                        <option value="">-- Не указан --</option>
                        {Object.entries(FIRE_CLASS_LABELS).map(([code, label]) => <option key={code} value={code}>{label}</option>)}
                      </select>
                    </label>
                    <label className="block text-xs"><span className="text-slate-600 dark:text-slate-400">Ответственный за ПБ</span><input type="text" value={protectedObjectForm.fireResponsibleName} onChange={e => setProtectedObjectForm(p => ({ ...p, fireResponsibleName: e.target.value }))} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900" /></label>
                    <label className="block text-xs"><span className="text-slate-600 dark:text-slate-400">Номер приказа ответственного</span><input type="text" value={protectedObjectForm.fireResponsibleOrderNumber} onChange={e => setProtectedObjectForm(p => ({ ...p, fireResponsibleOrderNumber: e.target.value }))} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900" /></label>
                    <label className="block text-xs"><span className="text-slate-600 dark:text-slate-400">Дата приказа</span><input type="date" value={protectedObjectForm.fireResponsibleOrderDate} onChange={e => setProtectedObjectForm(p => ({ ...p, fireResponsibleOrderDate: e.target.value }))} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900" /></label>
                    <label className="block text-xs"><span className="text-slate-600 dark:text-slate-400">Телефон</span><input type="tel" value={protectedObjectForm.contactPhone} onChange={e => setProtectedObjectForm(p => ({ ...p, contactPhone: e.target.value }))} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900" /></label>
                    <label className="block text-xs"><span className="text-slate-600 dark:text-slate-400">Email</span><input type="email" value={protectedObjectForm.contactEmail} onChange={e => setProtectedObjectForm(p => ({ ...p, contactEmail: e.target.value }))} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900" /></label>
                    {protectedObjectFormError ? <div className="col-span-full text-xs text-red-600">{protectedObjectFormError}</div> : null}
                    <div className="col-span-full flex gap-2">
                      <button type="submit" disabled={protectedObjectMutating} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800 disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900">{protObjEditId ? 'Сохранить' : 'Создать'}</button>
                      <button type="button" onClick={() => setProtObjFormOpen(false)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm transition hover:bg-slate-100 dark:border-slate-600 dark:hover:bg-slate-800">Отмена</button>
                    </div>
                  </form>
                </div>
              </div>
            ) : null}
          </section>
        ) : null}

        {pageTab === 'journal' ? (
        <>
        {/* F-042: Fire safety check calendar widget */}
        <SppzCheckCalendar
          directionId={filters.directionId && filters.directionId !== '' ? filters.directionId : undefined}
          className="shadow-sm"
        />

        <div className="grid gap-6 xl:grid-cols-[380px_1fr]">
          <aside className="space-y-6">
            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Объекты из направлений
              </h2>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Направление раскрывает список объектов. В объекте открываются 12 месяцев в компактной сетке.
              </p>

              <label className="mt-3 block space-y-1">
                <span className="text-xs text-slate-500 dark:text-slate-400">Поиск по объектам/адресу</span>
                <div className="relative">
                  <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    value={objectSearch}
                    onChange={(event) => setObjectSearch(event.target.value)}
                    placeholder="Введите объект или адрес..."
                    className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm outline-none ring-brand-red transition focus:border-brand-red focus:ring-2 dark:border-slate-700 dark:bg-slate-800"
                  />
                </div>
              </label>

              <div className="mt-3 flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-800/40">
                <p className="text-xs text-slate-500 dark:text-slate-400">Год</p>
                <div className="inline-flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setPlannerYear((prev) => prev - 1)}
                    className="rounded-md border border-slate-300 px-2 py-1 text-xs transition hover:bg-slate-100 dark:border-slate-600 dark:hover:bg-slate-700"
                  >
                    −
                  </button>
                  <span className="min-w-[54px] text-center text-sm font-semibold">{selectedPlannerYear}</span>
                  <button
                    type="button"
                    onClick={() => setPlannerYear((prev) => prev + 1)}
                    className="rounded-md border border-slate-300 px-2 py-1 text-xs transition hover:bg-slate-100 dark:border-slate-600 dark:hover:bg-slate-700"
                  >
                    +
                  </button>
                </div>
              </div>

              <label className="mt-3 flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
                <input
                  type="checkbox"
                  checked={showOnlyWithGaps}
                  onChange={(event) => setShowOnlyWithGaps(event.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-brand-red focus:ring-brand-red dark:border-slate-600 dark:bg-slate-800"
                />
                Только объекты с пропусками за {selectedPlannerYear} год
              </label>

              <div className="mt-3 max-h-[34rem] space-y-2 overflow-auto">
                <button
                  type="button"
                  onClick={() => {
                    applyDirectionContext('');
                    setExpandedDirectionId(null);
                    setExpandedObjectRef(null);
                  }}
                  className={[
                    'w-full rounded-lg border px-3 py-2 text-left transition',
                    filters.directionId
                      ? 'border-slate-200 bg-white hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800'
                      : 'border-brand-red/50 bg-brand-red/5',
                  ].join(' ')}
                >
                  <p className="text-sm font-semibold">Все направления</p>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    Направлений: {directionJournalStats.length} • Всего записей: {entries.length}
                  </p>
                </button>

                {directionJournalStats.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-slate-300 px-3 py-4 text-center text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">
                    {showOnlyWithGaps
                      ? `Нет объектов с пропусками за ${selectedPlannerYear} год.`
                      : 'По заданному поиску объекты не найдены.'}
                  </div>
                ) : null}

                {directionJournalStats.map((stat) => {
                  const isDirectionExpanded = expandedDirectionId === stat.directionId;
                  const lastEntryLabel = stat.lastEntryDateTime ? formatDateTime(stat.lastEntryDateTime) : 'нет записей';

                  return (
                    <div
                      key={stat.directionId}
                      className={[
                        'overflow-hidden rounded-lg border transition',
                        filters.directionId === stat.directionId
                          ? 'border-brand-red/50 bg-brand-red/5'
                          : 'border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900',
                      ].join(' ')}
                    >
                      <button
                        type="button"
                        onClick={() => handleDirectionCardClick(stat.directionId)}
                        className="w-full px-3 py-2 text-left transition hover:bg-slate-50/80 dark:hover:bg-slate-800/60"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">{stat.name}</p>
                            <p className="mt-1 line-clamp-1 text-xs text-slate-500 dark:text-slate-400">
                              {stat.address || 'Адрес не указан'}
                            </p>
                            <p className="mt-1 text-[11px] text-slate-600 dark:text-slate-300">
                              Последняя запись: <span className="font-medium">{lastEntryLabel}</span>
                            </p>
                          </div>
                          <span className="mt-0.5 text-slate-500 dark:text-slate-400">
                            {isDirectionExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                          </span>
                        </div>
                        <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-slate-600 dark:text-slate-300">
                          <span>Объектов: {stat.objectStats.length}</span>
                          <span>Всего: {stat.total}</span>
                          <span>Черновики: {stat.drafts}</span>
                          <span>Ожидают: {stat.pending}</span>
                          <span>Locked: {stat.locked}</span>
                        </div>
                      </button>

                      {isDirectionExpanded ? (
                        <div className="border-t border-slate-200 px-2 py-2 dark:border-slate-700">
                          <div className="space-y-1.5">
                            {stat.objectStats.map((objectStat) => {
                              const objectCompletion = Math.round((objectStat.filledMonthsInPlannerYear / 12) * 100);
                              const objectExpanded = expandedObjectRef === objectStat.objectRef;
                              const objectLastEntry = objectStat.lastEntryDateTime
                                ? formatDateTime(objectStat.lastEntryDateTime)
                                : 'нет записей';
                              const currentMonthIndex = new Date().getMonth();
                              const currentMonthEntry = getDirectionObjectMonthEntry(
                                stat.directionId,
                                objectStat.key,
                                selectedPlannerYear,
                                currentMonthIndex,
                              );
                              const hasCurrentMonth = Boolean(currentMonthEntry);

                              return (
                                <div key={objectStat.objectRef} className="rounded-md border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
                                  <button
                                    type="button"
                                    onClick={() => handleObjectCardClick(stat.directionId, objectStat.objectRef)}
                                    className="w-full px-2 py-2 text-left transition hover:bg-slate-50 dark:hover:bg-slate-800/60"
                                  >
                                    <div className="flex items-start justify-between gap-2">
                                      <div className="min-w-0">
                                        <p className="truncate text-xs font-semibold text-slate-900 dark:text-slate-100">{objectStat.name}</p>
                                        <p className="mt-0.5 line-clamp-1 text-[11px] text-slate-500 dark:text-slate-400">
                                          {objectStat.address || 'Адрес не указан'}
                                        </p>
                                        <p className="mt-0.5 text-[11px] text-slate-600 dark:text-slate-300">
                                          Последняя: <span className="font-medium">{objectLastEntry}</span>
                                        </p>
                                      </div>
                                      <span className="text-slate-500 dark:text-slate-400">
                                        {objectExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                                      </span>
                                    </div>
                                    <div className="mt-1.5 flex flex-wrap gap-2 text-[10px] text-slate-600 dark:text-slate-300">
                                      <span>Заполнено: {objectStat.filledMonthsInPlannerYear}/12</span>
                                      <span>{objectStat.hasCurrentMonthEntry ? 'Текущий: OK' : 'Текущий: нет'}</span>
                                      <span>Всего: {objectStat.total}</span>
                                    </div>
                                    <div className="mt-1 h-1 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
                                      <div className="h-full bg-brand-red" style={{ width: `${objectCompletion}%` }} />
                                    </div>
                                  </button>

                                  {objectExpanded ? (
                                    <div className="border-t border-slate-200 px-2 py-2 dark:border-slate-700">
                                      <div className="mb-1.5 flex flex-wrap gap-1.5">
                                        <button
                                          type="button"
                                          disabled={objectStat.total === 0}
                                          onClick={() => exportObjectCsv(stat.directionId, objectStat.key, objectStat.name)}
                                          className="rounded-md border border-slate-300 px-2 py-1 text-[10px] transition enabled:hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-600 dark:enabled:hover:bg-slate-700"
                                        >
                                          CSV объекта
                                        </button>
                                        <button
                                          type="button"
                                          disabled={objectStat.total === 0}
                                          onClick={() => exportObjectXls(stat.directionId, objectStat.key, objectStat.name)}
                                          className="rounded-md border border-slate-300 px-2 py-1 text-[10px] transition enabled:hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-600 dark:enabled:hover:bg-slate-700"
                                        >
                                          XLS объекта
                                        </button>
                                        <button
                                          type="button"
                                          disabled={objectStat.total === 0}
                                          onClick={() => exportObjectEvidencePackage(stat.directionId, objectStat.key, objectStat.name)}
                                          className="rounded-md border border-slate-300 px-2 py-1 text-[10px] transition enabled:hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-600 dark:enabled:hover:bg-slate-700"
                                        >
                                          Пакет объекта
                                        </button>
                                        <button
                                          type="button"
                                          disabled={objectStat.nextMissingMonthIndex === -1}
                                          onClick={() => {
                                            if (objectStat.nextMissingMonthIndex === -1) return;
                                            handleObjectMonthCreateClick(
                                              stat.directionId,
                                              objectStat.key,
                                              objectStat.nextMissingMonthIndex,
                                              objectStat.name,
                                              objectStat.tenantId,
                                            );
                                          }}
                                          className="rounded-md border border-slate-300 px-2 py-1 text-[10px] transition enabled:hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-600 dark:enabled:hover:bg-slate-700"
                                        >
                                          Следующий пропуск
                                        </button>
                                        <button
                                          type="button"
                                          disabled={hasCurrentMonth}
                                          onClick={() =>
                                            handleObjectMonthCreateClick(
                                              stat.directionId,
                                              objectStat.key,
                                              currentMonthIndex,
                                              objectStat.name,
                                              objectStat.tenantId,
                                            )
                                          }
                                          className="rounded-md border border-slate-300 px-2 py-1 text-[10px] transition enabled:hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-600 dark:enabled:hover:bg-slate-700"
                                        >
                                          Текущий месяц
                                        </button>
                                      </div>

                                      <div className="grid grid-cols-4 gap-1">
                                        {MONTH_LABELS.map((monthLabel, monthIndex) => {
                                          const monthEntry = getDirectionObjectMonthEntry(
                                            stat.directionId,
                                            objectStat.key,
                                            selectedPlannerYear,
                                            monthIndex,
                                          );
                                          const filled = Boolean(monthEntry);

                                          return (
                                            <button
                                              key={`${objectStat.objectRef}-${monthIndex}`}
                                              type="button"
                                              onClick={() => {
                                                applyDirectionContext(stat.directionId);
                                                setForm((prev) => ({ ...prev, objectKey: objectStat.key }));
                                                if (monthEntry) {
                                                  setSelectedId(monthEntry.id);
                                                  return;
                                                }
                                                handleObjectMonthCreateClick(
                                                  stat.directionId,
                                                  objectStat.key,
                                                  monthIndex,
                                                  objectStat.name,
                                                  objectStat.tenantId,
                                                );
                                              }}
                                              className={[
                                                'rounded border px-1 py-1 text-[10px] transition',
                                                filled
                                                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-900/20 dark:text-emerald-300'
                                                  : 'border-slate-200 bg-white hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800',
                                              ].join(' ')}
                                              title={
                                                filled
                                                  ? `${monthLabel}: запись есть`
                                                  : `${monthLabel}: добавить запись`
                                              }
                                            >
                                              {monthLabel.slice(0, 3)}
                                            </button>
                                          );
                                        })}
                                      </div>
                                    </div>
                                  ) : null}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <div className="mb-3 flex items-center gap-2">
                <Plus size={16} className="text-slate-500" />
                <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Новая запись
                </h2>
              </div>

              {referenceError ? (
                <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300">
                  Сначала восстановите доступ к справочникам объектов и контрагентов.
                </div>
              ) : null}

              <form id="sppz-entry-form" onSubmit={handleCreateEntry} className="space-y-3">
                <label className="block space-y-1">
                  <span className="text-xs text-slate-500 dark:text-slate-400">Дата/время события</span>
                  <input
                    type="datetime-local"
                    required
                    value={form.eventDateTime}
                    onChange={(event) => updateForm('eventDateTime', event.target.value)}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-brand-red transition focus:border-brand-red focus:ring-2 dark:border-slate-700 dark:bg-slate-800"
                  />
                </label>

                <label className="block space-y-1">
                  <span className="text-xs text-slate-500 dark:text-slate-400">Направление (из справочника)</span>
                  <select
                    value={form.directionId}
                    onChange={(event) => handleFormDirectionChange(event.target.value)}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-brand-red transition focus:border-brand-red focus:ring-2 dark:border-slate-700 dark:bg-slate-800"
                    required
                    disabled={referenceLoading || directions.length === 0}
                  >
                    {directions.length === 0 ? <option value="">Нет доступных объектов</option> : null}
                    {directions.map((direction) => (
                      <option key={direction.id} value={direction.id}>
                        {direction.name}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block space-y-1">
                  <span className="text-xs text-slate-500 dark:text-slate-400">Объект внутри направления</span>
                  <select
                    value={form.objectKey}
                    onChange={(event) => handleFormObjectChange(event.target.value)}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-brand-red transition focus:border-brand-red focus:ring-2 dark:border-slate-700 dark:bg-slate-800"
                    required
                    disabled={referenceLoading || !form.directionId || getDirectionObjects(form.directionId).length === 0}
                  >
                    {getDirectionObjects(form.directionId).length === 0 ? <option value="">Нет объектов</option> : null}
                    {getDirectionObjects(form.directionId).map((object) => (
                      <option key={object.key} value={object.key}>
                        {object.name}
                      </option>
                    ))}
                  </select>
                </label>

                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-300">
                  <p className="font-medium">Адрес выбранного объекта</p>
                  <p className="mt-1">{selectedDirectionObject?.address || selectedDirection?.address || 'Адрес недоступен'}</p>
                </div>

                <div className="space-y-2">
                  <p className="text-xs text-slate-500 dark:text-slate-400">Разделы (можно выбрать несколько)</p>
                  <div className="grid grid-cols-2 gap-2 rounded-lg border border-slate-200 bg-slate-50 p-2 text-xs dark:border-slate-700 dark:bg-slate-800/60">
                    {Object.entries(SECTION_LABELS).map(([key, label]) => (
                      <label key={key} className="inline-flex items-center gap-2 rounded-md px-2 py-1 hover:bg-white/70 dark:hover:bg-slate-700/60">
                        <input
                          type="checkbox"
                          checked={form.sections.includes(key as JournalSection)}
                          onChange={() => handleSectionToggle(key as JournalSection)}
                          className="h-4 w-4 rounded border-slate-300 text-brand-red focus:ring-brand-red dark:border-slate-600 dark:bg-slate-800"
                        />
                        <span>{label}</span>
                      </label>
                    ))}
                  </div>
                </div>

                <label className="block space-y-1">
                  <span className="text-xs text-slate-500 dark:text-slate-400">Тип записи</span>
                  <select
                    value={form.recordType}
                    onChange={(event) => updateForm('recordType', event.target.value as JournalRecordType)}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-brand-red transition focus:border-brand-red focus:ring-2 dark:border-slate-700 dark:bg-slate-800"
                  >
                    {Object.entries(RECORD_TYPE_LABELS).map(([key, label]) => (
                      <option key={key} value={key}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block space-y-1">
                  <span className="text-xs text-slate-500 dark:text-slate-400">Контрагент (только из справочника)</span>
                  <select
                    value={form.contractorId}
                    onChange={(event) => updateForm('contractorId', event.target.value)}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-brand-red transition focus:border-brand-red focus:ring-2 dark:border-slate-700 dark:bg-slate-800"
                    required
                    disabled={referenceLoading || contractors.length === 0}
                  >
                    {contractors.length === 0 ? <option value="">Нет доступных контрагентов</option> : null}
                    {contractors.map((contractor) => (
                      <option key={contractor.id} value={contractor.id}>
                        {contractor.name}
                      </option>
                    ))}
                  </select>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    Подставляется автоматически при выборе объекта. При необходимости можно изменить вручную.
                  </p>
                </label>

                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-300">
                  <p className="font-medium">Данные контрагента</p>
                  <p className="mt-1">ИНН: {selectedContractor?.inn || 'не указан'}</p>
                  <p className="mt-1">Email: {selectedContractor?.email || 'не указан'}</p>
                </div>

                <label className="block space-y-1">
                  <span className="text-xs text-slate-500 dark:text-slate-400">Зона/узел</span>
                  <input
                    value={form.zone}
                    onChange={(event) => updateForm('zone', event.target.value)}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-brand-red transition focus:border-brand-red focus:ring-2 dark:border-slate-700 dark:bg-slate-800"
                  />
                </label>

                <label className="block space-y-1">
                  <span className="text-xs text-slate-500 dark:text-slate-400">Описание работ/события</span>
                  <textarea
                    value={form.description}
                    onChange={(event) => updateForm('description', event.target.value)}
                    required
                    rows={3}
                    className={[
                      'w-full rounded-lg border bg-white px-3 py-2 text-sm outline-none ring-brand-red transition focus:border-brand-red focus:ring-2 dark:bg-slate-800',
                      form.description.trim().length > 0 && form.description.trim().length < DESCRIPTION_MIN_LENGTH
                        ? 'border-amber-400 dark:border-amber-600'
                        : 'border-slate-300 dark:border-slate-700',
                    ].join(' ')}
                  />
                  <div className="flex items-center justify-between">
                    <span className={[
                      'text-xs',
                      form.description.trim().length < DESCRIPTION_MIN_LENGTH
                        ? 'text-amber-600 dark:text-amber-400'
                        : 'text-slate-500 dark:text-slate-400',
                    ].join(' ')}>
                      {form.description.trim().length}/{DESCRIPTION_MIN_LENGTH}
                    </span>
                    {form.description.trim().length > 0 && form.description.trim().length < DESCRIPTION_MIN_LENGTH ? (
                      <span className="text-xs text-amber-600 dark:text-amber-400">
                        Укажите конкретно: какие узлы проверены, какие операции выполнены
                      </span>
                    ) : null}
                  </div>
                </label>

                <div className="grid grid-cols-1 gap-2">
                  <label className="block space-y-1">
                    <span className="text-xs text-slate-500 dark:text-slate-400">Организация-исполнитель</span>
                    <input
                      value={DEFAULT_EXECUTOR_ORGANIZATION}
                      readOnly
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-brand-red transition focus:border-brand-red focus:ring-2 dark:border-slate-700 dark:bg-slate-800"
                    />
                  </label>
                  <label className="block space-y-1">
                    <span className="text-xs text-slate-500 dark:text-slate-400">Исполнитель (ФИО)</span>
                    <input
                      value={form.executorName}
                      onChange={(event) => updateForm('executorName', event.target.value)}
                      required
                      placeholder="Иванов Иван Иванович"
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-brand-red transition focus:border-brand-red focus:ring-2 dark:border-slate-700 dark:bg-slate-800"
                    />
                  </label>
                  <label className="block space-y-1">
                    <span className="text-xs text-slate-500 dark:text-slate-400">Договор (подтягивается с объекта)</span>
                    <input
                      value={form.contractNumber}
                      readOnly
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-brand-red transition focus:border-brand-red focus:ring-2 dark:border-slate-700 dark:bg-slate-800"
                    />
                  </label>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <label className="block space-y-1">
                    <span className="text-xs text-slate-500 dark:text-slate-400">Лицензия МЧС</span>
                    <input
                      value={form.licenseNumber}
                      onChange={(event) => updateForm('licenseNumber', event.target.value)}
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-brand-red transition focus:border-brand-red focus:ring-2 dark:border-slate-700 dark:bg-slate-800"
                    />
                  </label>
                  <label className="block space-y-1">
                    <span className="text-xs text-slate-500 dark:text-slate-400">Статус лицензии</span>
                    <select
                      value={form.licenseStatus}
                      onChange={(event) => updateForm('licenseStatus', event.target.value as JournalEntry['licenseStatus'])}
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-brand-red transition focus:border-brand-red focus:ring-2 dark:border-slate-700 dark:bg-slate-800"
                    >
                      <option value="active">Действует</option>
                      <option value="suspended">Приостановлена</option>
                      <option value="expired">Истекла</option>
                      </select>
                  </label>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void checkContractorLicense()}
                    disabled={licenseCheckInFlight}
                    className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:hover:bg-slate-800"
                  >
                    {licenseCheckInFlight ? 'Проверяем...' : 'Проверить лицензию МЧС'}
                  </button>
                  {form.licenseCheckSnapshot ? (
                    <span className="text-xs text-slate-500 dark:text-slate-400">
                      Проверено: {formatDateTime(form.licenseCheckSnapshot.checkedAt)} ({form.licenseCheckSnapshot.status})
                    </span>
                  ) : null}
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <label className="block space-y-1">
                    <span className="text-xs text-slate-500 dark:text-slate-400">Режим ЭП</span>
                    <select
                      value={form.signatureMode}
                      onChange={(event) => updateForm('signatureMode', event.target.value as SignatureMode)}
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-brand-red transition focus:border-brand-red focus:ring-2 dark:border-slate-700 dark:bg-slate-800"
                    >
                      <option value="contract">{SIGNATURE_MODE_LABELS.contract}</option>
                      <option value="kep">{SIGNATURE_MODE_LABELS.kep}</option>
                    </select>
                  </label>
                  <label className="block space-y-1">
                    <span className="text-xs text-slate-500 dark:text-slate-400">МЧД ID</span>
                    <input
                      value={form.mchdId}
                      onChange={(event) => updateForm('mchdId', event.target.value)}
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-brand-red transition focus:border-brand-red focus:ring-2 dark:border-slate-700 dark:bg-slate-800"
                    />
                  </label>
                </div>

                {form.sections.includes('fire_extinguishers') ? (
                  <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
                    <input
                      type="checkbox"
                      checked={form.allowUnepByContract}
                      onChange={(event) => updateForm('allowUnepByContract', event.target.checked)}
                      className="h-4 w-4 rounded border-slate-300 text-brand-red focus:ring-brand-red dark:border-slate-600 dark:bg-slate-800"
                    />
                    УНЭП разрешена по договору (для раздела «Огнетушители»)
                  </label>
                ) : null}

                <label className="block space-y-1">
                  <span className="text-xs text-slate-500 dark:text-slate-400">Приложенные файлы (имена)</span>
                  <input
                    value={form.attachmentsInput}
                    onChange={(event) => updateForm('attachmentsInput', event.target.value)}
                    placeholder="act-01.pdf, protocol-02.docx"
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-brand-red transition focus:border-brand-red focus:ring-2 dark:border-slate-700 dark:bg-slate-800"
                  />
                </label>

                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-300">
                  <p className="font-medium">
                    Правило ЭП для разделов: {form.sections.map((section) => SECTION_LABELS[section]).join(', ') || 'не выбраны'}
                  </p>
                  <p className="mt-1">
                    {selectedSectionRules.length > 0
                      ? Array.from(new Set(selectedSectionRules.map((rule) => rule.note))).join(' ')
                      : 'Выберите минимум один раздел.'}
                  </p>
                </div>

                {formError ? (
                  <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300">
                    {formError}
                  </div>
                ) : null}

                {form.sections.length > 1 ? (
                  <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
                    <input
                      type="checkbox"
                      checked={groupedCreation}
                      onChange={(event) => setGroupedCreation(event.target.checked)}
                      className="h-4 w-4 rounded border-slate-300 text-brand-red focus:ring-brand-red dark:border-slate-600 dark:bg-slate-800"
                    />
                    Создать отдельную запись для каждой системы ({form.sections.length} шт.)
                  </label>
                ) : null}

                <div className="flex gap-2">
                  <button
                    type="submit"
                    className="flex-1 rounded-lg bg-brand-red px-3 py-2 text-sm font-semibold text-white transition hover:bg-red-700"
                    disabled={referenceLoading || !!referenceError || entryMutationInFlight || form.description.trim().length < DESCRIPTION_MIN_LENGTH}
                  >
                    {entryMutationInFlight ? 'Сохраняем...' : groupedCreation && form.sections.length > 1 ? `Создать ${form.sections.length} записей` : 'Создать запись'}
                  </button>
                  <button
                    type="button"
                    onClick={resetForm}
                    className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium transition hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
                  >
                    Очистить
                  </button>
                </div>
              </form>
            </section>
          </aside>

          <section className="space-y-6">
            <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <div className="mb-4 flex items-center gap-2">
                <Filter size={16} className="text-slate-500" />
                <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Фильтры
                </h2>
              </div>

              {referenceError ? (
                <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300">
                  {referenceError}
                </div>
              ) : null}

              <div className="grid gap-3 lg:grid-cols-2">
                <label className="block space-y-1">
                  <span className="text-xs text-slate-500 dark:text-slate-400">Поиск</span>
                  <div className="relative">
                    <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      value={filters.query}
                      onChange={(event) => setFilters((prev) => ({ ...prev, query: event.target.value }))}
                      placeholder="Объект, зона, подрядчик..."
                      className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm outline-none ring-brand-red transition focus:border-brand-red focus:ring-2 dark:border-slate-700 dark:bg-slate-800"
                    />
                  </div>
                </label>

                <label className="block space-y-1">
                  <span className="text-xs text-slate-500 dark:text-slate-400">Объект (из справочника)</span>
                  <select
                    value={filters.directionId}
                    onChange={(event) => applyDirectionContext(event.target.value)}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-brand-red transition focus:border-brand-red focus:ring-2 dark:border-slate-700 dark:bg-slate-800"
                    disabled={referenceLoading}
                  >
                    <option value="">Все объекты</option>
                    {directions.map((direction) => (
                      <option key={direction.id} value={direction.id}>
                        {direction.name}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block space-y-1">
                  <span className="text-xs text-slate-500 dark:text-slate-400">Контрагент (из справочника)</span>
                  <select
                    value={filters.contractorId}
                    onChange={(event) => setFilters((prev) => ({ ...prev, contractorId: event.target.value }))}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-brand-red transition focus:border-brand-red focus:ring-2 dark:border-slate-700 dark:bg-slate-800"
                    disabled={referenceLoading}
                  >
                    <option value="">Все контрагенты</option>
                    {contractors.map((contractor) => (
                      <option key={contractor.id} value={contractor.id}>
                        {contractor.name}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block space-y-1">
                  <span className="text-xs text-slate-500 dark:text-slate-400">Раздел</span>
                  <select
                    value={filters.section}
                    onChange={(event) =>
                      setFilters((prev) => ({ ...prev, section: event.target.value as FilterState['section'] }))
                    }
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-brand-red transition focus:border-brand-red focus:ring-2 dark:border-slate-700 dark:bg-slate-800"
                  >
                    <option value="all">Все разделы</option>
                    {Object.entries(SECTION_LABELS).map(([key, label]) => (
                      <option key={key} value={key}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block space-y-1">
                  <span className="text-xs text-slate-500 dark:text-slate-400">Статус подписи</span>
                  <select
                    value={filters.status}
                    onChange={(event) =>
                      setFilters((prev) => ({ ...prev, status: event.target.value as FilterState['status'] }))
                    }
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-brand-red transition focus:border-brand-red focus:ring-2 dark:border-slate-700 dark:bg-slate-800"
                  >
                    <option value="all">Все статусы</option>
                    {Object.entries(STATUS_LABELS).map(([key, label]) => (
                      <option key={key} value={key}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <button
                type="button"
                onClick={() => setFilters(INITIAL_FILTERS)}
                className="mt-3 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium transition hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
              >
                Сбросить фильтры
              </button>
            </article>

            <article className="rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <div className="border-b border-slate-200 px-5 py-4 dark:border-slate-800">
                <h2 className="text-lg font-semibold">Лента записей</h2>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                  Отфильтровано: {filteredEntries.length} из {entries.length}
                </p>
              </div>
              <div className="max-h-[460px] overflow-auto">
                {entriesLoading ? (
                  <div className="px-5 py-10 text-center text-sm text-slate-500 dark:text-slate-400">
                    Загрузка записей журнала...
                  </div>
                ) : filteredEntries.length === 0 ? (
                  <div className="px-5 py-10 text-center text-sm text-slate-500 dark:text-slate-400">
                    По текущим фильтрам записи не найдены.
                  </div>
                ) : (
                  <div className="space-y-4 p-4">
                    {groupedEntries.map((group) => (
                      <section key={group.key} className="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800">
                        <div className="border-b border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-800 dark:bg-slate-800/40">
                          <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{group.name}</p>
                          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                            {group.address || 'Адрес не указан'} • Записей: {group.items.length}
                          </p>
                        </div>
                        <div className="divide-y divide-slate-200 dark:divide-slate-800">
                          {group.items.map((entry) => (
                            <button
                              key={entry.id}
                              type="button"
                              onClick={() => setSelectedId(entry.id)}
                              className={[
                                'w-full px-4 py-4 text-left transition',
                                selectedEntry?.id === entry.id ? 'bg-brand-red/5' : 'hover:bg-slate-50 dark:hover:bg-slate-800/50',
                              ].join(' ')}
                            >
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <div>
                                  <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                                    {RECORD_TYPE_LABELS[entry.recordType]} • {getEntrySections(entry).map((section) => SECTION_LABELS[section]).join(', ')}
                                  </p>
                                  <p className="text-xs text-slate-500 dark:text-slate-400">
                                    {entry.zone || 'Зона не указана'}
                                  </p>
                                </div>
                                <span className={['rounded-full px-2.5 py-1 text-xs font-medium', STATUS_BADGE_CLASS[entry.status]].join(' ')}>
                                  {STATUS_LABELS[entry.status]}
                                </span>
                              </div>
                              <div className="mt-2 grid gap-2 text-xs text-slate-500 dark:text-slate-400 sm:grid-cols-4">
                                <div className="inline-flex items-center gap-1.5">
                                  <CalendarClock size={14} />
                                  {formatDateTime(entry.eventDateTime)}
                                </div>
                                <div className="inline-flex items-center gap-1.5">
                                  <FilePen size={14} />
                                  {SIGNATURE_MODE_LABELS[entry.signatureMode]}
                                </div>
                                <div>{entry.contractor}</div>
                                <div>{entry.contractNumber}</div>
                              </div>
                            </button>
                          ))}
                        </div>
                      </section>
                    ))}

                    {/* Pagination controls */}
                    {entries.length > ENTRIES_PER_PAGE ? (
                      <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3 dark:border-slate-800">
                        <p className="text-xs text-slate-500">
                          Показано {Math.min(filteredEntries.length, ENTRIES_PER_PAGE)} из {filteredEntries.length} записей
                        </p>
                        <div className="flex gap-1">
                          <button
                            type="button"
                            disabled={paginationPage <= 1}
                            onClick={() => setPaginationPage(p => Math.max(1, p - 1))}
                            className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium transition hover:bg-slate-100 disabled:opacity-40 dark:border-slate-600 dark:hover:bg-slate-800"
                          >
                            <ChevronLeft size={14} />
                          </button>
                          <span className="inline-flex items-center px-3 text-xs text-slate-600 dark:text-slate-400">
                            Стр. {paginationPage} / {paginationTotalPages || 1}
                          </span>
                          <button
                            type="button"
                            disabled={paginationPage >= paginationTotalPages}
                            onClick={() => setPaginationPage(p => Math.min(paginationTotalPages, p + 1))}
                            className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium transition hover:bg-slate-100 disabled:opacity-40 dark:border-slate-600 dark:hover:bg-slate-800"
                          >
                            <ChevronRight size={14} />
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </div>
                )}
              </div>
            </article>

            <article className="rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
              {!selectedEntry ? (
                <div className="px-5 py-10 text-center text-sm text-slate-500 dark:text-slate-400">
                  Выберите запись из списка.
                </div>
              ) : (
                <>
                  <div className="border-b border-slate-200 px-5 py-4 dark:border-slate-800">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="text-sm text-slate-500 dark:text-slate-400">Запись #{selectedEntry.id}</p>
                        <h3 className="text-lg font-semibold">
                          {selectedEntry.objectName} • {RECORD_TYPE_LABELS[selectedEntry.recordType]}
                        </h3>
                      </div>
                      <span className={['rounded-full px-2.5 py-1 text-xs font-medium', STATUS_BADGE_CLASS[selectedEntry.status]].join(' ')}>
                        {STATUS_LABELS[selectedEntry.status]}
                      </span>
                    </div>
                  </div>

                  <div className="grid gap-6 px-5 py-5 lg:grid-cols-[1.3fr_0.7fr]">
                    <div className="space-y-4">
                      <div className="grid gap-3 rounded-xl border border-slate-200 p-4 text-sm dark:border-slate-700 sm:grid-cols-2">
                        <div>
                          <p className="text-xs text-slate-500 dark:text-slate-400">EventDateTime</p>
                          <p className="mt-1 font-medium">{formatDateTime(selectedEntry.eventDateTime)}</p>
                        </div>
                        <div>
                          <p className="text-xs text-slate-500 dark:text-slate-400">EntryTimestamp</p>
                          <p className="mt-1 font-medium">{formatDateTime(selectedEntry.entryTimestamp)}</p>
                        </div>
                        <div>
                          <p className="text-xs text-slate-500 dark:text-slate-400">Раздел</p>
                          <p className="mt-1 font-medium">
                            {getEntrySections(selectedEntry).map((section) => SECTION_LABELS[section]).join(', ')}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs text-slate-500 dark:text-slate-400">Режим ЭП</p>
                          <p className="mt-1 font-medium">{SIGNATURE_MODE_LABELS[selectedEntry.signatureMode]}</p>
                        </div>
                        <div>
                          <p className="text-xs text-slate-500 dark:text-slate-400">Подрядчик</p>
                          <p className="mt-1 font-medium">{selectedEntry.contractor}</p>
                        </div>
                        <div>
                          <p className="text-xs text-slate-500 dark:text-slate-400">ИНН подрядчика</p>
                          <p className="mt-1 font-medium">{selectedEntry.contractorInn || 'не указан'}</p>
                        </div>
                        <div>
                          <p className="text-xs text-slate-500 dark:text-slate-400">Организация-исполнитель</p>
                          <p className="mt-1 font-medium">{getExecutorOrganization(selectedEntry)}</p>
                        </div>
                        <div>
                          <p className="text-xs text-slate-500 dark:text-slate-400">Исполнитель</p>
                          <p className="mt-1 font-medium">{selectedEntry.executorName}</p>
                        </div>
                        <div>
                          <p className="text-xs text-slate-500 dark:text-slate-400">МЧД</p>
                          <p className="mt-1 font-medium">{selectedEntry.mchdId}</p>
                        </div>
                        <div>
                          <p className="text-xs text-slate-500 dark:text-slate-400">Подписант заказчика (ФИО)</p>
                          <p className="mt-1 font-medium">{selectedEntry.customerSignerFio || 'не указан'}</p>
                        </div>
                        <div>
                          <p className="text-xs text-slate-500 dark:text-slate-400">Номер приказа</p>
                          <p className="mt-1 font-medium">{selectedEntry.customerSignerOrderNumber || 'не указан'}</p>
                        </div>
                        <div>
                          <p className="text-xs text-slate-500 dark:text-slate-400">УНЭП по договору</p>
                          <p className="mt-1 font-medium">{selectedEntry.allowUnepByContract ? 'да' : 'нет'}</p>
                        </div>
                      </div>

                      <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-700">
                        <p className="text-xs text-slate-500 dark:text-slate-400">Описание</p>
                        <p className="mt-2 text-sm leading-relaxed">{selectedEntry.description}</p>
                        {selectedEntry.correctionOfId ? (
                          <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-900/20 dark:text-amber-300">
                            Исправление к записи: {selectedEntry.correctionOfId}
                          </p>
                        ) : null}
                      </div>

                      <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-700">
                        <p className="text-xs text-slate-500 dark:text-slate-400">Вложения</p>
                        {selectedEntry.attachments.length === 0 ? (
                          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">Нет вложений</p>
                        ) : (
                          <ul className="mt-2 space-y-1 text-sm">
                            {selectedEntry.attachments.map((attachment) => (
                              <li key={attachment} className="rounded-md bg-slate-50 px-3 py-2 dark:bg-slate-800/60">
                                {attachment}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>

                      {selectedEntry.licenseCheckSnapshot ? (
                        <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-700">
                          <p className="text-xs text-slate-500 dark:text-slate-400">Снапшот проверки лицензии</p>
                          <p className="mt-2 text-sm">
                            Статус: <span className="font-medium">{selectedEntry.licenseCheckSnapshot.status}</span>
                          </p>
                          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                            Проверено: {formatDateTime(selectedEntry.licenseCheckSnapshot.checkedAt)} • Источник:{' '}
                            {selectedEntry.licenseCheckSnapshot.source || 'manual'}
                          </p>
                          {selectedEntry.licenseCheckSnapshot.message ? (
                            <p className="mt-2 text-xs text-slate-600 dark:text-slate-300">
                              {selectedEntry.licenseCheckSnapshot.message}
                            </p>
                          ) : null}
                        </div>
                      ) : null}

                      <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-700">
                        <p className="text-xs text-slate-500 dark:text-slate-400">Аудит действий по записи</p>
                        {auditLoading && !auditByEntryId[selectedEntry.id] ? (
                          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">Загрузка аудита...</p>
                        ) : (auditByEntryId[selectedEntry.id] || []).length === 0 ? (
                          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">Записи аудита не найдены.</p>
                        ) : (
                          <ul className="mt-2 space-y-1 text-xs">
                            {(auditByEntryId[selectedEntry.id] || []).slice(0, 12).map((row) => (
                              <li key={row.id} className="rounded-md bg-slate-50 px-3 py-2 dark:bg-slate-800/60">
                                <p className="font-medium">{row.action}</p>
                                <p className="text-slate-500 dark:text-slate-400">
                                  {formatDateTime(row.createdAt)} • {row.actorRole || 'n/a'}
                                </p>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </div>

                    <div className="space-y-4">
                      <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-700">
                        <div className="inline-flex items-center gap-2 text-sm font-medium">
                          <ShieldCheck size={16} />
                          Цепочка подписания
                        </div>
                        <div className="mt-3 space-y-2 text-sm">
                          <div
                            className={[
                              'rounded-lg border px-3 py-2',
                              selectedEntry.status === 'draft'
                                ? 'border-slate-300 bg-slate-50 dark:border-slate-700 dark:bg-slate-800/60'
                                : 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-900/20 dark:text-emerald-300',
                            ].join(' ')}
                          >
                            1) Подпись исполнителя
                          </div>
                          <div
                            className={[
                              'rounded-lg border px-3 py-2',
                              selectedEntry.status === 'fully_signed'
                                ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-900/20 dark:text-emerald-300'
                                : 'border-slate-300 bg-slate-50 dark:border-slate-700 dark:bg-slate-800/60',
                            ].join(' ')}
                          >
                            2) Подпись заказчика
                          </div>
                        </div>
                        {selectedEntry.status === 'fully_signed' ? (
                          <div className="mt-3 inline-flex items-center gap-1 rounded-md bg-slate-900 px-2.5 py-1 text-xs text-white dark:bg-slate-100 dark:text-slate-900">
                            <Lock size={12} />
                            Запись locked (редактирование запрещено)
                          </div>
                        ) : null}
                      </div>

                      <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-700">
                        <p className="text-xs text-slate-500 dark:text-slate-400">Действия</p>
                        <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-300">
                          <p>Подписать как исполнитель: переводит запись из «Черновик» в «Подписано исполнителем».</p>
                          <p className="mt-1">Подписать как заказчик: закрывает запись статусом «Подписано обеими сторонами (locked)».</p>
                          <p className="mt-1">Повторно отправить ссылку: отправляет контрагенту email-ссылку на внешнее подписание.</p>
                          <p className="mt-1">Создать исправление: формирует новую запись-корректировку с ссылкой на исходную.</p>
                        </div>
                        <div className="mt-3 space-y-2">
                          <button
                            type="button"
                            disabled={!canSignExecutorAction}
                            onClick={() => void signAsExecutor(selectedEntry.id)}
                            title={
                              canSignExecutorAction
                                ? 'Перевести запись в статус "Подписано исполнителем"'
                                : 'Доступно только для статуса "Черновик" и роли исполнителя'
                            }
                            className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white transition enabled:hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900 dark:enabled:hover:bg-slate-200"
                          >
                            <FilePen size={15} />
                            Подписать как исполнитель
                          </button>
                          <button
                            type="button"
                            disabled={!canSignCustomerAction}
                            onClick={() => void signAsCustomer(selectedEntry.id)}
                            title={
                              canSignCustomerAction
                                ? 'Перевести запись в статус "Подписано обеими сторонами"'
                                : 'Доступно только после подписи исполнителя и для роли заказчика'
                            }
                            className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white transition enabled:hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            <CheckCheck size={15} />
                            Подписать как заказчик
                          </button>
                          <button
                            type="button"
                            disabled={!canResendCustomerSignLinkAction}
                            onClick={() => void resendCustomerSignLink(selectedEntry.id)}
                            title={
                              canResendCustomerSignLinkAction
                                ? 'Повторно отправить ссылку контрагенту на подписание'
                                : 'Доступно только в статусе "Подписано исполнителем"'
                            }
                            className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:hover:bg-slate-800"
                          >
                            <MailWarning size={15} />
                            Повторно отправить ссылку
                          </button>
                          <button
                            type="button"
                            disabled={!canCreateCorrectionAction}
                            onClick={() => void createCorrection(selectedEntry)}
                            title={
                              canCreateCorrectionAction
                                ? 'Создать новую запись-исправление с ссылкой на исходную'
                                : 'Доступно только для записи со статусом "Подписано обеими сторонами"'
                            }
                            className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium transition hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
                          >
                            <Plus size={15} />
                            Создать исправление
                          </button>
                        </div>
                        {actionMessage ? (
                          <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:border-amber-900/40 dark:bg-amber-900/20 dark:text-amber-300">
                            {actionMessage}
                          </div>
                        ) : null}
                      </div>

                      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-800 dark:border-amber-900/40 dark:bg-amber-900/20 dark:text-amber-200">
                        <p className="inline-flex items-center gap-1.5 font-semibold">
                          <AlertCircle size={14} />
                          Юридический контур (напоминание)
                        </p>
                        <p className="mt-2">
                          Для разделов {getEntrySections(selectedEntry).map((section) => SECTION_LABELS[section]).join(', ')} применено правило:{' '}
                          {Array.from(new Set(getEntrySections(selectedEntry).map((section) => SECTION_SIGNATURE_RULES[section].note))).join(' ')}
                        </p>
                      </div>
                    </div>
                  </div>
                </>
              )}
            </article>
          </section>
        </div>
        </>
        ) : null}
      </div>

      {/* Inspector Access Modal */}
      {inspectorModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-700 dark:bg-slate-900">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold">Доступ для проверки (ГПН)</h3>
              <button
                type="button"
                onClick={() => setInspectorModalOpen(false)}
                className="rounded-lg p-1 text-slate-500 transition hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X size={20} />
              </button>
            </div>
            <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
              Создайте временную ссылку для пожарного инспектора с доступом только на чтение подписанных записей.
            </p>

            <div className="mt-4 space-y-3">
              <label className="block space-y-1">
                <span className="text-xs text-slate-500 dark:text-slate-400">Направление</span>
                <select
                  value={form.directionId}
                  onChange={(event) => handleFormDirectionChange(event.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-brand-red transition focus:border-brand-red focus:ring-2 dark:border-slate-700 dark:bg-slate-800"
                  disabled={directions.length === 0}
                >
                  {directions.map((direction) => (
                    <option key={direction.id} value={direction.id}>
                      {direction.name}
                    </option>
                  ))}
                </select>
              </label>

              <div className="grid grid-cols-2 gap-2">
                <label className="block space-y-1">
                  <span className="text-xs text-slate-500 dark:text-slate-400">Период с</span>
                  <input
                    type="date"
                    value={inspectorPeriodFrom}
                    onChange={(event) => setInspectorPeriodFrom(event.target.value)}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-brand-red transition focus:border-brand-red focus:ring-2 dark:border-slate-700 dark:bg-slate-800"
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-xs text-slate-500 dark:text-slate-400">Период по</span>
                  <input
                    type="date"
                    value={inspectorPeriodTo}
                    onChange={(event) => setInspectorPeriodTo(event.target.value)}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-brand-red transition focus:border-brand-red focus:ring-2 dark:border-slate-700 dark:bg-slate-800"
                  />
                </label>
              </div>

              <label className="block space-y-1">
                <span className="text-xs text-slate-500 dark:text-slate-400">Срок действия (часов)</span>
                <select
                  value={inspectorExpiresHours}
                  onChange={(event) => setInspectorExpiresHours(Number(event.target.value))}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-brand-red transition focus:border-brand-red focus:ring-2 dark:border-slate-700 dark:bg-slate-800"
                >
                  <option value={24}>24 часа</option>
                  <option value={48}>48 часов</option>
                  <option value={72}>72 часа</option>
                </select>
              </label>

              <button
                type="button"
                onClick={() => void createInspectorAccess()}
                disabled={inspectorLoading || !form.directionId}
                className="w-full rounded-lg bg-sky-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {inspectorLoading ? 'Создаем...' : 'Создать ссылку'}
              </button>

              {inspectorError ? (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300">
                  {inspectorError}
                </div>
              ) : null}

              {inspectorLink ? (
                <div className="space-y-2">
                  <p className="text-xs font-medium text-emerald-700 dark:text-emerald-300">Ссылка создана:</p>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      readOnly
                      value={inspectorLink}
                      className="flex-1 rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-xs outline-none dark:border-slate-700 dark:bg-slate-800"
                      onClick={(event) => (event.target as HTMLInputElement).select()}
                    />
                    <button
                      type="button"
                      onClick={() => void copyInspectorLink()}
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-2 text-xs font-medium transition hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
                    >
                      <Copy size={14} />
                      {inspectorCopied ? 'Скопировано' : 'Копировать'}
                    </button>
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    Ссылка предоставляет доступ только к подписанным записям выбранного направления. Черновики не отображаются.
                  </p>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
