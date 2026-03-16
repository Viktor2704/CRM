import helmet from 'helmet';
import { appConfig } from '../config.js';

const isDev = process.env.NODE_ENV !== 'production';

/**
 * Security headers middleware powered by helmet
 * Implements CSP, HSTS, X-Frame-Options, and other security headers
 */
export const securityHeadersMiddleware = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: isDev ? ["'self'", "'unsafe-inline'", "'unsafe-eval'"] : ["'self'"],
      styleSrc: isDev ? ["'self'", "'unsafe-inline'"] : ["'self'"],
      imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
      fontSrc: ["'self'", 'data:'],
      connectSrc: ["'self'", ...appConfig.corsOrigins],
      mediaSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      upgradeInsecureRequests: [],
    },
  },
  strictTransportSecurity: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true,
  },
  frameguard: { action: 'deny' },
  noSniff: true,
  xssFilter: true,
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  permittedCrossDomainPolicies: { permittedPolicies: 'none' },
  dnsPrefetchControl: { allow: false },
});
