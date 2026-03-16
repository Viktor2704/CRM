import { randomUUID } from 'node:crypto';
import { ApiError } from '../errors.js';
import { normalizeText } from './normalize.js';

type SavedViewConfig = {
    module: string;
    systemViewId: string;
    systemViewName: string;
    defaultParams?: Record<string, any>;
    mergeParams?: (baseParams: any, value: any) => Record<string, any>;
};

type SavedViewItem = {
    id: string;
    module: string;
    name: string;
    params: Record<string, any>;
    columns: string[];
    groupBy: string | null;
    layout: 'list' | 'board' | null;
    isSystem: boolean;
    isDefault: boolean;
    createdAt: string | null;
    updatedAt: string | null;
};

type LocalMockSavedViewState = {
    customViews: SavedViewItem[];
    defaultViewId: string;
};

const localMockSavedViews = new Map<string, LocalMockSavedViewState>();
const MAX_SAVED_VIEWS = 50;
const MAX_COLUMNS = 50;
const MAX_NAME_LENGTH = 120;
const ALLOWED_LAYOUTS = new Set(['list', 'board']);

const buildStorageKey = (actorUserId: string, config: SavedViewConfig) => `${actorUserId}::${config.module}`;

const mergeSavedViewParams = (config: SavedViewConfig, baseParams: any, value: any) => {
    if (typeof config.mergeParams === 'function') {
        return config.mergeParams(baseParams ?? config.defaultParams ?? {}, value);
    }
    return {
        ...(config.defaultParams ?? {}),
        ...(baseParams ?? {}),
        ...((value && typeof value === 'object' && !Array.isArray(value)) ? value : {}),
    };
};

const assertActorUserId = (actorUserId: unknown): string => {
    const normalizedActorUserId = normalizeText(actorUserId);
    if (!normalizedActorUserId) {
        throw new ApiError(401, 'UNAUTHORIZED', 'Authentication is required');
    }
    return normalizedActorUserId;
};

const normalizeSavedViewName = (value: unknown): string => {
    const name = normalizeText(value);
    if (!name) {
        throw new ApiError(422, 'VALIDATION_ERROR', 'name is required');
    }
    if (name.length > MAX_NAME_LENGTH) {
        throw new ApiError(422, 'VALIDATION_ERROR', `name must be <= ${MAX_NAME_LENGTH} characters`);
    }
    return name;
};

const normalizeSavedViewColumns = (value: unknown): string[] => {
    if (!Array.isArray(value)) {
        return [];
    }

    const columns = Array.from(
        new Set(
            value
                .map((entry) => normalizeText(entry))
                .filter((entry) => entry.length > 0)
        )
    );

    if (columns.length > MAX_COLUMNS) {
        throw new ApiError(422, 'VALIDATION_ERROR', `columns can contain up to ${MAX_COLUMNS} values`);
    }

    return columns;
};

const normalizeSavedViewGroupBy = (value: unknown): string | null => {
    const normalized = normalizeText(value);
    return normalized || null;
};

const normalizeSavedViewLayout = (value: unknown): 'list' | 'board' | null => {
    const normalized = normalizeText(value).toLowerCase();
    if (!normalized) {
        return null;
    }
    if (!ALLOWED_LAYOUTS.has(normalized)) {
        throw new ApiError(422, 'VALIDATION_ERROR', 'layout contains unsupported value');
    }
    return normalized as 'list' | 'board';
};

const buildSystemView = (config: SavedViewConfig, defaultViewId: string): SavedViewItem => ({
    id: config.systemViewId,
    module: config.module,
    name: config.systemViewName,
    params: mergeSavedViewParams(config, config.defaultParams ?? {}, {}),
    columns: [],
    groupBy: null,
    layout: null,
    isSystem: true,
    isDefault: defaultViewId === config.systemViewId,
    createdAt: null,
    updatedAt: null,
});

const ensureState = (actorUserId: string, config: SavedViewConfig): LocalMockSavedViewState => {
    const key = buildStorageKey(actorUserId, config);
    const existingState = localMockSavedViews.get(key);
    if (existingState) {
        return existingState;
    }
    const nextState: LocalMockSavedViewState = {
        customViews: [],
        defaultViewId: config.systemViewId,
    };
    localMockSavedViews.set(key, nextState);
    return nextState;
};

const applyDefaultView = (state: LocalMockSavedViewState, defaultViewId: string) => {
    state.defaultViewId = defaultViewId;
    state.customViews = state.customViews.map((item) => ({
        ...item,
        isDefault: item.id === defaultViewId,
    }));
};

const buildListResponse = (state: LocalMockSavedViewState, config: SavedViewConfig) => ({
    items: [
        buildSystemView(config, state.defaultViewId),
        ...state.customViews,
    ],
    defaultViewId: state.defaultViewId,
    systemViewId: config.systemViewId,
});

const getExistingViewIndex = (state: LocalMockSavedViewState, viewId: string): number => {
    return state.customViews.findIndex((item) => item.id === viewId);
};

