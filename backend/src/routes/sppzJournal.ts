import { randomBytes, createHash } from 'node:crypto';
import { join as pathJoin } from 'node:path';
import { isUuidValue } from '../helpers/normalize.js';

const STAFF_ROLES = new Set(['admin', 'manager', 'curator', 'dispatcher', 'executor', 'installer']);
const ADMIN_LIKE_SPPZ_ROLES = new Set(['admin', 'manager']);
const EXECUTOR_SIGN_ROLES = new Set(['admin', 'manager', 'curator', 'dispatcher', 'executor']);
const CUSTOMER_SIGN_ROLES = new Set(['admin', 'manager', 'curator']);
const VALID_FIRE_CLASSES = new Set(['f1', 'f2', 'f3', 'f4', 'f5']);
const VALID_FIRE_SYSTEM_TYPE_CODES = new Set([
    'aps', 'aupt', 'soue', 'pdv', 'vpv', 'npv', 'ogn', 'ext', 'pl', 'door', 'sizod',
]);
const VALID_FIRE_SYSTEM_STATUSES = new Set(['active', 'inactive', 'decommissioned']);
const VALID_STATUSES = new Set(['draft', 'executor_signed', 'fully_signed']);
const VALID_SECTIONS = new Set(['aps', 'soue', 'aupt', 'vpv', 'fire_extinguishers', 'pdv', 'pl', 'hose_reroll', 'booster_pumps', 'custom']);

// ГОСТ Р 57974-2017 check periods (in days)
const FIRE_CHECK_PERIODS: Record<string, { label: string; days: number; labelRu: string }[]> = {
    aps: [{ label: 'quarterly', days: 90, labelRu: 'Квартальная проверка' }],
    soue: [{ label: 'quarterly', days: 90, labelRu: 'Квартальная проверка' }],
    aupt: [{ label: 'semi_annual', days: 180, labelRu: 'Полугодовая проверка' }],
    pdv: [{ label: 'semi_annual', days: 180, labelRu: 'Полугодовая проверка' }],
    vpv: [{ label: 'semi_annual', days: 180, labelRu: 'Полугодовая проверка' }],
    fire_extinguishers: [
        { label: 'annual_full', days: 365, labelRu: 'Годовая полная проверка' },
        { label: 'quarterly_inspection', days: 90, labelRu: 'Квартальный осмотр' },
    ],
    pl: [{ label: 'five_year', days: 1825, labelRu: 'Проверка раз в 5 лет' }],
    hose_reroll: [{ label: 'annual', days: 365, labelRu: 'Ежегодная перекатка' }],
    booster_pumps: [{ label: 'monthly', days: 30, labelRu: 'Ежемесячная проверка' }],
};

const POSITIVE_RESULTS = new Set([
    'исправна', 'исправно', 'исправен', 'норма', 'годен', 'годна', 'годно',
    'пройдена', 'пройдено', 'ок', 'ok', 'pass', 'passed', 'работоспособна',
    'работоспособно', 'работоспособен', 'соответствует',
]);

const isPositiveResult = (description: string) => {
    const lower = (description || '').toLowerCase().trim();
    if (!lower) return true; // default to positive if no explicit result
    for (const keyword of POSITIVE_RESULTS) {
        if (lower.includes(keyword)) return true;
    }
    return false;
};

const resolveUserDirectionIds = async (request: any, dbQuery: any): Promise<string[] | null> => {
    const role = request.authUser?.role ?? '';
    if (ADMIN_LIKE_SPPZ_ROLES.has(role)) return null;
    const userId = request.authUser?.id;
    if (!userId) return [];
    const result = await dbQuery(
        `SELECT direction_id::text FROM app_user_direction_bindings WHERE user_id = $1::uuid`,
        [userId],
    );
    return result.rows.map((row: any) => row.direction_id);
};

const computeNextCheckDates = (section: string, entryDate: string) => {
    const periods = FIRE_CHECK_PERIODS[section];
    if (!periods) return [];
    const base = new Date(entryDate);
    if (Number.isNaN(base.getTime())) return [];
    return periods.map((period) => {
        const next = new Date(base.getTime() + period.days * 24 * 60 * 60 * 1000);
        return {
            section,
            checkType: period.label,
            checkTypeLabel: period.labelRu,
            periodDays: period.days,
            nextCheckDate: next.toISOString(),
        };
    });
};
const VALID_RECORD_TYPES = new Set([
    'maintenance',
    'repair',
    'testing',
    'functional_control',
    'shutdown',
    'fault',
    'false_trigger',
    'trigger',
    'other',
]);
const VALID_SIGNATURE_MODES = new Set(['kep', 'contract']);
const VALID_LICENSE_STATUSES = new Set(['active', 'suspended', 'expired']);
const LICENSE_CHECK_RESULT_STATUSES = new Set(['active', 'suspended', 'expired', 'unknown']);
const DEFAULT_EXECUTOR_ORGANIZATION = 'ООО Новинжстрой';
const CUSTOMER_SIGN_TOKEN_TTL_HOURS = 24 * 14;
const INSPECTOR_TOKEN_MIN_HOURS = 24;
const INSPECTOR_TOKEN_MAX_HOURS = 72;
const DESCRIPTION_MIN_LENGTH = 50;
const ADMIN_ROLES = new Set(['admin']);

const buildInspectorToken = () => randomBytes(32).toString('base64url');


const isEmailValue = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

const buildEntryId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const buildSigningToken = () => randomBytes(24).toString('base64url');

const normalizeBoolean = (value: unknown) => value === true;

const resolveLicenseCheckStatus = (value: unknown): 'active' | 'suspended' | 'expired' | 'unknown' => {
    const text = String(value ?? '').trim().toLowerCase();
    if (!text) return 'unknown';
    if (text === 'active' || text === 'действует' || text.includes('действ')) return 'active';
    if (text === 'suspended' || text.includes('приостан') || text.includes('suspend')) return 'suspended';
    if (text === 'expired' || text.includes('истек') || text.includes('expired')) return 'expired';
    return 'unknown';
};

const normalizeStringArray = (value: unknown) =>
    Array.isArray(value)
        ? value.map((item) => (typeof item === 'string' ? item.trim() : '')).filter(Boolean)
        : [];

const pickFirstContactEmail = (contactsRaw: any) => {
    let contacts = contactsRaw;
    if (typeof contacts === 'string') {
        try {
            contacts = JSON.parse(contacts);
        } catch {
            contacts = [];
        }
    }
    if (!Array.isArray(contacts)) return '';
    for (const contact of contacts) {
        const email = typeof contact?.email === 'string' ? contact.email.trim().toLowerCase() : '';
        if (email && isEmailValue(email)) return email;
    }
    return '';
};

const computeEntryHash = (
    prevEntryHash: string,
    entryId: string,
    entryDataJson: string,
    executorSignedAt: string,
    customerSignedAt: string,
): string => {
    const payload = [prevEntryHash, entryId, entryDataJson, executorSignedAt, customerSignedAt].join('|');
    return createHash('sha256').update(payload, 'utf8').digest('hex');
};

const resolveAppBaseUrl = (request: any, appConfig: any, normalizeText: (value: unknown) => string) => {
    const configured = normalizeText(appConfig?.appUrl).replace(/\/+$/, '');
    if (configured) return configured;

    const host = normalizeText(request?.get?.('host'));
    if (!host) return '';

    const forwardedProto = normalizeText(request?.get?.('x-forwarded-proto')).toLowerCase();
    const proto = forwardedProto || (request?.secure ? 'https' : 'http');
    if (proto !== 'http' && proto !== 'https') {
        return `https://${host}`;
    }

    return `${proto}://${host}`;
};

const buildCustomerSigningLink = (
    request: any,
    appConfig: any,
    normalizeText: (value: unknown) => string,
    token: string,
) => {
    const base = resolveAppBaseUrl(request, appConfig, normalizeText);
    const path = `/sppz-journal/customer-sign?token=${encodeURIComponent(token)}`;
    return base ? `${base}${path}` : path;
};

const normalizeEntryPayload = (body: any, normalizeText: (value: unknown) => string, forceStatus = 'draft') => {
    const id = normalizeText(body?.id) || buildEntryId();
    const rawSections = normalizeStringArray(body?.sections).filter((item) => VALID_SECTIONS.has(item));
    const fallbackSection = VALID_SECTIONS.has(normalizeText(body?.section))
        ? normalizeText(body?.section)
        : 'custom';
    const sections = rawSections.length > 0 ? rawSections : [fallbackSection];
    const section = sections[0];
    const recordType = VALID_RECORD_TYPES.has(normalizeText(body?.recordType))
        ? normalizeText(body?.recordType)
        : 'other';
    const signatureMode = VALID_SIGNATURE_MODES.has(normalizeText(body?.signatureMode))
        ? normalizeText(body?.signatureMode)
        : 'contract';
    const licenseStatus = VALID_LICENSE_STATUSES.has(normalizeText(body?.licenseStatus))
        ? normalizeText(body?.licenseStatus)
        : 'active';
    const eventDateTime = normalizeText(body?.eventDateTime) || new Date().toISOString();
    const entryTimestamp = normalizeText(body?.entryTimestamp) || new Date().toISOString();
    const status = VALID_STATUSES.has(forceStatus) ? forceStatus : 'draft';
    const executorOrganization = normalizeText(body?.executorOrganization) || DEFAULT_EXECUTOR_ORGANIZATION;
    const executorName = normalizeText(body?.executorName);
    const attachments = normalizeStringArray(body?.attachments);
    const allowUnepByContract = normalizeBoolean(body?.allowUnepByContract);
    const rawLicenseCheckSnapshot = body?.licenseCheckSnapshot;
    const licenseCheckSnapshot =
        rawLicenseCheckSnapshot && typeof rawLicenseCheckSnapshot === 'object'
            ? {
                checkId: normalizeText((rawLicenseCheckSnapshot as any).checkId),
                checkedAt: normalizeText((rawLicenseCheckSnapshot as any).checkedAt),
                source: normalizeText((rawLicenseCheckSnapshot as any).source),
                status: resolveLicenseCheckStatus((rawLicenseCheckSnapshot as any).status),
                message: normalizeText((rawLicenseCheckSnapshot as any).message),
                licenseNumber: normalizeText((rawLicenseCheckSnapshot as any).licenseNumber),
                contractorInn: normalizeText((rawLicenseCheckSnapshot as any).contractorInn),
                contractorName: normalizeText((rawLicenseCheckSnapshot as any).contractorName),
            }
            : undefined;

    return {
        id,
        eventDateTime,
        entryTimestamp,
        directionId: isUuidValue(body?.directionId) ? body.directionId : undefined,
        maintenanceItemId: isUuidValue(body?.maintenanceItemId) ? body.maintenanceItemId : undefined,
        contractorId: isUuidValue(body?.contractorId) ? body.contractorId : undefined,
        objectKey: normalizeText(body?.objectKey) || '',
        objectName: normalizeText(body?.objectName) || '',
        address: normalizeText(body?.address) || '',
        section,
        sections,
        zone: normalizeText(body?.zone) || '',
        recordType,
        description: normalizeText(body?.description) || '',
        contractor: normalizeText(body?.contractor) || '',
        contractorInn: normalizeText(body?.contractorInn) || '',
        executorOrganization,
        executorName,
        contractNumber: normalizeText(body?.contractNumber) || '',
        licenseNumber: normalizeText(body?.licenseNumber) || '',
        licenseStatus,
        licenseCheckSnapshot,
        signatureMode,
        allowUnepByContract,
        mchdId: normalizeText(body?.mchdId) || '',
        attachments,
        status,
        correctionOfId: normalizeText(body?.correctionOfId) || undefined,
    };
};

const validateEntryCompliance = (payload: any, ApiError: any) => {
    const sections = Array.isArray(payload?.sections) ? payload.sections : [];
    const includesFireExtinguishers = sections.includes('fire_extinguishers');
    const signatureMode = String(payload?.signatureMode || 'contract');
    const allowUnepByContract = payload?.allowUnepByContract === true;

    if (includesFireExtinguishers && signatureMode !== 'kep' && !allowUnepByContract) {
        throw new ApiError(
            422,
            'SIGNATURE_POLICY_VIOLATION',
            'Для раздела "Огнетушители" требуется УКЭП либо явное разрешение УНЭП по договору.',
        );
    }
};

const mapJournalRow = (row: any) => {
    const data = row?.entry_data && typeof row.entry_data === 'object' ? row.entry_data : {};
    return {
        ...data,
        id: row.id || data.id,
        directionId: row.direction_id ?? data.directionId,
        maintenanceItemId: row.maintenance_item_id ?? data.maintenanceItemId,
        contractorId: row.contractor_id ?? data.contractorId,
        objectKey: row.object_key ?? data.objectKey,
        eventDateTime: row.event_datetime ?? data.eventDateTime,
        entryTimestamp: row.entry_timestamp ?? data.entryTimestamp,
        status: row.status ?? data.status ?? 'draft',
        correctionOfId: row.correction_of_id ?? data.correctionOfId,
        executorSignedAt: row.executor_signed_at ?? data.executorSignedAt,
        executorSignedById: row.executor_signed_by ?? data.executorSignedById,
        customerSignedAt: row.customer_signed_at ?? data.customerSignedAt,
        customerSignedById: row.customer_signed_by ?? data.customerSignedById,
        createdAt: row.created_at ?? data.createdAt,
        updatedAt: row.updated_at ?? data.updatedAt,
        prevEntryHash: row.prev_entry_hash ?? undefined,
        entryHash: row.entry_hash ?? undefined,
    };
};

/* ──────────────────────────────────────────────────────────────────────
 *  PDF Generation helpers (F-060 / F-063)
 * ────────────────────────────────────────────────────────────────────── */

const PDF_SECTION_LABELS: Record<string, string> = {
    aps: 'СПС',
    soue: 'СОУЭ',
    aupt: 'АУПТ',
    vpv: 'ВПВ',
    fire_extinguishers: 'Огнетушители',
    custom: 'Прочее',
};

