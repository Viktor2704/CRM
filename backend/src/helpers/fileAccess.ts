import { dbQuery } from '../db.js';
import { appConfig } from '../config.js';
import { appendActorScopeCondition } from './actorAccess.js';
import { canActorDeleteAccessRequest } from './accessRequestAccess.js';
import { isUuidValue, normalizeText } from './normalize.js';
import { appendProjectScopeCondition } from './projectHelpers.js';
import { projectClientRoles } from './roles.js';

const escapeLikePattern = (value) => value.replace(/[\\%_]/g, '\\$&');
const mimeByExtension = {
    pdf: 'application/pdf',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    doc: 'application/msword',
    txt: 'text/plain',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    xls: 'application/vnd.ms-excel',
};

const safeQueryRows = async (queryFn, text, values = []) => {
    try {
        const result = await queryFn(text, values);
        return Array.isArray(result?.rows) ? result.rows : [];
    }
    catch (error) {
        if (error?.code === '42P01' || error?.code === '42703') {
            return [];
        }
        throw error;
    }
};

const normalizeStorageKey = (value) => {
    const decodedValue = normalizeText(value);
    if (!decodedValue) {
        return '';
    }
    let safeValue = decodedValue;
    try {
        safeValue = decodeURIComponent(decodedValue);
    }
    catch (_error) {
        safeValue = decodedValue;
    }
    safeValue = safeValue
        .replace(/\\/g, '/')
        .split('?')[0]
        .split('#')[0];
    const segments = safeValue.split('/').filter(Boolean);
    if (segments.length === 0 || segments.some((segment) => segment === '.' || segment === '..')) {
        return '';
    }
    return segments.join('/');
};

export const extractStorageKeyFromFileUrl = (value) => {
    const normalized = normalizeText(value);
    if (!normalized) {
        return '';
    }
    const publicBasePath = normalizeText(appConfig.filePublicBasePath).replace(/\/+$/, '');
    const marker = publicBasePath ? `${publicBasePath}/` : '/uploads/';
    const markerIndex = normalized.lastIndexOf(marker);
    if (markerIndex >= 0) {
        return normalizeStorageKey(normalized.slice(markerIndex + marker.length));
    }
    if (!normalized.includes('://') && !normalized.startsWith('/')) {
        return normalizeStorageKey(normalized);
    }
    return '';
};

export const extractStorageKeyFromFilePayload = (payload) => {
    if (!payload || typeof payload !== 'object') {
        return '';
    }
    const directStorageKey = normalizeStorageKey(payload.storageKey ?? payload.storage_key);
    if (directStorageKey) {
        return directStorageKey;
    }
    return extractStorageKeyFromFileUrl(payload.url);
};

export const resolveMimeTypeFromFilePayload = (payload) => {
    const directMime = normalizeText(payload?.mimeType ?? payload?.mime_type ?? payload?.type).toLowerCase();
    if (directMime) {
        return directMime;
    }
    const sourceName = normalizeText(payload?.name ?? payload?.fileName ?? payload?.url);
    const extension = sourceName.split('.').pop()?.toLowerCase() || '';
    return mimeByExtension[extension] ?? '';
};

const payloadArrayContainsStorageKey = (value, storageKey) => {
    if (!Array.isArray(value)) {
        return false;
    }
    return value.some((item) => extractStorageKeyFromFilePayload(item) === storageKey);
};

const canActorAccessRequestRow = async ({ actorUserId, actorRole, requestId, type, isProject, queryFn = dbQuery }) => {
    try {
        if (!isUuidValue(requestId)) {
            return false;
        }
        const conditions = [
            `r.id = $1::uuid`,
            `r.deleted_at is null`,
        ];
        const values = [requestId];
        if (normalizeText(type) === 'installation') {
            conditions.push(`r.type = 'installation'`);
            conditions.push(`coalesce(r.is_project, false) = ${isProject ? 'true' : 'false'}`);
            await appendProjectScopeCondition({
                actorUserId,
                actorRole,
                conditions,
                values,
                queryFn,
            });
        }
        else {
            conditions.push(`r.type <> 'installation'`);
            await appendActorScopeCondition({
                actorUserId,
                actorRole,
                conditions,
                values,
                queryFn,
                tableAlias: 'r',
                tenantIdColumn: 'tenant_id',
                directionIdColumn: 'direction_id',
                createdByIdColumn: 'created_by_id',
                executorIdsColumn: 'executor_ids',
                curatorIdColumn: 'curator_id',
                includeDirectionBindings: true,
                includeProjectBindings: false,
            });
        }
        const result = await safeQueryRows(queryFn, `select 1
           from requests r
           where ${conditions.join(' and ')}
           limit 1`, values);
        return result.length > 0;
    }
    catch (error) {
        if (error?.code === '42P01' || error?.code === '42703') {
            return false;
        }
        throw error;
    }
};

