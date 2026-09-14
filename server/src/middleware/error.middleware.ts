import { Request, Response, NextFunction } from 'express';
import { sendError } from '../utils/response.js';
import { logger } from '../utils/logger.js';
import { env } from '../config/env.js';

export interface AppError extends Error {
  statusCode?: number;
  code?: string;
  details?: unknown;
}

export const errorMiddleware = (
  err: AppError,
  req: Request,
  res: Response,
  _next: NextFunction
): void => {
  const statusCode = err.statusCode || 500;
  const code = err.code || (statusCode === 500 ? 'INTERNAL_SERVER_ERROR' : 'BAD_REQUEST');
  const message = statusCode === 500 && env.NODE_ENV === 'production'
    ? 'An unexpected server error occurred.'
    : err.message || 'Internal server error';

  logger.error(
    {
      err: {
        message: err.message,
        stack: err.stack,
        code,
        statusCode,
      },
      url: req.originalUrl,
      method: req.method,
    },
    'Request error'
  );

  sendError(
    res,
    code,
    message,
    statusCode,
    env.NODE_ENV !== 'production' && err.details ? err.details : undefined
  );
};
