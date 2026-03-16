/**
 * Input Sanitization Helpers
 */

export { escapeHtml } from './normalize.js';

/**
 * Strip HTML tags from string, leaving only plain text
 */
export function stripHtml(input: string): string {
  if (!input) return '';

  let text = input.replace(/<[^>]*>/g, '');

  text = text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, '/');

  return text.trim().replace(/\s+/g, ' ');
}
