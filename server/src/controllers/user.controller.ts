import { Response } from 'express';
import { userService } from '../services/user.service.js';
import { sendSuccess } from '../utils/response.js';
import { AuthenticatedRequest } from '../middleware/auth.middleware.js';
import { asyncHandler } from '../utils/async.js';

export const getMe = asyncHandler(async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const userId = req.user!._id.toString();
  const user = await userService.getUserProfile(userId);
  sendSuccess(res, { user }, 200);
});

export const getStorageStats = asyncHandler(async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const userId = req.user!._id.toString();
  const stats = await userService.getStorageStats(userId);
  sendSuccess(res, { stats }, 200);
});

