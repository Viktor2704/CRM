import { randomUUID } from 'node:crypto';
import { createWriteStream, promises as fs } from 'node:fs';
import path from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { appConfig } from '../config.js';
import { ApiError } from '../errors.js';
const sanitizeFileName = (fileName) => {
    const normalized = fileName
        .trim()
        .replace(/[/\\?%*:|"<>]/g, '_')
        .replace(/\s+/g, '_')
        .replace(/_+/g, '_')
        .replace(/^\.+/, '')
        .slice(0, 120);
    return normalized || 'file.bin';
};
const toPosixPath = (value) => {
    return value.split(path.sep).join(path.posix.sep);
};
const createStorageTarget = (rootDir, fileName) => {
    const fileId = randomUUID();
    const uploadedAt = new Date().toISOString();
    const date = new Date(uploadedAt);
    const year = String(date.getUTCFullYear());
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const safeFileName = sanitizeFileName(fileName);
    const relativeDir = path.join(year, month);
    const storageDir = path.join(rootDir, relativeDir);
    const storedFileName = `${fileId}-${safeFileName}`;
    const fullPath = path.join(storageDir, storedFileName);
    const storageKey = toPosixPath(path.join(relativeDir, storedFileName));
    return {
        fileId,
        fullPath,
        safeFileName,
        storageDir,
        storageKey,
        uploadedAt,
    };
};
const createFileTooLargeError = () => {
    return new ApiError(413, 'FILE_TOO_LARGE', `File exceeds ${appConfig.fileUploadMaxMb} MB limit`);
};
export const isAllowedMimeType = (mimeType) => {
    const normalized = mimeType.trim().toLowerCase();
    if (!normalized)
        return false;
    return appConfig.fileAllowedMimeTypes.some(rule => {
        const ruleValue = rule.trim().toLowerCase();
        if (!ruleValue)
            return false;
        if (ruleValue.endsWith('/*')) {
            const prefix = ruleValue.slice(0, -1);
            return normalized.startsWith(prefix);
        }
        return normalized === ruleValue;
    });
};
class LocalFileStorageProvider {
    rootDir;
    constructor(rootDir) {
        this.rootDir = rootDir;
    }
    async save(input) {
        if (!isAllowedMimeType(input.mimeType)) {
            throw new ApiError(415, 'UNSUPPORTED_MEDIA_TYPE', `File type "${input.mimeType}" is not allowed`);
        }
        const target = createStorageTarget(this.rootDir, input.fileName);
        await fs.mkdir(target.storageDir, { recursive: true });
        await fs.writeFile(target.fullPath, input.content, { flag: 'wx' });
        return {
            id: target.fileId,
            fileName: target.safeFileName,
            mimeType: input.mimeType,
            sizeBytes: input.content.byteLength,
            storageKey: target.storageKey,
            uploadedAt: target.uploadedAt,
        };
    }
    async saveStream(input) {
        if (!isAllowedMimeType(input.mimeType)) {
            throw new ApiError(415, 'UNSUPPORTED_MEDIA_TYPE', `File type "${input.mimeType}" is not allowed`);
        }
        const target = createStorageTarget(this.rootDir, input.fileName);
        const maxBytes = appConfig.fileUploadMaxMb * 1024 * 1024;
        let sizeBytes = 0;
        await fs.mkdir(target.storageDir, { recursive: true });
        const sizeGuard = new Transform({
            transform(chunk, _encoding, callback) {
                const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
                sizeBytes += buffer.byteLength;
                if (sizeBytes > maxBytes) {
                    callback(createFileTooLargeError());
                    return;
                }
                callback(null, buffer);
            },
        });
        try {
            await pipeline(input.stream, sizeGuard, createWriteStream(target.fullPath, { flags: 'wx' }));
            if (sizeBytes === 0) {
                throw new ApiError(422, 'INVALID_FILE_PAYLOAD', 'File payload is empty');
            }
        }
        catch (error) {
            await fs.rm(target.fullPath, { force: true });
            throw error;
        }
        return {
            id: target.fileId,
            fileName: target.safeFileName,
            mimeType: input.mimeType,
            sizeBytes,
            storageKey: target.storageKey,
            uploadedAt: target.uploadedAt,
        };
    }
}
const createFileStorageProvider = () => {
    switch (appConfig.fileStorageProvider) {
        case 'local':
        default:
            return new LocalFileStorageProvider(appConfig.fileStorageDir);
    }
};
export const fileStorageProvider = createFileStorageProvider();
export const storeFile = async (input) => {
    return fileStorageProvider.save(input);
};
export const storeFileStream = async (input) => {
    return fileStorageProvider.saveStream(input);
};
