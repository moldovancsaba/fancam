/**
 * Rate Limiting Middleware
 * Version: 1.7.1
 * 
 * Implements token bucket algorithm for API rate limiting.
 * 
 * Why this module exists:
 * - Prevents abuse and DOS attacks on API endpoints
 * - Protects expensive operations (image uploads, database writes)
 * - Ensures fair resource allocation across users
 * - No external dependencies (uses in-memory storage)
 * 
 * Usage:
 * ```typescript
 * export const POST = withErrorHandler(async (request: NextRequest) => {
 *   await checkRateLimit(request, { max: 10, windowMs: 60000 }); // 10 requests per minute
 *   // ... route logic
 * });
 * ```
 * 
 * Why token bucket algorithm:
 * - Allows burst traffic while maintaining average rate
 * - Memory efficient (only stores active users)
 * - Automatic cleanup of expired entries
 * 
 * Production considerations:
 * - For multi-server deployments, use Redis instead of in-memory storage
 * - Set UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN for Upstash (shared limits on Vercel)
 * - Otherwise uses in-memory token buckets (single-instance / dev)
 */

import { NextRequest } from 'next/server';
import { apiError } from './responses';
import type { RateLimitConfig } from './rateLimitTypes';
import { isUpstashRedisConfigured } from './upstash-redis';
import { checkUpstashRateLimit } from './upstash-rate-limit';

export type { RateLimitConfig } from './rateLimitTypes';

/**
 * Token bucket entry for rate limiting
 */
interface TokenBucket {
  /** Number of tokens remaining */
  tokens: number;
  /** Timestamp of last refill */
  lastRefill: number;
}

/**
 * In-memory storage for rate limit buckets
 * 
 * Why: Simple and fast for single-server deployments
 * Production: Replace with Redis for distributed systems
 */
const buckets = new Map<string, TokenBucket>();

/**
 * Default rate limit configurations for different endpoint types
 */
export const RATE_LIMITS = {
  // Authentication endpoints (strict)
  AUTH: { max: 5, windowMs: 15 * 60 * 1000 }, // 5 requests per 15 minutes
  
  // Write operations (moderate)
  WRITE: { max: 30, windowMs: 60 * 1000 }, // 30 requests per minute
  
  // Image uploads (strict - expensive operation)
  UPLOAD: { max: 10, windowMs: 60 * 1000 }, // 10 uploads per minute
  
  // Read operations (permissive)
  READ: { max: 100, windowMs: 60 * 1000 }, // 100 requests per minute
  
  // Admin operations (moderate)
  ADMIN: { max: 50, windowMs: 60 * 1000 }, // 50 requests per minute

  // Slideshow play-count bumps (public; generous for multi-slide batches)
  SLIDESHOW_PLAYED: { max: 200, windowMs: 60 * 1000 },

  /** Public playlist generation (polls often; cap per IP per route path) */
  SLIDESHOW_PLAYLIST: { max: 180, windowMs: 60 * 1000 },

  /** Rolling-buffer next slide (same rough budget as playlist) */
  SLIDESHOW_NEXT: { max: 180, windowMs: 60 * 1000 },

  /** Public slideshow layout JSON (infrequent vs playlist polling) */
  SLIDESHOW_LAYOUT_GET: { max: 120, windowMs: 60 * 1000 },

  /** OAuth login start (/api/auth/login) — curb redirect storms per IP */
  LOGIN_INIT: { max: 25, windowMs: 15 * 60 * 1000 },
} as const;

/**
 * Extract identifier from request (IP address)
 * 
 * Why: Uses IP as identifier to track rate limits per client
 * Fallback: Uses 'unknown' if IP cannot be determined
 * 
 * Note: In production behind proxy/CDN, use X-Forwarded-For or CF-Connecting-IP
 */
function getClientIdentifier(request: NextRequest): string {
  // Try X-Forwarded-For header first (when behind proxy)
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  
  // Try X-Real-IP header
  const realIp = request.headers.get('x-real-ip');
  if (realIp) {
    return realIp;
  }
  
  // Try CF-Connecting-IP (Cloudflare)
  const cfIp = request.headers.get('cf-connecting-ip');
  if (cfIp) {
    return cfIp;
  }
  
  // Fallback to unknown (should not happen in production)
  return 'unknown';
}

/** Bucket key uses pathname + client so different query strings share the same limit. */
function rateLimitBucketKey(request: NextRequest, identifier: string): string {
  return `${request.nextUrl.pathname}:${identifier}`;
}

/**
 * Refill tokens in bucket based on elapsed time
 * 
 * @param bucket - Token bucket to refill
 * @param config - Rate limit configuration
 * @returns Updated bucket with refilled tokens
 * 
 * Why: Token bucket algorithm allows burst traffic while maintaining average rate
 * 
 * Algorithm:
 * 1. Calculate time elapsed since last refill
 * 2. Calculate tokens to add based on elapsed time
 * 3. Cap tokens at maximum configured limit
 * 4. Update last refill timestamp
 */
