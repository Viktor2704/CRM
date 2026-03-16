import { promises as fs } from 'node:fs';
import path from 'node:path';
import { appConfig } from '../config.js';
import { logger } from '../logger.js';

const MAX_TEXT_LENGTH = 16000;

export const extractTextFromFile = async (storageKey: string, mimeType: string): Promise<string> => {
    const filePath = path.join(appConfig.fileStorageDir, storageKey);
    try {
        const buffer = await fs.readFile(filePath);

        if (mimeType === 'application/pdf') {
            const pdfParse = (await import('pdf-parse' as any)) as any;
            const parseFn = pdfParse.default || pdfParse;
            const result = await parseFn(buffer);
            return (result.text || '').slice(0, MAX_TEXT_LENGTH);
        }

        if (
            mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
            mimeType === 'application/msword'
        ) {
            const mammoth = await import('mammoth');
            const result = await mammoth.extractRawText({ buffer });
            return (result.value || '').slice(0, MAX_TEXT_LENGTH);
        }

        if (mimeType === 'text/plain') {
            return buffer.toString('utf-8').slice(0, MAX_TEXT_LENGTH);
        }

        if (
            mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
            mimeType === 'application/vnd.ms-excel'
        ) {
            const ExcelJS = await import('exceljs');
            const WorkbookClass = ExcelJS.default?.Workbook || ExcelJS.Workbook;
            const workbook = new WorkbookClass();
            await workbook.xlsx.load(buffer as any);
            const parts: string[] = [];
            workbook.eachSheet((sheet) => {
                parts.push(`[${sheet.name}]`);
                sheet.eachRow((row) => {
                    const vals = (Array.isArray(row.values) ? row.values.slice(1) : [])
                        .map((v) => (v != null ? String(v) : ''))
                        .join('\t');
                    if (vals.trim()) parts.push(vals);
                });
            });
            return parts.join('\n').slice(0, MAX_TEXT_LENGTH);
        }

        return '';
    } catch (error) {
        logger.warn('Failed to extract text from file', {
            storageKey,
            mimeType,
            error: error instanceof Error ? error.message : 'unknown',
        });
        return '';
    }
};

export const extractTextFromFiles = async (
    files: Array<{ storageKey?: string; storage_key?: string; mimeType?: string; mime_type?: string }>,
): Promise<string> => {
    if (!Array.isArray(files) || files.length === 0) return '';

    const results = await Promise.all(
        files.slice(0, 5).map(async (f) => {
            const key = f.storageKey || f.storage_key || '';
            const mime = f.mimeType || f.mime_type || '';
            if (!key || !mime) return '';
            return extractTextFromFile(key, mime);
        }),
    );

    return results.filter(Boolean).join('\n\n---\n\n').slice(0, MAX_TEXT_LENGTH);
};
