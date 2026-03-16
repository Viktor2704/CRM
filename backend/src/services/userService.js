import { dbQuery, withTx } from '../db.js';
import { ApiError, mapPgError } from '../errors.js';
import { logger, serializeError } from '../logger.js';
import { canSendEmails, sendSystemEventNotice } from './mailService.js';
import { publishUserAuditEvent } from './userAuditEvents.js';
const clientRoles = ['client_manager', 'client_user', 'user'];
const userRoleLabels = {
    admin: 'Администратор',
    manager: 'Руководитель',
    dispatcher: 'Диспетчер',
    curator: 'Куратор',
    executor: 'Исполнитель',
    installer: 'Заказчик монтаж/проекты',
    client_manager: 'Представитель клиента',
    client_user: 'Пользователь клиента',
    user: 'Клиент',
};
const userStatusLabels = {
    active: 'Активен',
    invited: 'Приглашен',
    blocked: 'Заблокирован',
    deactivated: 'Деактивирован',
};
const userAuditActionLabels = {
    user_created: 'Создание пользователя',
    profile_changed: 'Изменение профиля',
    role_changed: 'Изменение роли',
    status_changed: 'Изменение статуса',
    bindings_changed: 'Изменение прав доступа',
    user_deleted: 'Удаление пользователя',
    email_login_token_sent: 'Отправка токена входа',
    invite_sent: 'Отправка приглашения',
    invite_accepted: 'Принятие приглашения',
    registration_pending_approval: 'Ожидание подтверждения',
    password_reset_requested: 'Запрос сброса пароля',
    password_reset: 'Сброс пароля',
    bootstrap_admin_created: 'Создание первого администратора',
};
const normalizeText = (value, fallback = 'не указано') => {
    if (value === null || value === undefined) {
        return fallback;
    }
    const text = String(value).trim();
    return text.length > 0 ? text : fallback;
};
const asObject = (value) => {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
};
const formatIsoDateTime = (value) => {
    if (!value) {
        return 'не указано';
    }
    const parsed = new Date(String(value));
    if (Number.isNaN(parsed.getTime())) {
        return normalizeText(value);
    }
    return parsed.toLocaleString('ru-RU');
};
const roleLabel = (value) => {
    const key = String(value ?? '');
    return userRoleLabels[key] ?? normalizeText(value);
};
const statusLabel = (value) => {
    const key = String(value ?? '');
    return userStatusLabels[key] ?? normalizeText(value);
};
const userAuditActionLabel = (action) => {
    return userAuditActionLabels[action] ?? 'Изменение пользователя';
};
const summarizeUserAuditEvent = (action, beforeState, afterState) => {
    const before = asObject(beforeState);
    const after = asObject(afterState);
    switch (action) {
        case 'user_created':
            return `Создан пользователь: ${normalizeText(after.fullName, 'Без имени')} (${normalizeText(after.email, 'без email')}), роль: ${roleLabel(after.role)}, статус: ${statusLabel(after.status)}.`;
        case 'profile_changed':
            return `Обновлен профиль пользователя: ФИО "${normalizeText(before.fullName)}" -> "${normalizeText(after.fullName)}", телефон "${normalizeText(before.phone, 'не указан')}" -> "${normalizeText(after.phone, 'не указан')}".`;
        case 'role_changed':
            return `Изменена роль пользователя: ${roleLabel(before.role)} -> ${roleLabel(after.role)}.`;
        case 'status_changed':
            return `Изменен статус пользователя: ${statusLabel(before.status)} -> ${statusLabel(after.status)}.`;
        case 'bindings_changed':
            return `Изменены права доступа: контрагент ${normalizeText(before.counterpartyId, 'не выбран')} -> ${normalizeText(after.counterpartyId, 'не выбран')}, глобальный доступ ${before.isGlobal ? 'да' : 'нет'} -> ${after.isGlobal ? 'да' : 'нет'}.`;
        case 'user_deleted':
            return `Удален пользователь: ${normalizeText(before.fullName, 'Без имени')} (${normalizeText(before.email, 'без email')}), ID: ${normalizeText(after.deletedUserId)}.`;
        case 'email_login_token_sent':
            return `Отправлен токен входа на email ${normalizeText(after.email)} (действует до ${formatIsoDateTime(after.expiresAt)}).`;
        case 'invite_sent':
            return `Отправлено приглашение пользователю (действует до ${formatIsoDateTime(after.expiresAt)}).`;
        case 'invite_accepted':
            return 'Пользователь принял приглашение и завершил регистрацию.';
        case 'registration_pending_approval':
            return `Регистрация завершена, ожидает подтверждения администратора (уведомлено администраторов: ${normalizeText(after.adminRecipients, '0')}).`;
        case 'password_reset_requested':
            return `Запрошен сброс пароля для email ${normalizeText(after.email)}.`;
        case 'password_reset':
            return `Пароль успешно сброшен, текущий статус: ${statusLabel(after.status)}.`;
        case 'bootstrap_admin_created':
            return `Создан первичный администратор системы (ID: ${normalizeText(after.userId)}).`;
        default:
            return userAuditActionLabel(action);
    }
};
const sanitizeBindings = (bindings) => {
    const unique = (items) => {
        return Array.from(new Set(items ?? []));
    };
    return {
        counterpartyId: bindings?.counterpartyId ?? null,
        contractIds: unique(bindings?.contractIds),
        objectIds: unique(bindings?.objectIds),
        directionIds: unique(bindings?.directionIds),
        projectIds: unique(bindings?.projectIds),
        isGlobal: !!bindings?.isGlobal,
    };
};
const sortArray = (items) => [...items].sort((a, b) => a.localeCompare(b));
const normalizedBindings = (bindings) => {
    return {
        counterpartyId: bindings.counterpartyId,
        contractIds: sortArray(bindings.contractIds),
        objectIds: sortArray(bindings.objectIds),
        directionIds: sortArray(bindings.directionIds),
        projectIds: sortArray(bindings.projectIds),
        isGlobal: !!bindings.isGlobal,
    };
};
const mapUserRow = (row) => {
    return {
        id: row.id,
        email: row.email,
        fullName: row.full_name,
        phone: row.phone,
        role: row.role,
        status: row.status,
        mustChangePassword: row.must_change_password,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        companyName: row.company_name || null,
        bindings: {
            counterpartyId: row.counterparty_id,
            contractIds: row.contract_ids ?? [],
            objectIds: row.object_ids ?? [],
            directionIds: row.direction_ids ?? [],
            projectIds: row.project_ids ?? [],
            isGlobal: !!row.is_global,
        },
    };
};
const userSelectSql = `
select
  u.id::text as id,
  u.email as email,
  u.full_name as full_name,
  u.phone as phone,
  u.role::text as role,
  u.status::text as status,
  u.must_change_password as must_change_password,
  u.created_at::text as created_at,
  u.updated_at::text as updated_at,
  b.counterparty_id::text as counterparty_id,
  coalesce(b.is_global, false) as is_global,
  coalesce((select t.name from tenants t where t.id = b.counterparty_id and t.deleted_at is null limit 1), '') as company_name,
  coalesce(array_agg(distinct udb.direction_id::text) filter (where udb.direction_id is not null), '{}') as direction_ids,
  coalesce(array_agg(distinct ucb.contract_id::text) filter (where ucb.contract_id is not null), '{}') as contract_ids,
  coalesce(array_agg(distinct uob.object_id::text) filter (where uob.object_id is not null), '{}') as object_ids,
  coalesce(array_agg(distinct upb.project_id::text) filter (where upb.project_id is not null), '{}') as project_ids
from app_users u
left join app_user_bindings b on b.user_id = u.id
left join app_user_direction_bindings udb on udb.user_id = u.id
left join app_user_contract_bindings ucb on ucb.user_id = u.id
left join app_user_object_bindings uob on uob.user_id = u.id
left join app_user_project_bindings upb on upb.user_id = u.id
`;
export const getUserById = async (userId) => {
    const result = await dbQuery(`${userSelectSql}
      where u.id = $1::uuid
      group by u.id, b.counterparty_id, b.is_global`, [userId]);
    if (result.rows.length === 0)
        return null;
    return mapUserRow(result.rows[0]);
};
export const listActiveAdminRecipients = async () => {
    const result = await dbQuery(`select
       id::text as id,
       email,
       full_name
     from app_users
     where role::text = 'admin'
       and status::text = 'active'`);
    return result.rows.map(row => ({
        id: row.id,
        email: row.email,
        fullName: row.full_name,
    }));
};
const listActiveAdminRecipientsTx = async (client) => {
    const result = await client.query(`select
       id::text as id,
       email,
       full_name
     from app_users
     where role::text = 'admin'
       and status::text = 'active'`);
    return result.rows.map(row => ({
        id: row.id,
        email: row.email,
        fullName: row.full_name,
    }));
};
const listScopedClientRecipientsTx = async (client, targetUserId) => {
    const result = await client.query(`select distinct
       u.id::text as id,
       u.email as email,
       u.full_name as full_name
     from app_users u
     join app_user_bindings ub on ub.user_id = u.id
     where u.status::text = 'active'
       and u.role::text = any($2::text[])
       and ub.counterparty_id is not null
       and ub.counterparty_id = (
         select b.counterparty_id
         from app_user_bindings b
         where b.user_id = $1::uuid
         limit 1
       )
       and u.id <> $1::uuid`, [targetUserId, clientRoles]);
    return result.rows.map(row => ({
        id: row.id,
        email: row.email,
        fullName: row.full_name,
    }));
};
const listScopedClientRecipientsByCounterpartyTx = async (client, counterpartyId) => {
    const result = await client.query(`select distinct
       u.id::text as id,
       u.email as email,
       u.full_name as full_name
     from app_users u
     join app_user_bindings ub on ub.user_id = u.id
     where u.status::text = 'active'
       and u.role::text = any($2::text[])
       and ub.counterparty_id::text = $1
       and coalesce(trim(u.email), '') <> ''`, [counterpartyId, clientRoles]);
    return result.rows.map(row => ({
        id: row.id,
        email: row.email,
        fullName: row.full_name,
    }));
};
const sendAuditEventEmails = async (client, args) => {
    if (!canSendEmails()) {
        return;
    }
    const admins = await listActiveAdminRecipientsTx(client);
    const scopeCounterpartyId = (args.beforeState?.bindings?.counterpartyId ??
        args.afterState?.bindings?.counterpartyId ?? null);
    const scopedClients = args.targetUserId
        ? await listScopedClientRecipientsTx(client, args.targetUserId)
        : scopeCounterpartyId
            ? await listScopedClientRecipientsByCounterpartyTx(client, scopeCounterpartyId)
            : [];
    const recipients = new Map();
    for (const admin of admins) {
        recipients.set(admin.email.toLowerCase(), {
            email: admin.email,
            recipientType: 'admin',
        });
    }
    for (const recipient of scopedClients) {
        const key = recipient.email.toLowerCase();
        if (!recipients.has(key)) {
            recipients.set(key, {
                email: recipient.email,
                recipientType: 'client',
            });
        }
    }
    if (recipients.size === 0) {
        return;
    }
    const actionLabel = userAuditActionLabel(args.action);
    const summary = summarizeUserAuditEvent(args.action, args.beforeState, args.afterState);
    const emailTargetUserId = args.targetUserId ??
        (typeof args.afterState === 'object' && args.afterState
            ? args.afterState.deletedUserId ?? null
            : null);
    const sendTasks = Array.from(recipients.values()).map(async (recipient) => {
        const roleMark = recipient.recipientType === 'admin' ? '[Администратор]' : '[Клиент]';
        const subject = `${roleMark} Пользователи: ${actionLabel}`;
        const body = `Событие: ${actionLabel}\n` +
            `Описание: ${summary}\n\n` +
            `ID инициатора: ${args.actorUserId ?? 'система'}\n` +
            `ID пользователя: ${emailTargetUserId ?? 'не указан'}\n` +
            `ID запроса: ${args.meta.requestId ?? 'не указан'}\n` +
            `IP-адрес: ${args.meta.ip ?? 'не указан'}\n` +
            `User-Agent: ${args.meta.userAgent ?? 'не указан'}`;
        try {
            await sendSystemEventNotice({
                to: recipient.email,
                subject,
                body,
            });
        }
        catch (error) {
            logger.error('Failed to send audit event email', {
                action: args.action,
                targetUserId: args.targetUserId ?? null,
                recipientEmail: recipient.email,
                recipientType: recipient.recipientType,
                error: serializeError(error),
            });
        }
    });
    await Promise.all(sendTasks);
};
const insertAuditLog = async (client, args) => {
    const insertResult = await client.query(`
      insert into app_audit_log(
        actor_user_id,
        target_user_id,
        action,
        entity_type,
        entity_id,
        before_state,
        after_state,
        result,
        error_code,
        request_id,
        ip,
        user_agent
      )
      values(
        $1::uuid,
        $2::uuid,
        $3,
        'user',
        coalesce($2::text, ''),
        $4::jsonb,
        $5::jsonb,
        $6,
        $7,
        $8,
        $9::inet,
        $10
      )
      returning id::text as id, created_at::text as created_at`, [
        args.actorUserId,
        args.targetUserId,
        args.action,
        args.beforeState ? JSON.stringify(args.beforeState) : null,
        args.afterState ? JSON.stringify(args.afterState) : null,
        args.result ?? 'success',
        args.errorCode ?? null,
        args.meta.requestId,
        args.meta.ip,
        args.meta.userAgent,
    ]);
    const insertedAuditId = insertResult.rows[0]?.id ?? '';
    const insertedAt = insertResult.rows[0]?.created_at ?? new Date().toISOString();
    const realtimeTargetUserId = args.targetUserId ??
        (typeof args.afterState === 'object' && args.afterState
            ? args.afterState.deletedUserId ?? null
            : null);
    publishUserAuditEvent({
        id: insertedAuditId,
        action: args.action,
        actionLabel: userAuditActionLabel(args.action),
        actorUserId: args.actorUserId ?? null,
        targetUserId: realtimeTargetUserId,
        before: args.beforeState ?? null,
        after: args.afterState ?? null,
        summary: summarizeUserAuditEvent(args.action, args.beforeState, args.afterState),
        createdAt: insertedAt,
    });
    try {
        await sendAuditEventEmails(client, args);
    }
    catch (error) {
        logger.error('Failed to dispatch audit event emails', {
            action: args.action,
            targetUserId: args.targetUserId ?? null,
            error: serializeError(error),
        });
    }
};
export const appendUserAuditLog = async (args) => {
    await withTx(async (client) => {
        await insertAuditLog(client, args);
        return true;
    });
};
const replaceBindings = async (client, userId, bindings) => {
    await client.query(`insert into app_user_bindings(user_id, counterparty_id, is_global)
     values($1::uuid, $2::uuid, $3)
     on conflict(user_id) do update set
       counterparty_id = excluded.counterparty_id,
       is_global = excluded.is_global`, [userId, bindings.counterpartyId, bindings.isGlobal]);
    await client.query(`delete from app_user_object_bindings where user_id = $1::uuid`, [userId]);
    await client.query(`delete from app_user_contract_bindings where user_id = $1::uuid`, [userId]);
    if (bindings.directionIds.length > 0) {
        await client.query(`insert into app_user_direction_bindings(user_id, direction_id)
       select $1::uuid, x::uuid
       from unnest($2::text[]) as x
       on conflict(user_id, direction_id) do nothing`, [userId, bindings.directionIds]);
        await client.query(`delete from app_user_direction_bindings
       where user_id = $1::uuid
         and not (direction_id::text = any($2::text[]))`, [userId, bindings.directionIds]);
    }
    else {
        await client.query(`delete from app_user_direction_bindings where user_id = $1::uuid`, [userId]);
    }
    await client.query(`delete from app_user_project_bindings where user_id = $1::uuid`, [userId]);
    if (bindings.contractIds.length > 0) {
        await client.query(`insert into app_user_contract_bindings(user_id, contract_id)
       select $1::uuid, x::uuid
       from unnest($2::text[]) as x
       on conflict(user_id, contract_id) do nothing`, [userId, bindings.contractIds]);
    }
    if (bindings.objectIds.length > 0) {
        await client.query(`insert into app_user_object_bindings(user_id, object_id)
       select $1::uuid, x::uuid
       from unnest($2::text[]) as x
       on conflict(user_id, object_id) do nothing`, [userId, bindings.objectIds]);
    }
    if (bindings.projectIds.length > 0) {
        await client.query(`insert into app_user_project_bindings(user_id, project_id)
       select $1::uuid, x::uuid
       from unnest($2::text[]) as x
       on conflict(user_id, project_id) do nothing`, [userId, bindings.projectIds]);
    }
};
export const createUser = async (actorUserId, input, meta) => {
    const bindings = sanitizeBindings(input.bindings);
    try {
        return await withTx(async (client) => {
            const insertUser = await client.query(`insert into app_users(
          email,
          full_name,
          phone,
          role,
          status,
          password_hash,
          must_change_password
        )
        values($1, $2, $3, $4::app_user_role, $5::app_user_status, $6, $7)
        returning id::text as id`, [
                input.email.toLowerCase(),
                input.fullName,
                input.phone ?? null,
                input.role,
                input.status,
                input.passwordHash,
                input.mustChangePassword,
            ]);
            const userId = insertUser.rows[0]?.id;
            if (!userId) {
                throw new ApiError(500, 'USER_CREATE_FAILED', 'Failed to create user');
            }
            await replaceBindings(client, userId, bindings);
            const created = await client.query(`${userSelectSql}
          where u.id = $1::uuid
          group by u.id, b.counterparty_id, b.is_global`, [userId]);
            if (created.rows.length === 0) {
                throw new ApiError(500, 'USER_CREATE_FAILED', 'Failed to read created user');
            }
            const user = mapUserRow(created.rows[0]);
            await insertAuditLog(client, {
                actorUserId,
                targetUserId: user.id,
                action: 'user_created',
                beforeState: null,
                afterState: user,
                meta,
            });
            return user;
        });
    }
    catch (error) {
        const mapped = mapPgError(error);
        if (mapped)
            throw mapped;
        throw error;
    }
};
export const updateUser = async (actorUserId, userId, input, meta) => {
    try {
        return await withTx(async (client) => {
            const before = await client.query(`${userSelectSql}
          where u.id = $1::uuid
          group by u.id, b.counterparty_id, b.is_global`, [userId]);
            if (before.rows.length === 0) {
                throw new ApiError(404, 'USER_NOT_FOUND', 'User not found');
            }
            const previousUser = mapUserRow(before.rows[0]);
            const nextFullName = input.fullName ?? previousUser.fullName;
            const nextEmail = input.email ?? previousUser.email;
            const nextPhone = input.phone !== undefined ? input.phone : previousUser.phone;
            const nextRole = input.role ?? previousUser.role;
            const nextStatus = input.status ?? previousUser.status;
            const nextMustChangePassword = input.mustChangePassword !== undefined ? input.mustChangePassword : previousUser.mustChangePassword;
            const nextBindings = sanitizeBindings(input.bindings ?? previousUser.bindings);
            await client.query(`update app_users
         set
           email = $2,
           full_name = $3,
           phone = $4,
           role = $5::app_user_role,
           status = $6::app_user_status,
           must_change_password = $7
         where id = $1::uuid`, [userId, nextEmail.toLowerCase(), nextFullName, nextPhone, nextRole, nextStatus, nextMustChangePassword]);
            await replaceBindings(client, userId, nextBindings);
            const after = await client.query(`${userSelectSql}
          where u.id = $1::uuid
          group by u.id, b.counterparty_id, b.is_global`, [userId]);
            const updatedUser = mapUserRow(after.rows[0]);
            if (previousUser.fullName !== updatedUser.fullName || (previousUser.phone ?? null) !== (updatedUser.phone ?? null)) {
                await insertAuditLog(client, {
                    actorUserId,
                    targetUserId: userId,
                    action: 'profile_changed',
                    beforeState: {
                        fullName: previousUser.fullName,
                        phone: previousUser.phone ?? null,
                    },
                    afterState: {
                        fullName: updatedUser.fullName,
                        phone: updatedUser.phone ?? null,
                    },
                    meta,
                });
            }
            if (previousUser.role !== updatedUser.role) {
                await insertAuditLog(client, {
                    actorUserId,
                    targetUserId: userId,
                    action: 'role_changed',
                    beforeState: { role: previousUser.role },
                    afterState: { role: updatedUser.role },
                    meta,
                });
            }
            if (previousUser.status !== updatedUser.status) {
                await insertAuditLog(client, {
                    actorUserId,
                    targetUserId: userId,
                    action: 'status_changed',
                    beforeState: { status: previousUser.status },
                    afterState: { status: updatedUser.status },
                    meta,
                });
            }
            if (JSON.stringify(normalizedBindings(previousUser.bindings)) !==
                JSON.stringify(normalizedBindings(updatedUser.bindings))) {
                await insertAuditLog(client, {
                    actorUserId,
                    targetUserId: userId,
                    action: 'bindings_changed',
                    beforeState: normalizedBindings(previousUser.bindings),
                    afterState: normalizedBindings(updatedUser.bindings),
                    meta,
                });
            }
            return updatedUser;
        });
    }
    catch (error) {
        const mapped = mapPgError(error);
        if (mapped)
            throw mapped;
        throw error;
    }
};
export const deleteUser = async (actorUserId, userId, meta) => {
    try {
        return await withTx(async (client) => {
            const before = await client.query(`${userSelectSql}
          where u.id = $1::uuid
          group by u.id, b.counterparty_id, b.is_global`, [userId]);
            if (before.rows.length === 0) {
                throw new ApiError(404, 'USER_NOT_FOUND', 'User not found');
            }
            const previousUser = mapUserRow(before.rows[0]);
            if (previousUser.role === 'admin' && previousUser.status === 'active') {
                const admins = await client.query(`select count(*)::int as total
           from app_users
           where role::text = 'admin' and status::text = 'active'`);
                const totalAdmins = Number(admins.rows[0]?.total ?? 0);
                if (totalAdmins <= 1) {
                    throw new ApiError(409, 'LAST_ADMIN_DELETE_FORBIDDEN', 'Cannot delete the last active admin');
                }
            }
            await client.query(`update app_audit_log
         set actor_user_id = null
         where actor_user_id = $1::uuid`, [userId]);
            await client.query(`update app_audit_log
         set target_user_id = null
         where target_user_id = $1::uuid`, [userId]);
            await client.query(`update app_bootstrap_state
         set first_admin_user_id = null
         where first_admin_user_id = $1::uuid`, [userId]);
            await client.query(`update auth_login_events
         set user_id = null
         where user_id = $1::uuid`, [userId]);
            await client.query(`update auth_invite_tokens
         set created_by_user_id = $2::uuid
         where created_by_user_id = $1::uuid
           and user_id <> $1::uuid`, [userId, actorUserId]);
            await client.query(`delete from auth_refresh_tokens where user_id = $1::uuid`, [userId]);
            await client.query(`delete from app_users where id = $1::uuid`, [userId]);
            await insertAuditLog(client, {
                actorUserId,
                targetUserId: null,
                action: 'user_deleted',
                beforeState: previousUser,
                afterState: { deletedUserId: userId },
                meta,
            });
            return true;
        });
    }
    catch (error) {
        const mapped = mapPgError(error);
        if (mapped)
            throw mapped;
        throw error;
    }
};
export const listUsers = async (query) => {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const actorRole = typeof query.actorRole === 'string' ? query.actorRole : '';
    const actorUserId = typeof query.actorUserId === 'string' ? query.actorUserId : '';
    const offset = (page - 1) * pageSize;
    const where = [];
    const values = [];
    const push = (value) => {
        values.push(value);
        return `$${values.length}`;
    };
    if (query.tab === 'employees') {
        where.push(`u.role::text <> all(${push(clientRoles)}::text[])`);
        where.push(`u.status::text <> 'deactivated'`);
    }
    else if (query.tab === 'clients') {
        where.push(`u.role::text = any(${push(clientRoles)}::text[])`);
        where.push(`u.status::text <> 'deactivated'`);
    }
    else if (query.tab === 'invitations') {
        where.push(`u.status::text = 'invited'`);
    }
    else if (query.tab === 'deactivated') {
        where.push(`u.status::text = any(${push(['deactivated', 'blocked'])}::text[])`);
    }
    if (actorRole === 'curator') {
        if (!actorUserId) {
            where.push('1 = 0');
        }
        else {
            const actorRef = push(actorUserId);
            where.push(`u.id in (
        select udb2.user_id
        from app_user_direction_bindings udb2
        where udb2.direction_id in (
          select udb1.direction_id
          from app_user_direction_bindings udb1
          where udb1.user_id = ${actorRef}::uuid
        )
      )`);
        }
    }
    else if (actorRole === 'client_manager') {
        if (!actorUserId) {
            where.push('1 = 0');
        }
        else {
            const actorRef = push(actorUserId);
            where.push(`u.id in (
        select ub2.user_id
        from app_user_bindings ub2
        where ub2.counterparty_id = (
          select ub1.counterparty_id
          from app_user_bindings ub1
          where ub1.user_id = ${actorRef}::uuid
          limit 1
        )
      )`);
            where.push(`u.role::text = any(${push(['client_manager', 'client_user', 'user'])}::text[])`);
        }
    }
    else if (actorRole && actorRole !== 'admin' && actorRole !== 'manager' && actorRole !== 'dispatcher') {
        where.push('1 = 0');
    }
    if (query.role) {
        where.push(`u.role::text = ${push(query.role)}`);
    }
    if (query.status) {
        where.push(`u.status::text = ${push(query.status)}`);
    }
    if (query.q) {
        const search = `%${query.q.toLowerCase()}%`;
        const marker = push(search);
        where.push(`(lower(u.full_name) like ${marker} or lower(u.email) like ${marker} or lower(coalesce(u.phone, '')) like ${marker})`);
    }
    const whereSql = where.length > 0 ? `where ${where.join(' and ')}` : '';
    const sortColumnMap = {
        fullName: 'u.full_name',
        createdAt: 'u.created_at',
        role: 'u.role',
        status: 'u.status',
    };
    const sortColumn = sortColumnMap[query.sort ?? 'createdAt'];
    const sortOrder = query.order === 'asc' ? 'asc' : 'desc';
    const totalResult = await dbQuery(`select count(*)::text as total from app_users u ${whereSql}`, values);
    const total = Number(totalResult.rows[0]?.total ?? '0');
    const pagedValues = [...values, pageSize, offset];
    const listResult = await dbQuery(`${userSelectSql}
      ${whereSql}
      group by u.id, b.counterparty_id, b.is_global
      order by ${sortColumn} ${sortOrder}
      limit $${pagedValues.length - 1}
      offset $${pagedValues.length}`, pagedValues);
    return {
        items: listResult.rows.map(mapUserRow),
        total,
        page,
        pageSize,
    };
};
export const getUserByEmailForAuth = async (email) => {
    const result = await dbQuery(`select
       id::text as id,
       email,
       role::text as role,
       status::text as status,
       password_hash,
       must_change_password,
       failed_login_attempts,
       locked_until::text as locked_until
     from app_users
     where lower(email) = lower($1)
     limit 1`, [email]);
    const row = result.rows[0];
    if (!row)
        return null;
    return {
        id: row.id,
        email: row.email,
        role: row.role,
        status: row.status,
        passwordHash: row.password_hash,
        mustChangePassword: row.must_change_password,
        failedLoginAttempts: row.failed_login_attempts,
        lockedUntil: row.locked_until,
    };
};
export const recordLoginEvent = async (args) => {
    await dbQuery(`insert into auth_login_events(user_id, email, success, ip, user_agent, reason_code)
     values($1::uuid, $2, $3, $4::inet, $5, $6)`, [args.userId ?? null, args.email ?? null, args.success, args.meta.ip, args.meta.userAgent, args.reasonCode ?? null]);
};
export const countRecentFailedLoginsByIp = async (ip, windowMinutes) => {
    const result = await dbQuery(`select count(*)::text as total
     from auth_login_events
     where success = false
       and ip = $1::inet
       and created_at >= now() - make_interval(mins => $2::int)`, [ip, windowMinutes]);
    return Number(result.rows[0]?.total ?? '0');
};
export const updateLoginFailureState = async (userId, nextAttempts, lockUntil) => {
    await dbQuery(`update app_users
     set failed_login_attempts = $2,
         locked_until = $3::timestamptz
     where id = $1::uuid`, [userId, nextAttempts, lockUntil]);
};
export const markLoginSuccess = async (userId) => {
    await dbQuery(`update app_users
     set failed_login_attempts = 0,
         locked_until = null,
         last_login_at = now()
     where id = $1::uuid`, [userId]);
};
export const saveRefreshToken = async (args) => {
    await dbQuery(`insert into auth_refresh_tokens(
       user_id,
       token_hash,
       jti,
       expires_at,
       ip,
       user_agent
     )
     values($1::uuid, $2, $3::uuid, $4::timestamptz, $5::inet, $6)`, [args.userId, args.tokenHash, args.jti, args.expiresAt, args.meta.ip, args.meta.userAgent]);
};
export const findRefreshTokenByHash = async (tokenHash) => {
    const result = await dbQuery(`select
       rt.id::text as id,
       rt.user_id::text as user_id,
       rt.jti::text as jti,
       rt.expires_at::text as expires_at,
       rt.revoked_at::text as revoked_at,
       u.role::text as role
     from auth_refresh_tokens rt
     join app_users u on u.id = rt.user_id
     where rt.token_hash = $1
     limit 1`, [tokenHash]);
    return result.rows[0] ?? null;
};
export const revokeRefreshTokenById = async (refreshTokenId, replacedByJti) => {
    await dbQuery(`update auth_refresh_tokens
     set revoked_at = now(),
         replaced_by_jti = $2::uuid
     where id = $1::uuid and revoked_at is null`, [refreshTokenId, replacedByJti ?? null]);
};
export const revokeRefreshTokenByHash = async (tokenHash) => {
    await dbQuery(`update auth_refresh_tokens
     set revoked_at = now()
     where token_hash = $1 and revoked_at is null`, [tokenHash]);
};
export const revokeAllUserRefreshTokens = async (userId) => {
    await dbQuery(`update auth_refresh_tokens
     set revoked_at = now()
     where user_id = $1::uuid and revoked_at is null`, [userId]);
};
export const createInviteToken = async (args) => {
    await dbQuery(`insert into auth_invite_tokens(user_id, email, token_hash, created_by_user_id, expires_at)
     values($1::uuid, $2, $3, $4::uuid, $5::timestamptz)`, [args.userId, args.email, args.tokenHash, args.createdByUserId, args.expiresAt]);
};
export const findInviteToken = async (tokenHash) => {
    const result = await dbQuery(`select id::text as id, user_id::text as user_id, expires_at::text as expires_at, used_at::text as used_at
     from auth_invite_tokens
     where token_hash = $1
     limit 1`, [tokenHash]);
    return result.rows[0] ?? null;
};
export const markInviteTokenUsed = async (inviteTokenId) => {
    await dbQuery(`update auth_invite_tokens
     set used_at = now()
     where id = $1::uuid and used_at is null`, [inviteTokenId]);
};
export const createPasswordResetToken = async (args) => {
    await dbQuery(`insert into auth_password_reset_tokens(user_id, token_hash, expires_at)
     values($1::uuid, $2, $3::timestamptz)`, [args.userId, args.tokenHash, args.expiresAt]);
};
export const revokeActiveEmailLoginTokensForUser = async (userId) => {
    await dbQuery(`update auth_email_login_tokens
     set used_at = now()
     where user_id = $1::uuid
       and used_at is null
       and expires_at > now()`, [userId]);
};
export const createEmailLoginToken = async (args) => {
    await dbQuery(`insert into auth_email_login_tokens(user_id, email, token_hash, expires_at)
     values($1::uuid, $2, $3, $4::timestamptz)`, [args.userId, args.email.toLowerCase(), args.tokenHash, args.expiresAt]);
};
export const findEmailLoginToken = async (tokenHash) => {
    const result = await dbQuery(`select
       id::text as id,
       user_id::text as user_id,
       email,
       expires_at::text as expires_at,
       used_at::text as used_at
     from auth_email_login_tokens
     where token_hash = $1
     limit 1`, [tokenHash]);
    return result.rows[0] ?? null;
};
export const markEmailLoginTokenUsed = async (tokenId) => {
    await dbQuery(`update auth_email_login_tokens
     set used_at = now()
     where id = $1::uuid and used_at is null`, [tokenId]);
};
export const findPasswordResetToken = async (tokenHash) => {
    const result = await dbQuery(`select id::text as id, user_id::text as user_id, expires_at::text as expires_at, used_at::text as used_at
     from auth_password_reset_tokens
     where token_hash = $1
     limit 1`, [tokenHash]);
    return result.rows[0] ?? null;
};
export const markPasswordResetTokenUsed = async (tokenId) => {
    await dbQuery(`update auth_password_reset_tokens
     set used_at = now()
     where id = $1::uuid and used_at is null`, [tokenId]);
};
export const updateUserPasswordAndActivate = async (userId, passwordHash) => {
    await dbQuery(`update app_users
     set password_hash = $2,
         status = 'active',
         must_change_password = false,
         failed_login_attempts = 0,
         locked_until = null
     where id = $1::uuid`, [userId, passwordHash]);
};
export const updateUserPasswordAfterInviteAcceptance = async (userId, passwordHash) => {
    await dbQuery(`update app_users
     set password_hash = $2,
         must_change_password = false,
         failed_login_attempts = 0,
         locked_until = null
     where id = $1::uuid`, [userId, passwordHash]);
};
export const createBootstrapAdmin = async (args) => {
    try {
        return await withTx(async (client) => {
            const canBootstrap = await client.query(`select can_bootstrap_first_admin() as can_bootstrap_first_admin`);
            if (!canBootstrap.rows[0]?.can_bootstrap_first_admin) {
                throw new ApiError(409, 'BOOTSTRAP_ALREADY_COMPLETED', 'Bootstrap already completed');
            }
            const insert = await client.query(`insert into app_users(
          email,
          full_name,
          role,
          status,
          password_hash,
          must_change_password
        )
        values($1, $2, 'admin', 'active', $3, false)
        returning id::text as id`, [args.email.toLowerCase(), args.fullName, args.passwordHash]);
            const userId = insert.rows[0]?.id;
            if (!userId) {
                throw new ApiError(500, 'BOOTSTRAP_FAILED', 'Failed to create bootstrap admin');
            }
            await client.query(`insert into app_user_bindings(user_id, counterparty_id, is_global)
         values($1::uuid, null, true)
         on conflict(user_id) do update set
           counterparty_id = null,
           is_global = true`, [userId]);
            await client.query(`update app_bootstrap_state
         set first_admin_user_id = $1::uuid, completed_at = now()
         where singleton = true`, [userId]);
            await insertAuditLog(client, {
                actorUserId: userId,
                targetUserId: userId,
                action: 'bootstrap_admin_created',
                beforeState: null,
                afterState: { userId, role: 'admin' },
                meta: { ip: null, userAgent: null, requestId: null },
            });
            const created = await client.query(`${userSelectSql}
         where u.id = $1::uuid
         group by u.id, b.counterparty_id, b.is_global`, [userId]);
            return mapUserRow(created.rows[0]);
        });
    }
    catch (error) {
        const mapped = mapPgError(error);
        if (mapped)
            throw mapped;
        throw error;
    }
};
export const listUserAudit = async (query) => {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const offset = (page - 1) * pageSize;
    const where = [`entity_type = 'user'`];
    const values = [];
    const push = (value) => {
        values.push(value);
        return `$${values.length}`;
    };
    if (query.userId) {
        where.push(`target_user_id = ${push(query.userId)}::uuid`);
    }
    if (query.action) {
        where.push(`action = ${push(query.action)}`);
    }
    const whereSql = `where ${where.join(' and ')}`;
    const totalResult = await dbQuery(`select count(*)::text as total from app_audit_log ${whereSql}`, values);
    const total = Number(totalResult.rows[0]?.total ?? '0');
    const pagedValues = [...values, pageSize, offset];
    const itemsResult = await dbQuery(`select
       id,
       action,
       actor_user_id::text as actor_user_id,
       target_user_id::text as target_user_id,
       before_state,
       after_state,
       ip::text as ip,
       user_agent,
       created_at::text as created_at
     from app_audit_log
     ${whereSql}
     order by created_at desc
     limit $${pagedValues.length - 1}
     offset $${pagedValues.length}`, pagedValues);
    return {
        items: itemsResult.rows.map(row => ({
            id: row.id,
            action: row.action,
            actionLabel: userAuditActionLabel(row.action),
            summary: summarizeUserAuditEvent(row.action, row.before_state, row.after_state),
            actorUserId: row.actor_user_id,
            targetUserId: row.target_user_id,
            before: row.before_state,
            after: row.after_state,
            ip: row.ip,
            userAgent: row.user_agent,
            createdAt: row.created_at,
        })),
        total,
        page,
        pageSize,
    };
};
export const buildUserBindings = (input) => {
    return sanitizeBindings(input);
};
