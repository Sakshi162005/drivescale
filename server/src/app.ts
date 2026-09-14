import express, { Express, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { env } from './config/env.js';
import { logger } from './utils/logger.js';
import { apiV1Routes } from './routes/index.js';
import { notFoundMiddleware } from './middleware/not-found.middleware.js';
import { errorMiddleware } from './middleware/error.middleware.js';

export const createApp = (): Express => {
  const app = express();

  // Security headers
  app.use(helmet());

  // CORS configuration
  app.use(
    cors({
      origin: [env.CLIENT_URL, 'http://localhost:5173', 'http://127.0.0.1:5173'],
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
    })
  );

  // Cookie parser
  app.use(cookieParser());

  // Body parser
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Request logger
  app.use((req: Request, res: Response, next: NextFunction) => {
    const start = Date.now();
    res.on('finish', () => {
      const duration = Date.now() - start;
      logger.info(
        {
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

  // API v1 routes
  app.use('/api/v1', apiV1Routes);

  // 404 handler
  app.use(notFoundMiddleware);

  // Global error handler
  app.use(errorMiddleware);

  return app;
};
