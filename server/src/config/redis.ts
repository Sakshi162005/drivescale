import { Redis, RedisOptions } from 'ioredis';
import { env } from './env.js';
import { logger } from '../utils/logger.js';

let redisClient: Redis | null = null;
let redisStatus: 'connected' | 'connecting' | 'disconnected' | 'ready' = 'disconnected';

/**
 * Sanitizes Redis connection URL for secure logging (masks password)
 */
const sanitizeRedisUrl = (url: string): string => {
  try {
    const parsed = new URL(url);
    if (parsed.password) {
      parsed.password = '******';
    }
    return parsed.toString();
  } catch {
    return 'redis://[custom]';
  }
};

/**
 * Creates or retrieves the singleton Redis client
 */
export const getRedisClient = (): Redis => {
  if (!redisClient) {
    const redisOptions: RedisOptions = {
      lazyConnect: true,
      connectTimeout: 5000,
      commandTimeout: 3000,
      enableReadyCheck: true,
      maxRetriesPerRequest: 3,
      retryStrategy: (times) => {
        if (times > 5) {
          logger.warn('Redis retry limit reached (5 attempts), pausing reconnection');
          return null;
        }
        const delay = Math.min(times * 200, 2000);
        return delay;
      },
    };

    redisClient = new Redis(env.REDIS_URL, redisOptions);

    redisClient.on('connect', () => {
      redisStatus = 'connected';
      logger.info({ url: sanitizeRedisUrl(env.REDIS_URL) }, 'Redis socket connected');
    });

    redisClient.on('ready', () => {
      redisStatus = 'ready';
      logger.info('Redis connection ready to accept commands');
    });

    redisClient.on('error', (err: Error) => {
      redisStatus = 'disconnected';
      logger.error({ err: err.message }, 'Redis client error');
    });

    redisClient.on('close', () => {
      redisStatus = 'disconnected';
      logger.warn('Redis connection closed');
    });

    redisClient.on('reconnecting', (time: number) => {
      redisStatus = 'connecting';
      logger.info({ delayMs: time }, 'Redis reconnecting...');
    });

    redisClient.on('end', () => {
      redisStatus = 'disconnected';
      logger.info('Redis client ended');
    });
  }

  return redisClient;
};

/**
 * Injects a custom or mock Redis client (primarily for testing and dependency injection)
 */
export const setRedisClient = (client: Redis | null): void => {
  redisClient = client;
  if (client) {
    redisStatus = 'ready';
    const statusHolder = client as unknown as { status?: string };
    if (!statusHolder.status) {
      statusHolder.status = 'ready';
    }
  } else {
    redisStatus = 'disconnected';
  }
};

/**
 * Connects to Redis during application startup
 */
export const connectRedis = async (): Promise<boolean> => {
  const client = getRedisClient();
  try {
    if (client.status === 'wait') {
      await client.connect();
    }
    return true;
  } catch (err) {
    logger.error({ err: err instanceof Error ? err.message : 'Unknown error' }, 'Failed to connect to Redis during startup');
    return false;
  }
};

/**
 * Disconnects Redis cleanly during shutdown
 */
export const disconnectRedis = async (): Promise<void> => {
  if (redisClient) {
    try {
      await redisClient.quit();
      logger.info('Redis connection closed gracefully');
    } catch {
      redisClient.disconnect();
    } finally {
      redisClient = null;
      redisStatus = 'disconnected';
    }
  }
};

/**
 * Returns current internal connection state string
 */
export const getRedisConnectionState = (): string => {
  return redisStatus;
};

/**
 * Checks if Redis is ready and reachable via PING
 */
export const getRedisStatus = async (): Promise<'connected' | 'disconnected'> => {
  if (!redisClient) return 'disconnected';
  try {
    const res = await redisClient.ping();
    return res === 'PONG' ? 'connected' : 'disconnected';
  } catch {
    return 'disconnected';
  }
};

/**
 * Helper to check if client is ready for commands
 */
export const isRedisReady = (): boolean => {
  if (!redisClient) return false;
  if (redisClient.status) {
    return redisClient.status === 'ready' || redisClient.status === 'connect';
  }
  return redisStatus === 'ready' || redisStatus === 'connected';
};
