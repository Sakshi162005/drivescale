import { Router, Request, Response } from 'express';
import { sendSuccess } from '../utils/response.js';
import { getDatabaseStatus } from '../config/database.js';
import { getRedisStatus } from '../config/redis.js';

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
  };
}

router.get('/', async (_req: Request, res: Response) => {
  const dbStatus = getDatabaseStatus();
  const redisStatus = await getRedisStatus();

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
    },
  };

  sendSuccess(res, healthData, 200);
});

export const healthRoutes = router;
