/**
 * Input Sanitization Helpers
 * Provides utilities for sanitizing and validating user input to prevent injection attacks
 */

/**
 * Sanitize HTML to prevent XSS attacks
 * Removes potentially dangerous HTML tags and attributes
 */
export function sanitizeHtml(input: string): string {
  if (!input) return '';

  // Remove script tags and their content
  let sanitized = input.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');

  // Remove event handlers (onclick, onerror, etc.)
  sanitized = sanitized.replace(/\s*on\w+\s*=\s*["'][^"']*["']/gi, '');
  sanitized = sanitized.replace(/\s*on\w+\s*=\s*[^\s>]*/gi, '');

  // Remove javascript: protocol
  sanitized = sanitized.replace(/javascript:/gi, '');

  // Remove data: protocol (can be used for XSS)
  sanitized = sanitized.replace(/data:text\/html/gi, '');

  return sanitized;
}

/**
 * Escape HTML special characters to prevent XSS
 */
export function escapeHtml(input: string): string {
  if (!input) return '';

  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#x27;',
    '/': '&#x2F;',
  };

  return input.replace(/[&<>"'/]/g, (char) => map[char] || char);
}

/**
 * Strip HTML tags from string, leaving only plain text
 * Useful for notifications and plain text displays
 */
export function stripHtml(input: string): string {
  if (!input) return '';

  // Remove HTML tags
  let text = input.replace(/<[^>]*>/g, '');

  // Decode common HTML entities
  text = text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, '/');

  // Trim and normalize whitespace
  return text.trim().replace(/\s+/g, ' ');
}

/**
 * Sanitize SQL LIKE pattern to prevent SQL injection in LIKE clauses
 * Escapes special characters: %, _, \
 */
export function sanitizeLikePattern(input: string): string {
  if (!input) return '';

  return input
    .replace(/\\/g, '\\\\')  // Escape backslash first
    .replace(/%/g, '\\%')    // Escape percent
    .replace(/_/g, '\\_');   // Escape underscore
}

/**
 * Validate and sanitize email address
 */
export function sanitizeEmail(input: string): string {
  if (!input) return '';

  const trimmed = input.trim().toLowerCase();

  // Basic email validation regex
  const emailRegex = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i;

  if (!emailRegex.test(trimmed)) {
    throw new Error('Invalid email format');
  }

  return trimmed;
}

/**
 * Validate and sanitize UUID
 */
export function sanitizeUuid(input: string): string {
  if (!input) return '';

  const trimmed = input.trim().toLowerCase();

  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  if (!uuidRegex.test(trimmed)) {
    throw new Error('Invalid UUID format');
  }

  return trimmed;
}

/**
 * Sanitize file path to prevent directory traversal attacks
 */
export function sanitizeFilePath(input: string): string {
  if (!input) return '';

  // Remove null bytes
  let sanitized = input.replace(/\0/g, '');

  // Remove path traversal attempts
  sanitized = sanitized.replace(/\.\./g, '');

  // Remove leading slashes
  sanitized = sanitized.replace(/^\/+/, '');

  // Normalize slashes
  sanitized = sanitized.replace(/\\/g, '/');

  // Remove multiple consecutive slashes
  sanitized = sanitized.replace(/\/+/g, '/');

  return sanitized;
}

/**
 * Sanitize integer input
 */
export function sanitizeInteger(input: any, min?: number, max?: number): number {
  const normalized = String(input ?? '').trim();
  if (!/^-?\d+$/.test(normalized)) {
    throw new Error('Invalid integer');
  }

  const parsed = Number.parseInt(normalized, 10);

  if (min !== undefined && parsed < min) {
    throw new Error(`Integer must be at least ${min}`);
  }

  if (max !== undefined && parsed > max) {
    throw new Error(`Integer must be at most ${max}`);
  }

  return parsed;
}

/**
 * Sanitize string input with length limits
 */
export function sanitizeString(input: string, maxLength: number = 1000): string {
  if (!input) return '';

  const trimmed = input.trim();

  if (trimmed.length > maxLength) {
    throw new Error(`String exceeds maximum length of ${maxLength}`);
  }

  return trimmed;
}

/**
 * Validate JSON input to prevent JSON injection
 */
export function sanitizeJson(input: string): any {
  try {
    return JSON.parse(input);
  } catch (error) {
    throw new Error('Invalid JSON format');
  }
}

/**
 * Sanitize URL to prevent open redirect vulnerabilities
 */
export function sanitizeUrl(input: string, allowedDomains?: string[]): string {
  if (!input) return '';

  const trimmed = input.trim();

  // Check for javascript: protocol
  if (trimmed.toLowerCase().startsWith('javascript:')) {
    throw new Error('JavaScript URLs are not allowed');
  }

  // Check for data: protocol
  if (trimmed.toLowerCase().startsWith('data:')) {
    throw new Error('Data URLs are not allowed');
  }

  // If allowed domains specified, validate domain
  if (allowedDomains && allowedDomains.length > 0) {
    try {
      const url = new URL(trimmed);
      const isAllowed = allowedDomains.some(domain =>
        url.hostname === domain || url.hostname.endsWith(`.${domain}`)
      );

      if (!isAllowed) {
        throw new Error('URL domain is not allowed');
      }
    } catch (error) {
      if (error instanceof TypeError) {
        throw new Error('Invalid URL format');
      }
      throw error;
    }
  }

  return trimmed;
}

/**
 * Remove null bytes from string (can cause issues in C-based systems)
 */
export function removeNullBytes(input: string): string {
  if (!input) return '';
  return input.replace(/\0/g, '');
}

/**
 * Validate and sanitize phone number
 */
export function sanitizePhoneNumber(input: string): string {
  if (!input) return '';

  // Remove all non-digit characters except + at the start
  const sanitized = input.trim().replace(/[^\d+]/g, '');

  // Basic validation: should start with + or digit, and be reasonable length
  if (sanitized.length < 7 || sanitized.length > 20) {
    throw new Error('Invalid phone number length');
  }

  return sanitized;
}
