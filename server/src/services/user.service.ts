import { User, IUser } from '../models/User.js';
import { cacheService, CacheKeys } from './cache.service.js';
import { NotFoundError } from '../utils/errors.js';

export interface UserStorageStats {
  storageUsed: number;
  storageQuota: number;
  percentageUsed: number;
}

export class UserService {
  /**
   * Retrieves user storage statistics, using Redis cache with MongoDB fallback
   */
  async getStorageStats(userId: string): Promise<UserStorageStats> {
    const cacheKey = CacheKeys.userStorageStats(userId);
    const cached = await cacheService.get<UserStorageStats>(cacheKey);

    if (cached) {
      return cached;
    }

    const user = await User.findById(userId);
    if (!user) {
      throw new NotFoundError('User not found', 'USER_NOT_FOUND');
    }

    const stats: UserStorageStats = {
      storageUsed: user.storageUsed,
      storageQuota: user.storageQuota,
      percentageUsed: user.storageQuota > 0 ? Math.round((user.storageUsed / user.storageQuota) * 100) : 0,
    };

    // Cache for 5 minutes (invalidated when files are uploaded/deleted)
    await cacheService.set(cacheKey, stats, 300);

    return stats;
  }

  /**
   * Retrieves user profile details
   */
  async getUserProfile(userId: string): Promise<IUser> {
    const user = await User.findById(userId);
    if (!user) {
      throw new NotFoundError('User not found', 'USER_NOT_FOUND');
    }
    return user;
  }
}

export const userService = new UserService();

