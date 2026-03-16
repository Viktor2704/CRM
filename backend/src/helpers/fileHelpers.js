import { appConfig } from '../config.js';
import { ApiError } from '../errors.js';
import { isAllowedMimeType } from '../services/fileStorage.js';
export const parseDataUrlPayload = (payload) => {
    const dataUrlMatch = /^data:([^;]+);base64,([\s\S]+)$/i.exec(payload.dataUrl.trim());
    if (!dataUrlMatch) {
        throw new ApiError(422, 'INVALID_FILE_PAYLOAD', 'Invalid data URL payload');
    }
    const mimeType = dataUrlMatch[1].trim().toLowerCase();
    if (!isAllowedMimeType(mimeType)) {
        throw new ApiError(415, 'FILE_TYPE_NOT_ALLOWED', 'File type is not allowed');
    }
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
    return { mimeType, content };
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