const listRequestFileReferences = async (storageKey, queryFn = dbQuery) => {
    const likeValue = `%${escapeLikePattern(storageKey)}%`;
    const result = await safeQueryRows(queryFn, `select
         id::text as id,
         type::text as type,
         coalesce(is_project, false) as is_project,
         coalesce(files, '[]'::jsonb) as files,
         coalesce(resolution_files, '[]'::jsonb) as resolution_files
       from requests
       where deleted_at is null
         and (
           coalesce(files, '[]'::jsonb)::text like $1 escape '\\'
           or coalesce(resolution_files, '[]'::jsonb)::text like $1 escape '\\'
         )`, [likeValue]);
    return result.filter((row) => payloadArrayContainsStorageKey(row.files, storageKey)
        || payloadArrayContainsStorageKey(row.resolution_files, storageKey));
};

const listRequestCommentFileReferences = async (storageKey, queryFn = dbQuery) => {
    const likeValue = `%${escapeLikePattern(storageKey)}%`;
    const result = await safeQueryRows(queryFn, `select
         c.request_id::text as request_id,
         coalesce(c.files, '[]'::jsonb) as files
       from request_comments c
       where c.deleted_at is null
         and coalesce(c.files, '[]'::jsonb)::text like $1 escape '\\'`, [likeValue]);
    return result.filter((row) => payloadArrayContainsStorageKey(row.files, storageKey));
};

const listProjectChatFileReferences = async (storageKey, queryFn = dbQuery) => {
    const likeValue = `%${escapeLikePattern(storageKey)}%`;
    const result = await safeQueryRows(queryFn, `select
         pcm.id::text as id,
         pcm.project_id::text as project_id,
         pcm.visibility,
         coalesce(pcm.attachments, '[]'::jsonb) as attachments,
         r.type::text as request_type,
         coalesce(r.is_project, false) as is_project
       from project_chat_messages pcm
       join requests r on r.id = pcm.project_id
       where pcm.deleted_at is null
         and r.deleted_at is null
         and coalesce(pcm.attachments, '[]'::jsonb)::text like $1 escape '\\'`, [likeValue]);
    return result.filter((row) => payloadArrayContainsStorageKey(row.attachments, storageKey));
};

const listProcurementFileReferences = async (storageKey, queryFn = dbQuery) => {
    const likeValue = `%${escapeLikePattern(storageKey)}%`;
    const result = await safeQueryRows(queryFn, `select
         installation_id::text as installation_id,
         coalesce(files, '[]'::jsonb) as files
       from installation_procurement_items
       where coalesce(files, '[]'::jsonb)::text like $1 escape '\\'`, [likeValue]);
    return result.filter((row) => payloadArrayContainsStorageKey(row.files, storageKey));
};

const listAccessRequestFileReferences = async (storageKey, queryFn = dbQuery) => {
    const likeValue = `%${escapeLikePattern(storageKey)}%`;
    const result = await safeQueryRows(queryFn, `select
         id::text as id,
         created_by_id::text as created_by_id,
         file_url
       from access_requests
       where deleted_at is null
         and coalesce(file_url, '') like $1 escape '\\'`, [likeValue]);
    return result.filter((row) => extractStorageKeyFromFileUrl(row.file_url) === storageKey);
};

export const registerUploadedFile = async ({ fileId, storageKey, fileName, mimeType, sizeBytes, uploadedById, queryFn = dbQuery }) => {
    await queryFn(`insert into uploaded_files(
         id,
         storage_key,
         file_name,
         mime_type,
         size_bytes,
         uploaded_by_id,
         created_at
       )
       values(
         $1::uuid,
         $2::text,
         $3::text,
         $4::text,
         $5::int,
         $6::uuid,
         now()
       )
       on conflict (storage_key) do update
       set id = excluded.id,
           file_name = excluded.file_name,
           mime_type = excluded.mime_type,
           size_bytes = excluded.size_bytes,
           uploaded_by_id = excluded.uploaded_by_id`, [
        fileId,
        storageKey,
        normalizeText(fileName),
        normalizeText(mimeType),
        Number.isFinite(Number(sizeBytes)) ? Number(sizeBytes) : 0,
        isUuidValue(uploadedById) ? uploadedById : null,
    ]);
};

