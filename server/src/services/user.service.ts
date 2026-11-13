import { User, IUser } from '../models/User.js';
import { File } from '../models/File.js';
import { cacheService, CacheKeys } from './cache.service.js';
import { NotFoundError, BadRequestError } from '../utils/errors.js';

export interface UserStorageStats {
  storageUsed: number;
  storageReserved: number;
  storageQuota: number;
  storageRemaining: number;
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

    const storageUsed = Math.max(0, user.storageUsed || 0);
    const storageReserved = Math.max(0, user.storageReserved || 0);
    const storageQuota = user.storageQuota;
    const totalAllocated = storageUsed + storageReserved;
    const storageRemaining = Math.max(0, storageQuota - totalAllocated);
    const percentageUsed = storageQuota > 0 ? Math.min(100, Math.round((totalAllocated / storageQuota) * 100)) : 0;

    const stats: UserStorageStats = {
      storageUsed,
      storageReserved,
      storageQuota,
      storageRemaining,
      percentageUsed,
    };

    // Cache for 5 minutes (invalidated when files are uploaded/deleted)
    await cacheService.set(cacheKey, stats, 300);

    return stats;
  }

  /**
   * Updates a user's storage quota with validation
   */
  async updateStorageQuota(userId: string, newQuotaBytes: number): Promise<UserStorageStats> {
    if (typeof newQuotaBytes !== 'number' || newQuotaBytes <= 0 || !Number.isInteger(newQuotaBytes)) {
      throw new BadRequestError('Storage quota must be a positive integer', 'INVALID_QUOTA');
    }

    const user = await User.findByIdAndUpdate(
      userId,
      { $set: { storageQuota: newQuotaBytes } },
      { new: true }
    );

    if (!user) {
      throw new NotFoundError('User not found', 'USER_NOT_FOUND');
    }

    // Invalidate user storage stats cache
    await cacheService.del(CacheKeys.userStorageStats(userId));

    return this.getStorageStats(userId);
  }

  /**
   * Recalculates storage used based on active files
   */
  async recalculateStorageUsed(userId: string): Promise<number> {
    const files = await File.find({ ownerId: userId, isDeleted: false });
    const totalUsed = files.reduce((acc, f) => acc + (f.size || 0), 0);

    await User.findByIdAndUpdate(userId, {
      $set: { storageUsed: totalUsed, storageReserved: 0 },
    });

    await cacheService.del(CacheKeys.userStorageStats(userId));
    return totalUsed;
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

