import { appConfig } from '../config.js';
import { normalizeText } from './normalize.js';

const normalizeStorageKey = (value: unknown) => {
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

const normalizePublicBasePath = (value: unknown) => {
    const normalized = normalizeText(value).replace(/\/+$/, '');
    return normalized.startsWith('/') ? normalized : '';
};

export const resolveFilePublicBasePaths = (publicBasePaths: Array<string> = [appConfig.filePublicBasePath]) => {
    const uniquePaths = new Set<string>();
    for (const candidate of [...publicBasePaths, '/api/uploads', '/uploads']) {
        const normalized = normalizePublicBasePath(candidate);
        if (normalized) {
            uniquePaths.add(normalized);
        }
    }
    return [...uniquePaths];
};

export const extractStorageKeyFromPublicFileUrl = (value: unknown, publicBasePaths: Array<string> = [appConfig.filePublicBasePath]) => {
    const normalized = normalizeText(value);
    if (!normalized) {
        return '';
    }
    for (const basePath of resolveFilePublicBasePaths(publicBasePaths)) {
        const marker = `${basePath}/`;
        const markerIndex = normalized.lastIndexOf(marker);
        if (markerIndex >= 0) {
            return normalizeStorageKey(normalized.slice(markerIndex + marker.length));
        }
    }
    if (!normalized.includes('://') && !normalized.startsWith('/')) {
        return normalizeStorageKey(normalized);
    }
    return '';
};

export const buildPublicFilePath = (storageKey: unknown, publicBasePath: string = appConfig.filePublicBasePath) => {
    const normalizedBasePath = normalizePublicBasePath(publicBasePath) || '/api/uploads';
    const normalizedStorageKey = normalizeStorageKey(storageKey);
    if (!normalizedStorageKey) {
        return normalizedBasePath;
    }
    return `${normalizedBasePath}/${normalizedStorageKey}`;
};

export const rewriteFileUrlToPublicBasePath = (value: unknown, publicBasePath: string = appConfig.filePublicBasePath) => {
    const normalized = normalizeText(value);
    if (!normalized) {
        return '';
    }
    const storageKey = extractStorageKeyFromPublicFileUrl(normalized, [publicBasePath]);
    if (!storageKey) {
        return normalized;
    }
    const nextPath = buildPublicFilePath(storageKey, publicBasePath);
    if (normalized.includes('://')) {
        try {
            const url = new URL(normalized);
            return `${url.protocol}//${url.host}${nextPath}`;
        }
        catch (_error) {
            return nextPath;
        }
    }
    return nextPath;
};
