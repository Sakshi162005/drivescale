import express, { Express, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import crypto from 'crypto';
import { env } from './config/env.js';
import { logger } from './utils/logger.js';
import { apiV1Routes } from './routes/index.js';
import { notFoundMiddleware } from './middleware/not-found.middleware.js';
import { errorMiddleware } from './middleware/error.middleware.js';
import { generalRateLimiter } from './middleware/rate-limit.middleware.js';

export const createApp = (): Express => {
  const app = express();

  // Trust proxy for secure IP rate limiting behind reverse proxies (e.g. Nginx, Docker)
  app.set('trust proxy', 1);

  // Security headers with cross-origin allowances for file downloads
  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      crossOriginEmbedderPolicy: false,
    })
  );

  // CORS configuration
  app.use(
    cors({
      origin: env.allowedOrigins,
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
      exposedHeaders: ['X-Request-Id', 'Content-Disposition'],
    })
  );

  // Cookie parser
  app.use(cookieParser());

  // Body parser
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Request logger with Request ID tracking
  app.use((req: Request, res: Response, next: NextFunction) => {
    const requestId = (req.headers['x-request-id'] as string) || crypto.randomUUID();
    req.headers['x-request-id'] = requestId;
    res.setHeader('X-Request-Id', requestId);

    const start = Date.now();
    res.on('finish', () => {
      const duration = Date.now() - start;
      logger.info(
        {
          requestId,
          method: req.method,
          url: req.originalUrl,
          statusCode: res.statusCode,
          durationMs: duration,
        },
        `${req.method} ${req.originalUrl} ${res.statusCode} in ${duration}ms`
      );
    });
    next();
  });

  // Global rate limiter on API routes (skips health check)
  app.use('/api/v1', generalRateLimiter);

  // API v1 routes
  app.use('/api/v1', apiV1Routes);

  // 404 handler
  app.use(notFoundMiddleware);

  // Global error handler
  app.use(errorMiddleware);

  return app;
};
