import { Response } from 'express';
import { userService } from '../services/user.service.js';
import { sendSuccess } from '../utils/response.js';
import { AuthenticatedRequest } from '../middleware/auth.middleware.js';
import { asyncHandler } from '../utils/async.js';

/**
 * GET /api/v1/storage/usage
 * Retrieves authoritative storage usage, quota, and remaining bytes for authenticated user
 */
export const getStorageUsage = asyncHandler(async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const userId = req.user!._id.toString();
  const stats = await userService.getStorageStats(userId);
  sendSuccess(res, stats, 200);
});

/**
 * PATCH /api/v1/storage/quota
 * Updates the user's storage quota
 */
export const updateStorageQuota = asyncHandler(async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const userId = req.user!._id.toString();
  const { storageQuota } = req.body;
  const stats = await userService.updateStorageQuota(userId, storageQuota);
  sendSuccess(res, stats, 200);
});
