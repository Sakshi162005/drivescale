import { Request, Response } from 'express';
import { sendError } from '../utils/response.js';

export const notFoundMiddleware = (req: Request, res: Response): void => {
  sendError(
    res,
    'NOT_FOUND',
    `The requested resource '${req.originalUrl}' was not found on this server.`,
    404
  );
};
