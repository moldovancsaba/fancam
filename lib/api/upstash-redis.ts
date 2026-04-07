/**
 * Lazy Upstash Redis REST client when env is set.
 * Used for distributed rate limiting on Vercel (multiple serverless instances).
 */

import { Redis } from '@upstash/redis';

let redis: Redis | null = null;

export function isUpstashRedisConfigured(): boolean {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  return Boolean(url && token);
}

/**
 * Singleton Redis client. Returns null if URL/token are missing (local dev / no Upstash).
 */
export function getUpstashRedis(): Redis | null {
  if (!isUpstashRedisConfigured()) {
    return null;
  }
  if (!redis) {
    redis = Redis.fromEnv();
  }
  return redis;
}
