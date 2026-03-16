import { ApiError } from '../errors.js';
import { normalizeText } from './normalize.js';
import { normalizeSavedViewOrder } from './savedViews.js';

export const SERVICE_REQUEST_STATUSES = new Set([
    'new',
    'triage',
    'assigned',
    'in_progress',
    'on_site',
    'review',
    'done',
    'closed',
    'cancelled',
    'paused',
]);

export const SERVICE_REQUEST_PRIORITIES = new Set([
    'low',
    'medium',
    'high',
    'critical',
]);

export const normalizeServiceRequestSavedViewStatusParam = (value) => {
    const normalized = normalizeText(value).toLowerCase();
    if (!normalized) {
        return '';
    }
    if (!SERVICE_REQUEST_STATUSES.has(normalized)) {
        throw new ApiError(422, 'VALIDATION_ERROR', 'status contains unsupported value');
    }
    return normalized;
};

export const normalizeServiceRequestSavedViewPriorityParam = (value) => {
    const normalized = normalizeText(value).toLowerCase();
    if (!normalized) {
        return '';
    }
    if (!SERVICE_REQUEST_PRIORITIES.has(normalized)) {
        throw new ApiError(422, 'VALIDATION_ERROR', 'priority contains unsupported value');
    }
    return normalized;
};

export const normalizeServiceRequestSavedViewExecutorParam = (value) => {
    const normalized = normalizeText(value);
    if (!normalized) {
        return '';
    }
    if (normalized.length > 120) {
        throw new ApiError(422, 'VALIDATION_ERROR', 'executor must be <= 120 characters');
    }
    return normalized;
};

export const normalizeServiceRequestSavedViewSort = (value) => {
    const normalized = normalizeText(value).toLowerCase();
    if (!normalized) {
        return 'updated_at';
    }
    const allowedFields = new Set(['created_at', 'updated_at', 'priority', 'status', 'title']);
    if (!allowedFields.has(normalized)) {
        throw new ApiError(422, 'VALIDATION_ERROR', 'sort contains unsupported value');
    }
    return normalized;
};

export const normalizeSearchQuery = (value) => {
    const normalized = normalizeText(value);
    if (!normalized) {
        return '';
    }
    if (normalized.length > 500) {
        throw new ApiError(422, 'VALIDATION_ERROR', 'search query must be <= 500 characters');
    }
    return normalized;
};

export const mergeServiceRequestSavedViewParams = (baseParams, value) => {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const next = {
        search: normalizeSearchQuery(baseParams?.search),
        status: normalizeServiceRequestSavedViewStatusParam(baseParams?.status),
        priority: normalizeServiceRequestSavedViewPriorityParam(baseParams?.priority),
        executor: normalizeServiceRequestSavedViewExecutorParam(baseParams?.executor),
        sort: normalizeServiceRequestSavedViewSort(baseParams?.sort),
        order: normalizeSavedViewOrder(baseParams?.order),
    };
    if (Object.prototype.hasOwnProperty.call(source, 'search')) {
        next.search = normalizeSearchQuery(source.search);
    }
    if (Object.prototype.hasOwnProperty.call(source, 'status')) {
        next.status = normalizeServiceRequestSavedViewStatusParam(source.status);
    }
    if (Object.prototype.hasOwnProperty.call(source, 'priority')) {
        next.priority = normalizeServiceRequestSavedViewPriorityParam(source.priority);
    }
    if (Object.prototype.hasOwnProperty.call(source, 'executor')) {
        next.executor = normalizeServiceRequestSavedViewExecutorParam(source.executor);
    }
    if (Object.prototype.hasOwnProperty.call(source, 'sort') || Object.prototype.hasOwnProperty.call(source, 'order')) {
        next.sort = normalizeServiceRequestSavedViewSort(Object.prototype.hasOwnProperty.call(source, 'sort') ? source.sort : next.sort);
        next.order = normalizeSavedViewOrder(Object.prototype.hasOwnProperty.call(source, 'order') ? source.order : next.order);
    }
    return next;
};

export const serviceRequestSavedViewConfig = {
    module: 'service-requests',
    systemViewId: 'service-requests-system-default',
    systemViewName: 'Все заявки',
    defaultParams: {
        search: '',
        status: '',
        priority: '',
        executor: '',
        sort: 'updated_at',
        order: 'desc',
    },
    mergeParams: mergeServiceRequestSavedViewParams,
};