export const canActorAccessStoredFile = async ({ storageKey, actorUserId, actorRole, queryFn = dbQuery }) => {
    const normalizedStorageKey = normalizeStorageKey(storageKey);
    const normalizedActorUserId = normalizeText(actorUserId);
    const normalizedActorRole = normalizeText(actorRole).toLowerCase();
    if (!normalizedStorageKey) {
        return false;
    }
    const [requestRefs, requestCommentRefs, chatRefs, procurementRefs, accessRequestRefs] = await Promise.all([
        listRequestFileReferences(normalizedStorageKey, queryFn),
        listRequestCommentFileReferences(normalizedStorageKey, queryFn),
        listProjectChatFileReferences(normalizedStorageKey, queryFn),
        listProcurementFileReferences(normalizedStorageKey, queryFn),
        listAccessRequestFileReferences(normalizedStorageKey, queryFn),
    ]);
    let hasBoundReference = false;
    for (const ref of requestRefs) {
        hasBoundReference = true;
        if (await canActorAccessRequestRow({
            actorUserId: normalizedActorUserId,
            actorRole: normalizedActorRole,
            requestId: normalizeText(ref.id),
            type: normalizeText(ref.type),
            isProject: ref.is_project === true,
            queryFn,
        })) {
            return true;
        }
    }
    for (const ref of requestCommentRefs) {
        hasBoundReference = true;
        if (await canActorAccessRequestRow({
            actorUserId: normalizedActorUserId,
            actorRole: normalizedActorRole,
            requestId: normalizeText(ref.request_id),
            type: 'service_request',
            isProject: false,
            queryFn,
        })) {
            return true;
        }
    }
    for (const ref of chatRefs) {
        hasBoundReference = true;
        if (projectClientRoles.has(normalizedActorRole) && normalizeText(ref.visibility) === 'internal') {
            continue;
        }
        if (await canActorAccessRequestRow({
            actorUserId: normalizedActorUserId,
            actorRole: normalizedActorRole,
            requestId: normalizeText(ref.project_id),
            type: normalizeText(ref.request_type) || 'installation',
            isProject: ref.is_project === true,
            queryFn,
        })) {
            return true;
        }
    }
    for (const ref of procurementRefs) {
        hasBoundReference = true;
        if (await canActorAccessRequestRow({
            actorUserId: normalizedActorUserId,
            actorRole: normalizedActorRole,
            requestId: normalizeText(ref.installation_id),
            type: 'installation',
            isProject: false,
            queryFn,
        })) {
            return true;
        }
    }
    for (const ref of accessRequestRefs) {
        hasBoundReference = true;
        if (canActorDeleteAccessRequest({
            actorUserId: normalizedActorUserId,
            actorRole: normalizedActorRole,
            createdById: ref.created_by_id,
        })) {
            return true;
        }
    }
    const uploadRows = await safeQueryRows(queryFn, `select uploaded_by_id::text as uploaded_by_id
       from uploaded_files
       where storage_key = $1::text
       limit 1`, [normalizedStorageKey]);
    const uploadedById = normalizeText(uploadRows[0]?.uploaded_by_id);
    if (!hasBoundReference && uploadedById && uploadedById === normalizedActorUserId) {
        return true;
    }
    return false;
};

export const resolveAccessibleExtractionEntries = async ({ files, actorUserId, actorRole, queryFn = dbQuery }) => {
    if (!Array.isArray(files)) {
        return [];
    }
    const entries = [];
    for (const file of files.slice(0, 5)) {
        if (!file || typeof file !== 'object') {
            continue;
        }
        const storageKey = extractStorageKeyFromFilePayload(file);
        const mimeType = resolveMimeTypeFromFilePayload(file);
        if (!storageKey || !mimeType) {
            continue;
        }
        if (await canActorAccessStoredFile({
            storageKey,
            actorUserId,
            actorRole,
            queryFn,
        })) {
            entries.push({
                storage_key: storageKey,
                mime_type: mimeType,
            });
        }
    }
    return entries;
};
