import type { NextRequest } from 'next/server';

/**
 * Rate limit configuration (shared by in-memory and Upstash backends).
 */
export interface RateLimitConfig {
  max: number;
  windowMs: number;
  keyGenerator?: (request: NextRequest) => string;
  message?: string;
}
