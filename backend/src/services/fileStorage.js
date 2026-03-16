import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { appConfig } from '../config.js';
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
        const fileId = randomUUID();
        const uploadedAt = new Date().toISOString();
        const date = new Date(uploadedAt);
        const year = String(date.getUTCFullYear());
        const month = String(date.getUTCMonth() + 1).padStart(2, '0');
        const safeFileName = sanitizeFileName(input.fileName);
        const relativeDir = path.join(year, month);
        const storageDir = path.join(this.rootDir, relativeDir);
        const storedFileName = `${fileId}-${safeFileName}`;
        const fullPath = path.join(storageDir, storedFileName);
        await fs.mkdir(storageDir, { recursive: true });
        await fs.writeFile(fullPath, input.content, { flag: 'wx' });
        const storageKey = toPosixPath(path.join(relativeDir, storedFileName));
        return {
            id: fileId,
            fileName: safeFileName,
            mimeType: input.mimeType,
            sizeBytes: input.content.byteLength,
            storageKey,
            uploadedAt,
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
