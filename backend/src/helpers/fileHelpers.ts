import { createReadStream } from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { appConfig } from '../config.js';
import { ApiError } from '../errors.js';
import { isAllowedMimeType } from '../services/fileStorage.js';

const blockedActiveContentExtensions = new Set([
    '.htm',
    '.html',
    '.shtml',
    '.svg',
    '.svgz',
    '.xht',
    '.xhtml',
]);
const blockedActiveContentMimeTypes = new Set([
    'application/xhtml+xml',
    'image/svg+xml',
    'text/html',
]);

const normalizeFileName = (value) => {
    return String(value ?? '').trim();
};
const normalizeFileExtension = (fileName) => {
    const normalized = fileName.replace(/\\/g, '/');
    return path.posix.extname(path.posix.basename(normalized)).toLowerCase();
};
const sanitizeAttachmentFileName = (fileName) => {
    const normalized = normalizeFileName(fileName).replace(/\\/g, '/');
    const baseName = path.posix.basename(normalized) || 'download.bin';
    const safeAsciiName = baseName
        .replace(/[^\x20-\x7e]/g, '_')
        .replace(/["\\]/g, '_')
        .replace(/[;\r\n]/g, '_');
    return safeAsciiName || 'download.bin';
};
const encodeDispositionFileName = (fileName) => {
    return encodeURIComponent(fileName).replace(/['()*]/g, (character) => {
        return `%${character.charCodeAt(0).toString(16).toUpperCase()}`;
    });
};
const buildAttachmentContentDisposition = (fileName) => {
    const normalized = normalizeFileName(fileName).replace(/\\/g, '/');
    const baseName = path.posix.basename(normalized) || 'download.bin';
    const fallback = sanitizeAttachmentFileName(baseName);
    const encoded = encodeDispositionFileName(baseName);
    return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
};

export const normalizeMimeType = (value) => {
    return String(value ?? '').split(';')[0].trim().toLowerCase();
};
export const ensureAllowedMimeType = (mimeType) => {
    const normalized = normalizeMimeType(mimeType);
    if (!normalized) {
        throw new ApiError(415, 'FILE_TYPE_NOT_ALLOWED', 'File Content-Type is required');
    }
    if (!isAllowedMimeType(normalized)) {
        throw new ApiError(415, 'FILE_TYPE_NOT_ALLOWED', 'File type is not allowed');
    }
    return normalized;
};
export const ensureSafeUploadMetadata = ({ fileName, mimeType }) => {
    const normalizedFileName = normalizeFileName(fileName);
    if (!normalizedFileName) {
        throw new ApiError(422, 'INVALID_FILE_PAYLOAD', 'fileName is required');
    }
    const normalizedMimeType = ensureAllowedMimeType(mimeType);
    const normalizedExtension = normalizeFileExtension(normalizedFileName);
    if (blockedActiveContentExtensions.has(normalizedExtension) || blockedActiveContentMimeTypes.has(normalizedMimeType)) {
        throw new ApiError(415, 'FILE_TYPE_NOT_ALLOWED', 'Active web document uploads are not allowed');
    }
    return {
        fileName: normalizedFileName,
        mimeType: normalizedMimeType,
    };
};
export const parseDataUrlPayload = (payload) => {
    const dataUrlMatch = /^data:([^;]+);base64,([\s\S]+)$/i.exec(payload.dataUrl.trim());
    if (!dataUrlMatch) {
        throw new ApiError(422, 'INVALID_FILE_PAYLOAD', 'Invalid data URL payload');
    }
    const metadata = ensureSafeUploadMetadata({
        fileName: payload.fileName,
        mimeType: dataUrlMatch[1],
    });
    const base64Content = dataUrlMatch[2].replace(/\s+/g, '');
    if (!base64Content) {
        throw new ApiError(422, 'INVALID_FILE_PAYLOAD', 'File payload is empty');
    }
    const content = Buffer.from(base64Content, 'base64');
    if (content.byteLength === 0) {
        throw new ApiError(422, 'INVALID_FILE_PAYLOAD', 'File payload is empty');
    }
    const maxBytes = appConfig.fileUploadMaxMb * 1024 * 1024;
    if (content.byteLength > maxBytes) {
        throw new ApiError(413, 'FILE_TOO_LARGE', `File exceeds ${appConfig.fileUploadMaxMb} MB limit`);
    }
    return {
        fileName: metadata.fileName,
        mimeType: metadata.mimeType,
        content,
    };
};
export const buildFileUrl = (request, storageKey) => {
    const forwardedProto = request.get('x-forwarded-proto')?.split(',')[0]?.trim();
    const forwardedHost = request.get('x-forwarded-host')?.split(',')[0]?.trim();
    const protocol = forwardedProto || request.protocol;
    const host = forwardedHost || request.get('host');
    const basePath = appConfig.filePublicBasePath.replace(/\/+$/, '');
    const pathValue = `${basePath}/${storageKey}`;
    if (!host) {
        return pathValue;
    }
    return `${protocol}://${host}${pathValue}`;
};
export const sendAttachmentSafeFileResponse = async ({ request, response, fullPath, fileName, sizeBytes, lastModified }) => {
    response.status(200);
    response.setHeader('Cache-Control', 'private, max-age=3600');
    response.setHeader('Content-Disposition', buildAttachmentContentDisposition(fileName));
    response.setHeader('Content-Length', String(sizeBytes));
    response.setHeader('Content-Type', 'application/octet-stream');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    if (lastModified) {
        response.setHeader('Last-Modified', lastModified instanceof Date ? lastModified.toUTCString() : new Date(lastModified).toUTCString());
    }
    if (String(request.method ?? '').toUpperCase() === 'HEAD') {
        response.end();
        return;
    }
    await pipeline(createReadStream(fullPath), response);
};
