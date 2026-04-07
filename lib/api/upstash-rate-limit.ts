/**
 * Distributed rate limits via Upstash Redis + @upstash/ratelimit.
 * Falls back is handled in rateLimiter.ts when env vars are unset.
 */

import { createHash } from 'crypto';
import { Ratelimit } from '@upstash/ratelimit';
import { getUpstashRedis } from './upstash-redis';
import { apiError } from './responses';

const limiterCache = new Map<string, Ratelimit>();

function cacheKey(max: number, windowMs: number): string {
  return `${max}:${windowMs}`;
}

function getOrCreateRatelimit(max: number, windowMs: number): Ratelimit {
  const key = cacheKey(max, windowMs);
  let rl = limiterCache.get(key);
  if (rl) {
    return rl;
  }
  const redis = getUpstashRedis();
  if (!redis) {
    throw new Error('Upstash Redis not configured');
  }
  rl = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(max, `${windowMs} ms`),
    prefix: 'camera:rl',
    analytics: false,
  });
  limiterCache.set(key, rl);
  return rl;
}

/** Stable identifier for Upstash (avoids Redis key length / character issues). */
export function hashRateLimitBucketKey(bucketKey: string): string {
  return createHash('sha256').update(bucketKey, 'utf8').digest('hex');
}

export async function checkUpstashRateLimit(
  bucketKey: string,
  max: number,
  windowMs: number,
  message?: string
): Promise<void> {
  const rl = getOrCreateRatelimit(max, windowMs);
  const id = hashRateLimitBucketKey(bucketKey);
  const result = await rl.limit(id);

  if (!result.success) {
    throw apiError(message || 'Too many requests, please try again later', 429);
  }

  void result.pending.catch(() => {
    /* analytics disabled; keep promise from surfacing as unhandled */
  });
}
