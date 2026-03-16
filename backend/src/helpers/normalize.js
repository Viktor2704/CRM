const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const normalizeText = (value) => typeof value === 'string' ? value.trim() : '';
export const escapeHtml = (value) => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
export const isUuidValue = (value) => uuidPattern.test(String(value ?? ''));
export const isEmailValue = (value) => emailPattern.test(String(value ?? ''));
export const hasAnyText = (...values) => values.some((value) => normalizeText(value).length > 0);
