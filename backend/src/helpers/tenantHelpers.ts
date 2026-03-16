import { randomUUID } from 'node:crypto';
import { dbQuery } from '../db.js';
import { ApiError } from '../errors.js';
import { logger, serializeError } from '../logger.js';
import { canSendEmails, sendSystemEventNotice } from '../services/mailService.js';
import { escapeHtml, isEmailValue, isUuidValue, normalizeText } from './normalize.js';
import { wrapEmailHtml } from './emailTemplates.js';
import { localMockAuthEnabled } from './mockData.js';
import { clientRecipientRoles } from './roles.js';
import { normalizeSearchQuery } from './projectHelpers.js';
import { normalizeSavedViewOrder } from './savedViews.js';

export const normalizeTenantContacts = (value) => {
    let parsed = value;
    if (typeof parsed === 'string') {
        try { parsed = JSON.parse(parsed); } catch { return []; }
    }
    if (!Array.isArray(parsed)) {
        return [];
    }
    return parsed
        .filter((contact) => contact && typeof contact === 'object')
        .map((contact) => ({
        id: typeof contact.id === 'string' && contact.id.trim().length > 0 ? contact.id.trim() : randomUUID(),
        fullName: typeof contact.fullName === 'string' ? contact.fullName.trim() : '',
        position: typeof contact.position === 'string' ? contact.position.trim() : '',
        email: typeof contact.email === 'string' ? contact.email.trim() : '',
        phone: typeof contact.phone === 'string' ? contact.phone.trim() : '',
    }));
};
export const mapTenantRow = (row) => {
    const contacts = normalizeTenantContacts(row.contacts);
    const firstContact = contacts[0] as { email?: string; phone?: string } | undefined;
    return {
        id: row.id,
        name: row.name,
        brandName: typeof row.brandName === 'string' && row.brandName.trim().length > 0 ? row.brandName.trim() : row.name,
        inn: typeof row.inn === 'string' ? row.inn : '',
        email: typeof firstContact?.email === 'string' ? firstContact.email : '',
        phone: typeof firstContact?.phone === 'string' ? firstContact.phone : '',
        type: row.type === 'contractor' ? 'contractor' : 'tenant',
        contacts,
    };
};
export const sendTenantEventNotification = async (request, payload) => {
    const action = typeof payload?.action === 'string' ? payload.action.trim().toLowerCase() : '';
    if (!['created', 'updated', 'deleted'].includes(action)) {
        throw new ApiError(422, 'VALIDATION_ERROR', 'action must be one of: created, updated, deleted');
    }
    const tenant = payload?.tenant && typeof payload.tenant === 'object' ? payload.tenant : {};
    const tenantId = typeof tenant.id === 'string' && tenant.id.trim().length > 0 ? tenant.id.trim() : null;
    const tenantName = typeof tenant.name === 'string' && tenant.name.trim().length > 0
        ? tenant.name.trim()
        : typeof tenant.brandName === 'string' && tenant.brandName.trim().length > 0
            ? tenant.brandName.trim()
            : tenantId ?? 'Без названия';
    if (!canSendEmails()) {
        return { status: 'accepted', delivery: 'disabled' };
    }
    const recipients = new Map();
    if (!localMockAuthEnabled) {
        const adminResult = await dbQuery(`select distinct lower(trim(email)) as email
       from app_users
       where role::text in ('admin', 'manager')
         and status::text = 'active'
         and coalesce(trim(email), '') <> ''`);
        for (const row of adminResult.rows) {
            const email = String(row.email ?? '').trim().toLowerCase();
            if (!email) {
                continue;
            }
            recipients.set(email, email);
        }
        if (tenantId && isUuidValue(tenantId)) {
            const scopedResult = await dbQuery(`select distinct lower(trim(u.email)) as email
         from app_users u
         join app_user_bindings ub on ub.user_id = u.id
         where u.status::text = 'active'
           and u.role::text = any($2::text[])
           and coalesce(trim(u.email), '') <> ''
           and ub.counterparty_id = $1::uuid`, [tenantId, clientRecipientRoles]);
            for (const row of scopedResult.rows) {
                const email = String(row.email ?? '').trim().toLowerCase();
                if (!email) {
                    continue;
                }
                recipients.set(email, email);
            }
        }
    }
    if (recipients.size === 0) {
        return { status: 'accepted', delivery: 'no_recipients' };
    }
    const actorUserId = request.authUser?.id ?? null;
    const actorRole = request.authUser?.role ?? null;
    const subject = `[TENANT_${action.toUpperCase()}] ${tenantName}`;
    const tenantSnapshot = (() => {
        try {
            const serialized = JSON.stringify(tenant ?? null);
            return serialized.length > 4000 ? `${serialized.slice(0, 4000)}...` : serialized;
        }
        catch (_error) {
            return '[unserializable]';
        }
    })();
    const body = `Событие: tenant_${action}\n` +
        `ActorUserId: ${actorUserId ?? 'null'}\n` +
        `ActorRole: ${actorRole ?? 'null'}\n` +
        `TenantId: ${tenantId ?? 'null'}\n` +
        `RequestId: ${request.requestId ?? 'null'}\n` +
        `IP: ${request.ip ?? 'null'}\n\n` +
        `Tenant:\n${tenantSnapshot}`;
    await Promise.all(Array.from(recipients.values()).map(async (email) => {
        try {
            await sendSystemEventNotice({
                to: email,
                subject,
                body,
            });
        }
        catch (error) {
            logger.error('Failed to send tenant event email', {
                action,
                tenantId,
                recipientEmail: email,
                error: serializeError(error),
            });
        }
    }));
    return { status: 'accepted', sent: recipients.size };
};

