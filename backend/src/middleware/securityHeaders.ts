import { Request, Response, NextFunction } from 'express';
import { appConfig } from '../config.js';

/**
 * Security headers middleware
 * Implements comprehensive security headers including CSP, HSTS, X-Frame-Options, etc.
 */
export const securityHeadersMiddleware = (
  _request: Request,
  response: Response,
  next: NextFunction
): void => {
  // Content Security Policy
  // Restricts resource loading to prevent XSS attacks
  const isDev = process.env.NODE_ENV !== 'production';
  const scriptSrc = isDev
    ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'" // unsafe-inline/eval needed for React dev only
    : "script-src 'self'";
  const styleSrc = isDev
    ? "style-src 'self' 'unsafe-inline'" // unsafe-inline needed for styled components in dev
    : "style-src 'self'";
  const cspDirectives = [
    "default-src 'self'",
    scriptSrc,
    styleSrc,
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    "connect-src 'self' " + appConfig.corsOrigins.join(' '),
    "media-src 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'", // Equivalent to X-Frame-Options: DENY
    "base-uri 'self'",
    "form-action 'self'",
    "upgrade-insecure-requests",
  ].join('; ');

  response.setHeader('Content-Security-Policy', cspDirectives);

  // Strict-Transport-Security (HSTS)
  // Forces HTTPS connections for 1 year, including subdomains
  response.setHeader(
    'Strict-Transport-Security',
    'max-age=31536000; includeSubDomains; preload'
  );

  // X-Frame-Options
  // Prevents clickjacking attacks by disallowing iframe embedding
  response.setHeader('X-Frame-Options', 'DENY');

  // X-Content-Type-Options
  // Prevents MIME type sniffing
  response.setHeader('X-Content-Type-Options', 'nosniff');

  // X-XSS-Protection
  // Enables browser XSS protection (legacy, but still useful)
  response.setHeader('X-XSS-Protection', '1; mode=block');

  // Referrer-Policy
  // Controls how much referrer information is sent
  response.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

  // Permissions-Policy
  // Restricts browser features and APIs
  response.setHeader(
    'Permissions-Policy',
    'geolocation=(), microphone=(), camera=(), payment=(), usb=(), magnetometer=(), gyroscope=()'
  );

  // X-Permitted-Cross-Domain-Policies
  // Restricts Adobe Flash and PDF cross-domain requests
  response.setHeader('X-Permitted-Cross-Domain-Policies', 'none');

  // X-Download-Options
  // Prevents IE from executing downloads in site context
  response.setHeader('X-Download-Options', 'noopen');

  next();
};
