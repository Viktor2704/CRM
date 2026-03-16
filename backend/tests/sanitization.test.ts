import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  sanitizeHtml,
  escapeHtml,
  sanitizeLikePattern,
  sanitizeEmail,
  sanitizeUuid,
  sanitizeFilePath,
  sanitizeInteger,
  sanitizeString,
  sanitizeUrl,
  removeNullBytes,
  sanitizePhoneNumber,
} from '../src/helpers/sanitization.js';

describe('Input Sanitization', () => {
  describe('sanitizeHtml', () => {
    it('should remove script tags', () => {
      const input = '<div>Hello<script>alert("xss")</script>World</div>';
      const result = sanitizeHtml(input);
      assert.strictEqual(result.includes('<script>'), false);
      assert.strictEqual(result.includes('alert'), false);
    });

    it('should remove event handlers', () => {
      const input = '<div onclick="alert(1)">Click me</div>';
      const result = sanitizeHtml(input);
      assert.strictEqual(result.includes('onclick'), false);
    });

    it('should remove javascript: protocol', () => {
      const input = '<a href="javascript:alert(1)">Link</a>';
      const result = sanitizeHtml(input);
      assert.strictEqual(result.toLowerCase().includes('javascript:'), false);
    });

    it('should handle empty input', () => {
      assert.strictEqual(sanitizeHtml(''), '');
      assert.strictEqual(sanitizeHtml(null as any), '');
    });
  });

  describe('escapeHtml', () => {
    it('should escape HTML special characters', () => {
      const input = '<script>alert("XSS")</script>';
      const result = escapeHtml(input);
      assert.strictEqual(result, '&lt;script&gt;alert(&quot;XSS&quot;)&lt;&#x2F;script&gt;');
    });

    it('should escape ampersands', () => {
      assert.strictEqual(escapeHtml('Tom & Jerry'), 'Tom &amp; Jerry');
    });

    it('should handle empty input', () => {
      assert.strictEqual(escapeHtml(''), '');
    });
  });

  describe('sanitizeLikePattern', () => {
    it('should escape SQL LIKE wildcards', () => {
      const input = 'test%value_with\\backslash';
      const result = sanitizeLikePattern(input);
      assert.strictEqual(result, 'test\\%value\\_with\\\\backslash');
    });

    it('should handle empty input', () => {
      assert.strictEqual(sanitizeLikePattern(''), '');
    });
  });

  describe('sanitizeEmail', () => {
    it('should accept valid email addresses', () => {
      const valid = ['test@example.com', 'user.name+tag@example.co.uk'];
      valid.forEach(email => {
        assert.doesNotThrow(() => sanitizeEmail(email));
      });
    });

    it('should reject invalid email addresses', () => {
      const invalid = ['not-an-email', '@example.com', 'user@', 'user @example.com'];
      invalid.forEach(email => {
        assert.throws(() => sanitizeEmail(email), /Invalid email format/);
      });
    });

    it('should normalize email to lowercase', () => {
      assert.strictEqual(sanitizeEmail('Test@Example.COM'), 'test@example.com');
    });
  });

  describe('sanitizeUuid', () => {
    it('should accept valid UUIDs', () => {
      const valid = [
        '123e4567-e89b-12d3-a456-426614174000',
        'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
      ];
      valid.forEach(uuid => {
        assert.doesNotThrow(() => sanitizeUuid(uuid));
      });
    });

    it('should reject invalid UUIDs', () => {
      const invalid = ['not-a-uuid', '123-456', 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx'];
      invalid.forEach(uuid => {
        assert.throws(() => sanitizeUuid(uuid), /Invalid UUID format/);
      });
    });

    it('should normalize UUID to lowercase', () => {
      const input = '123E4567-E89B-12D3-A456-426614174000';
      const result = sanitizeUuid(input);
      assert.strictEqual(result, input.toLowerCase());
    });
  });

  describe('sanitizeFilePath', () => {
    it('should prevent directory traversal', () => {
      const input = '../../../etc/passwd';
      const result = sanitizeFilePath(input);
      assert.strictEqual(result.includes('..'), false);
    });

    it('should remove null bytes', () => {
      const input = 'file\0name.txt';
      const result = sanitizeFilePath(input);
      assert.strictEqual(result.includes('\0'), false);
    });

    it('should normalize slashes', () => {
      const input = 'path\\to\\file';
      const result = sanitizeFilePath(input);
      assert.strictEqual(result, 'path/to/file');
    });

    it('should remove leading slashes', () => {
      const input = '///path/to/file';
      const result = sanitizeFilePath(input);
      assert.strictEqual(result, 'path/to/file');
    });
  });

  describe('sanitizeInteger', () => {
    it('should parse valid integers', () => {
      assert.strictEqual(sanitizeInteger('42'), 42);
      assert.strictEqual(sanitizeInteger(42), 42);
    });

    it('should reject non-integers', () => {
      assert.throws(() => sanitizeInteger('not-a-number'), /Invalid integer/);
      assert.throws(() => sanitizeInteger('3.14'), /Invalid integer/);
    });

    it('should enforce minimum value', () => {
      assert.throws(() => sanitizeInteger(5, 10), /must be at least 10/);
      assert.doesNotThrow(() => sanitizeInteger(10, 10));
    });

    it('should enforce maximum value', () => {
      assert.throws(() => sanitizeInteger(100, undefined, 50), /must be at most 50/);
      assert.doesNotThrow(() => sanitizeInteger(50, undefined, 50));
    });
  });

  describe('sanitizeString', () => {
    it('should trim whitespace', () => {
      assert.strictEqual(sanitizeString('  hello  '), 'hello');
    });

    it('should enforce maximum length', () => {
      const longString = 'a'.repeat(1001);
      assert.throws(() => sanitizeString(longString, 1000), /exceeds maximum length/);
    });

    it('should accept strings within limit', () => {
      const validString = 'a'.repeat(100);
      assert.strictEqual(sanitizeString(validString, 1000), validString);
    });
  });

  describe('sanitizeUrl', () => {
    it('should reject javascript: URLs', () => {
      assert.throws(() => sanitizeUrl('javascript:alert(1)'), /JavaScript URLs are not allowed/);
    });

    it('should reject data: URLs', () => {
      assert.throws(() => sanitizeUrl('data:text/html,<script>alert(1)</script>'), /Data URLs are not allowed/);
    });

    it('should accept valid HTTP URLs', () => {
      assert.doesNotThrow(() => sanitizeUrl('https://example.com'));
      assert.doesNotThrow(() => sanitizeUrl('http://example.com/path'));
    });

    it('should enforce allowed domains', () => {
      const allowedDomains = ['example.com', 'trusted.org'];
      assert.doesNotThrow(() => sanitizeUrl('https://example.com', allowedDomains));
      assert.doesNotThrow(() => sanitizeUrl('https://sub.example.com', allowedDomains));
      assert.throws(() => sanitizeUrl('https://evil.com', allowedDomains), /domain is not allowed/);
    });
  });

  describe('removeNullBytes', () => {
    it('should remove null bytes', () => {
      const input = 'hello\0world\0';
      const result = removeNullBytes(input);
      assert.strictEqual(result, 'helloworld');
      assert.strictEqual(result.includes('\0'), false);
    });
  });

  describe('sanitizePhoneNumber', () => {
    it('should accept valid phone numbers', () => {
      const valid = ['+1234567890', '1234567890', '+44 20 1234 5678'];
      valid.forEach(phone => {
        assert.doesNotThrow(() => sanitizePhoneNumber(phone));
      });
    });

    it('should remove non-digit characters except leading +', () => {
      const input = '+1 (234) 567-8900';
      const result = sanitizePhoneNumber(input);
      assert.strictEqual(result, '+12345678900');
    });

    it('should reject too short numbers', () => {
      assert.throws(() => sanitizePhoneNumber('123'), /Invalid phone number length/);
    });

    it('should reject too long numbers', () => {
      const tooLong = '1'.repeat(25);
      assert.throws(() => sanitizePhoneNumber(tooLong), /Invalid phone number length/);
    });
  });
});
