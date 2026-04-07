/**
 * API Utilities Index
 * Version: 1.7.1
 * 
 * Centralized export of all API utilities for easy importing.
 * 
 * Why this module exists:
 * - Single import point for all API utilities
 * - Makes refactoring easier (change imports in one place)
 * - Cleaner import statements in route files
 * 
 * Usage:
 * ```typescript
 * import {
 *   withErrorHandler,
 *   requireAuth,
 *   requireAdmin,
 *   apiSuccess,
 *   apiError,
 *   validateRequiredFields,
 *   parsePaginationParams
 * } from '@/lib/api';
 * ```
 */

// Response helpers
export {
  apiSuccess,
  apiError,
  apiUnauthorized,
  apiForbidden,
  apiBadRequest,
  apiNotFound,
  apiCreated,
  apiNoContent,
  apiPaginated,
} from './responses';

// Middleware functions
export {
  requireAuth,
  requireAdmin,
  optionalAuth,
  validateRequiredFields,
  parsePaginationParams,
} from './middleware';

// Error handling
export {
  withErrorHandler,
  safeAsync,
  dbOperation,
} from './withErrorHandler';

// Rate limiting (v1.7.1 - Phase 7)
export {
  checkRateLimit,
  RATE_LIMITS,
  cleanupBuckets,
  getRateLimitStatus,
  resetRateLimit,
  type RateLimitConfig,
} from './rateLimiter';

export { isUpstashRedisConfigured } from './upstash-redis';

export { blockDangerousApiInProduction } from './production-guard';
