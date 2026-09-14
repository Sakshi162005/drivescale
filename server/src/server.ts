import { createApp } from './app.js';
import { env } from './config/env.js';
import { connectDatabase, disconnectDatabase } from './config/database.js';
import { connectRedis, disconnectRedis } from './config/redis.js';
import { logger } from './utils/logger.js';
import { Server } from 'http';

const startServer = async () => {
  logger.info(`Starting DriveScale API Server in [${env.NODE_ENV}] mode...`);

  // Connect infrastructure
  await connectDatabase();
  await connectRedis();

  const app = createApp();

  const server: Server = app.listen(env.PORT, () => {
    logger.info(`🚀 DriveScale Server running on http://localhost:${env.PORT}`);
    logger.info(`   Health check: http://localhost:${env.PORT}/api/v1/health`);
  });

  const gracefulShutdown = async (signal: string) => {
    logger.info(`Received ${signal}. Initiating graceful shutdown...`);

    server.close(async () => {
      logger.info('HTTP server closed');
      await disconnectDatabase();
      await disconnectRedis();
      logger.info('Graceful shutdown completed. Exiting.');
      process.exit(0);
    });

    // Force exit if hanging
    setTimeout(() => {
      logger.error('Forced shutdown timeout reached. Exiting immediately.');
      process.exit(1);
    }, 10000).unref();
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
