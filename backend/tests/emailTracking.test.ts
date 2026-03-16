import { describe, it, expect } from '@jest/globals';
import {
  generateTrackingPixelUrl,
  generateClickTrackingUrl,
  wrapLinksWithTracking,
  insertTrackingPixel,
} from '../src/services/emailTracking';

describe('Email Tracking Service', () => {
  const baseUrl = 'https://example.com';
  const trackingId = 'test-tracking-id-123';

  describe('Tracking Pixel', () => {
    it('should generate tracking pixel URL', () => {
      const url = generateTrackingPixelUrl(trackingId, baseUrl);

      expect(url).toBe(`${baseUrl}/api/email-tracking/pixel/${trackingId}.png`);
    });

    it('should insert tracking pixel into HTML', () => {
      const html = '<html><body><p>Test email</p></body></html>';
      const result = insertTrackingPixel(html, trackingId, baseUrl);

      expect(result).toContain('<img src=');
      expect(result).toContain(`/api/email-tracking/pixel/${trackingId}.png`);
      expect(result).toContain('width="1"');
      expect(result).toContain('height="1"');
    });

    it('should insert pixel before closing body tag', () => {
      const html = '<html><body><p>Test</p></body></html>';
      const result = insertTrackingPixel(html, trackingId, baseUrl);

      expect(result.indexOf('<img')).toBeLessThan(result.indexOf('</body>'));
    });

    it('should append pixel if no body tag', () => {
      const html = '<p>Test email</p>';
      const result = insertTrackingPixel(html, trackingId, baseUrl);

      expect(result).toContain('<img src=');
      expect(result.endsWith('.png" width="1" height="1" alt="" style="display:none;" />')).toBe(
        true
      );
    });
  });

  describe('Click Tracking', () => {
    it('should generate click tracking URL', () => {
      const originalUrl = 'https://example.com/page';
      const url = generateClickTrackingUrl(trackingId, originalUrl, baseUrl);

      expect(url).toContain(`${baseUrl}/api/email-tracking/click/${trackingId}/`);
      expect(url).toContain(Buffer.from(originalUrl).toString('base64url'));
    });

    it('should wrap links with tracking URLs', () => {
      const html = '<a href="https://example.com/page">Click here</a>';
      const result = wrapLinksWithTracking(html, trackingId, baseUrl);

      expect(result).toContain('/api/email-tracking/click/');
      expect(result).not.toContain('href="https://example.com/page"');
    });

    it('should wrap multiple links', () => {
      const html = `
        <a href="https://example.com/page1">Link 1</a>
        <a href="https://example.com/page2">Link 2</a>
      `;
      const result = wrapLinksWithTracking(html, trackingId, baseUrl);

      const matches = result.match(/\/api\/email-tracking\/click\//g);
      expect(matches).toHaveLength(2);
    });

    it('should skip mailto links', () => {
      const html = '<a href="mailto:test@example.com">Email us</a>';
      const result = wrapLinksWithTracking(html, trackingId, baseUrl);

      expect(result).toContain('href="mailto:test@example.com"');
      expect(result).not.toContain('/api/email-tracking/click/');
    });

    it('should skip tel links', () => {
      const html = '<a href="tel:+1234567890">Call us</a>';
      const result = wrapLinksWithTracking(html, trackingId, baseUrl);

      expect(result).toContain('href="tel:+1234567890"');
      expect(result).not.toContain('/api/email-tracking/click/');
    });

    it('should skip already tracked links', () => {
      const html = `<a href="${baseUrl}/api/email-tracking/click/abc/def">Already tracked</a>`;
      const result = wrapLinksWithTracking(html, trackingId, baseUrl);

      expect(result).toBe(html);
    });

    it('should handle links with attributes', () => {
      const html = '<a class="btn" href="https://example.com" target="_blank">Click</a>';
      const result = wrapLinksWithTracking(html, trackingId, baseUrl);

      expect(result).toContain('class="btn"');
      expect(result).toContain('target="_blank"');
      expect(result).toContain('/api/email-tracking/click/');
    });
  });

  describe('Combined Tracking', () => {
    it('should add both pixel and link tracking', () => {
      const html = `
        <html>
          <body>
            <p>Hello!</p>
            <a href="https://example.com/page">Click here</a>
          </body>
        </html>
      `;

      let result = wrapLinksWithTracking(html, trackingId, baseUrl);
      result = insertTrackingPixel(result, trackingId, baseUrl);

      expect(result).toContain('/api/email-tracking/click/');
      expect(result).toContain('/api/email-tracking/pixel/');
    });
  });
});