const PDF_RECORD_TYPE_LABELS: Record<string, string> = {
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

const PDF_SIGNATURE_MODE_LABELS: Record<string, string> = {
    kep: 'УКЭП',
    contract: 'ЭП по договору',
};

const getPdfMakeInstance = () => {
    const pdfmake = require('pdfmake');
    const fontsDir = pathJoin(
        require.resolve('pdfmake').replace(/[/\\]js[/\\]index\.js$/, ''),
        'build',
        'fonts',
        'Roboto',
    );
    pdfmake.fonts = {
        Roboto: {
            normal: pathJoin(fontsDir, 'Roboto-Regular.ttf'),
            bold: pathJoin(fontsDir, 'Roboto-Medium.ttf'),
            italics: pathJoin(fontsDir, 'Roboto-Italic.ttf'),
            bolditalics: pathJoin(fontsDir, 'Roboto-MediumItalic.ttf'),
        },
    };
    return pdfmake;
};

const formatDateTimeRu = (value: string | undefined) => {
    if (!value) return '\u2014';
    try {
        const d = new Date(value);
        if (Number.isNaN(d.getTime())) return value;
        return d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch { return value; }
};

const formatDateRu = (value: string | undefined) => {
    if (!value) return '\u2014';
    try {
        const d = new Date(value);
        if (Number.isNaN(d.getTime())) return value;
        return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
    } catch { return value; }
};

const resolveEntrySections = (entry: any): string => {
    const sections = Array.isArray(entry?.sections) && entry.sections.length > 0
        ? entry.sections : [entry?.section || 'custom'];
    return sections.map((s: string) => PDF_SECTION_LABELS[s] || s).join(', ');
};

const resolveSignatureStamp = (entry: any): string => {
    const status = String(entry?.status || 'draft');
    if (status === 'fully_signed') {
        const parts = ['Подписано обеими сторонами'];
        if (entry?.executorSignedAt) parts.push(`Исп: ${formatDateTimeRu(entry.executorSignedAt)}`);
        if (entry?.customerSignedAt) parts.push(`Зак: ${formatDateTimeRu(entry.customerSignedAt)}`);
        if (entry?.customerSignerFio) parts.push(entry.customerSignerFio);
        return parts.join('\n');
    }
    if (status === 'executor_signed') {
        return `Подп. исп. (${formatDateTimeRu(entry?.executorSignedAt)})`;
    }
    return 'Черновик';
};

const buildJournalPdfDocument = (entries: any[], options: {
    organizationName?: string; objectName?: string; address?: string;
    periodFrom?: string; periodTo?: string;
}) => {
    const orgName = options.organizationName || DEFAULT_EXECUTOR_ORGANIZATION;
    const objectName = options.objectName || 'Все объекты';
    const address = options.address || '';
    const periodLabel = options.periodFrom || options.periodTo
        ? `${formatDateRu(options.periodFrom)} \u2014 ${formatDateRu(options.periodTo)}`
        : 'Все записи';

    const tableBody: any[][] = [[
        { text: '\u2116', style: 'tableHeader' },
        { text: 'Дата/время', style: 'tableHeader' },
        { text: 'Объект', style: 'tableHeader' },
        { text: 'Раздел', style: 'tableHeader' },
        { text: 'Тип записи', style: 'tableHeader' },
        { text: 'Описание', style: 'tableHeader' },
        { text: 'Подрядчик', style: 'tableHeader' },
        { text: 'Исполнитель', style: 'tableHeader' },
        { text: 'Режим ЭП', style: 'tableHeader' },
        { text: 'Статус подписи', style: 'tableHeader' },
    ]];

    for (let i = 0; i < entries.length; i += 1) {
        const e = entries[i];
        tableBody.push([
            { text: String(i + 1), style: 'tableCell' },
            { text: formatDateTimeRu(e.eventDateTime), style: 'tableCell' },
            { text: e.objectName || '\u2014', style: 'tableCell' },
            { text: resolveEntrySections(e), style: 'tableCell' },
            { text: PDF_RECORD_TYPE_LABELS[e.recordType] || e.recordType || '\u2014', style: 'tableCell' },
            { text: e.description || '\u2014', style: 'tableCell' },
            { text: e.contractor || '\u2014', style: 'tableCell' },
            { text: `${e.executorOrganization || DEFAULT_EXECUTOR_ORGANIZATION}\n${e.executorName || ''}`.trim(), style: 'tableCell' },
            { text: PDF_SIGNATURE_MODE_LABELS[e.signatureMode] || e.signatureMode || '\u2014', style: 'tableCell' },
            { text: resolveSignatureStamp(e), style: 'tableCellSmall' },
        ]);
    }

    return {
        pageSize: 'A4',
        pageOrientation: 'landscape',
        pageMargins: [30, 40, 30, 40],
        footer: (currentPage: number, pageCount: number) => ({
            text: `Стр. ${currentPage} из ${pageCount}`,
            alignment: 'center', fontSize: 8, margin: [0, 10, 0, 0],
        }),
        content: [
            { text: '\n\n\n\n\n', fontSize: 12 },
            { text: orgName, style: 'title', alignment: 'center' },
            { text: '\n' },
            { text: 'ЭЛЕКТРОННЫЙ ЖУРНАЛ', style: 'title', alignment: 'center', fontSize: 20 },
            { text: 'ЭКСПЛУАТАЦИИ СППЗ', style: 'title', alignment: 'center', fontSize: 20 },
            { text: '\n\n' },
            { text: `Объект: ${objectName}`, style: 'subtitle', alignment: 'center' },
            address ? { text: `Адрес: ${address}`, style: 'subtitle', alignment: 'center' } : { text: '' },
            { text: `Период: ${periodLabel}`, style: 'subtitle', alignment: 'center' },
            { text: `\nСформирован: ${new Date().toLocaleString('ru-RU')}`, alignment: 'center', fontSize: 9, color: '#666666' },
            { text: `Всего записей: ${entries.length}`, alignment: 'center', fontSize: 9, color: '#666666' },
            { text: '', pageBreak: 'after' },
            { text: 'Содержание', style: 'h2', margin: [0, 0, 0, 10] },
            {
                ol: entries.slice(0, 200).map((en: any) => ({
                    text: `${formatDateTimeRu(en.eventDateTime)} \u2014 ${en.objectName || 'Объект'} \u2014 ${PDF_RECORD_TYPE_LABELS[en.recordType] || 'Прочее'}`,
                    fontSize: 8, margin: [0, 1, 0, 1],
                })),
            },
            entries.length > 200 ? { text: `... и ещё ${entries.length - 200} записей`, fontSize: 8, italics: true } : { text: '' },
            { text: '', pageBreak: 'after' },
            { text: 'Записи журнала', style: 'h2', margin: [0, 0, 0, 10] },
            {
                table: { headerRows: 1, widths: [22, 55, 70, 45, 55, '*', 60, 65, 40, 80], body: tableBody },
                layout: {
                    fillColor: (rowIndex: number) => rowIndex === 0 ? '#2d3748' : (rowIndex % 2 === 0 ? '#f7fafc' : null),
                    hLineWidth: () => 0.5, vLineWidth: () => 0.5,
                    hLineColor: () => '#cbd5e0', vLineColor: () => '#cbd5e0',
                },
            },
        ],
        styles: {
            title: { fontSize: 16, bold: true, color: '#1a202c' },
            subtitle: { fontSize: 12, color: '#4a5568' },
            h2: { fontSize: 14, bold: true, color: '#2d3748' },
            tableHeader: { fontSize: 7, bold: true, color: '#ffffff', fillColor: '#2d3748', margin: [2, 4, 2, 4] },
            tableCell: { fontSize: 7, margin: [2, 3, 2, 3] },
            tableCellSmall: { fontSize: 6, margin: [2, 3, 2, 3], color: '#4a5568' },
        },
        defaultStyle: { font: 'Roboto', fontSize: 9 },
    };
};

const buildSummaryReportDocument = (entries: any[], options: {
    organizationName?: string; periodFrom?: string; periodTo?: string;
}) => {
    const orgName = options.organizationName || DEFAULT_EXECUTOR_ORGANIZATION;
    const periodLabel = options.periodFrom || options.periodTo
        ? `${formatDateRu(options.periodFrom)} \u2014 ${formatDateRu(options.periodTo)}`
        : 'Все записи';

    const totalChecks = entries.length;
    const violations = entries.filter((e) => e.recordType === 'fault' || e.recordType === 'false_trigger').length;
    const fullySigned = entries.filter((e) => e.status === 'fully_signed').length;
    const drafts = entries.filter((e) => e.status === 'draft').length;
    const executorSigned = entries.filter((e) => e.status === 'executor_signed').length;

    const faultEntryIds = new Set(entries.filter((e) => e.recordType === 'fault').map((e) => e.id));
    const corrections = entries.filter((e) => e.correctionOfId && faultEntryIds.has(e.correctionOfId));
    let avgFixTimeText = '\u2014';
    if (corrections.length > 0) {
        const faultMap = new Map(entries.filter((e) => e.recordType === 'fault').map((e) => [e.id, e]));
        let totalHours = 0;
        let count = 0;
        for (const correction of corrections) {
            const fault = faultMap.get(correction.correctionOfId);
            if (fault?.eventDateTime && correction.eventDateTime) {
                const diff = new Date(correction.eventDateTime).getTime() - new Date(fault.eventDateTime).getTime();
                if (diff > 0) { totalHours += diff / (1000 * 60 * 60); count += 1; }
            }
        }
        if (count > 0) {
            const avg = totalHours / count;
            avgFixTimeText = avg < 24 ? `${avg.toFixed(1)} ч.` : `${(avg / 24).toFixed(1)} дн.`;
        }
    }

    const overdueThreshold = 14 * 24 * 60 * 60 * 1000;
    const now = Date.now();
    const overdue = entries.filter((e) => {
        if (e.status !== 'executor_signed') return false;
        return now - new Date(e.executorSignedAt || e.eventDateTime || '').getTime() > overdueThreshold;
    }).length;
    const overduePercent = totalChecks > 0 ? ((overdue / totalChecks) * 100).toFixed(1) : '0.0';

    const sectionCounts: Record<string, number> = {};
    for (const entry of entries) {
        const secs = Array.isArray(entry.sections) && entry.sections.length > 0 ? entry.sections : [entry.section || 'custom'];
        for (const s of secs) sectionCounts[s] = (sectionCounts[s] || 0) + 1;
    }
    const sectionTableBody: any[][] = [[
        { text: 'Система', style: 'sTableHeader' },
        { text: 'Кол-во записей', style: 'sTableHeader' },
        { text: '% от общего', style: 'sTableHeader' },
    ]];
    for (const [key, cnt] of Object.entries(sectionCounts).sort((a, b) => b[1] - a[1])) {
        sectionTableBody.push([
            { text: PDF_SECTION_LABELS[key] || key, style: 'sTableCell' },
            { text: String(cnt), style: 'sTableCell', alignment: 'center' },
            { text: totalChecks > 0 ? `${((cnt / totalChecks) * 100).toFixed(1)}%` : '0%', style: 'sTableCell', alignment: 'center' },
        ]);
    }

    const typeCounts: Record<string, number> = {};
    for (const entry of entries) { typeCounts[entry.recordType || 'other'] = (typeCounts[entry.recordType || 'other'] || 0) + 1; }
    const typeTableBody: any[][] = [[
        { text: 'Тип записи', style: 'sTableHeader' },
        { text: 'Кол-во', style: 'sTableHeader' },
        { text: '% от общего', style: 'sTableHeader' },
    ]];
    for (const [key, cnt] of Object.entries(typeCounts).sort((a, b) => b[1] - a[1])) {
        typeTableBody.push([
            { text: PDF_RECORD_TYPE_LABELS[key] || key, style: 'sTableCell' },
            { text: String(cnt), style: 'sTableCell', alignment: 'center' },
            { text: totalChecks > 0 ? `${((cnt / totalChecks) * 100).toFixed(1)}%` : '0%', style: 'sTableCell', alignment: 'center' },
        ]);
    }

    return {
        pageSize: 'A4',
        pageOrientation: 'portrait',
        pageMargins: [40, 40, 40, 40],
        content: [
            { text: orgName, style: 'orgName', alignment: 'center' },
            { text: '\n' },
            { text: 'СВОДНЫЙ ОТЧЁТ ПО ЖУРНАЛУ СППЗ', style: 'title', alignment: 'center' },
            { text: `Период: ${periodLabel}`, alignment: 'center', fontSize: 10, color: '#4a5568', margin: [0, 5, 0, 15] },
            { text: `Дата формирования: ${new Date().toLocaleString('ru-RU')}`, alignment: 'center', fontSize: 8, color: '#999', margin: [0, 0, 0, 20] },
            { text: 'Основные показатели', style: 'h2', margin: [0, 0, 0, 8] },
            {
                table: { widths: ['*', '*'], body: [
                    [{ text: 'Всего проверок / записей', style: 'metricLabel' }, { text: String(totalChecks), style: 'metricValue' }],
                    [{ text: 'Нарушения (неисправности + ложные срабатывания)', style: 'metricLabel' }, { text: String(violations), style: 'metricValue' }],
                    [{ text: 'Среднее время устранения', style: 'metricLabel' }, { text: avgFixTimeText, style: 'metricValue' }],
                    [{ text: 'Просроченные (ожидают подпись >14 дн.)', style: 'metricLabel' }, { text: `${overdue} (${overduePercent}%)`, style: 'metricValue' }],
                    [{ text: 'Полностью подписано', style: 'metricLabel' }, { text: String(fullySigned), style: 'metricValue' }],
                    [{ text: 'Черновики', style: 'metricLabel' }, { text: String(drafts), style: 'metricValue' }],
                    [{ text: 'Ожидают подпись заказчика', style: 'metricLabel' }, { text: String(executorSigned), style: 'metricValue' }],
                ] },
                layout: {
                    fillColor: (ri: number) => ri % 2 === 0 ? '#f7fafc' : null,
                    hLineWidth: () => 0.5, vLineWidth: () => 0.5,
                    hLineColor: () => '#e2e8f0', vLineColor: () => '#e2e8f0',
                },
                margin: [0, 0, 0, 20],
            },
            { text: 'Распределение по системам', style: 'h2', margin: [0, 0, 0, 8] },
            {
                table: { headerRows: 1, widths: ['*', 80, 80], body: sectionTableBody },
                layout: {
                    fillColor: (ri: number) => ri === 0 ? '#2d3748' : (ri % 2 === 0 ? '#f7fafc' : null),
                    hLineWidth: () => 0.5, vLineWidth: () => 0.5,
                    hLineColor: () => '#e2e8f0', vLineColor: () => '#e2e8f0',
                },
                margin: [0, 0, 0, 20],
            },
            { text: 'Распределение по типу записей', style: 'h2', margin: [0, 0, 0, 8] },
            {
                table: { headerRows: 1, widths: ['*', 80, 80], body: typeTableBody },
                layout: {
                    fillColor: (ri: number) => ri === 0 ? '#2d3748' : (ri % 2 === 0 ? '#f7fafc' : null),
                    hLineWidth: () => 0.5, vLineWidth: () => 0.5,
                    hLineColor: () => '#e2e8f0', vLineColor: () => '#e2e8f0',
                },
            },
        ],
        styles: {
            orgName: { fontSize: 12, bold: true, color: '#2d3748' },
            title: { fontSize: 18, bold: true, color: '#1a202c' },
            h2: { fontSize: 13, bold: true, color: '#2d3748' },
            metricLabel: { fontSize: 10, margin: [4, 4, 4, 4] },
            metricValue: { fontSize: 10, bold: true, alignment: 'right', margin: [4, 4, 4, 4] },
            sTableHeader: { fontSize: 9, bold: true, color: '#ffffff', fillColor: '#2d3748', margin: [4, 4, 4, 4] },
            sTableCell: { fontSize: 9, margin: [4, 3, 4, 3] },
        },
        defaultStyle: { font: 'Roboto', fontSize: 9 },
    };
};

const generatePdfBuffer = (docDefinition: any): Promise<Buffer> => {
    return new Promise((resolve, reject) => {
        try {
            const pdfmake = getPdfMakeInstance();
            const pdfDoc = pdfmake.createPdf(docDefinition);
            pdfDoc.getBuffer((buffer: Buffer) => {
                resolve(Buffer.from(buffer));
            });
        } catch (error) {
            reject(error);
        }
    });
};

const filterEntriesByQueryParams = (
    allEntries: any[],
    query: any,
    normalizeText: (v: unknown) => string,
) => {
    const directionId = normalizeText(query?.directionId);
    const section = normalizeText(query?.section);
    const status = normalizeText(query?.status);
    const from = normalizeText(query?.from);
    const to = normalizeText(query?.to);

    return allEntries.filter((entry) => {
        if (directionId && entry.directionId !== directionId) return false;
        if (section && section !== 'all') {
            const secs = Array.isArray(entry.sections) && entry.sections.length > 0
                ? entry.sections : [entry.section || 'custom'];
            if (!secs.includes(section)) return false;
        }
        if (status && status !== 'all' && entry.status !== status) return false;
        if (from) {
            const entryDate = String(entry.eventDateTime || '').slice(0, 10);
            if (entryDate < from) return false;
        }
        if (to) {
            const entryDate = String(entry.eventDateTime || '').slice(0, 10);
            if (entryDate > to) return false;
        }
        return true;
    });
};

export const registerMockSppzJournalRoutes = (params: any) => {
    const {
        app,
        requireAuth,
        ApiError,
        normalizeText,
        appConfig,
        publicLimiter,
    } = params;

    const mockEntries: any[] = [];
    const mockSignTokens: any[] = [];
    const mockAuditRows: any[] = [];

    const findEntryIndex = (entryId: string) => mockEntries.findIndex((entry) => entry.id === entryId);

    const pushMockAudit = (entryId: string | null, action: string, request: any, payload: Record<string, unknown> = {}) => {
        mockAuditRows.unshift({
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            entryId: entryId || '',
            action,
            actorId: request.authUser?.id || '',
            actorRole: request.authUser?.role || '',
            payload,
            createdAt: new Date().toISOString(),
        });
    };

    const requireStaffRole = (request: any) => {
        const role = request.authUser?.role ?? '';
        if (!STAFF_ROLES.has(role)) {
            throw new ApiError(403, 'FORBIDDEN', 'Access denied');
        }
    };

    const ensureMockSignToken = (request: any, contractorKey: string, contractorName: string) => {
        const existing = mockSignTokens.find((item) => item.contractorKey === contractorKey);
        if (existing) return existing;

        const tokenRow = {
            id: `mock-sign-token-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            token: buildSigningToken(),
            contractorKey,
            contractorName,
            contractorEmail: '',
            expiresAt: new Date(Date.now() + CUSTOMER_SIGN_TOKEN_TTL_HOURS * 60 * 60 * 1000).toISOString(),
        };
        mockSignTokens.push(tokenRow);
        return tokenRow;
    };

    app.get('/sppz-journal/entries', requireAuth, (request: any, response: any) => {
        requireStaffRole(request);
        const directionId = normalizeText(request.query?.directionId);
        const status = normalizeText(request.query?.status);
        const objectKey = normalizeText(request.query?.objectKey);

        const filtered = mockEntries
            .filter((entry) => {
                if (directionId && entry.directionId !== directionId) return false;
                if (status && entry.status !== status) return false;
                if (objectKey && (entry.objectKey || '') !== objectKey) return false;
                return true;
            })
            .sort((left, right) => String(right.eventDateTime || '').localeCompare(String(left.eventDateTime || '')));

        response.status(200).json(filtered);
    });

    app.post('/sppz-journal/entries', requireAuth, (request: any, response: any) => {
        requireStaffRole(request);
        const body = request.body && typeof request.body === 'object' ? request.body : {};
        const groupedSections = normalizeStringArray(body?.groupedSections).filter((item: string) => VALID_SECTIONS.has(item));

        const payload = normalizeEntryPayload(body, normalizeText, 'draft');
        validateEntryCompliance(payload, ApiError);
        if (!payload.objectName || !payload.description || !payload.executorName) {
            throw new ApiError(422, 'VALIDATION_ERROR', 'objectName, description and executorName are required');
        }
        if (payload.description.trim().length < DESCRIPTION_MIN_LENGTH) {
            throw new ApiError(
                422,
                'DESCRIPTION_TOO_SHORT',
                'Укажите конкретно: какие узлы проверены, какие операции выполнены',
            );
        }

        if (groupedSections.length > 1) {
            const createdEntries: any[] = [];
            for (const section of groupedSections) {
                const sectionPayload = {
                    ...payload,
                    id: buildEntryId(),
                    section,
                    sections: [section],
                };
                if (findEntryIndex(sectionPayload.id) >= 0) continue;
                mockEntries.unshift(sectionPayload);
                pushMockAudit(sectionPayload.id, 'entry_created', request, {
                    status: sectionPayload.status,
                    section: sectionPayload.section,
                    groupedWith: groupedSections,
                });
                createdEntries.push(sectionPayload);
            }
            response.status(201).json(createdEntries.length === 1 ? createdEntries[0] : createdEntries);
            return;
        }

        if (findEntryIndex(payload.id) >= 0) {
            throw new ApiError(409, 'ENTRY_ALREADY_EXISTS', 'Entry with this id already exists');
        }

        mockEntries.unshift(payload);
        pushMockAudit(payload.id, 'entry_created', request, {
            status: payload.status,
            section: payload.section,
        });
        response.status(201).json(payload);
    });

    app.post('/sppz-journal/entries/:entryId/sign-executor', requireAuth, (request: any, response: any) => {
        const role = request.authUser?.role ?? '';
        if (!EXECUTOR_SIGN_ROLES.has(role)) {
            throw new ApiError(403, 'FORBIDDEN', 'Executor signature is not allowed for this role');
        }
        const idx = findEntryIndex(String(request.params.entryId));
        if (idx < 0) throw new ApiError(404, 'NOT_FOUND', 'Entry not found');
        if (mockEntries[idx].status !== 'draft') {
            throw new ApiError(409, 'INVALID_STATUS', 'Entry must be in draft status');
        }

        mockEntries[idx] = {
            ...mockEntries[idx],
            status: 'executor_signed',
            executorSignedAt: new Date().toISOString(),
            executorSignedById: request.authUser?.id ?? '',
        };
        pushMockAudit(mockEntries[idx].id, 'signed_executor', request, {
            status: mockEntries[idx].status,
        });

        const contractorKey = normalizeText(mockEntries[idx].contractorId) || normalizeText(mockEntries[idx].contractor) || 'unknown';
        const tokenRow = ensureMockSignToken(request, contractorKey, normalizeText(mockEntries[idx].contractor) || 'Контрагент');
        const signLink = buildCustomerSigningLink(request, appConfig, normalizeText, tokenRow.token);
        pushMockAudit(mockEntries[idx].id, 'customer_sign_link_resent', request, {
            contractorKey,
        });

        response.status(200).json({
            ...mockEntries[idx],
            customerSigningDispatch: {
                status: 'sent',
                email: 'mock@local',
                link: signLink,
                pendingCount: mockEntries.filter((entry) => (normalizeText(entry.contractorId) || normalizeText(entry.contractor) || 'unknown') === contractorKey && entry.status === 'executor_signed').length,
            },
        });
    });

    app.post('/sppz-journal/entries/:entryId/resend-customer-sign-link', requireAuth, (request: any, response: any) => {
        requireStaffRole(request);
        const idx = findEntryIndex(String(request.params.entryId));
        if (idx < 0) throw new ApiError(404, 'NOT_FOUND', 'Entry not found');
        if (mockEntries[idx].status !== 'executor_signed') {
            throw new ApiError(409, 'INVALID_STATUS', 'Entry must be signed by executor first');
        }

        const contractorKey = normalizeText(mockEntries[idx].contractorId) || normalizeText(mockEntries[idx].contractor) || 'unknown';
        const tokenRow = ensureMockSignToken(request, contractorKey, normalizeText(mockEntries[idx].contractor) || 'Контрагент');
        const signLink = buildCustomerSigningLink(request, appConfig, normalizeText, tokenRow.token);

        response.status(200).json({
            ...mockEntries[idx],
            customerSigningDispatch: {
                status: 'sent',
                email: 'mock@local',
                link: signLink,
                pendingCount: mockEntries.filter((entry) => (normalizeText(entry.contractorId) || normalizeText(entry.contractor) || 'unknown') === contractorKey && entry.status === 'executor_signed').length,
            },
        });
    });

    app.post('/sppz-journal/entries/:entryId/sign-customer', requireAuth, (request: any, response: any) => {
        const role = request.authUser?.role ?? '';
        if (!CUSTOMER_SIGN_ROLES.has(role)) {
            throw new ApiError(403, 'FORBIDDEN', 'Customer signature is not allowed for this role');
        }
        const idx = findEntryIndex(String(request.params.entryId));
        if (idx < 0) throw new ApiError(404, 'NOT_FOUND', 'Entry not found');
        if (mockEntries[idx].status !== 'executor_signed') {
            throw new ApiError(409, 'INVALID_STATUS', 'Entry must be signed by executor first');
        }

        const body = request.body && typeof request.body === 'object' ? request.body : {};
        const signerFio = normalizeText(body.signerFio);
        const signerOrderNumber = normalizeText(body.signerOrderNumber);

        mockEntries[idx] = {
            ...mockEntries[idx],
            status: 'fully_signed',
            customerSignedAt: new Date().toISOString(),
            customerSignedById: request.authUser?.id ?? '',
            customerSignerFio: signerFio || undefined,
            customerSignerOrderNumber: signerOrderNumber || undefined,
        };
        pushMockAudit(mockEntries[idx].id, 'signed_customer_internal', request, {
            status: mockEntries[idx].status,
            signerFio: signerFio || '',
            signerOrderNumber: signerOrderNumber || '',
        });

        response.status(200).json(mockEntries[idx]);
    });

    app.post('/sppz-journal/entries/:entryId/correction', requireAuth, (request: any, response: any) => {
        requireStaffRole(request);
        const sourceIdx = findEntryIndex(String(request.params.entryId));
        if (sourceIdx < 0) throw new ApiError(404, 'NOT_FOUND', 'Entry not found');
        const source = mockEntries[sourceIdx];
        if (source.status !== 'fully_signed') {
            throw new ApiError(409, 'INVALID_STATUS', 'Correction is allowed only for fully signed entry');
        }

        const body = request.body && typeof request.body === 'object' ? request.body : {};
        const correction = normalizeEntryPayload(
            {
                ...source,
                ...body,
                id: normalizeText(body.id) || buildEntryId(),
                status: 'draft',
                correctionOfId: source.id,
                description: normalizeText(body.description) || `Исправление к записи ${source.id}: ${source.description || ''}`,
                entryTimestamp: normalizeText(body.entryTimestamp) || new Date().toISOString(),
                executorOrganization: DEFAULT_EXECUTOR_ORGANIZATION,
            },
            normalizeText,
            'draft',
        );
        if (findEntryIndex(correction.id) >= 0) {
            throw new ApiError(409, 'ENTRY_ALREADY_EXISTS', 'Entry with this id already exists');
        }
        validateEntryCompliance(correction, ApiError);
        mockEntries.unshift(correction);
        pushMockAudit(correction.id, 'correction_created', request, {
            sourceEntryId: source.id,
        });
        response.status(201).json(correction);
    });

    app.post('/sppz-journal/license-check', requireAuth, (request: any, response: any) => {
        requireStaffRole(request);
        const body = request.body && typeof request.body === 'object' ? request.body : {};
        const licenseNumber = normalizeText(body.licenseNumber);
        const contractorInn = normalizeText(body.contractorInn);
        const contractorName = normalizeText(body.contractorName);
        if (!licenseNumber && !contractorInn) {
            throw new ApiError(422, 'VALIDATION_ERROR', 'licenseNumber or contractorInn is required');
        }

        const checkedAt = new Date().toISOString();
        const snapshot = {
            checkId: `mock-license-check-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            checkedAt,
            source: 'mock',
            status: licenseNumber ? 'active' : 'unknown',
            message: licenseNumber
                ? 'Mock-проверка: статус лицензии определен как "active".'
                : 'Mock-проверка: недостаточно данных для автоматического статуса.',
            licenseNumber,
            contractorInn,
            contractorName,
        };
        pushMockAudit(null, 'license_checked', request, snapshot);
        response.status(200).json(snapshot);
    });

    app.get('/sppz-journal/audit', requireAuth, (request: any, response: any) => {
        requireStaffRole(request);
        const entryId = normalizeText(request.query?.entryId);
        const limitRaw = Number(request.query?.limit ?? 200);
        const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(500, Math.floor(limitRaw)) : 200;
        const items = mockAuditRows
            .filter((row) => !entryId || normalizeText(row.entryId) === entryId)
            .slice(0, limit);
        response.status(200).json(items);
    });

    /* -- Inspector access (F-050-053) -- */
    const mockInspectorTokens: any[] = [];

    app.post('/sppz-journal/inspector-access', requireAuth, (request: any, response: any) => {
        const role = request.authUser?.role ?? '';
        if (!ADMIN_ROLES.has(role)) {
            throw new ApiError(403, 'FORBIDDEN', 'Only admins can create inspector access tokens');
        }
        const body = request.body && typeof request.body === 'object' ? request.body : {};
        const directionId = normalizeText(body.directionId);
        if (!isUuidValue(directionId)) {
            throw new ApiError(422, 'VALIDATION_ERROR', 'directionId is required');
        }
        const periodFrom = normalizeText(body.periodFrom) || null;
        const periodTo = normalizeText(body.periodTo) || null;
        const expiresInHours = Math.max(
            INSPECTOR_TOKEN_MIN_HOURS,
            Math.min(INSPECTOR_TOKEN_MAX_HOURS, Number(body.expiresInHours) || 48),
        );
        const token = buildInspectorToken();
        const tokenRow = {
            id: `mock-inspector-token-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            directionId,
            token,
            createdBy: request.authUser?.id || '',
            periodFrom,
            periodTo,
            expiresAt: new Date(Date.now() + expiresInHours * 60 * 60 * 1000).toISOString(),
            accessedCount: 0,
            lastAccessedAt: null,
            lastAccessedIp: null,
            createdAt: new Date().toISOString(),
        };
        mockInspectorTokens.push(tokenRow);
        pushMockAudit(null, 'inspector_token_created', request, { directionId, expiresInHours });
        const base = resolveAppBaseUrl(request, appConfig, normalizeText);
        const inspectUrl = `${base}/sppz-journal/inspect/${encodeURIComponent(token)}`;
        response.status(201).json({ ...tokenRow, inspectUrl });
    });

    app.get('/sppz-journal/inspect/:token', publicLimiter, (request: any, response: any) => {
        const inspectToken = normalizeText(request.params.token);
        if (!inspectToken) {
            throw new ApiError(422, 'VALIDATION_ERROR', 'Token is required');
        }
        const tokenRow = mockInspectorTokens.find((t: any) => t.token === inspectToken);
        if (!tokenRow) {
            throw new ApiError(403, 'INVALID_TOKEN', 'Invalid inspector access token');
        }
        if (new Date(tokenRow.expiresAt).getTime() <= Date.now()) {
            throw new ApiError(403, 'TOKEN_EXPIRED', 'Inspector access token expired');
        }
        tokenRow.accessedCount += 1;
        tokenRow.lastAccessedAt = new Date().toISOString();
        tokenRow.lastAccessedIp = normalizeText(request.ip);

        const signedEntries = mockEntries
            .filter((entry: any) => {
                if (entry.directionId !== tokenRow.directionId) return false;
                if (entry.status === 'draft') return false;
                if (tokenRow.periodFrom && (entry.eventDateTime || '').slice(0, 10) < tokenRow.periodFrom) return false;
                if (tokenRow.periodTo && (entry.eventDateTime || '').slice(0, 10) > tokenRow.periodTo) return false;
                return true;
            })
            .sort((a: any, b: any) => String(b.eventDateTime || '').localeCompare(String(a.eventDateTime || '')));

        pushMockAudit(null, 'inspector_access', { authUser: { id: null, role: 'inspector' } }, {
            token: inspectToken.slice(0, 8) + '...',
            directionId: tokenRow.directionId,
            ip: normalizeText(request.ip),
        });

        response.status(200).json({
            directionId: tokenRow.directionId,
            periodFrom: tokenRow.periodFrom,
            periodTo: tokenRow.periodTo,
            expiresAt: tokenRow.expiresAt,
            entryCount: signedEntries.length,
            entries: signedEntries.map((e: any) => ({
                id: e.id, eventDateTime: e.eventDateTime, entryTimestamp: e.entryTimestamp,
                objectName: e.objectName, address: e.address, section: e.section, sections: e.sections,
                zone: e.zone, recordType: e.recordType, description: e.description,
                contractor: e.contractor, contractorInn: e.contractorInn,
                executorOrganization: e.executorOrganization, executorName: e.executorName,
                contractNumber: e.contractNumber, licenseNumber: e.licenseNumber,
                licenseStatus: e.licenseStatus, signatureMode: e.signatureMode,
                status: e.status, executorSignedAt: e.executorSignedAt, customerSignedAt: e.customerSignedAt,
            })),
        });
    });

    app.get('/sppz-journal/customer-sign/session', publicLimiter, (request: any, response: any) => {
        const token = normalizeText(request.query?.token);
        if (!token) {
            throw new ApiError(422, 'VALIDATION_ERROR', 'Token is required');
        }

        const tokenRow = mockSignTokens.find((item) => item.token === token) || null;
        if (!tokenRow) {
            throw new ApiError(403, 'INVALID_TOKEN', 'Invalid signing token');
        }

        if (new Date(tokenRow.expiresAt).getTime() <= Date.now()) {
            throw new ApiError(403, 'TOKEN_EXPIRED', 'Signing token expired');
        }

        const entries = mockEntries
            .filter((entry) => {
                const contractorKey = normalizeText(entry.contractorId) || normalizeText(entry.contractor) || 'unknown';
                return contractorKey === tokenRow.contractorKey && entry.status === 'executor_signed';
            })
            .sort((left, right) => String(right.eventDateTime || '').localeCompare(String(left.eventDateTime || '')));

        response.status(200).json({
            contractor: {
                key: tokenRow.contractorKey,
                name: tokenRow.contractorName || 'Контрагент',
                email: tokenRow.contractorEmail || '',
            },
            expiresAt: tokenRow.expiresAt,
            pendingCount: entries.length,
            entries,
        });
    });

    app.post('/sppz-journal/customer-sign/submit', publicLimiter, (request: any, response: any) => {
        const body = request.body && typeof request.body === 'object' ? request.body : {};
        const token = normalizeText(body.token);
        const signerFio = normalizeText(body.signerFio);
        const signerOrderNumber = normalizeText(body.signerOrderNumber);
        const signAllPending = body.signAllPending !== false;
        const entryIds = normalizeStringArray(body.entryIds);

        if (!token) {
            throw new ApiError(422, 'VALIDATION_ERROR', 'Token is required');
        }
        if (!signerFio || !signerOrderNumber) {
            throw new ApiError(422, 'VALIDATION_ERROR', 'signerFio and signerOrderNumber are required');
        }

        const tokenRow = mockSignTokens.find((item) => item.token === token) || null;
        if (!tokenRow) {
            throw new ApiError(403, 'INVALID_TOKEN', 'Invalid signing token');
        }

        if (new Date(tokenRow.expiresAt).getTime() <= Date.now()) {
            throw new ApiError(403, 'TOKEN_EXPIRED', 'Signing token expired');
        }

        const idsSet = new Set(entryIds);
        const signedAt = new Date().toISOString();
        const signed: any[] = [];

        for (let idx = 0; idx < mockEntries.length; idx += 1) {
            const current = mockEntries[idx];
            const contractorKey = normalizeText(current.contractorId) || normalizeText(current.contractor) || 'unknown';
            if (contractorKey !== tokenRow.contractorKey) continue;
            if (current.status !== 'executor_signed') continue;
            if (!signAllPending && idsSet.size > 0 && !idsSet.has(String(current.id))) continue;

            const next = {
                ...current,
                status: 'fully_signed',
                customerSignedAt: signedAt,
                customerSignedById: `external:${tokenRow.contractorKey}`,
                customerSignerFio: signerFio,
                customerSignerOrderNumber: signerOrderNumber,
                customerSignedVia: 'email_link',
            };
            mockEntries[idx] = next;
            signed.push(next);
            mockAuditRows.unshift({
                id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                entryId: next.id,
                action: 'signed_customer_external',
                actorId: `external:${tokenRow.contractorKey}`,
                actorRole: 'external',
                payload: {
                    signerFio,
                    signerOrderNumber,
                    via: 'email_link',
                },
                createdAt: signedAt,
            });
        }

        response.status(200).json({
            status: 'signed',
            signedCount: signed.length,
            signedEntries: signed,
        });

    /* ── Mock PDF Export (F-060) ── */
    app.get('/sppz-journal/export/pdf', requireAuth, async (request: any, response: any) => {
        requireStaffRole(request);
        const filtered = filterEntriesByQueryParams(mockEntries, request.query, normalizeText);
        const firstEntry = filtered[0] || {};
        const docDef = buildJournalPdfDocument(filtered, {
            organizationName: DEFAULT_EXECUTOR_ORGANIZATION,
            objectName: firstEntry.objectName || undefined,
            address: firstEntry.address || undefined,
            periodFrom: normalizeText(request.query?.from) || undefined,
            periodTo: normalizeText(request.query?.to) || undefined,
        });
        const buffer = await generatePdfBuffer(docDef);
        response.setHeader('Content-Type', 'application/pdf');
        response.setHeader('Content-Disposition', `attachment; filename="sppz-journal-${new Date().toISOString().slice(0, 10)}.pdf"`);
        response.send(buffer);
    });

    /* ── Mock Summary Report (F-063) ── */
    app.get('/sppz-journal/report', requireAuth, async (request: any, response: any) => {
        requireStaffRole(request);
        const filtered = filterEntriesByQueryParams(mockEntries, request.query, normalizeText);
        const docDef = buildSummaryReportDocument(filtered, {
            organizationName: DEFAULT_EXECUTOR_ORGANIZATION,
            periodFrom: normalizeText(request.query?.from) || undefined,
            periodTo: normalizeText(request.query?.to) || undefined,
        });
        const buffer = await generatePdfBuffer(docDef);
        response.setHeader('Content-Type', 'application/pdf');
        response.setHeader('Content-Disposition', `attachment; filename="sppz-report-${new Date().toISOString().slice(0, 10)}.pdf"`);
        response.send(buffer);
    });
    });
};

export const registerSppzJournalRoutes = (params: any) => {
    const {
        app,
        requireAuth,
        asyncHandler,
        ensureSppzJournalSchema,
        dbQuery,
        ApiError,
        normalizeText,
        appConfig,
        canSendEmails,
        sendSystemEventNotice,
        publicLimiter,
    } = params;

    const requireStaffRole = (request: any) => {
        const role = request.authUser?.role ?? '';
        if (!STAFF_ROLES.has(role)) {
            throw new ApiError(403, 'FORBIDDEN', 'Access denied');
        }
    };

    const getUserDirectionIds = async (request: any): Promise<string[] | null> => {
        return resolveUserDirectionIds(request, dbQuery);
    };

    const pushAudit = async (
        request: any,
        action: string,
        entryId: string | null,
        payload: Record<string, unknown> = {},
    ) => {
        try {
            await dbQuery(
                `INSERT INTO sppz_journal_audit_log (entry_id, action, actor_id, actor_role, payload)
                 VALUES ($1::text, $2::text, $3::uuid, $4::text, $5::jsonb)`,
                [
                    entryId || null,
                    action,
                    isUuidValue(request.authUser?.id) ? request.authUser.id : null,
                    normalizeText(request.authUser?.role) || null,
                    JSON.stringify(payload),
                ],
            );
        } catch {
            // Best effort: audit write failure must not block operational workflow.
        }
    };

    const getValidSignTokenRow = async (token: string) => {
        const tokenResult = await dbQuery(
            `SELECT *
             FROM sppz_journal_customer_sign_tokens
             WHERE token = $1::text
               AND revoked_at IS NULL
             LIMIT 1`,
            [token],
        );

        const tokenRow = tokenResult.rows[0] || null;
        if (!tokenRow) {
            throw new ApiError(403, 'INVALID_TOKEN', 'Invalid signing token');
        }

        if (new Date(tokenRow.expires_at).getTime() <= Date.now()) {
            throw new ApiError(403, 'TOKEN_EXPIRED', 'Signing token expired');
        }

        if (!isUuidValue(tokenRow.contractor_id)) {
            throw new ApiError(403, 'INVALID_TOKEN', 'Signing token has invalid contractor');
        }

        return tokenRow;
    };

    const getOrCreateSignToken = async (args: {
        contractorId: string;
        contractorName: string;
        contractorEmail: string;
        createdBy: string | null;
    }) => {
        const existingResult = await dbQuery(
            `SELECT *
             FROM sppz_journal_customer_sign_tokens
             WHERE contractor_id = $1::uuid
               AND contractor_email = $2::text
               AND revoked_at IS NULL
               AND expires_at > now()
             ORDER BY created_at DESC
             LIMIT 1`,
            [args.contractorId, args.contractorEmail],
        );

        const existing = existingResult.rows[0] || null;
        if (existing) {
            return existing;
        }

        const tokenRowId = `sppz-sign-token-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const token = buildSigningToken();
        const expiresAt = new Date(Date.now() + CUSTOMER_SIGN_TOKEN_TTL_HOURS * 60 * 60 * 1000).toISOString();

        const createdResult = await dbQuery(
            `INSERT INTO sppz_journal_customer_sign_tokens (
                id, token, contractor_id, contractor_name, contractor_email, created_by, expires_at
             ) VALUES (
                $1::text, $2::text, $3::uuid, $4::text, $5::text, $6::uuid, $7::timestamptz
             )
             RETURNING *`,
            [tokenRowId, token, args.contractorId, args.contractorName, args.contractorEmail, args.createdBy, expiresAt],
        );

        return createdResult.rows[0];
    };

    const fetchContractorContact = async (contractorId: string) => {
        const contractorResult = await dbQuery(
            `SELECT id, coalesce(name, '') as name, coalesce(contacts, '[]'::jsonb) as contacts
             FROM tenants
             WHERE id = $1::uuid
             LIMIT 1`,
            [contractorId],
        );
        const contractor = contractorResult.rows[0] || null;
        if (!contractor) return null;

        const email = pickFirstContactEmail(contractor.contacts);
        return {
            contractorId,
            contractorName: normalizeText(contractor.name) || 'Контрагент',
            contractorEmail: email,
        };
    };

    // --- F-040: Schedule table & upsert logic ---
    const ensureScheduleTable = async () => {
        await dbQuery(`CREATE TABLE IF NOT EXISTS sppz_check_schedule (
            id TEXT PRIMARY KEY DEFAULT 'sched-' || extract(epoch from now())::bigint || '-' || substr(md5(random()::text), 1, 6),
            direction_id UUID,
            maintenance_item_id UUID,
            object_key TEXT NOT NULL DEFAULT '',
            section TEXT NOT NULL,
            check_type TEXT NOT NULL,
            check_type_label TEXT NOT NULL DEFAULT '',
            period_days INT NOT NULL,
            source_entry_id TEXT,
            entry_date TIMESTAMPTZ,
            next_check_date TIMESTAMPTZ NOT NULL,
            notified_14d BOOLEAN NOT NULL DEFAULT FALSE,
            notified_7d BOOLEAN NOT NULL DEFAULT FALSE,
            notified_1d BOOLEAN NOT NULL DEFAULT FALSE,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )`);
        try {
            await dbQuery(`CREATE UNIQUE INDEX IF NOT EXISTS sppz_check_schedule_unique_key
                ON sppz_check_schedule (coalesce(direction_id::text, ''), object_key, section, check_type)`);
        } catch {
            // constraint may already exist
        }
    };

    let scheduleTableReady = false;
    const initScheduleTable = async () => {
        if (scheduleTableReady) return;
        await ensureScheduleTable();
        scheduleTableReady = true;
    };

    const upsertScheduleEntries = async (row: any) => {
        await initScheduleTable();
        const data = row?.entry_data && typeof row.entry_data === 'object' ? row.entry_data : {};
        const entryDate = normalizeText(row?.event_datetime ?? data.eventDateTime);
        const description = normalizeText(data.description);
        const directionId = normalizeText(row?.direction_id ?? data.directionId) || null;
        const maintenanceItemId = normalizeText(row?.maintenance_item_id ?? data.maintenanceItemId) || null;
        const objectKey = normalizeText(row?.object_key ?? data.objectKey) || '';
        const entryId = normalizeText(row?.id ?? data.id);
        const sections = Array.isArray(data.sections) ? data.sections : [normalizeText(row?.section ?? data.section)];
        const recordType = normalizeText(data.recordType ?? row?.record_type);

        const schedulableTypes = new Set(['maintenance', 'testing', 'functional_control']);
        if (!schedulableTypes.has(recordType)) return;
        if (!isPositiveResult(description)) return;

        for (const section of sections) {
            const schedules = computeNextCheckDates(section, entryDate);
            for (const sched of schedules) {
                try {
                    await dbQuery(
                        `INSERT INTO sppz_check_schedule (
                            id, direction_id, maintenance_item_id, object_key, section,
                            check_type, check_type_label, period_days,
                            source_entry_id, entry_date, next_check_date,
                            notified_14d, notified_7d, notified_1d, updated_at
                        ) VALUES (
                            $1, $2::uuid, $3::uuid, $4, $5,
                            $6, $7, $8,
                            $9, $10::timestamptz, $11::timestamptz,
                            false, false, false, now()
                        )
                        ON CONFLICT (coalesce(direction_id::text, ''), object_key, section, check_type)
                        DO UPDATE SET
                            source_entry_id = EXCLUDED.source_entry_id,
                            entry_date = EXCLUDED.entry_date,
                            next_check_date = EXCLUDED.next_check_date,
                            period_days = EXCLUDED.period_days,
                            check_type_label = EXCLUDED.check_type_label,
                            maintenance_item_id = EXCLUDED.maintenance_item_id,
                            notified_14d = false,
                            notified_7d = false,
                            notified_1d = false,
                            updated_at = now()
                        `,
                        [
                            `sched-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                            isUuidValue(directionId) ? directionId : null,
                            isUuidValue(maintenanceItemId) ? maintenanceItemId : null,
                            objectKey,
                            sched.section,
                            sched.checkType,
                            sched.checkTypeLabel,
                            sched.periodDays,
                            entryId,
                            entryDate,
                            sched.nextCheckDate,
                        ],
                    );
                } catch {
                    // best effort
                }
            }
        }
    };

    const checkLicenseWithRegistry = async (args: {
        licenseNumber: string;
        contractorInn: string;
        contractorName: string;
    }) => {
        const lookupUrl = normalizeText(appConfig?.mchsRegistryLookupUrl);
        const checkedAt = new Date().toISOString();
        const baseSnapshot = {
            checkedAt,
            licenseNumber: args.licenseNumber,
            contractorInn: args.contractorInn,
            contractorName: args.contractorName,
        };

        if (!lookupUrl) {
            return {
                ...baseSnapshot,
                source: 'manual',
                status: 'unknown' as const,
                message: 'Интеграция с реестром МЧС не настроена (MCHS_REGISTRY_LOOKUP_URL пуст).',
                responsePayload: {},
            };
        }

        const timeoutMs = Number(appConfig?.mchsRegistryLookupTimeoutMs ?? 8000);
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), Math.max(1000, timeoutMs));

        try {
            const url = new URL(lookupUrl);
            if (args.licenseNumber) url.searchParams.set('licenseNumber', args.licenseNumber);
            if (args.contractorInn) url.searchParams.set('inn', args.contractorInn);
            if (args.contractorName) url.searchParams.set('contractorName', args.contractorName);

            const response = await fetch(url.toString(), {
                method: 'GET',
                signal: controller.signal,
                headers: {
                    Accept: 'application/json,text/plain,*/*',
                },
            });
            const rawText = await response.text();
            let payload: any = rawText;
            try {
                payload = JSON.parse(rawText);
            } catch {
                // Keep text payload if endpoint returns non-json.
            }

            const rawStatus = typeof payload === 'object' && payload
                ? (payload.status ?? payload.resultStatus ?? payload.licenseStatus ?? '')
                : '';
            const normalizedStatus = resolveLicenseCheckStatus(rawStatus || rawText);

            return {
                ...baseSnapshot,
                source: 'mchs_registry',
                status: normalizedStatus,
                message: response.ok
                    ? 'Проверка лицензии выполнена через настроенный реестр.'
                    : `Реестр вернул ошибку HTTP ${response.status}.`,
                responsePayload: {
                    httpStatus: response.status,
                    body: payload,
                },
            };
        } catch (error: any) {
            return {
                ...baseSnapshot,
                source: 'mchs_registry',
                status: 'unknown' as const,
                message: normalizeText(error?.message) || 'Ошибка запроса к реестру МЧС.',
                responsePayload: {},
            };
        } finally {
            clearTimeout(timeout);
        }
    };

    const sealEntryHash = async (entryId: string, directionId: string | null, entryDataJson: string, executorSignedAt: string, customerSignedAt: string) => {
        // Find the last fully_signed entry in this direction that already has a hash
        let prevHash = 'GENESIS';
        if (directionId && isUuidValue(directionId)) {
            const prevResult = await dbQuery(
                `SELECT entry_hash
                 FROM sppz_journal_entries
                 WHERE direction_id = $1::uuid
                   AND status = 'fully_signed'
                   AND entry_hash IS NOT NULL
                   AND deleted_at IS NULL
                   AND id != $2::text
                 ORDER BY customer_signed_at DESC, created_at DESC
                 LIMIT 1`,
                [directionId, entryId],
            );
            if (prevResult.rows[0]?.entry_hash) {
                prevHash = prevResult.rows[0].entry_hash;
            }
        }

        const hash = computeEntryHash(prevHash, entryId, entryDataJson, executorSignedAt, customerSignedAt);

        await dbQuery(
            `UPDATE sppz_journal_entries
             SET prev_entry_hash = $2::text,
                 entry_hash = $3::text
             WHERE id = $1::text`,
            [entryId, prevHash, hash],
        );

        return { prevEntryHash: prevHash, entryHash: hash };
    };

    const sendCustomerSigningLinkForEntry = async (request: any, row: any) => {
        const data = row?.entry_data && typeof row.entry_data === 'object' ? row.entry_data : {};
        const contractorId = normalizeText(row?.contractor_id ?? data.contractorId);

        if (!isUuidValue(contractorId)) {
            return {
                status: 'missing_contractor',
                message: 'У записи не указан contractorId из справочника.',
            };
        }

        const contractorContact = await fetchContractorContact(contractorId);
        if (!contractorContact) {
            return {
                status: 'contractor_not_found',
                message: 'Контрагент не найден в справочнике tenants.',
            };
        }

        if (!contractorContact.contractorEmail) {
            return {
                status: 'missing_email',
                contractorId,
                contractorName: contractorContact.contractorName,
                message: 'У контрагента не заполнен email в контактах.',
            };
        }

        const createdBy = isUuidValue(request.authUser?.id) ? request.authUser.id : null;
        const tokenRow = await getOrCreateSignToken({
            contractorId,
            contractorName: contractorContact.contractorName,
            contractorEmail: contractorContact.contractorEmail,
            createdBy,
        });
        const signLink = buildCustomerSigningLink(request, appConfig, normalizeText, normalizeText(tokenRow.token));

        const pendingCountResult = await dbQuery(
            `SELECT count(*)::int AS cnt
             FROM sppz_journal_entries
             WHERE contractor_id = $1::uuid
               AND status = 'executor_signed'
               AND deleted_at IS NULL`,
            [contractorId],
        );
        const pendingCount = Number(pendingCountResult.rows[0]?.cnt ?? 0);

        await dbQuery(
            `UPDATE sppz_journal_customer_sign_tokens
             SET last_sent_at = now(),
                 last_sent_entry_id = $2::text
             WHERE id = $1::text`,
            [tokenRow.id, normalizeText(row?.id)],
        );

        if (typeof canSendEmails !== 'function' || !canSendEmails() || typeof sendSystemEventNotice !== 'function') {
            return {
                status: 'email_disabled',
                email: contractorContact.contractorEmail,
                link: signLink,
                pendingCount,
                message: 'SMTP не настроен, email не отправлен.',
            };
        }

        try {
            const objectName = normalizeText(data.objectName) || normalizeText(row?.object_key) || 'Объект';
            const eventDateTime = normalizeText(data.eventDateTime) || normalizeText(row?.event_datetime) || 'n/a';
            const subject = `СППЗ: требуется подпись заказчика (${contractorContact.contractorName})`;
            const body = [
                `Контрагент: ${contractorContact.contractorName}`,
                `Объект: ${objectName}`,
                `Дата записи: ${eventDateTime}`,
                `Ожидают подпись заказчика: ${pendingCount}`,
                '',
                'Для подписи откройте ссылку ниже и укажите ФИО и номер приказа:',
                signLink,
                '',
                `Ссылка действует до ${new Date(tokenRow.expires_at).toLocaleString('ru-RU')}.`,
            ].join('\n');

            await sendSystemEventNotice({
                to: contractorContact.contractorEmail,
                subject,
                body,
            });

            return {
                status: 'sent',
                email: contractorContact.contractorEmail,
                link: signLink,
                pendingCount,
            };
        } catch (error: any) {
            return {
                status: 'send_failed',
                email: contractorContact.contractorEmail,
                link: signLink,
                pendingCount,
                message: normalizeText(error?.message) || 'Не удалось отправить email',
            };
        }
    };

    app.get('/sppz-journal/entries', requireAuth, asyncHandler(async (request: any, response: any) => {
        requireStaffRole(request);
        await ensureSppzJournalSchema();

        const allowedDirectionIds = await getUserDirectionIds(request);
        if (allowedDirectionIds !== null && allowedDirectionIds.length === 0) {
            response.status(200).json([]);
            return;
        }

        const directionId = normalizeText(request.query?.directionId);
        const status = normalizeText(request.query?.status);
        const objectKey = normalizeText(request.query?.objectKey);
        const rawPage = Number(request.query?.page);
        const rawLimit = Number(request.query?.limit);
        const paginated = Number.isFinite(rawPage) && rawPage >= 1;
        const page = paginated ? Math.max(1, Math.floor(rawPage)) : 1;
        const limit = Number.isFinite(rawLimit) && rawLimit >= 1 ? Math.min(500, Math.floor(rawLimit)) : 50;

        const conditions = ['deleted_at IS NULL'];
        const values: unknown[] = [];
        const push = (value: unknown) => {
            values.push(value);
            return `$${values.length}`;
        };

        if (allowedDirectionIds !== null) {
            conditions.push(`direction_id = ANY(${push(allowedDirectionIds)}::uuid[])`);
        }
        if (directionId && isUuidValue(directionId)) {
            conditions.push(`direction_id = ${push(directionId)}::uuid`);
        }
        if (status && VALID_STATUSES.has(status)) {
            conditions.push(`status = ${push(status)}::text`);
        }
        if (objectKey) {
            conditions.push(`object_key = ${push(objectKey)}::text`);
        }

        const whereClause = conditions.join(' AND ');

        if (paginated) {
            const countResult = await dbQuery(
                `SELECT count(*)::int AS total FROM sppz_journal_entries WHERE ${whereClause}`,
                values,
            );
            const total = Number(countResult.rows[0]?.total ?? 0);
            const totalPages = Math.max(1, Math.ceil(total / limit));
            const offset = (page - 1) * limit;
            const limitRef = push(limit);
            const offsetRef = push(offset);

            const result = await dbQuery(
                `SELECT *
                 FROM sppz_journal_entries
                 WHERE ${whereClause}
                 ORDER BY event_datetime DESC, created_at DESC
                 LIMIT ${limitRef}::int OFFSET ${offsetRef}::int`,
                values,
            );
            response.status(200).json({
                entries: result.rows.map(mapJournalRow),
                total,
                page,
                totalPages,
            });
        } else {
            const result = await dbQuery(
                `SELECT *
                 FROM sppz_journal_entries
                 WHERE ${whereClause}
                 ORDER BY event_datetime DESC, created_at DESC`,
                values,
            );
            response.status(200).json(result.rows.map(mapJournalRow));
        }
    }));

    app.post('/sppz-journal/license-check', requireAuth, asyncHandler(async (request: any, response: any) => {
        requireStaffRole(request);
        await ensureSppzJournalSchema();

        const body = request.body && typeof request.body === 'object' ? request.body : {};
        const licenseNumber = normalizeText(body.licenseNumber);
        const contractorInn = normalizeText(body.contractorInn);
        const contractorName = normalizeText(body.contractorName);
        if (!licenseNumber && !contractorInn) {
            throw new ApiError(422, 'VALIDATION_ERROR', 'licenseNumber or contractorInn is required');
        }

        const checked = await checkLicenseWithRegistry({
            licenseNumber,
            contractorInn,
            contractorName,
        });
        const checkId = `sppz-license-check-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const checkedBy = isUuidValue(request.authUser?.id) ? request.authUser.id : null;
        const resultStatus = LICENSE_CHECK_RESULT_STATUSES.has(checked.status) ? checked.status : 'unknown';

        await dbQuery(
            `INSERT INTO sppz_journal_license_checks (
                id, checked_at, checked_by, source, license_number, contractor_inn,
                contractor_name, result_status, message, response_payload
             ) VALUES (
                $1::text, $2::timestamptz, $3::uuid, $4::text, $5::text, $6::text,
                $7::text, $8::text, $9::text, $10::jsonb
             )`,
            [
                checkId,
                checked.checkedAt,
                checkedBy,
                normalizeText(checked.source) || 'manual',
                licenseNumber || null,
                contractorInn || null,
                contractorName || null,
                resultStatus,
                normalizeText(checked.message),
                JSON.stringify(checked.responsePayload || {}),
            ],
        );

        await pushAudit(request, 'license_checked', null, {
            checkId,
            status: resultStatus,
            licenseNumber,
            contractorInn,
        });

        response.status(200).json({
            checkId,
            checkedAt: checked.checkedAt,
            source: normalizeText(checked.source) || 'manual',
            status: resultStatus,
            message: normalizeText(checked.message),
            licenseNumber,
            contractorInn,
            contractorName,
        });
    }));

    app.get('/sppz-journal/audit', requireAuth, asyncHandler(async (request: any, response: any) => {
        requireStaffRole(request);
        await ensureSppzJournalSchema();

        const allowedDirectionIds = await getUserDirectionIds(request);
        if (allowedDirectionIds !== null && allowedDirectionIds.length === 0) {
            response.status(200).json([]);
            return;
        }

        const entryId = normalizeText(request.query?.entryId);
        const action = normalizeText(request.query?.action);
        const rawLimit = Number(request.query?.limit ?? 200);
        const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(500, Math.floor(rawLimit)) : 200;

        const conditions = ['1=1'];
        const values: unknown[] = [];
        const push = (value: unknown) => {
            values.push(value);
            return `$${values.length}`;
        };
        if (allowedDirectionIds !== null) {
            conditions.push(`(entry_id IS NULL OR entry_id IN (SELECT id FROM sppz_journal_entries WHERE direction_id = ANY(${push(allowedDirectionIds)}::uuid[]) AND deleted_at IS NULL))`);
        }
        if (entryId) {
            conditions.push(`entry_id = ${push(entryId)}::text`);
        }
        if (action) {
            conditions.push(`action = ${push(action)}::text`);
        }
        const limitRef = push(limit);

        const result = await dbQuery(
            `SELECT id::text AS id,
                    coalesce(entry_id, '') AS "entryId",
                    action,
                    coalesce(actor_id::text, '') AS "actorId",
                    coalesce(actor_role, '') AS "actorRole",
                    coalesce(payload, '{}'::jsonb) AS payload,
                    created_at AS "createdAt"
             FROM sppz_journal_audit_log
             WHERE ${conditions.join(' AND ')}
             ORDER BY created_at DESC
             LIMIT ${limitRef}::int`,
            values,
        );

        response.status(200).json(result.rows);
    }));

    app.post('/sppz-journal/entries', requireAuth, asyncHandler(async (request: any, response: any) => {
        requireStaffRole(request);
        await ensureSppzJournalSchema();

        const bodyRaw = request.body && typeof request.body === 'object' ? request.body : {};
        const groupedSections = normalizeStringArray(bodyRaw?.groupedSections).filter((item: string) => VALID_SECTIONS.has(item));
        const payload = normalizeEntryPayload(bodyRaw, normalizeText, 'draft');
        validateEntryCompliance(payload, ApiError);
        if (!payload.objectName || !payload.description || !payload.executorName) {
            throw new ApiError(422, 'VALIDATION_ERROR', 'objectName, description and executorName are required');
        }
        if (payload.description.trim().length < DESCRIPTION_MIN_LENGTH) {
            throw new ApiError(
                422,
                'DESCRIPTION_TOO_SHORT',
                'Укажите конкретно: какие узлы проверены, какие операции выполнены',
            );
        }

        if (groupedSections.length > 1) {
            const createdEntries: any[] = [];
            for (const sectionItem of groupedSections) {
                const sectionPayload = {
                    ...payload,
                    id: buildEntryId(),
                    section: sectionItem,
                    sections: [sectionItem],
                };
                const sectionResult = await dbQuery(
                    `INSERT INTO sppz_journal_entries (
                        id, direction_id, maintenance_item_id, contractor_id, object_key,
                        event_datetime, entry_timestamp, status, section, record_type, signature_mode,
                        correction_of_id, entry_data, created_by
                     ) VALUES (
                        $1, $2::uuid, $3::uuid, $4::uuid, $5,
                        $6, $7, $8, $9, $10, $11,
                        $12, $13::jsonb, $14::uuid
                     )
                     ON CONFLICT (id) DO NOTHING
                     RETURNING *`,
                    [
                        sectionPayload.id,
                        sectionPayload.directionId ?? null,
                        sectionPayload.maintenanceItemId ?? null,
                        sectionPayload.contractorId ?? null,
                        sectionPayload.objectKey || null,
                        sectionPayload.eventDateTime,
                        sectionPayload.entryTimestamp,
                        sectionPayload.status,
                        sectionPayload.section,
                        sectionPayload.recordType,
                        sectionPayload.signatureMode,
                        sectionPayload.correctionOfId ?? null,
                        JSON.stringify(sectionPayload),
                        isUuidValue(request.authUser?.id) ? request.authUser.id : null,
                    ],
                );
                const sectionRow = sectionResult.rows[0];
                if (sectionRow) {
                    await pushAudit(request, 'entry_created', sectionPayload.id, {
                        status: sectionPayload.status,
                        section: sectionPayload.section,
                        signatureMode: sectionPayload.signatureMode,
                        groupedWith: groupedSections,
                    });
                    createdEntries.push(mapJournalRow(sectionRow));
                }
            }
            response.status(201).json(createdEntries.length === 1 ? createdEntries[0] : createdEntries);
            return;
        }

        const result = await dbQuery(
            `INSERT INTO sppz_journal_entries (
                id, direction_id, maintenance_item_id, contractor_id, object_key,
                event_datetime, entry_timestamp, status, section, record_type, signature_mode,
                correction_of_id, entry_data, created_by
             ) VALUES (
                $1, $2::uuid, $3::uuid, $4::uuid, $5,
                $6, $7, $8, $9, $10, $11,
                $12, $13::jsonb, $14::uuid
             )
             ON CONFLICT (id) DO NOTHING
             RETURNING *`,
            [
                payload.id,
                payload.directionId ?? null,
                payload.maintenanceItemId ?? null,
                payload.contractorId ?? null,
                payload.objectKey || null,
                payload.eventDateTime,
                payload.entryTimestamp,
                payload.status,
                payload.section,
                payload.recordType,
                payload.signatureMode,
                payload.correctionOfId ?? null,
                JSON.stringify(payload),
                isUuidValue(request.authUser?.id) ? request.authUser.id : null,
            ],
        );
        const row = result.rows[0];
        if (!row) {
            throw new ApiError(409, 'ENTRY_ALREADY_EXISTS', 'Entry with this id already exists');
        }
        await pushAudit(request, 'entry_created', payload.id, {
            status: payload.status,
            section: payload.section,
            signatureMode: payload.signatureMode,
        });
        response.status(201).json(mapJournalRow(row));
    }));

    app.post('/sppz-journal/entries/:entryId/sign-executor', requireAuth, asyncHandler(async (request: any, response: any) => {
        const role = request.authUser?.role ?? '';
        if (!EXECUTOR_SIGN_ROLES.has(role)) {
            throw new ApiError(403, 'FORBIDDEN', 'Executor signature is not allowed for this role');
        }
        await ensureSppzJournalSchema();

        const entryId = normalizeText(request.params.entryId);
        const currentResult = await dbQuery(
            `SELECT * FROM sppz_journal_entries WHERE id = $1::text AND deleted_at IS NULL`,
            [entryId],
        );
        const current = currentResult.rows[0];
        if (!current) throw new ApiError(404, 'NOT_FOUND', 'Entry not found');
        if (current.status !== 'draft') {
            throw new ApiError(409, 'INVALID_STATUS', 'Entry must be in draft status');
        }

        const currentData = current.entry_data && typeof current.entry_data === 'object' ? current.entry_data : {};
        const signedAt = new Date().toISOString();
        const signedBy = isUuidValue(request.authUser?.id) ? request.authUser.id : null;
        const nextData = {
            ...currentData,
            status: 'executor_signed',
            executorSignedAt: signedAt,
            executorSignedById: signedBy ?? '',
        };

        const updateResult = await dbQuery(
            `UPDATE sppz_journal_entries
             SET status = 'executor_signed',
                 entry_data = $2::jsonb,
                 executor_signed_at = $3,
                 executor_signed_by = $4::uuid,
                 updated_at = now()
             WHERE id = $1::text AND deleted_at IS NULL AND status = 'draft'
             RETURNING *`,
            [entryId, JSON.stringify(nextData), signedAt, signedBy],
        );
        const row = updateResult.rows[0];
        if (!row) {
            throw new ApiError(409, 'INVALID_STATUS', 'Entry status changed, reload and retry');
        }
        await pushAudit(request, 'signed_executor', entryId, {
            status: 'executor_signed',
        });

        const dispatch = await sendCustomerSigningLinkForEntry(request, row);

        response.status(200).json({
            ...mapJournalRow(row),
            customerSigningDispatch: dispatch,
        });
    }));

    app.post('/sppz-journal/entries/:entryId/resend-customer-sign-link', requireAuth, asyncHandler(async (request: any, response: any) => {
        requireStaffRole(request);
        await ensureSppzJournalSchema();

        const entryId = normalizeText(request.params.entryId);
        const currentResult = await dbQuery(
            `SELECT * FROM sppz_journal_entries WHERE id = $1::text AND deleted_at IS NULL`,
            [entryId],
        );
        const current = currentResult.rows[0];
        if (!current) throw new ApiError(404, 'NOT_FOUND', 'Entry not found');
        if (current.status !== 'executor_signed') {
            throw new ApiError(409, 'INVALID_STATUS', 'Entry must be signed by executor first');
        }

        const dispatch = await sendCustomerSigningLinkForEntry(request, current);
        await pushAudit(request, 'customer_sign_link_resent', entryId, {
            dispatchStatus: normalizeText(dispatch?.status),
        });
        response.status(200).json({
            ...mapJournalRow(current),
            customerSigningDispatch: dispatch,
        });
    }));

    app.post('/sppz-journal/entries/:entryId/sign-customer', requireAuth, asyncHandler(async (request: any, response: any) => {
        const role = request.authUser?.role ?? '';
        if (!CUSTOMER_SIGN_ROLES.has(role)) {
            throw new ApiError(403, 'FORBIDDEN', 'Customer signature is not allowed for this role');
        }
        await ensureSppzJournalSchema();

        const entryId = normalizeText(request.params.entryId);
        const currentResult = await dbQuery(
            `SELECT * FROM sppz_journal_entries WHERE id = $1::text AND deleted_at IS NULL`,
            [entryId],
        );
        const current = currentResult.rows[0];
        if (!current) throw new ApiError(404, 'NOT_FOUND', 'Entry not found');
        if (current.status !== 'executor_signed') {
            throw new ApiError(409, 'INVALID_STATUS', 'Entry must be signed by executor first');
        }

        const body = request.body && typeof request.body === 'object' ? request.body : {};
        const signerFio = normalizeText(body.signerFio);
        const signerOrderNumber = normalizeText(body.signerOrderNumber);

        const currentData = current.entry_data && typeof current.entry_data === 'object' ? current.entry_data : {};
        const signedAt = new Date().toISOString();
        const signedBy = isUuidValue(request.authUser?.id) ? request.authUser.id : null;
        const nextData = {
            ...currentData,
            status: 'fully_signed',
            customerSignedAt: signedAt,
            customerSignedById: signedBy ?? '',
            customerSignerFio: signerFio || undefined,
            customerSignerOrderNumber: signerOrderNumber || undefined,
        };

        const updateResult = await dbQuery(
            `UPDATE sppz_journal_entries
             SET status = 'fully_signed',
                 entry_data = $2::jsonb,
                 customer_signed_at = $3,
                 customer_signed_by = $4::uuid,
                 updated_at = now()
             WHERE id = $1::text AND deleted_at IS NULL AND status = 'executor_signed'
             RETURNING *`,
            [entryId, JSON.stringify(nextData), signedAt, signedBy],
        );
        const row = updateResult.rows[0];
        if (!row) {
            throw new ApiError(409, 'INVALID_STATUS', 'Entry status changed, reload and retry');
        }

        // F-033: Seal hash chain upon fully_signed
        const executorTs = normalizeText(row.executor_signed_at) || normalizeText(currentData.executorSignedAt) || '';
        const hashResult = await sealEntryHash(
            entryId,
            normalizeText(row.direction_id) || null,
            JSON.stringify(nextData),
            executorTs,
            signedAt,
        );

        await pushAudit(request, 'signed_customer_internal', entryId, {
            status: 'fully_signed',
            signerFio: signerFio || '',
            signerOrderNumber: signerOrderNumber || '',
            entryHash: hashResult.entryHash,
        });

        // F-040: auto-calculate next check dates
        try { await upsertScheduleEntries(row); } catch { /* best effort */ }

        response.status(200).json({
            ...mapJournalRow(row),
            prevEntryHash: hashResult.prevEntryHash,
            entryHash: hashResult.entryHash,
        });
    }));

    app.post('/sppz-journal/entries/:entryId/correction', requireAuth, asyncHandler(async (request: any, response: any) => {
        requireStaffRole(request);
        await ensureSppzJournalSchema();

        const sourceId = normalizeText(request.params.entryId);
        const sourceResult = await dbQuery(
            `SELECT * FROM sppz_journal_entries WHERE id = $1::text AND deleted_at IS NULL`,
            [sourceId],
        );
        const source = sourceResult.rows[0];
        if (!source) throw new ApiError(404, 'NOT_FOUND', 'Entry not found');
        if (source.status !== 'fully_signed') {
            throw new ApiError(409, 'INVALID_STATUS', 'Correction is allowed only for fully signed entry');
        }

        const sourceData = source.entry_data && typeof source.entry_data === 'object' ? source.entry_data : {};
        const body = request.body && typeof request.body === 'object' ? request.body : {};
        const correctionData = normalizeEntryPayload(
            {
                ...sourceData,
                ...body,
                id: normalizeText(body.id) || buildEntryId(),
                eventDateTime: normalizeText(body.eventDateTime) || new Date().toISOString(),
                entryTimestamp: normalizeText(body.entryTimestamp) || new Date().toISOString(),
                description:
                    normalizeText(body.description) ||
                    `Исправление к записи ${sourceId}: ${normalizeText(sourceData.description)}`,
                correctionOfId: sourceId,
                executorOrganization: DEFAULT_EXECUTOR_ORGANIZATION,
            },
            normalizeText,
            'draft',
        );
        if (!correctionData.executorName) {
            correctionData.executorName = normalizeText(sourceData.executorName) || 'Не указан';
        }
        validateEntryCompliance(correctionData, ApiError);

        const insertResult = await dbQuery(
            `INSERT INTO sppz_journal_entries (
                id, direction_id, maintenance_item_id, contractor_id, object_key,
                event_datetime, entry_timestamp, status, section, record_type, signature_mode,
                correction_of_id, entry_data, created_by
             ) VALUES (
                $1, $2::uuid, $3::uuid, $4::uuid, $5,
                $6, $7, $8, $9, $10, $11,
                $12, $13::jsonb, $14::uuid
             )
             ON CONFLICT (id) DO NOTHING
             RETURNING *`,
            [
                correctionData.id,
                correctionData.directionId ?? null,
                correctionData.maintenanceItemId ?? null,
                correctionData.contractorId ?? null,
                correctionData.objectKey || null,
                correctionData.eventDateTime,
                correctionData.entryTimestamp,
                correctionData.status,
                correctionData.section,
                correctionData.recordType,
                correctionData.signatureMode,
                correctionData.correctionOfId ?? null,
                JSON.stringify(correctionData),
                isUuidValue(request.authUser?.id) ? request.authUser.id : null,
            ],
        );
        const row = insertResult.rows[0];
        if (!row) {
            throw new ApiError(409, 'ENTRY_ALREADY_EXISTS', 'Entry with this id already exists');
        }
        await pushAudit(request, 'correction_created', correctionData.id, {
            sourceEntryId: sourceId,
        });
        response.status(201).json(mapJournalRow(row));
    }));

    /* -- Inspector access (F-050-053) DB-backed -- */

    app.post('/sppz-journal/inspector-access', requireAuth, asyncHandler(async (request: any, response: any) => {
        const role = request.authUser?.role ?? '';
        if (!ADMIN_ROLES.has(role)) {
            throw new ApiError(403, 'FORBIDDEN', 'Only admins can create inspector access tokens');
        }
        await ensureSppzJournalSchema();

        const body = request.body && typeof request.body === 'object' ? request.body : {};
        const directionId = normalizeText(body.directionId);
        if (!isUuidValue(directionId)) {
            throw new ApiError(422, 'VALIDATION_ERROR', 'directionId is required');
        }
        const periodFrom = normalizeText(body.periodFrom) || null;
        const periodTo = normalizeText(body.periodTo) || null;
        const expiresInHours = Math.max(
            INSPECTOR_TOKEN_MIN_HOURS,
            Math.min(INSPECTOR_TOKEN_MAX_HOURS, Number(body.expiresInHours) || 48),
        );

        const token = buildInspectorToken();
        const expiresAt = new Date(Date.now() + expiresInHours * 60 * 60 * 1000).toISOString();
        const createdBy = isUuidValue(request.authUser?.id) ? request.authUser.id : null;

        await dbQuery(
            `CREATE TABLE IF NOT EXISTS sppz_inspector_tokens (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                direction_id UUID NOT NULL,
                token TEXT UNIQUE NOT NULL,
                created_by UUID NOT NULL,
                period_from DATE,
                period_to DATE,
                expires_at TIMESTAMPTZ NOT NULL,
                accessed_count INT DEFAULT 0,
                last_accessed_at TIMESTAMPTZ,
                last_accessed_ip TEXT,
                created_at TIMESTAMPTZ DEFAULT NOW()
            )`,
            [],
        );

        const insertResult = await dbQuery(
            `INSERT INTO sppz_inspector_tokens (direction_id, token, created_by, period_from, period_to, expires_at)
             VALUES ($1::uuid, $2::text, $3::uuid, $4::date, $5::date, $6::timestamptz)
             RETURNING *`,
            [directionId, token, createdBy, periodFrom, periodTo, expiresAt],
        );
        const row = insertResult.rows[0];
        await pushAudit(request, 'inspector_token_created', null, { directionId, expiresInHours });

        const base = resolveAppBaseUrl(request, appConfig, normalizeText);
        const inspectUrl = `${base}/sppz-journal/inspect/${encodeURIComponent(token)}`;
        response.status(201).json({
            id: row.id,
            directionId: row.direction_id,
            token: row.token,
            periodFrom: row.period_from,
            periodTo: row.period_to,
            expiresAt: row.expires_at,
            createdAt: row.created_at,
            inspectUrl,
        });
    }));

    app.get('/sppz-journal/inspect/:token', publicLimiter, asyncHandler(async (request: any, response: any) => {
        await ensureSppzJournalSchema();

        const inspectToken = normalizeText(request.params.token);
        if (!inspectToken) {
            throw new ApiError(422, 'VALIDATION_ERROR', 'Token is required');
        }

        await dbQuery(
            `CREATE TABLE IF NOT EXISTS sppz_inspector_tokens (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                direction_id UUID NOT NULL,
                token TEXT UNIQUE NOT NULL,
                created_by UUID NOT NULL,
                period_from DATE,
                period_to DATE,
                expires_at TIMESTAMPTZ NOT NULL,
                accessed_count INT DEFAULT 0,
                last_accessed_at TIMESTAMPTZ,
                last_accessed_ip TEXT,
                created_at TIMESTAMPTZ DEFAULT NOW()
            )`,
            [],
        );

        const tokenResult = await dbQuery(
            `SELECT * FROM sppz_inspector_tokens WHERE token = $1::text LIMIT 1`,
            [inspectToken],
        );
        const tokenRow = tokenResult.rows[0];
        if (!tokenRow) {
            throw new ApiError(403, 'INVALID_TOKEN', 'Invalid inspector access token');
        }
        if (new Date(tokenRow.expires_at).getTime() <= Date.now()) {
            throw new ApiError(403, 'TOKEN_EXPIRED', 'Inspector access token expired');
        }

        await dbQuery(
            `UPDATE sppz_inspector_tokens
             SET accessed_count = accessed_count + 1,
                 last_accessed_at = now(),
                 last_accessed_ip = $2::text
             WHERE id = $1::uuid`,
            [tokenRow.id, normalizeText(request.ip)],
        );

        const conditions = [
            'direction_id = $1::uuid',
            'deleted_at IS NULL',
            "status != 'draft'",
        ];
        const values: unknown[] = [tokenRow.direction_id];
        if (tokenRow.period_from) {
            values.push(tokenRow.period_from);
            conditions.push(`event_datetime::date >= $${values.length}::date`);
        }
        if (tokenRow.period_to) {
            values.push(tokenRow.period_to);
            conditions.push(`event_datetime::date <= $${values.length}::date`);
        }

        const entriesResult = await dbQuery(
            `SELECT * FROM sppz_journal_entries
             WHERE ${conditions.join(' AND ')}
             ORDER BY event_datetime DESC, created_at DESC`,
            values,
        );

        const entries = entriesResult.rows.map((r: any) => {
            const d = r.entry_data && typeof r.entry_data === 'object' ? r.entry_data : {};
            return {
                id: r.id, eventDateTime: r.event_datetime ?? d.eventDateTime,
                entryTimestamp: r.entry_timestamp ?? d.entryTimestamp,
                objectName: d.objectName || '', address: d.address || '',
                section: d.section || r.section, sections: d.sections || [r.section],
                zone: d.zone || '', recordType: d.recordType || r.record_type,
                description: d.description || '', contractor: d.contractor || '',
                contractorInn: d.contractorInn || '',
                executorOrganization: d.executorOrganization || '',
                executorName: d.executorName || '', contractNumber: d.contractNumber || '',
                licenseNumber: d.licenseNumber || '', licenseStatus: d.licenseStatus || '',
                signatureMode: d.signatureMode || r.signature_mode,
                status: r.status ?? d.status,
                executorSignedAt: r.executor_signed_at ?? d.executorSignedAt,
                customerSignedAt: r.customer_signed_at ?? d.customerSignedAt,
            };
        });

        try {
            await dbQuery(
                `INSERT INTO sppz_journal_audit_log (entry_id, action, actor_id, actor_role, payload)
                 VALUES (NULL, 'inspector_access', NULL, 'inspector', $1::jsonb)`,
                [JSON.stringify({
                    token: inspectToken.slice(0, 8) + '...',
                    directionId: normalizeText(tokenRow.direction_id),
                    ip: normalizeText(request.ip),
                })],
            );
        } catch {
            // best effort
        }

        response.status(200).json({
            directionId: tokenRow.direction_id,
            periodFrom: tokenRow.period_from,
            periodTo: tokenRow.period_to,
            expiresAt: tokenRow.expires_at,
            entryCount: entries.length,
            entries,
        });
    }));

    app.get('/sppz-journal/customer-sign/session', publicLimiter, asyncHandler(async (request: any, response: any) => {
        await ensureSppzJournalSchema();

        const token = normalizeText(request.query?.token);
        if (!token) {
            throw new ApiError(422, 'VALIDATION_ERROR', 'Token is required');
        }

        const tokenRow = await getValidSignTokenRow(token);

        const pendingResult = await dbQuery(
            `SELECT *
             FROM sppz_journal_entries
             WHERE contractor_id = $1::uuid
               AND status = 'executor_signed'
               AND deleted_at IS NULL
             ORDER BY event_datetime DESC, created_at DESC`,
            [tokenRow.contractor_id],
        );

        response.status(200).json({
            contractor: {
                id: tokenRow.contractor_id,
                name: normalizeText(tokenRow.contractor_name),
                email: normalizeText(tokenRow.contractor_email),
            },
            expiresAt: tokenRow.expires_at,
            pendingCount: pendingResult.rows.length,
            entries: pendingResult.rows.map(mapJournalRow),
        });
    }));

    app.post('/sppz-journal/customer-sign/submit', publicLimiter, asyncHandler(async (request: any, response: any) => {
        await ensureSppzJournalSchema();

        const body = request.body && typeof request.body === 'object' ? request.body : {};
        const token = normalizeText(body.token);
        const signerFio = normalizeText(body.signerFio);
        const signerOrderNumber = normalizeText(body.signerOrderNumber);
        const signAllPending = body.signAllPending !== false;
        const requestedEntryIds = normalizeStringArray(body.entryIds);

        if (!token) {
            throw new ApiError(422, 'VALIDATION_ERROR', 'Token is required');
        }
        if (!signerFio || !signerOrderNumber) {
            throw new ApiError(422, 'VALIDATION_ERROR', 'signerFio and signerOrderNumber are required');
        }

        const tokenRow = await getValidSignTokenRow(token);

        const conditions = [
            'contractor_id = $1::uuid',
            `status = 'executor_signed'`,
            'deleted_at IS NULL',
        ];
        const values: unknown[] = [tokenRow.contractor_id];

        if (!signAllPending && requestedEntryIds.length > 0) {
            values.push(requestedEntryIds);
            conditions.push(`id = ANY($${values.length}::text[])`);
        }

        const pendingResult = await dbQuery(
            `SELECT *
             FROM sppz_journal_entries
             WHERE ${conditions.join(' AND ')}
             ORDER BY event_datetime DESC, created_at DESC`,
            values,
        );

        if (pendingResult.rows.length === 0) {
            response.status(200).json({
                status: 'signed',
                signedCount: 0,
                signedEntries: [],
            });
            return;
        }

        const signedAt = new Date().toISOString();
        const signedEntries: any[] = [];

        for (const row of pendingResult.rows) {
            const currentData = row.entry_data && typeof row.entry_data === 'object' ? row.entry_data : {};
            const nextData = {
                ...currentData,
                status: 'fully_signed',
                customerSignedAt: signedAt,
                customerSignedById: `external:${tokenRow.contractor_id}`,
                customerSignerFio: signerFio,
                customerSignerOrderNumber: signerOrderNumber,
                customerSignedVia: 'email_link',
                customerSignedViaTokenId: normalizeText(tokenRow.id),
            };

            const updateResult = await dbQuery(
                `UPDATE sppz_journal_entries
                 SET status = 'fully_signed',
                     entry_data = $2::jsonb,
                     customer_signed_at = $3,
                     customer_signed_by = NULL,
                     updated_at = now()
                 WHERE id = $1::text
                   AND status = 'executor_signed'
                   AND deleted_at IS NULL
                 RETURNING *`,
                [normalizeText(row.id), JSON.stringify(nextData), signedAt],
            );

            if (updateResult.rows[0]) {
                const updatedRow = updateResult.rows[0];
                const executorTs = normalizeText(updatedRow.executor_signed_at) || normalizeText(currentData.executorSignedAt) || '';

                // F-033: Seal hash chain upon fully_signed
                const hashResult = await sealEntryHash(
                    normalizeText(row.id),
                    normalizeText(updatedRow.direction_id) || null,
                    JSON.stringify(nextData),
                    executorTs,
                    signedAt,
                );

                signedEntries.push({
                    ...mapJournalRow(updatedRow),
                    prevEntryHash: hashResult.prevEntryHash,
                    entryHash: hashResult.entryHash,
                });
                try {
                    await dbQuery(
                        `INSERT INTO sppz_journal_audit_log (entry_id, action, actor_id, actor_role, payload)
                         VALUES ($1::text, $2::text, NULL, 'external', $3::jsonb)`,
                        [
                            normalizeText(row.id),
                            'signed_customer_external',
                            JSON.stringify({
                                signerFio,
                                signerOrderNumber,
                                via: 'email_link',
                                contractorId: normalizeText(tokenRow.contractor_id),
                                entryHash: hashResult.entryHash,
                            }),
                        ],
                    );
                } catch {
                    // Best effort only.
                }

                // F-040: auto-calculate next check dates
                try { await upsertScheduleEntries(updatedRow); } catch { /* best effort */ }
            }
        }

        await dbQuery(
            `UPDATE sppz_journal_customer_sign_tokens
             SET last_used_at = now(),
                 last_used_ip = $2::text
             WHERE id = $1::text`,
            [normalizeText(tokenRow.id), normalizeText(request.ip)],
        );

        response.status(200).json({
            status: 'signed',
            signedCount: signedEntries.length,
            signedEntries,
        });
    }));

    // F-030: Protection from editing signed entries — PATCH and PUT guards
    app.patch('/sppz-journal/entries/:entryId', requireAuth, asyncHandler(async (request: any, response: any) => {
        requireStaffRole(request);
        await ensureSppzJournalSchema();

        const entryId = normalizeText(request.params.entryId);
        const currentResult = await dbQuery(
            `SELECT id, status FROM sppz_journal_entries WHERE id = $1::text AND deleted_at IS NULL`,
            [entryId],
        );
        const current = currentResult.rows[0];
        if (!current) throw new ApiError(404, 'NOT_FOUND', 'Entry not found');

        if (current.status === 'executor_signed' || current.status === 'fully_signed') {
            throw new ApiError(
                403,
                'ENTRY_SIGNED',
                'Подписанная запись не может быть отредактирована. Используйте механизм исправлений (correction).',
            );
        }

        // Allow editing draft entries
        const body = request.body && typeof request.body === 'object' ? request.body : {};
        const currentFullResult = await dbQuery(
            `SELECT * FROM sppz_journal_entries WHERE id = $1::text AND deleted_at IS NULL`,
            [entryId],
        );
        const currentFull = currentFullResult.rows[0];
        const currentData = currentFull.entry_data && typeof currentFull.entry_data === 'object' ? currentFull.entry_data : {};

        const mergedData = { ...currentData, ...body, status: 'draft', id: entryId };
        const payload = normalizeEntryPayload(mergedData, normalizeText, 'draft');
        validateEntryCompliance(payload, ApiError);

        const updateResult = await dbQuery(
            `UPDATE sppz_journal_entries
             SET entry_data = $2::jsonb,
                 object_key = $3,
                 section = $4,
                 record_type = $5,
                 signature_mode = $6,
                 event_datetime = $7,
                 entry_timestamp = $8,
                 updated_at = now()
             WHERE id = $1::text AND deleted_at IS NULL AND status = 'draft'
             RETURNING *`,
            [
                entryId,
                JSON.stringify(payload),
                payload.objectKey || null,
                payload.section,
                payload.recordType,
                payload.signatureMode,
                payload.eventDateTime,
                payload.entryTimestamp,
            ],
        );
        const row = updateResult.rows[0];
        if (!row) {
            throw new ApiError(409, 'INVALID_STATUS', 'Entry status changed, reload and retry');
        }
        await pushAudit(request, 'entry_updated', entryId, { status: 'draft' });
        response.status(200).json(mapJournalRow(row));
    }));

    app.put('/sppz-journal/entries/:entryId', requireAuth, asyncHandler(async (request: any, response: any) => {
        requireStaffRole(request);
        await ensureSppzJournalSchema();

        const entryId = normalizeText(request.params.entryId);
        const currentResult = await dbQuery(
            `SELECT id, status FROM sppz_journal_entries WHERE id = $1::text AND deleted_at IS NULL`,
            [entryId],
        );
        const current = currentResult.rows[0];
        if (!current) throw new ApiError(404, 'NOT_FOUND', 'Entry not found');

        if (current.status === 'executor_signed' || current.status === 'fully_signed') {
            throw new ApiError(
                403,
                'ENTRY_SIGNED',
                'Подписанная запись не может быть отредактирована. Используйте механизм исправлений (correction).',
            );
        }

        // Allow full replacement of draft entries
        const payload = normalizeEntryPayload({ ...request.body, id: entryId }, normalizeText, 'draft');
        validateEntryCompliance(payload, ApiError);
        if (!payload.objectName || !payload.description || !payload.executorName) {
            throw new ApiError(422, 'VALIDATION_ERROR', 'objectName, description and executorName are required');
        }

        const updateResult = await dbQuery(
            `UPDATE sppz_journal_entries
             SET entry_data = $2::jsonb,
                 direction_id = $3::uuid,
                 maintenance_item_id = $4::uuid,
                 contractor_id = $5::uuid,
                 object_key = $6,
                 section = $7,
                 record_type = $8,
                 signature_mode = $9,
                 event_datetime = $10,
                 entry_timestamp = $11,
                 updated_at = now()
             WHERE id = $1::text AND deleted_at IS NULL AND status = 'draft'
             RETURNING *`,
            [
                entryId,
                JSON.stringify(payload),
                payload.directionId ?? null,
                payload.maintenanceItemId ?? null,
                payload.contractorId ?? null,
                payload.objectKey || null,
                payload.section,
                payload.recordType,
                payload.signatureMode,
                payload.eventDateTime,
                payload.entryTimestamp,
            ],
        );
        const row = updateResult.rows[0];
        if (!row) {
            throw new ApiError(409, 'INVALID_STATUS', 'Entry status changed, reload and retry');
        }
        await pushAudit(request, 'entry_replaced', entryId, { status: 'draft' });
        response.status(200).json(mapJournalRow(row));
    }));

    // F-033: Hash chain verification endpoint
    app.get('/sppz-journal/verify-chain', requireAuth, asyncHandler(async (request: any, response: any) => {
        requireStaffRole(request);
        await ensureSppzJournalSchema();

        const directionId = normalizeText(request.query?.directionId);
        if (!directionId || !isUuidValue(directionId)) {
            throw new ApiError(422, 'VALIDATION_ERROR', 'directionId (valid UUID) is required');
        }

        const allowedDirectionIds = await getUserDirectionIds(request);
        if (allowedDirectionIds !== null && !allowedDirectionIds.includes(directionId)) {
            throw new ApiError(403, 'FORBIDDEN', 'Access denied to this direction');
        }

        const result = await dbQuery(
            `SELECT id, direction_id, entry_data, executor_signed_at, customer_signed_at,
                    prev_entry_hash, entry_hash
             FROM sppz_journal_entries
             WHERE direction_id = $1::uuid
               AND status = 'fully_signed'
               AND deleted_at IS NULL
               AND entry_hash IS NOT NULL
             ORDER BY customer_signed_at ASC, created_at ASC`,
            [directionId],
        );

        const rows = result.rows;
        if (rows.length === 0) {
            response.status(200).json({
                valid: true,
                entriesChecked: 0,
                message: 'No signed entries with hash chain found for this direction.',
            });
            return;
        }

        let expectedPrevHash = 'GENESIS';
        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            const entryDataJson = JSON.stringify(row.entry_data ?? {});
            const executorSignedAt = normalizeText(row.executor_signed_at) || '';
            const customerSignedAt = normalizeText(row.customer_signed_at) || '';

            // Verify prev_entry_hash matches what we expect
            if (normalizeText(row.prev_entry_hash) !== expectedPrevHash) {
                response.status(200).json({
                    valid: false,
                    entriesChecked: i + 1,
                    brokenAt: row.id,
                    reason: 'prev_entry_hash mismatch',
                    details: {
                        expected: expectedPrevHash,
                        actual: normalizeText(row.prev_entry_hash),
                    },
                });
                return;
            }

            // Recompute hash and verify it matches stored entry_hash
            const recomputed = computeEntryHash(
                normalizeText(row.prev_entry_hash),
                normalizeText(row.id),
                entryDataJson,
                executorSignedAt,
                customerSignedAt,
            );

            if (recomputed !== normalizeText(row.entry_hash)) {
                response.status(200).json({
                    valid: false,
                    entriesChecked: i + 1,
                    brokenAt: row.id,
                    reason: 'entry_hash mismatch (data may have been tampered with)',
                    details: {
                        expected: recomputed,
                        actual: normalizeText(row.entry_hash),
                    },
                });
                return;
            }

            expectedPrevHash = normalizeText(row.entry_hash);
        }

        response.status(200).json({
            valid: true,
            entriesChecked: rows.length,
            firstEntryId: rows[0].id,
            lastEntryId: rows[rows.length - 1].id,
            lastEntryHash: normalizeText(rows[rows.length - 1].entry_hash),
        });
    }));

    // --- F-040: GET /sppz-journal/schedule — upcoming/overdue fire safety checks ---
    app.get('/sppz-journal/schedule', requireAuth, asyncHandler(async (request: any, response: any) => {
        requireStaffRole(request);
        await ensureSppzJournalSchema();
        await initScheduleTable();

        const allowedDirectionIds = await getUserDirectionIds(request);
        if (allowedDirectionIds !== null && allowedDirectionIds.length === 0) {
            response.status(200).json([]);
            return;
        }

        const directionId = normalizeText(request.query?.directionId);
        const conditions = ['1=1'];
        const values: unknown[] = [];
        const push = (value: unknown) => {
            values.push(value);
            return `$${values.length}`;
        };

        if (allowedDirectionIds !== null) {
            conditions.push(`direction_id = ANY(${push(allowedDirectionIds)}::uuid[])`);
        }
        if (directionId && isUuidValue(directionId)) {
            conditions.push(`direction_id = ${push(directionId)}::uuid`);
        }

        const result = await dbQuery(
            `SELECT
                id,
                direction_id AS "directionId",
                maintenance_item_id AS "maintenanceItemId",
                object_key AS "objectKey",
                section,
                check_type AS "checkType",
                check_type_label AS "checkTypeLabel",
                period_days AS "periodDays",
                source_entry_id AS "sourceEntryId",
                entry_date AS "entryDate",
                next_check_date AS "nextCheckDate",
                notified_14d AS "notified14d",
                notified_7d AS "notified7d",
                notified_1d AS "notified1d",
                created_at AS "createdAt",
                updated_at AS "updatedAt",
                CASE
                    WHEN next_check_date < now() THEN 'overdue'
                    WHEN next_check_date < now() + interval '14 days' THEN 'warning'
                    ELSE 'ok'
                END AS "urgency",
                EXTRACT(DAY FROM (next_check_date - now()))::int AS "daysUntil"
             FROM sppz_check_schedule
             WHERE ${conditions.join(' AND ')}
             ORDER BY next_check_date ASC`,
            values,
        );

        response.status(200).json(result.rows);
    }));


    // ── F-070/071/072: Fire extinguisher management ────────────────────

    const EXTINGUISHER_TYPES = new Set(['op', 'ou', 'ov', 'ove']);
    const EXTINGUISHER_STATUSES = new Set(['active', 'recharged', 'decommissioned']);

    const RECHARGE_PERIOD_YEARS: Record<string, number> = {
        op: 5,
        ou: 5,
        ov: 1,
        ove: 1,
    };

    const calcNextRechargeDate = (type: string, baseDate: string | null): string | null => {
        if (!baseDate) return null;
        const date = new Date(baseDate);
        if (Number.isNaN(date.getTime())) return null;
        const years = RECHARGE_PERIOD_YEARS[type] ?? 5;
        date.setFullYear(date.getFullYear() + years);
        return date.toISOString().slice(0, 10);
    };

    const buildQrToken = () => randomBytes(16).toString('base64url');

    const mapExtinguisherRow = (row: any) => ({
        id: row.id,
        directionId: row.direction_id,
        maintenanceItemId: row.maintenance_item_id ?? null,
        serialNumber: row.serial_number,
        type: row.type,
        brand: row.brand ?? '',
        chargeMassKg: row.charge_mass_kg != null ? Number(row.charge_mass_kg) : null,
        manufactureDate: row.manufacture_date ?? null,
        commissioningDate: row.commissioning_date ?? null,
        locationFloor: row.location_floor ?? '',
        locationRoom: row.location_room ?? '',
        locationDescription: row.location_description ?? '',
        lastRechargeDate: row.last_recharge_date ?? null,
        nextRechargeDate: row.next_recharge_date ?? null,
        lastInspectionDate: row.last_inspection_date ?? null,
        nextInspectionDate: row.next_inspection_date ?? null,
        status: row.status ?? 'active',
        qrCodeToken: row.qr_code_token ?? null,
        createdBy: row.created_by ?? null,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    });

    // GET /sppz-journal/extinguishers?directionId=...
    app.get('/sppz-journal/extinguishers', requireAuth, asyncHandler(async (request: any, response: any) => {
        requireStaffRole(request);
        await ensureSppzJournalSchema();

        const directionId = normalizeText(request.query?.directionId);
        const conditions = ['deleted_at IS NULL'];
        const values: unknown[] = [];
        const push = (value: unknown) => {
            values.push(value);
            return `$${values.length}`;
        };

        if (directionId && isUuidValue(directionId)) {
            conditions.push(`direction_id = ${push(directionId)}::uuid`);
        }

        const result = await dbQuery(
            `SELECT * FROM sppz_extinguishers
             WHERE ${conditions.join(' AND ')}
             ORDER BY serial_number ASC, created_at DESC`,
            values,
        );
        response.status(200).json(result.rows.map(mapExtinguisherRow));
    }));

    // POST /sppz-journal/extinguishers
    app.post('/sppz-journal/extinguishers', requireAuth, asyncHandler(async (request: any, response: any) => {
        requireStaffRole(request);
        await ensureSppzJournalSchema();

        const body = request.body && typeof request.body === 'object' ? request.body : {};
        const directionId = normalizeText(body.directionId);
        if (!isUuidValue(directionId)) {
            throw new ApiError(422, 'VALIDATION_ERROR', 'directionId is required');
        }
        const serialNumber = normalizeText(body.serialNumber);
        if (!serialNumber) {
            throw new ApiError(422, 'VALIDATION_ERROR', 'serialNumber is required');
        }
        const extType = normalizeText(body.type);
        if (!EXTINGUISHER_TYPES.has(extType)) {
            throw new ApiError(422, 'VALIDATION_ERROR', 'type must be one of: op, ou, ov, ove');
        }

        const maintenanceItemId = isUuidValue(body.maintenanceItemId) ? body.maintenanceItemId : null;
        const brand = normalizeText(body.brand) || null;
        const chargeMassKg = body.chargeMassKg != null && Number.isFinite(Number(body.chargeMassKg)) ? Number(body.chargeMassKg) : null;
        const manufactureDate = normalizeText(body.manufactureDate) || null;
        const commissioningDate = normalizeText(body.commissioningDate) || null;
        const locationFloor = normalizeText(body.locationFloor) || null;
        const locationRoom = normalizeText(body.locationRoom) || null;
        const locationDescription = normalizeText(body.locationDescription) || null;
        const lastRechargeDate = normalizeText(body.lastRechargeDate) || null;
        const lastInspectionDate = normalizeText(body.lastInspectionDate) || null;
        const nextInspectionDate = normalizeText(body.nextInspectionDate) || null;
        const status = EXTINGUISHER_STATUSES.has(normalizeText(body.status)) ? normalizeText(body.status) : 'active';

        // F-071: auto-calculate next_recharge_date
        const rechargeBase = lastRechargeDate || commissioningDate;
        const nextRechargeDate = calcNextRechargeDate(extType, rechargeBase);

        const qrCodeToken = buildQrToken();
        const createdBy = isUuidValue(request.authUser?.id) ? request.authUser.id : null;

        const result = await dbQuery(
            `INSERT INTO sppz_extinguishers (
                direction_id, maintenance_item_id, serial_number, type, brand,
                charge_mass_kg, manufacture_date, commissioning_date,
                location_floor, location_room, location_description,
                last_recharge_date, next_recharge_date,
                last_inspection_date, next_inspection_date,
                status, qr_code_token, created_by
             ) VALUES (
                $1::uuid, $2::uuid, $3, $4, $5,
                $6, $7::date, $8::date,
                $9, $10, $11,
                $12::date, $13::date,
                $14::date, $15::date,
                $16, $17, $18::uuid
             ) RETURNING *`,
            [
                directionId, maintenanceItemId, serialNumber, extType, brand,
                chargeMassKg, manufactureDate, commissioningDate,
                locationFloor, locationRoom, locationDescription,
                lastRechargeDate, nextRechargeDate,
                lastInspectionDate, nextInspectionDate,
                status, qrCodeToken, createdBy,
            ],
        );

        await pushAudit(request, 'extinguisher_created', null, {
            extinguisherId: result.rows[0].id,
            serialNumber,
            type: extType,
        });
        response.status(201).json(mapExtinguisherRow(result.rows[0]));
    }));

    // PATCH /sppz-journal/extinguishers/:id
    app.patch('/sppz-journal/extinguishers/:id', requireAuth, asyncHandler(async (request: any, response: any) => {
        requireStaffRole(request);
        await ensureSppzJournalSchema();

        const extId = normalizeText(request.params.id);
        if (!isUuidValue(extId)) {
            throw new ApiError(422, 'VALIDATION_ERROR', 'Invalid extinguisher id');
        }

        const existing = await dbQuery(
            `SELECT * FROM sppz_extinguishers WHERE id = $1::uuid AND deleted_at IS NULL`,
            [extId],
        );
        if (existing.rows.length === 0) {
            throw new ApiError(404, 'NOT_FOUND', 'Extinguisher not found');
        }

        const body = request.body && typeof request.body === 'object' ? request.body : {};
        const current = existing.rows[0];

        const extType = EXTINGUISHER_TYPES.has(normalizeText(body.type)) ? normalizeText(body.type) : current.type;
        const serialNumber = normalizeText(body.serialNumber) || current.serial_number;
        const brand = body.brand !== undefined ? (normalizeText(body.brand) || null) : current.brand;
        const chargeMassKg = body.chargeMassKg !== undefined
            ? (body.chargeMassKg != null && Number.isFinite(Number(body.chargeMassKg)) ? Number(body.chargeMassKg) : null)
            : current.charge_mass_kg;
        const manufactureDate = body.manufactureDate !== undefined ? (normalizeText(body.manufactureDate) || null) : current.manufacture_date;
        const commissioningDate = body.commissioningDate !== undefined ? (normalizeText(body.commissioningDate) || null) : current.commissioning_date;
        const locationFloor = body.locationFloor !== undefined ? (normalizeText(body.locationFloor) || null) : current.location_floor;
        const locationRoom = body.locationRoom !== undefined ? (normalizeText(body.locationRoom) || null) : current.location_room;
        const locationDescription = body.locationDescription !== undefined ? (normalizeText(body.locationDescription) || null) : current.location_description;
        const lastRechargeDate = body.lastRechargeDate !== undefined ? (normalizeText(body.lastRechargeDate) || null) : current.last_recharge_date;
        const lastInspectionDate = body.lastInspectionDate !== undefined ? (normalizeText(body.lastInspectionDate) || null) : current.last_inspection_date;
        const nextInspectionDate = body.nextInspectionDate !== undefined ? (normalizeText(body.nextInspectionDate) || null) : current.next_inspection_date;
        const status = EXTINGUISHER_STATUSES.has(normalizeText(body.status)) ? normalizeText(body.status) : current.status;

        // F-071: auto-recalculate next_recharge_date
        const rechargeBase = lastRechargeDate || commissioningDate;
        const nextRechargeDate = calcNextRechargeDate(extType, rechargeBase);

        const result = await dbQuery(
            `UPDATE sppz_extinguishers SET
                serial_number = $2, type = $3, brand = $4,
                charge_mass_kg = $5, manufacture_date = $6::date, commissioning_date = $7::date,
                location_floor = $8, location_room = $9, location_description = $10,
                last_recharge_date = $11::date, next_recharge_date = $12::date,
                last_inspection_date = $13::date, next_inspection_date = $14::date,
                status = $15, updated_at = now()
             WHERE id = $1::uuid AND deleted_at IS NULL
             RETURNING *`,
            [
                extId, serialNumber, extType, brand,
                chargeMassKg, manufactureDate, commissioningDate,
                locationFloor, locationRoom, locationDescription,
                lastRechargeDate, nextRechargeDate,
                lastInspectionDate, nextInspectionDate,
                status,
            ],
        );

        if (result.rows.length === 0) {
            throw new ApiError(404, 'NOT_FOUND', 'Extinguisher not found');
        }

        await pushAudit(request, 'extinguisher_updated', null, {
            extinguisherId: extId,
            serialNumber,
        });
        response.status(200).json(mapExtinguisherRow(result.rows[0]));
    }));

    // DELETE /sppz-journal/extinguishers/:id (soft delete)
    app.delete('/sppz-journal/extinguishers/:id', requireAuth, asyncHandler(async (request: any, response: any) => {
        requireStaffRole(request);
        await ensureSppzJournalSchema();

        const extId = normalizeText(request.params.id);
        if (!isUuidValue(extId)) {
            throw new ApiError(422, 'VALIDATION_ERROR', 'Invalid extinguisher id');
        }

        const result = await dbQuery(
            `UPDATE sppz_extinguishers SET deleted_at = now(), updated_at = now()
             WHERE id = $1::uuid AND deleted_at IS NULL
             RETURNING id`,
            [extId],
        );

        if (result.rows.length === 0) {
            throw new ApiError(404, 'NOT_FOUND', 'Extinguisher not found');
        }

        await pushAudit(request, 'extinguisher_deleted', null, { extinguisherId: extId });
        response.status(200).json({ deleted: true, id: extId });
    }));

    // GET /sppz-journal/extinguishers/:id/qr - returns QR code as PNG image
    app.get('/sppz-journal/extinguishers/:id/qr', requireAuth, asyncHandler(async (request: any, response: any) => {
        requireStaffRole(request);
        await ensureSppzJournalSchema();

        const extId = normalizeText(request.params.id);
        if (!isUuidValue(extId)) {
            throw new ApiError(422, 'VALIDATION_ERROR', 'Invalid extinguisher id');
        }

        const result = await dbQuery(
            `SELECT qr_code_token FROM sppz_extinguishers WHERE id = $1::uuid AND deleted_at IS NULL`,
            [extId],
        );

        if (result.rows.length === 0) {
            throw new ApiError(404, 'NOT_FOUND', 'Extinguisher not found');
        }

        const token = result.rows[0].qr_code_token;
        if (!token) {
            throw new ApiError(404, 'NOT_FOUND', 'QR token not found for this extinguisher');
        }

        const baseUrl = resolveAppBaseUrl(request, appConfig, normalizeText);
        const qrUrl = `${baseUrl}/sppz-journal/ext/${encodeURIComponent(token)}`;

        let QRCode: any;
        try {
            const qrModule = await import('qrcode');
            QRCode = qrModule.default || qrModule;
        } catch {
            throw new ApiError(500, 'QR_UNAVAILABLE', 'QR code library not available');
        }

        const pngBuffer = await QRCode.toBuffer(qrUrl, {
            type: 'png',
            width: 300,
            margin: 2,
            errorCorrectionLevel: 'M',
        });

        response.setHeader('Content-Type', 'image/png');
        response.setHeader('Content-Disposition', `inline; filename="ext-qr-${extId}.png"`);
        response.status(200).send(pngBuffer);
    }));

    // GET /sppz-journal/ext/:token - public card view (JSON)
    app.get('/sppz-journal/ext/:token', publicLimiter, asyncHandler(async (request: any, response: any) => {
        await ensureSppzJournalSchema();

        const token = normalizeText(request.params.token);
        if (!token) {
            throw new ApiError(422, 'VALIDATION_ERROR', 'Token is required');
        }

        const result = await dbQuery(
            `SELECT e.*, d.name as direction_name
             FROM sppz_extinguishers e
             LEFT JOIN directions d ON d.id = e.direction_id
             WHERE e.qr_code_token = $1 AND e.deleted_at IS NULL
             LIMIT 1`,
            [token],
        );

        if (result.rows.length === 0) {
            throw new ApiError(404, 'NOT_FOUND', 'Extinguisher not found');
        }

        const row = result.rows[0];
        const ext = mapExtinguisherRow(row);

        // Fetch related journal entries for this extinguisher's direction with fire_extinguishers section
        const historyResult = await dbQuery(
            `SELECT * FROM sppz_journal_entries
             WHERE direction_id = $1::uuid
               AND section = 'fire_extinguishers'
               AND deleted_at IS NULL
             ORDER BY event_datetime DESC
             LIMIT 50`,
            [row.direction_id],
        );

        const history = historyResult.rows.map(mapJournalRow);

        response.status(200).json({
            extinguisher: {
                ...ext,
                directionName: normalizeText(row.direction_name) || '',
            },
            history,
        });
    }));

    /* ── PDF Export (F-060) ── */
    app.get('/sppz-journal/export/pdf', requireAuth, asyncHandler(async (request: any, response: any) => {
        requireStaffRole(request);
        await ensureSppzJournalSchema();

        const allowedDirectionIds = await getUserDirectionIds(request);
        if (allowedDirectionIds !== null && allowedDirectionIds.length === 0) {
            response.setHeader('Content-Type', 'application/pdf');
            response.setHeader('Content-Disposition', `attachment; filename="sppz-journal-empty.pdf"`);
            response.status(200).send(Buffer.alloc(0));
            return;
        }

        const directionId = normalizeText(request.query?.directionId);
        const section = normalizeText(request.query?.section);
        const status = normalizeText(request.query?.status);
        const from = normalizeText(request.query?.from);
        const to = normalizeText(request.query?.to);

        const conditions = ['deleted_at IS NULL'];
        const values: unknown[] = [];
        const push = (value: unknown) => { values.push(value); return `$${values.length}`; };

        if (allowedDirectionIds !== null) {
            conditions.push(`direction_id = ANY(${push(allowedDirectionIds)}::uuid[])`);
        }
        if (directionId && isUuidValue(directionId)) {
            conditions.push(`direction_id = ${push(directionId)}::uuid`);
        }
        if (section && VALID_SECTIONS.has(section)) {
            conditions.push(`section = ${push(section)}::text`);
        }
        if (status && VALID_STATUSES.has(status)) {
            conditions.push(`status = ${push(status)}::text`);
        }
        if (from) {
            conditions.push(`event_datetime >= ${push(from)}::timestamptz`);
        }
        if (to) {
            conditions.push(`event_datetime <= (${push(to)}::date + interval '1 day')`);
        }

        const result = await dbQuery(
            `SELECT * FROM sppz_journal_entries
             WHERE ${conditions.join(' AND ')}
             ORDER BY event_datetime DESC, created_at DESC
             LIMIT 5000`,
            values,
        );
        const entries = result.rows.map(mapJournalRow);
        const firstEntry = entries[0] || {};

        const docDef = buildJournalPdfDocument(entries, {
            organizationName: DEFAULT_EXECUTOR_ORGANIZATION,
            objectName: firstEntry.objectName || undefined,
            address: firstEntry.address || undefined,
            periodFrom: from || undefined,
            periodTo: to || undefined,
        });

        await pushAudit(request, 'pdf_export', null, {
            entryCount: entries.length,
            filters: { directionId, section, status, from, to },
        });

        const buffer = await generatePdfBuffer(docDef);
        response.setHeader('Content-Type', 'application/pdf');
        response.setHeader('Content-Disposition', `attachment; filename="sppz-journal-${new Date().toISOString().slice(0, 10)}.pdf"`);
        response.send(buffer);
    }));

    /* ── Summary Report (F-063) ── */
    app.get('/sppz-journal/report', requireAuth, asyncHandler(async (request: any, response: any) => {
        requireStaffRole(request);
        await ensureSppzJournalSchema();

        const allowedDirectionIds = await getUserDirectionIds(request);
        if (allowedDirectionIds !== null && allowedDirectionIds.length === 0) {
            response.status(200).json({ entries: [], summary: {} });
            return;
        }

        const directionId = normalizeText(request.query?.directionId);
        const from = normalizeText(request.query?.from);
        const to = normalizeText(request.query?.to);

        const conditions = ['deleted_at IS NULL'];
        const values: unknown[] = [];
        const push = (value: unknown) => { values.push(value); return `$${values.length}`; };

        if (allowedDirectionIds !== null) {
            conditions.push(`direction_id = ANY(${push(allowedDirectionIds)}::uuid[])`);
        }
        if (directionId && isUuidValue(directionId)) {
            conditions.push(`direction_id = ${push(directionId)}::uuid`);
        }
        if (from) {
            conditions.push(`event_datetime >= ${push(from)}::timestamptz`);
        }
        if (to) {
            conditions.push(`event_datetime <= (${push(to)}::date + interval '1 day')`);
        }

        const result = await dbQuery(
            `SELECT * FROM sppz_journal_entries
             WHERE ${conditions.join(' AND ')}
             ORDER BY event_datetime DESC, created_at DESC`,
            values,
        );
        const entries = result.rows.map(mapJournalRow);

        const docDef = buildSummaryReportDocument(entries, {
            organizationName: DEFAULT_EXECUTOR_ORGANIZATION,
            periodFrom: from || undefined,
            periodTo: to || undefined,
        });

        await pushAudit(request, 'summary_report_export', null, {
            entryCount: entries.length,
            filters: { directionId, from, to },
        });

        const buffer = await generatePdfBuffer(docDef);
        response.setHeader('Content-Type', 'application/pdf');
        response.setHeader('Content-Disposition', `attachment; filename="sppz-report-${new Date().toISOString().slice(0, 10)}.pdf"`);
        response.send(buffer);
    }));
};

// ── Protected Objects CRUD (F-001..003) ──────────────────────────────
export const registerSppzProtectedObjectRoutes = (params: any) => {
    const { app, requireAuth, asyncHandler, dbQuery, ApiError, normalizeText } = params;

    const requireStaffRole = (request: any) => {
        const role = request.authUser?.role ?? '';
        if (!STAFF_ROLES.has(role)) throw new ApiError(403, 'FORBIDDEN', 'Access denied');
    };

    const ensureTables = async () => {
        await dbQuery(`CREATE TABLE IF NOT EXISTS sppz_protected_objects (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), direction_id UUID NOT NULL, org_name TEXT, org_inn TEXT, org_ogrn TEXT, legal_address TEXT, physical_address TEXT, director_name TEXT, fire_responsible_name TEXT, fire_responsible_order_number TEXT, fire_responsible_order_date DATE, fire_class TEXT, contact_phone TEXT, contact_email TEXT, created_by UUID, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW())`);
        await dbQuery(`CREATE TABLE IF NOT EXISTS sppz_fire_systems (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), object_id UUID NOT NULL REFERENCES sppz_protected_objects(id) ON DELETE CASCADE, type_code TEXT NOT NULL, model TEXT, commissioning_date DATE, contractor_id UUID, contractor_license TEXT, contractor_license_valid_to DATE, check_period_days INT, next_check_date DATE, status TEXT DEFAULT 'active', created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW())`);
    };

    const mapObj = (row: any) => ({
        id: row.id, directionId: row.direction_id, orgName: row.org_name ?? '', orgInn: row.org_inn ?? '', orgOgrn: row.org_ogrn ?? '', legalAddress: row.legal_address ?? '', physicalAddress: row.physical_address ?? '', directorName: row.director_name ?? '', fireResponsibleName: row.fire_responsible_name ?? '', fireResponsibleOrderNumber: row.fire_responsible_order_number ?? '', fireResponsibleOrderDate: row.fire_responsible_order_date ?? null, fireClass: row.fire_class ?? '', contactPhone: row.contact_phone ?? '', contactEmail: row.contact_email ?? '', createdBy: row.created_by ?? null, createdAt: row.created_at, updatedAt: row.updated_at,
    });

    const mapSys = (row: any) => ({
        id: row.id, objectId: row.object_id, typeCode: row.type_code, model: row.model ?? '', commissioningDate: row.commissioning_date ?? null, contractorId: row.contractor_id ?? null, contractorLicense: row.contractor_license ?? '', contractorLicenseValidTo: row.contractor_license_valid_to ?? null, checkPeriodDays: row.check_period_days ?? null, nextCheckDate: row.next_check_date ?? null, status: row.status ?? 'active', createdAt: row.created_at, updatedAt: row.updated_at,
    });

    // List protected objects
    app.get('/sppz-journal/objects', requireAuth, asyncHandler(async (request: any, response: any) => {
        requireStaffRole(request);
        await ensureTables();
        const allowedDirIds = await resolveUserDirectionIds(request, dbQuery);
        if (allowedDirIds !== null && allowedDirIds.length === 0) {
            response.status(200).json([]);
            return;
        }
        const directionId = normalizeText(request.query?.directionId);
        const conditions = ['1=1'];
        const values: unknown[] = [];
        if (allowedDirIds !== null) { values.push(allowedDirIds); conditions.push(`direction_id = ANY($${values.length}::uuid[])`); }
        if (directionId && isUuidValue(directionId)) { values.push(directionId); conditions.push(`direction_id = $${values.length}::uuid`); }
        const result = await dbQuery(`SELECT * FROM sppz_protected_objects WHERE ${conditions.join(' AND ')} ORDER BY created_at DESC`, values);
        response.status(200).json(result.rows.map(mapObj));
    }));

    // Get single protected object
    app.get('/sppz-journal/objects/:id', requireAuth, asyncHandler(async (request: any, response: any) => {
        requireStaffRole(request);
        await ensureTables();
        const objectId = normalizeText(request.params.id);
        if (!isUuidValue(objectId)) throw new ApiError(400, 'INVALID_ID', 'Invalid object id');
        const result = await dbQuery(`SELECT * FROM sppz_protected_objects WHERE id = $1::uuid`, [objectId]);
        if (!result.rows[0]) throw new ApiError(404, 'NOT_FOUND', 'Protected object not found');
        response.status(200).json(mapObj(result.rows[0]));
    }));

    // Create protected object
    app.post('/sppz-journal/objects', requireAuth, asyncHandler(async (request: any, response: any) => {
        requireStaffRole(request);
        await ensureTables();
        const body = request.body && typeof request.body === 'object' ? request.body : {};
        const directionId = normalizeText(body.directionId);
        if (!isUuidValue(directionId)) throw new ApiError(422, 'VALIDATION_ERROR', 'directionId is required');
        const fireClass = normalizeText(body.fireClass);
        if (fireClass && !VALID_FIRE_CLASSES.has(fireClass)) throw new ApiError(422, 'VALIDATION_ERROR', 'Invalid fire class');
        const createdBy = isUuidValue(request.authUser?.id) ? request.authUser.id : null;
        const result = await dbQuery(
            `INSERT INTO sppz_protected_objects (direction_id, org_name, org_inn, org_ogrn, legal_address, physical_address, director_name, fire_responsible_name, fire_responsible_order_number, fire_responsible_order_date, fire_class, contact_phone, contact_email, created_by) VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::uuid) RETURNING *`,
            [directionId, normalizeText(body.orgName) || null, normalizeText(body.orgInn) || null, normalizeText(body.orgOgrn) || null, normalizeText(body.legalAddress) || null, normalizeText(body.physicalAddress) || null, normalizeText(body.directorName) || null, normalizeText(body.fireResponsibleName) || null, normalizeText(body.fireResponsibleOrderNumber) || null, normalizeText(body.fireResponsibleOrderDate) || null, fireClass || null, normalizeText(body.contactPhone) || null, normalizeText(body.contactEmail) || null, createdBy],
        );
        response.status(201).json(mapObj(result.rows[0]));
    }));

    // Update protected object
    app.put('/sppz-journal/objects/:id', requireAuth, asyncHandler(async (request: any, response: any) => {
        requireStaffRole(request);
        await ensureTables();
        const objectId = normalizeText(request.params.id);
        if (!isUuidValue(objectId)) throw new ApiError(400, 'INVALID_ID', 'Invalid object id');
        const body = request.body && typeof request.body === 'object' ? request.body : {};
        const fireClass = normalizeText(body.fireClass);
        if (fireClass && !VALID_FIRE_CLASSES.has(fireClass)) throw new ApiError(422, 'VALIDATION_ERROR', 'Invalid fire class');
        const result = await dbQuery(
            `UPDATE sppz_protected_objects SET org_name = COALESCE($2, org_name), org_inn = COALESCE($3, org_inn), org_ogrn = COALESCE($4, org_ogrn), legal_address = COALESCE($5, legal_address), physical_address = COALESCE($6, physical_address), director_name = COALESCE($7, director_name), fire_responsible_name = COALESCE($8, fire_responsible_name), fire_responsible_order_number = COALESCE($9, fire_responsible_order_number), fire_responsible_order_date = COALESCE($10, fire_responsible_order_date), fire_class = COALESCE($11, fire_class), contact_phone = COALESCE($12, contact_phone), contact_email = COALESCE($13, contact_email), updated_at = now() WHERE id = $1::uuid RETURNING *`,
            [objectId, normalizeText(body.orgName) || null, normalizeText(body.orgInn) || null, normalizeText(body.orgOgrn) || null, normalizeText(body.legalAddress) || null, normalizeText(body.physicalAddress) || null, normalizeText(body.directorName) || null, normalizeText(body.fireResponsibleName) || null, normalizeText(body.fireResponsibleOrderNumber) || null, normalizeText(body.fireResponsibleOrderDate) || null, fireClass || null, normalizeText(body.contactPhone) || null, normalizeText(body.contactEmail) || null],
        );
        if (!result.rows[0]) throw new ApiError(404, 'NOT_FOUND', 'Protected object not found');
        response.status(200).json(mapObj(result.rows[0]));
    }));

    // Delete protected object
    app.delete('/sppz-journal/objects/:id', requireAuth, asyncHandler(async (request: any, response: any) => {
        requireStaffRole(request);
        await ensureTables();
        const objectId = normalizeText(request.params.id);
        if (!isUuidValue(objectId)) throw new ApiError(400, 'INVALID_ID', 'Invalid object id');
        const result = await dbQuery(`DELETE FROM sppz_protected_objects WHERE id = $1::uuid RETURNING id`, [objectId]);
        if (result.rows.length === 0) throw new ApiError(404, 'NOT_FOUND', 'Protected object not found');
        response.status(200).json({ deleted: true, id: objectId });
    }));

    // ── Fire Systems CRUD ────────────────────────────────────────────────

    // List fire systems for object
    app.get('/sppz-journal/objects/:id/systems', requireAuth, asyncHandler(async (request: any, response: any) => {
        requireStaffRole(request);
        await ensureTables();
        const objectId = normalizeText(request.params.id);
        if (!isUuidValue(objectId)) throw new ApiError(400, 'INVALID_ID', 'Invalid object id');
        const result = await dbQuery(`SELECT * FROM sppz_fire_systems WHERE object_id = $1::uuid ORDER BY created_at DESC`, [objectId]);
        response.status(200).json(result.rows.map(mapSys));
    }));

    // Add fire system
    app.post('/sppz-journal/objects/:id/systems', requireAuth, asyncHandler(async (request: any, response: any) => {
        requireStaffRole(request);
        await ensureTables();
        const objectId = normalizeText(request.params.id);
        if (!isUuidValue(objectId)) throw new ApiError(400, 'INVALID_ID', 'Invalid object id');
        const objectResult = await dbQuery(`SELECT id FROM sppz_protected_objects WHERE id = $1::uuid`, [objectId]);
        if (objectResult.rows.length === 0) throw new ApiError(404, 'NOT_FOUND', 'Protected object not found');
        const body = request.body && typeof request.body === 'object' ? request.body : {};
        const typeCode = normalizeText(body.typeCode);
        if (!typeCode || !VALID_FIRE_SYSTEM_TYPE_CODES.has(typeCode)) throw new ApiError(422, 'VALIDATION_ERROR', 'Invalid typeCode');
        const systemStatus = normalizeText(body.status) || 'active';
        if (!VALID_FIRE_SYSTEM_STATUSES.has(systemStatus)) throw new ApiError(422, 'VALIDATION_ERROR', 'Invalid status');
        const contractorId = normalizeText(body.contractorId);
        const result = await dbQuery(
            `INSERT INTO sppz_fire_systems (object_id, type_code, model, commissioning_date, contractor_id, contractor_license, contractor_license_valid_to, check_period_days, next_check_date, status) VALUES ($1::uuid, $2, $3, $4, $5::uuid, $6, $7, $8, $9, $10) RETURNING *`,
            [objectId, typeCode, normalizeText(body.model) || null, normalizeText(body.commissioningDate) || null, isUuidValue(contractorId) ? contractorId : null, normalizeText(body.contractorLicense) || null, normalizeText(body.contractorLicenseValidTo) || null, Number.isFinite(Number(body.checkPeriodDays)) ? Math.floor(Number(body.checkPeriodDays)) : null, normalizeText(body.nextCheckDate) || null, systemStatus],
        );
        response.status(201).json(mapSys(result.rows[0]));
    }));

    // Update fire system
    app.put('/sppz-journal/objects/:objectId/systems/:systemId', requireAuth, asyncHandler(async (request: any, response: any) => {
        requireStaffRole(request);
        await ensureTables();
        const objectId = normalizeText(request.params.objectId);
        const systemId = normalizeText(request.params.systemId);
        if (!isUuidValue(objectId) || !isUuidValue(systemId)) throw new ApiError(400, 'INVALID_ID', 'Invalid id');
        const body = request.body && typeof request.body === 'object' ? request.body : {};
        const typeCode = normalizeText(body.typeCode);
        if (typeCode && !VALID_FIRE_SYSTEM_TYPE_CODES.has(typeCode)) throw new ApiError(422, 'VALIDATION_ERROR', 'Invalid typeCode');
        const systemStatus = normalizeText(body.status);
        if (systemStatus && !VALID_FIRE_SYSTEM_STATUSES.has(systemStatus)) throw new ApiError(422, 'VALIDATION_ERROR', 'Invalid status');
        const contractorId = normalizeText(body.contractorId);
        const result = await dbQuery(
            `UPDATE sppz_fire_systems SET type_code = COALESCE($3, type_code), model = COALESCE($4, model), commissioning_date = COALESCE($5, commissioning_date), contractor_id = COALESCE($6::uuid, contractor_id), contractor_license = COALESCE($7, contractor_license), contractor_license_valid_to = COALESCE($8, contractor_license_valid_to), check_period_days = COALESCE($9, check_period_days), next_check_date = COALESCE($10, next_check_date), status = COALESCE($11, status), updated_at = now() WHERE id = $2::uuid AND object_id = $1::uuid RETURNING *`,
            [objectId, systemId, typeCode || null, normalizeText(body.model) || null, normalizeText(body.commissioningDate) || null, isUuidValue(contractorId) ? contractorId : null, normalizeText(body.contractorLicense) || null, normalizeText(body.contractorLicenseValidTo) || null, Number.isFinite(Number(body.checkPeriodDays)) ? Math.floor(Number(body.checkPeriodDays)) : null, normalizeText(body.nextCheckDate) || null, systemStatus || null],
        );
        if (!result.rows[0]) throw new ApiError(404, 'NOT_FOUND', 'Fire system not found');
        response.status(200).json(mapSys(result.rows[0]));
    }));

    // Delete fire system
    app.delete('/sppz-journal/objects/:objectId/systems/:systemId', requireAuth, asyncHandler(async (request: any, response: any) => {
        requireStaffRole(request);
        await ensureTables();
        const objectId = normalizeText(request.params.objectId);
        const systemId = normalizeText(request.params.systemId);
        if (!isUuidValue(objectId) || !isUuidValue(systemId)) throw new ApiError(400, 'INVALID_ID', 'Invalid id');
        const result = await dbQuery(`DELETE FROM sppz_fire_systems WHERE id = $2::uuid AND object_id = $1::uuid RETURNING id`, [objectId, systemId]);
        if (result.rows.length === 0) throw new ApiError(404, 'NOT_FOUND', 'Fire system not found');
        response.status(200).json({ deleted: true, id: systemId });
    }));
};
