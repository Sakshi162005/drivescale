import { Request, Response, NextFunction } from 'express';
import { verifyAccessToken, TokenPayload } from '../utils/jwt.js';
import { User, IUser } from '../models/User.js';
import { sendError } from '../utils/response.js';

export interface AuthenticatedRequest extends Request {
  user?: IUser;
  tokenPayload?: TokenPayload;
}

export const authenticate = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    sendError(res, 'UNAUTHORIZED', 'Access token is required', 401);
    return;
  }

  const token = authHeader.split(' ')[1];

  if (!token) {
    sendError(res, 'UNAUTHORIZED', 'Access token is malformed', 401);
    return;
  }

  try {
    const payload = verifyAccessToken(token);
    const user = await User.findById(payload.userId);

    if (!user || !user.isActive) {
      sendError(res, 'UNAUTHORIZED', 'User not found or account is deactivated', 401);
      return;
    }

    req.user = user;
    req.tokenPayload = payload;
    next();
  } catch {
    sendError(res, 'UNAUTHORIZED', 'Invalid or expired access token', 401);
  }
};