const buildSavedViewItem = (
    config: SavedViewConfig,
    id: string,
    input: Record<string, any>,
    timestamp: string,
): SavedViewItem => ({
    id,
    module: config.module,
    name: normalizeSavedViewName(input.name),
    params: mergeSavedViewParams(config, config.defaultParams ?? {}, input.params),
    columns: normalizeSavedViewColumns(input.columns),
    groupBy: normalizeSavedViewGroupBy(input.groupBy),
    layout: normalizeSavedViewLayout(input.layout),
    isSystem: false,
    isDefault: false,
    createdAt: timestamp,
    updatedAt: timestamp,
});

/**
 * Normalizes the order of saved views.
 */
export const normalizeSavedViewOrder = (order: any): 'asc' | 'desc' => {
    const normalized = normalizeText(order).toLowerCase();
    if (!normalized) {
        return 'desc';
    }
    if (normalized === 'asc' || normalized === 'desc') {
        return normalized;
    }
    throw new ApiError(422, 'VALIDATION_ERROR', 'order contains unsupported value');
};

// Stub implementations for saved view CRUD operations
// These should be implemented based on your database schema

export const createSavedView = async (params: any): Promise<any> => {
    throw new Error('createSavedView not implemented');
};

export const updateSavedView = async (params: any): Promise<any> => {
    throw new Error('updateSavedView not implemented');
};

export const deleteSavedView = async (params: any): Promise<any> => {
    throw new Error('deleteSavedView not implemented');
};

export const listSavedViews = async (params: any): Promise<any[]> => {
    return [];
};

export const createLocalMockSavedView = (params: any): any => {
    const actorUserId = assertActorUserId(params?.actorUserId);
    const config = params?.config as SavedViewConfig;
    const input = params?.input && typeof params.input === 'object' && !Array.isArray(params.input) ? params.input : {};
    const createId = typeof params?.createId === 'function' ? params.createId : randomUUID;
    const state = ensureState(actorUserId, config);

    if (state.customViews.length >= MAX_SAVED_VIEWS) {
        throw new ApiError(422, 'VALIDATION_ERROR', 'saved views limit reached');
    }

    const timestamp = new Date().toISOString();
    const nextItem = buildSavedViewItem(config, createId(), input, timestamp);
    state.customViews.push(nextItem);

    if (input.isDefault === true) {
        applyDefaultView(state, nextItem.id);
    }

    const item = state.customViews.find((candidate) => candidate.id === nextItem.id)!;
    return {
        ...buildListResponse(state, config),
        item,
    };
};

export const updateLocalMockSavedView = (params: any): any => {
    const actorUserId = assertActorUserId(params?.actorUserId);
    const config = params?.config as SavedViewConfig;
    const viewId = normalizeText(params?.viewId);
    const input = params?.input && typeof params.input === 'object' && !Array.isArray(params.input) ? params.input : {};
    const state = ensureState(actorUserId, config);

    if (viewId === config.systemViewId) {
        throw new ApiError(422, 'VALIDATION_ERROR', 'system view cannot be modified');
    }

    const index = getExistingViewIndex(state, viewId);
    if (index === -1) {
        throw new ApiError(404, 'NOT_FOUND', 'Saved view not found');
    }

    const currentItem = state.customViews[index];
    const nextItem: SavedViewItem = {
        ...currentItem,
        name: Object.prototype.hasOwnProperty.call(input, 'name') ? normalizeSavedViewName(input.name) : currentItem.name,
        params: Object.prototype.hasOwnProperty.call(input, 'params')
            ? mergeSavedViewParams(config, currentItem.params, input.params)
            : currentItem.params,
        columns: Object.prototype.hasOwnProperty.call(input, 'columns')
            ? normalizeSavedViewColumns(input.columns)
            : currentItem.columns,
        groupBy: Object.prototype.hasOwnProperty.call(input, 'groupBy')
            ? normalizeSavedViewGroupBy(input.groupBy)
            : currentItem.groupBy,
        layout: Object.prototype.hasOwnProperty.call(input, 'layout')
            ? normalizeSavedViewLayout(input.layout)
            : currentItem.layout,
        updatedAt: new Date().toISOString(),
    };

    state.customViews[index] = nextItem;

    if (input.isDefault === true) {
        applyDefaultView(state, viewId);
    } else if (input.isDefault === false && state.defaultViewId === viewId) {
        applyDefaultView(state, config.systemViewId);
    }

    const item = state.customViews[index];
    return {
        ...buildListResponse(state, config),
        item,
    };
};

export const deleteLocalMockSavedView = (params: any): any => {
    const actorUserId = assertActorUserId(params?.actorUserId);
    const config = params?.config as SavedViewConfig;
    const viewId = normalizeText(params?.viewId);
    const state = ensureState(actorUserId, config);

    if (viewId === config.systemViewId) {
        throw new ApiError(422, 'VALIDATION_ERROR', 'system view cannot be deleted');
    }

    const index = getExistingViewIndex(state, viewId);
    if (index === -1) {
        throw new ApiError(404, 'NOT_FOUND', 'Saved view not found');
    }

    state.customViews.splice(index, 1);

    if (state.defaultViewId === viewId) {
        applyDefaultView(state, config.systemViewId);
    }

    return buildListResponse(state, config);
};

export const listLocalMockSavedViews = (params: any): any => {
    const actorUserId = assertActorUserId(params?.actorUserId);
    const config = params?.config as SavedViewConfig;
    const state = ensureState(actorUserId, config);
    return buildListResponse(state, config);
};

export const resetLocalMockSavedViews = () => {
    localMockSavedViews.clear();
};
