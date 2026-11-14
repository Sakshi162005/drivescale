import { Router, Request, Response } from 'express';
import { sendSuccess, sendError } from '../utils/response.js';
import { getDatabaseStatus } from '../config/database.js';
import { getRedisStatus } from '../config/redis.js';
import { getStorageStatus } from '../config/storage.js';

const router = Router();

export interface HealthCheckData {
  status: 'healthy' | 'degraded' | 'unhealthy';
  version: string;
  uptime: number;
  timestamp: string;
  services: {
    database: {
      status: string;
    };
    redis: {
      status: string;
    };
    storage?: {
      status: string;
    };
  };
}

/**
 * Liveness probe: returns 200 as long as the Express process is running
 */
router.get('/live', (_req: Request, res: Response) => {
  res.status(200).json({ status: 'alive', uptime: Math.floor(process.uptime()) });
});

/**
 * Readiness probe: checks critical dependencies required to serve requests
 */
router.get('/ready', async (_req: Request, res: Response) => {
  const dbStatus = getDatabaseStatus();
  const isDbHealthy = dbStatus === 'connected';

  if (!isDbHealthy) {
    return sendError(res, 'SERVICE_UNAVAILABLE', 'Primary database is not ready', 503);
  }

  return sendSuccess(res, { ready: true, database: dbStatus }, 200);
});

/**
 * Full health check endpoint reporting detailed component status
 */
router.get('/', async (_req: Request, res: Response) => {
  const dbStatus = getDatabaseStatus();
  const redisStatus = await getRedisStatus();
  const storageStatus = await getStorageStatus();

  const isDbHealthy = dbStatus === 'connected';
  const isRedisHealthy = redisStatus === 'connected';

  let overallStatus: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
  if (!isDbHealthy && !isRedisHealthy) {
    overallStatus = 'unhealthy';
  } else if (!isDbHealthy || !isRedisHealthy) {
    overallStatus = 'degraded';
  }

  const healthData: HealthCheckData = {
    status: overallStatus,
    version: '0.1.0',
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
    services: {
      database: {
        status: dbStatus,
      },
      redis: {
        status: redisStatus,
      },
      storage: {
        status: storageStatus,
      },
    },
  };

  sendSuccess(res, healthData, 200);
});

export const healthRoutes = router;