function refillBucket(bucket: TokenBucket, config: RateLimitConfig): TokenBucket {
  const now = Date.now();
  const elapsedMs = now - bucket.lastRefill;
  
  // Calculate tokens to add based on elapsed time
  // Tokens refill at rate of max/windowMs per millisecond
  const tokensToAdd = (elapsedMs / config.windowMs) * config.max;
  
  return {
    tokens: Math.min(config.max, bucket.tokens + tokensToAdd),
    lastRefill: now,
  };
}

/**
 * Check rate limit for request and consume token
 * 
 * @param request - Incoming HTTP request
 * @param config - Rate limit configuration
 * @throws NextResponse with 429 Too Many Requests if limit exceeded
 * 
 * Why: Centralized rate limiting that can be called from any route handler
 * 
 * How it works:
 * 1. Extract client identifier (IP address)
 * 2. Get or create token bucket for client
 * 3. Refill tokens based on elapsed time
 * 4. Check if tokens available
 * 5. Consume token and update bucket
 * 6. Throw error if no tokens available
 */
export async function checkRateLimit(
  request: NextRequest,
  config: RateLimitConfig
): Promise<void> {
  const identifier = config.keyGenerator
    ? config.keyGenerator(request)
    : getClientIdentifier(request);

  const key = rateLimitBucketKey(request, identifier);

  if (isUpstashRedisConfigured()) {
    await checkUpstashRateLimit(
      key,
      config.max,
      config.windowMs,
      config.message
    );
    return;
  }

  // Get or create bucket for this client
  let bucket = buckets.get(key);
  
  if (!bucket) {
    // First request from this client - create new bucket with full tokens
    bucket = {
      tokens: config.max,
      lastRefill: Date.now(),
    };
  } else {
    // Refill tokens based on elapsed time
    bucket = refillBucket(bucket, config);
  }
  
  // Check if tokens available
  if (bucket.tokens < 1) {
    // Rate limit exceeded
    const message = config.message || 'Too many requests, please try again later';
    throw apiError(message, 429);
  }
  
  // Consume one token
  bucket.tokens -= 1;
  
  // Update bucket in storage
  buckets.set(key, bucket);
  
  // Set rate limit headers for client transparency
  const headers = {
    'X-RateLimit-Limit': config.max.toString(),
    'X-RateLimit-Remaining': Math.floor(bucket.tokens).toString(),
    'X-RateLimit-Reset': new Date(bucket.lastRefill + config.windowMs).toISOString(),
  };
  
  // Note: Headers are informational only; actual rate limit is enforced by throwing error
  // In production, consider adding headers to successful responses as well
}

/**
 * Cleanup expired buckets to prevent memory leak
 * 
 * Why: Token buckets accumulate over time for all clients
 * Solution: Periodically remove buckets that haven't been accessed recently
 * 
 * This should be called periodically (e.g., every hour) in production
 * For serverless deployments, this is less critical as instances are short-lived
 * 
 * @param maxAge - Maximum age in milliseconds before bucket is removed
 */
export function cleanupBuckets(maxAge: number = 60 * 60 * 1000): void {
  if (isUpstashRedisConfigured()) {
    return;
  }
  const now = Date.now();
  let removed = 0;
  
  for (const [key, bucket] of buckets.entries()) {
    const age = now - bucket.lastRefill;
    
    if (age > maxAge) {
      buckets.delete(key);
      removed++;
    }
  }
  
  if (removed > 0) {
    console.log(`✓ Cleaned up ${removed} expired rate limit buckets`);
  }
}

/**
 * Get current rate limit status for a request (for debugging)
 * 
 * @param request - Incoming HTTP request
 * @param config - Rate limit configuration
 * @returns Current bucket status or null if not found
 */
export function getRateLimitStatus(
  request: NextRequest,
  config: RateLimitConfig
): { tokens: number; resetAt: Date } | null {
  if (isUpstashRedisConfigured()) {
    return null;
  }
  const identifier = config.keyGenerator
    ? config.keyGenerator(request)
    : getClientIdentifier(request);

  const key = rateLimitBucketKey(request, identifier);
  const bucket = buckets.get(key);
  
  if (!bucket) {
    return null;
  }
  
  const refilled = refillBucket(bucket, config);
  
  return {
    tokens: Math.floor(refilled.tokens),
    resetAt: new Date(refilled.lastRefill + config.windowMs),
  };
}

/**
 * Reset rate limit for a specific client (admin use only)
 * 
 * @param identifier - Client identifier (IP address)
 * @param url - Optional pathname prefix to reset (bucket keys are `pathname:clientIp`)
 * @returns Number of buckets reset
 * 
 * Why: Allows admins to unblock legitimate users who hit rate limits
 */
export function resetRateLimit(identifier: string, url?: string): number {
  if (isUpstashRedisConfigured()) {
    return 0;
  }
  let reset = 0;
  
  for (const [key] of buckets.entries()) {
    const matchesIdentifier = key.endsWith(`:${identifier}`);
    const matchesUrl = !url || key.startsWith(url);
    
    if (matchesIdentifier && matchesUrl) {
      buckets.delete(key);
      reset++;
    }
  }
  
  return reset;
}

// Schedule periodic cleanup (every hour)
// Note: In serverless environments, this may not run reliably
// Consider using a scheduled function or cron job instead
if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    cleanupBuckets();
  }, 60 * 60 * 1000); // Every hour
}
