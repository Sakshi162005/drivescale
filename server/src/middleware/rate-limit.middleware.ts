import { Response, NextFunction } from 'express';
import { getRedisClient, isRedisReady } from '../config/redis.js';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { sendError } from '../utils/response.js';
import { AuthenticatedRequest } from './auth.middleware.js';

export interface RateLimitOptions {
  windowMs: number;
  max: number;
  prefix: string;
  message?: string;
  keyGenerator?: (req: AuthenticatedRequest) => string;
  skip?: (req: AuthenticatedRequest) => boolean;
  failClosed?: boolean; // If true, reject requests with 503 on Redis outage; if false, use local memory fallback
}

// In-memory fallback bucket for Redis outages
interface MemoryBucket {
  count: number;
  expiresAt: number;
}
const memoryFallbackStore = new Map<string, MemoryBucket>();

// Periodic memory fallback cleanup (every 60s)
setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of memoryFallbackStore.entries()) {
    if (bucket.expiresAt <= now) {
      memoryFallbackStore.delete(key);
    }
  }
}, 60000).unref();

/**
 * Atomic Lua script to increment counter and set window expiration in a single round-trip
 */
const RATE_LIMIT_LUA_SCRIPT = `
local current = redis.call('INCR', KEYS[1])
if current == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
local ttl = redis.call('PTTL', KEYS[1])
return {current, ttl}
`;

/**
 * Creates a distributed rate limiting middleware backed by Redis with atomic counters and memory fallback
 */
export const createRateLimiter = (options: RateLimitOptions) => {
  const {
    windowMs,
    max,
    prefix,
    message = 'Too many requests. Please try again later.',
    failClosed = false,
  } = options;

  return async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    // Check if request should skip rate limiting (e.g. health checks or options preflight)
    if (options.skip && options.skip(req)) {
      return next();
    }
    if (req.method === 'OPTIONS') {
      return next();
    }

    // Determine identifier: authenticated user ID takes precedence, fallback to client IP
    let identifier: string;
    if (options.keyGenerator) {
      identifier = options.keyGenerator(req);
    } else if (req.user?._id) {
      identifier = `user:${req.user._id.toString()}`;
    } else {
      const clientIp = req.ip || req.socket.remoteAddress || '127.0.0.1';
      identifier = `ip:${clientIp}`;
    }

    const rateLimitKey = `drivescale:ratelimit:${prefix}:${identifier}`;

    let current: number;
    let ttlMs: number;

    const redisAvailable = isRedisReady();

    if (redisAvailable) {
      try {
        const client = getRedisClient();
        const result = (await client.eval(
          RATE_LIMIT_LUA_SCRIPT,
          1,
          rateLimitKey,
          windowMs.toString()
        )) as [number, number];

        current = Number(result[0]);
        ttlMs = Math.max(0, Number(result[1]));
      } catch (redisError) {
        logger.warn(
          { key: rateLimitKey, err: redisError instanceof Error ? redisError.message : 'Unknown' },
          'Redis rate limiter failed; falling back to local memory rate limiting'
        );

        if (failClosed) {
          sendError(res, 'SERVICE_UNAVAILABLE', 'Rate limiting service temporarily unavailable', 503);
          return;
        }

        // Local memory fallback
        const memoryResult = handleMemoryFallback(rateLimitKey, windowMs);
        current = memoryResult.current;
        ttlMs = memoryResult.ttlMs;
      }
    } else {
      // Redis is not ready / disconnected
      logger.warn(
        { key: rateLimitKey },
        'Redis offline; enforcing local instance in-memory rate limiting'
      );

      if (failClosed) {
        sendError(res, 'SERVICE_UNAVAILABLE', 'Rate limiting service temporarily unavailable', 503);
        return;
      }

      const memoryResult = handleMemoryFallback(rateLimitKey, windowMs);
      current = memoryResult.current;
      ttlMs = memoryResult.ttlMs;
    }

    // Set standard rate limit headers
    const remaining = Math.max(0, max - current);
    const resetTimestamp = Math.ceil((Date.now() + ttlMs) / 1000);
    const retryAfterSec = Math.max(1, Math.ceil(ttlMs / 1000));

    res.setHeader('RateLimit-Limit', max);
    res.setHeader('RateLimit-Remaining', remaining);
    res.setHeader('RateLimit-Reset', resetTimestamp);

    if (current > max) {
      res.setHeader('Retry-After', retryAfterSec);

      logger.warn(
        { key: rateLimitKey, current, max, retryAfterSec },
        'Rate limit exceeded'
      );

      sendError(
        res,
        'TOO_MANY_REQUESTS',
        message,
        429,
        { retryAfter: retryAfterSec }
      );
      return;
    }

    next();
  };
};

/**
 * Fallback rate limiting mechanism in local memory when Redis is unreachable
 */
const handleMemoryFallback = (key: string, windowMs: number): { current: number; ttlMs: number } => {
  const now = Date.now();
  const bucket = memoryFallbackStore.get(key);

  if (!bucket || bucket.expiresAt <= now) {
    const newBucket: MemoryBucket = {
      count: 1,
      expiresAt: now + windowMs,
    };
    memoryFallbackStore.set(key, newBucket);
    return { current: 1, ttlMs: windowMs };
  }

  bucket.count += 1;
  const ttlMs = Math.max(0, bucket.expiresAt - now);
  return { current: bucket.count, ttlMs };
};

// Preset rate limiters according to AGENTS.md requirements:

/**
 * Auth rate limiter for login and registration endpoints (e.g. 5-10 requests / minute / IP)
 */
export const authRateLimiter = createRateLimiter({
  prefix: 'auth',
  windowMs: env.RATE_LIMIT_AUTH_WINDOW_MS,
  max: env.RATE_LIMIT_AUTH_LIMIT,
  message: 'Too many authentication attempts. Please try again after some time.',
  keyGenerator: (req) => {
    // Authenticated user ID if present, otherwise client IP
    if (req.user?._id) return `user:${req.user._id.toString()}`;
    const ip = req.ip || req.socket.remoteAddress || '127.0.0.1';
    return `ip:${ip}`;
  },
});

/**
 * Upload initialization rate limiter (e.g. 20 requests / minute / user)
 */
export const uploadInitRateLimiter = createRateLimiter({
  prefix: 'upload-init',
  windowMs: env.RATE_LIMIT_UPLOAD_INIT_WINDOW_MS,
  max: env.RATE_LIMIT_UPLOAD_INIT_LIMIT,
  message: 'Too many upload initialization requests. Please wait before creating new uploads.',
});

/**
 * Chunk upload rate limiter (e.g. 120 requests / minute / user)
 * Provides high enough throughput for 3-worker chunk uploads while preventing DoS flooding
 */
export const chunkUploadRateLimiter = createRateLimiter({
  prefix: 'upload-chunk',
  windowMs: 60000,
  max: 120,
  message: 'Chunk upload rate limit exceeded. Please throttle concurrent uploads.',
});

/**
 * General API rate limiter for all other /api/v1 endpoints (e.g. 100 requests / minute / user or IP)
 */
export const generalRateLimiter = createRateLimiter({
  prefix: 'general',
  windowMs: env.RATE_LIMIT_GENERAL_WINDOW_MS,
  max: env.RATE_LIMIT_GENERAL_LIMIT,
  skip: (req) => req.originalUrl?.includes('/health') || req.path?.includes('/health'), // Do not throttle health probes
});
