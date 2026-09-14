import { Redis } from 'ioredis';
import { env } from './env.js';
import { logger } from '../utils/logger.js';

let redisClient: Redis | null = null;
let redisStatus: 'connected' | 'connecting' | 'disconnected' | 'ready' = 'disconnected';

export const getRedisClient = (): Redis => {
  if (!redisClient) {
    redisClient = new Redis(env.REDIS_URL, {
      lazyConnect: true,
      maxRetriesPerRequest: 3,
      retryStrategy: (times) => {
        if (times > 5) {
          logger.warn('Redis retry limit reached, backing off');
          return null;
        }
        return Math.min(times * 200, 2000);
      },
    });

    redisClient.on('connect', () => {
      redisStatus = 'connected';
      logger.info('Redis socket connected');
    });

    redisClient.on('ready', () => {
      redisStatus = 'ready';
      logger.info('Redis connection ready');
    });

    redisClient.on('error', (err) => {
      redisStatus = 'disconnected';
      logger.error({ err: err.message }, 'Redis connection error');
    });

    redisClient.on('close', () => {
      redisStatus = 'disconnected';
      logger.warn('Redis connection closed');
    });

    redisClient.on('reconnecting', () => {
      redisStatus = 'connecting';
      logger.info('Redis reconnecting...');
    });
  }

  return redisClient;
};

export const connectRedis = async (): Promise<boolean> => {
  const client = getRedisClient();
  try {
    if (client.status === 'wait') {
      await client.connect();
    }
    return true;
  } catch (err) {
    logger.error({ err }, 'Failed to connect to Redis');
    return false;
  }
};

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

export const getRedisConnectionState = (): string => {
  return redisStatus;
};

export const getRedisStatus = async (): Promise<'connected' | 'disconnected'> => {
  if (!redisClient) return 'disconnected';
  try {
    const res = await redisClient.ping();
    return res === 'PONG' ? 'connected' : 'disconnected';
  } catch {
    return 'disconnected';
  }
};