// Saved view configuration for tenants
const normalizeTenantSavedViewBrandParam = (value: any): string => {
    const normalized = normalizeText(value).toLowerCase();
    return normalized;
};

const normalizeTenantSavedViewInnParam = (value: any): string => {
    const normalized = normalizeText(value);
    return normalized;
};

const normalizeTenantSavedViewContactParam = (value: any): string => {
    const normalized = normalizeText(value).toLowerCase();
    return normalized;
};

const normalizeTenantSavedViewSort = (value: any): string => {
    const normalized = normalizeText(value).toLowerCase();
    const allowed = new Set(['name', 'brand_name', 'inn', 'created_at', 'updated_at']);
    if (!normalized || !allowed.has(normalized)) {
        return 'name';
    }
    return normalized;
};

export const mergeTenantSavedViewParams = (baseParams: any, value: any) => {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const next: Record<string, any> = {
        search: normalizeSearchQuery(baseParams?.search),
        brand: normalizeTenantSavedViewBrandParam(baseParams?.brand),
        inn: normalizeTenantSavedViewInnParam(baseParams?.inn),
        contact: normalizeTenantSavedViewContactParam(baseParams?.contact),
        sort: normalizeTenantSavedViewSort(baseParams?.sort),
        order: normalizeSavedViewOrder(baseParams?.order),
    };

    if (Object.prototype.hasOwnProperty.call(source, 'search')) {
        next.search = normalizeSearchQuery(source.search);
    }
    if (Object.prototype.hasOwnProperty.call(source, 'brand')) {
        next.brand = normalizeTenantSavedViewBrandParam(source.brand);
    }
    if (Object.prototype.hasOwnProperty.call(source, 'inn')) {
        next.inn = normalizeTenantSavedViewInnParam(source.inn);
    }
    if (Object.prototype.hasOwnProperty.call(source, 'contact')) {
        next.contact = normalizeTenantSavedViewContactParam(source.contact);
    }
    if (Object.prototype.hasOwnProperty.call(source, 'sort') || Object.prototype.hasOwnProperty.call(source, 'order')) {
        next.sort = normalizeTenantSavedViewSort(
            Object.prototype.hasOwnProperty.call(source, 'sort') ? source.sort : next.sort
        );
        next.order = normalizeSavedViewOrder(
            Object.prototype.hasOwnProperty.call(source, 'order') ? source.order : next.order
        );
    }

    return next;
};

export const tenantSavedViewConfig = {
    module: 'tenants',
    systemViewId: 'tenants-system-default',
    systemViewName: 'Все контрагенты',
    defaultParams: {
        search: '',
        brand: '',
        inn: '',
        contact: '',
        sort: 'name',
        order: 'asc',
    },
    mergeParams: mergeTenantSavedViewParams,
};
