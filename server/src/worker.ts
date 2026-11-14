import fs from 'fs';
import path from 'path';
import os from 'os';
import { connectDatabase, disconnectDatabase } from './config/database.js';
import { connectRedis, disconnectRedis } from './config/redis.js';
import { initStorage } from './config/storage.js';
import { env } from './config/env.js';
import { logger } from './utils/logger.js';
import {
  createCleanupWorker,
  closeCleanupWorker,
} from './workers/cleanup.worker.js';
import {
  createFileWorker,
  closeFileWorker,
} from './workers/file.worker.js';
import {
  createNotificationWorker,
  closeNotificationWorker,
} from './workers/notification.worker.js';
import {
  getCleanupQueue,
  closeCleanupQueue,
  CLEANUP_JOB_NAMES,
} from './queues/cleanup.queue.js';
import { closeFileQueue } from './queues/file.queue.js';
import { closeNotificationQueue } from './queues/notification.queue.js';

let isShuttingDown = false;

export const startWorkerProcess = async (): Promise<void> => {
  logger.info('Starting DriveScale Background Worker process...');

  try {
    // 1. Connect database (MongoDB)
    await connectDatabase();

    // 2. Connect Redis
    const redisOk = await connectRedis();
    if (!redisOk) {
      logger.error('Failed to establish Redis connection for Background Worker');
      process.exit(1);
    }

    // 3. Initialize MinIO storage
    await initStorage();

    // 4. Initialize BullMQ workers
    const cleanupWorker = createCleanupWorker();
    const fileWorker = createFileWorker();
    const notificationWorker = createNotificationWorker();

    // 5. Schedule periodic repeatable cleanup job for expired upload sessions and expired trash
    const cleanupQueue = getCleanupQueue();
    await cleanupQueue.upsertJobScheduler(
      'periodic-expired-upload-cleanup',
      { every: env.BULLMQ_CLEANUP_INTERVAL_MS },
      {
        name: CLEANUP_JOB_NAMES.CLEANUP_EXPIRED_UPLOAD,
        data: { batchSize: 50, triggeredAt: new Date().toISOString() },
        opts: { removeOnComplete: true },
      }
    );

    await cleanupQueue.upsertJobScheduler(
      'periodic-trash-cleanup',
      { every: env.BULLMQ_CLEANUP_INTERVAL_MS },
      {
        name: CLEANUP_JOB_NAMES.CLEANUP_TRASH,
        data: {
          olderThanDays: env.TRASH_RETENTION_DAYS,
          batchSize: env.TRASH_CLEANUP_BATCH_SIZE,
        },
        opts: { removeOnComplete: true },
      }
    );

    // 6. Start heartbeat file writes for container health checks
    const heartbeatPath =
      process.env.WORKER_HEARTBEAT_FILE ||
      path.join(os.tmpdir(), 'drivescale-worker-heartbeat');
    const updateHeartbeat = () => {
      try {
        fs.writeFileSync(
          heartbeatPath,
          JSON.stringify({ timestamp: Date.now(), status: 'healthy' }),
          'utf-8'
        );
      } catch (err) {
        logger.warn({ err }, 'Failed to write worker heartbeat file');
      }
    };
    updateHeartbeat();
    const heartbeatInterval = setInterval(updateHeartbeat, 10000);
    heartbeatInterval.unref();

    logger.info(
      {
        concurrency: env.BULLMQ_CONCURRENCY,
        queues: [cleanupWorker.name, fileWorker.name, notificationWorker.name],
        cleanupIntervalMs: env.BULLMQ_CLEANUP_INTERVAL_MS,
      },
      'DriveScale Background Worker process is online and ready for jobs'
    );

    // 7. Register graceful shutdown handlers
    const shutdown = async (signal: string) => {
      if (isShuttingDown) return;
      isShuttingDown = true;

      logger.info({ signal }, 'Worker process received shutdown signal. Closing workers...');

      // Force exit timeout
      const forceExitTimeout = setTimeout(() => {
        logger.error('Worker shutdown timeout reached (10s). Forcing exit.');
        process.exit(1);
      }, 10000);
      forceExitTimeout.unref();

      try {
        clearInterval(heartbeatInterval);
        try {
          if (fs.existsSync(heartbeatPath)) fs.unlinkSync(heartbeatPath);
        } catch {
          // Ignore cleanup error
        }

        await Promise.allSettled([
          closeCleanupWorker(),
          closeFileWorker(),
          closeNotificationWorker(),
        ]);

        await Promise.allSettled([
          closeCleanupQueue(),
          closeFileQueue(),
          closeNotificationQueue(),
        ]);

        await disconnectRedis();
        await disconnectDatabase();

        clearTimeout(forceExitTimeout);
        logger.info('Background Worker process exited cleanly');
        process.exit(0);
      } catch (err) {
        logger.error({ err: err instanceof Error ? err.message : 'Unknown' }, 'Error during worker shutdown');
        process.exit(1);
      }
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
  } catch (error) {
    logger.error(
      { err: error instanceof Error ? error.message : 'Unknown error' },
      'Fatal error during worker process startup'
    );
    process.exit(1);
  }
};

// Start worker when executed directly
if (process.env.NODE_ENV !== 'test') {
  startWorkerProcess();
}

