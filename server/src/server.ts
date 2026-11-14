import { createApp } from './app.js';
import { env } from './config/env.js';
import { connectDatabase, disconnectDatabase } from './config/database.js';
import { connectRedis, disconnectRedis } from './config/redis.js';
import { initStorage } from './config/storage.js';
import { closeCleanupQueue } from './queues/cleanup.queue.js';
import { closeFileQueue } from './queues/file.queue.js';
import { closeNotificationQueue } from './queues/notification.queue.js';
import { logger } from './utils/logger.js';
import { Server } from 'http';

const startServer = async () => {
  logger.info(`Starting DriveScale API Server in [${env.NODE_ENV}] mode...`);

  // Connect infrastructure
  await connectDatabase();
  await connectRedis();
  await initStorage();

  const app = createApp();

  const server: Server = app.listen(env.PORT, () => {
    logger.info(`🚀 DriveScale Server running on http://localhost:${env.PORT}`);
    logger.info(`   Health check: http://localhost:${env.PORT}/api/v1/health`);
  });

  let isShuttingDown = false;

  const gracefulShutdown = async (signal: string) => {
    if (isShuttingDown) {
      logger.warn({ signal }, 'Shutdown already in progress, ignoring duplicate signal');
      return;
    }
    isShuttingDown = true;
    logger.info(`Received ${signal}. Initiating graceful shutdown...`);

    // Force exit if hanging beyond 10 seconds
    const forceExitTimeout = setTimeout(() => {
      logger.error('Forced shutdown timeout reached (10s). Exiting immediately.');
      process.exit(1);
    }, 10000);
    forceExitTimeout.unref();

    try {
      // 1. Stop accepting new HTTP requests and finish in-flight requests
      await new Promise<void>((resolve, reject) => {
        server.close((err) => {
          if (err) return reject(err);
          resolve();
        });
        // Safely close idle keep-alive connections if supported by Node.js Server
        if (typeof server.closeIdleConnections === 'function') {
          server.closeIdleConnections();
        }
      });
      logger.info('HTTP server closed; active requests completed');

      // 2. Close BullMQ producer queues
      try {
        await Promise.allSettled([
          closeCleanupQueue(),
          closeFileQueue(),
          closeNotificationQueue(),
        ]);
        logger.info('BullMQ queues closed');
      } catch (queueErr) {
        logger.warn({ err: queueErr }, 'Error closing BullMQ queues (non-fatal)');
      }

      // 3. Disconnect infrastructure
      await disconnectRedis();
      await disconnectDatabase();

      clearTimeout(forceExitTimeout);
      logger.info('Graceful shutdown completed successfully. Exiting.');
      process.exit(0);
    } catch (shutdownErr) {
      logger.error({ err: shutdownErr }, 'Error encountered during graceful shutdown');
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));

  process.on('unhandledRejection', (reason) => {
    logger.error({ reason }, 'Unhandled Promise Rejection');
  });

  process.on('uncaughtException', (err) => {
    logger.fatal({ err }, 'Uncaught Exception');
    process.exit(1);
  });
};

startServer().catch((err) => {
  logger.fatal({ err }, 'Failed to start DriveScale Server');
  process.exit(1);
});
