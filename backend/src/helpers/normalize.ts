import escapeHtmlLib from 'escape-html';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const normalizeText = (value: unknown): string => typeof value === 'string' ? value.trim() : '';

export const escapeHtml = (value: unknown): string => escapeHtmlLib(String(value ?? ''));

export const isUuidValue = (value: unknown): boolean => uuidPattern.test(String(value ?? ''));

export const isEmailValue = (value: unknown): boolean => emailPattern.test(String(value ?? ''));

export const hasAnyText = (...values: unknown[]): boolean => values.some((value) => normalizeText(value).length > 0);
