import rateLimit from 'express-rate-limit';
import { ApiError } from '../errors.js';

// General API rate limiter - 100 requests per 15 minutes per IP
export const apiRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_request, _response, _next) => {
    throw new ApiError(429, 'RATE_LIMIT_EXCEEDED', 'Too many requests, please try again later');
  },
  skip: (request) => {
    // Skip rate limiting for health checks
    return request.path === '/health' || request.path === '/api/health';
  },
});

// Strict rate limiter for authentication endpoints - 5 requests per 15 minutes per IP
export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_request, _response, _next) => {
    throw new ApiError(429, 'AUTH_RATE_LIMIT_EXCEEDED', 'Too many authentication attempts, please try again later');
  },
});

// Moderate rate limiter for sensitive operations - 20 requests per 15 minutes per IP
export const sensitiveOperationRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_request, _response, _next) => {
    throw new ApiError(429, 'RATE_LIMIT_EXCEEDED', 'Too many requests for this operation, please try again later');
  },
});

// File download rate limiter - 60 requests per 15 minutes per IP
export const fileDownloadRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_request, _response, _next) => {
    throw new ApiError(429, 'DOWNLOAD_RATE_LIMIT_EXCEEDED', 'Too many file download requests, please try again later');
  },
});

// File upload rate limiter - 10 uploads per 15 minutes per IP
export const uploadRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_request, _response, _next) => {
    throw new ApiError(429, 'UPLOAD_RATE_LIMIT_EXCEEDED', 'Too many file uploads, please try again later');
  },
});
