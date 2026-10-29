import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest';
import request from 'supertest';
import express from 'express';
import mongoose from 'mongoose';
import RedisMock from 'ioredis-mock';
import { createApp } from '../src/app.js';
import { getRedisClient, setRedisClient, disconnectRedis, isRedisReady, getRedisStatus } from '../src/config/redis.js';
import { cacheService, CacheService, CacheKeys } from '../src/services/cache.service.js';
import { createRateLimiter } from '../src/middleware/rate-limit.middleware.js';
import { User } from '../src/models/User.js';
import { Folder } from '../src/models/Folder.js';
import { File } from '../src/models/File.js';
import { signAccessToken } from '../src/utils/jwt.js';

describe('Phase 6 Redis Caching & Rate Limiting Test Suite', () => {
  let mockRedis: any;

  const userAId = new mongoose.Types.ObjectId().toString();
  const userBId = new mongoose.Types.ObjectId().toString();

  const tokenUserA = signAccessToken({ userId: userAId, email: 'usera@example.com', role: 'user' });
  const tokenUserB = signAccessToken({ userId: userBId, email: 'userb@example.com', role: 'user' });

  beforeEach(() => {
    vi.restoreAllMocks();
    mockRedis = new (RedisMock as any)();
    setRedisClient(mockRedis);

    // Mock User.findById for authentication middleware
    vi.spyOn(User, 'findById').mockImplementation((id: any) => {
      const idStr = id?.toString();
      if (idStr === userAId) {
        return Promise.resolve({
          _id: new mongoose.Types.ObjectId(userAId),
          name: 'User A',
          email: 'usera@example.com',
          isActive: true,
          storageQuota: 10 * 1024 * 1024 * 1024,
          storageUsed: 2048,
        } as any);
      }
      if (idStr === userBId) {
        return Promise.resolve({
          _id: new mongoose.Types.ObjectId(userBId),
          name: 'User B',
          email: 'userb@example.com',
          isActive: true,
          storageQuota: 10 * 1024 * 1024 * 1024,
          storageUsed: 4096,
        } as any);
      }
      return Promise.resolve(null);
    });

    vi.spyOn(User, 'findByIdAndUpdate').mockResolvedValue({} as any);
  });

  afterEach(async () => {
    if (mockRedis) {
      await mockRedis.flushall();
    }
  });

  afterAll(async () => {
    setRedisClient(null);
    await disconnectRedis();
  });

  describe('1. Redis Infrastructure & Client Lifecycle', () => {
    it('initializes and manages shared Redis client singleton', () => {
      const client = getRedisClient();
      expect(client).toBeDefined();
      expect(isRedisReady()).toBe(true);
    });

    it('reports connected status when PING returns PONG', async () => {
      const status = await getRedisStatus();
      expect(status).toBe('connected');
    });

    it('reports disconnected status when client is null or offline', async () => {
      setRedisClient(null);
      const status = await getRedisStatus();
      expect(status).toBe('disconnected');
      expect(isRedisReady()).toBe(false);
    });
  });

  describe('2. Cache Layer: Core Operations & Serialization', () => {
    it('returns null on cache miss', async () => {
      const result = await cacheService.get('non_existent_key');
      expect(result).toBeNull();
    });

    it('sets and retrieves JSON serialized data with explicit TTL', async () => {
      const testData = { id: 'folder_123', name: 'Documents', count: 42 };
      await cacheService.set('test:key', testData, 60);

      const retrieved = await cacheService.get<typeof testData>('test:key');
      expect(retrieved).toEqual(testData);

      // Verify TTL was applied in Redis
      const ttl = await mockRedis.ttl('test:key');
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(60);
    });

    it('deletes specific cache keys via del()', async () => {
      await cacheService.set('key_to_delete', { value: 123 }, 60);
      expect(await cacheService.get('key_to_delete')).not.toBeNull();

      await cacheService.del('key_to_delete');
      expect(await cacheService.get('key_to_delete')).toBeNull();
    });

    it('safely handles corrupted or malformed cached JSON without crashing', async () => {
      // Intentionally insert invalid non-JSON string into Redis
      await mockRedis.set('corrupted_json_key', '{invalid_json:');

      // get() must catch parse error, purge the key, and return null
      const result = await cacheService.get('corrupted_json_key');
      expect(result).toBeNull();

      // Key should have been cleaned up
      const exists = await mockRedis.exists('corrupted_json_key');
      expect(exists).toBe(0);
    });

    it('falls back gracefully to null on cache read/write when Redis is offline', async () => {
      setRedisClient(null); // Simulate Redis connection outage

      const readResult = await cacheService.get('any_key');
      expect(readResult).toBeNull();

      // set() and del() should not throw
      await expect(cacheService.set('any_key', { data: 123 }, 60)).resolves.not.toThrow();
      await expect(cacheService.del('any_key')).resolves.not.toThrow();
      await expect(cacheService.delByPattern('any:*')).resolves.not.toThrow();
    });
  });

  describe('3. User Isolation & Cache Namespacing', () => {
    it('strictly isolates cache keys between different users', async () => {
      const userAData = [{ _id: 'f1', name: 'User A Confidential Folder' }];
      const userBData = [{ _id: 'f2', name: 'User B Private Folder' }];

      const userAKey = CacheKeys.folderChildren(userAId, 'root');
      const userBKey = CacheKeys.folderChildren(userBId, 'root');

      expect(userAKey).not.toEqual(userBKey);

      await cacheService.set(userAKey, userAData);
      await cacheService.set(userBKey, userBData);

      // Verify User A receives only User A's data
      const readA = await cacheService.get<typeof userAData>(userAKey);
      expect(readA).toEqual(userAData);

      // Verify User B receives only User B's data
      const readB = await cacheService.get<typeof userBData>(userBKey);
      expect(readB).toEqual(userBData);
    });

    it('invalidates pattern matching only for the specific user namespace', async () => {
      await cacheService.set(`drivescale:user:${userAId}:folder:f1:meta`, { name: 'A1' });
      await cacheService.set(`drivescale:user:${userAId}:folder:f2:meta`, { name: 'A2' });
      await cacheService.set(`drivescale:user:${userBId}:folder:f3:meta`, { name: 'B1' });

      // Invalidate all folders for User A only
      await cacheService.delByPattern(CacheKeys.userAllFoldersPattern(userAId));

      expect(await cacheService.get(`drivescale:user:${userAId}:folder:f1:meta`)).toBeNull();
      expect(await cacheService.get(`drivescale:user:${userAId}:folder:f2:meta`)).toBeNull();

      // User B's cache must remain untouched
      expect(await cacheService.get(`drivescale:user:${userBId}:folder:f3:meta`)).toEqual({ name: 'B1' });
    });
  });

  describe('4. Cache Invalidation After Mutations', () => {
    it('invalidates folder listing cache upon creating a new folder', async () => {
      const app = createApp();

      // Pre-cache folder listings
      const rootChildrenKey = CacheKeys.folderChildren(userAId, 'root');
      await cacheService.set(rootChildrenKey, [{ name: 'Existing Folder' }]);
      expect(await cacheService.get(rootChildrenKey)).not.toBeNull();

      // Mock Folder model for creation
      vi.spyOn(Folder, 'findOne').mockResolvedValue(null);
      vi.spyOn(Folder, 'create').mockResolvedValue({
        _id: new mongoose.Types.ObjectId(),
        name: 'New Projects',
        ownerId: new mongoose.Types.ObjectId(userAId),
        parentId: null,
      } as any);

      const res = await request(app)
        .post('/api/v1/folders')
        .set('Authorization', `Bearer ${tokenUserA}`)
        .send({ name: 'New Projects', parentId: 'root' });

      expect(res.status).toBe(201);

      // Cache must be invalidated
      const cachedAfter = await cacheService.get(rootChildrenKey);
      expect(cachedAfter).toBeNull();
    });

    it('invalidates folder detail and listing caches upon renaming a folder', async () => {
      const app = createApp();
      const folderId = new mongoose.Types.ObjectId().toString();

      const detailKey = CacheKeys.folderDetail(userAId, folderId);
      const listingKey = CacheKeys.folderChildren(userAId, 'root');

      await cacheService.set(detailKey, { name: 'Old Name' });
      await cacheService.set(listingKey, [{ name: 'Old Name' }]);

      const mockFolder = {
        _id: new mongoose.Types.ObjectId(folderId),
        ownerId: new mongoose.Types.ObjectId(userAId),
        name: 'Old Name',
        parentId: null,
        isDeleted: false,
        save: vi.fn().mockResolvedValue(true),
      };

      vi.spyOn(Folder, 'findById').mockResolvedValue(mockFolder as any);
      vi.spyOn(Folder, 'findOne').mockResolvedValue(null);

      const res = await request(app)
        .patch(`/api/v1/folders/${folderId}`)
        .set('Authorization', `Bearer ${tokenUserA}`)
        .send({ name: 'Renamed Name' });

      expect(res.status).toBe(200);

      // Both caches must be invalidated
      expect(await cacheService.get(detailKey)).toBeNull();
      expect(await cacheService.get(listingKey)).toBeNull();
    });

    it('invalidates file listings and storage stats upon file deletion', async () => {
      const app = createApp();
      const fileId = new mongoose.Types.ObjectId().toString();

      const fileDetailKey = CacheKeys.fileDetail(userAId, fileId);
      const fileListKey = CacheKeys.fileList(userAId, 'all', 1, 50);
      const storageStatsKey = CacheKeys.userStorageStats(userAId);

      await cacheService.set(fileDetailKey, { name: 'document.pdf' });
      await cacheService.set(fileListKey, { files: [] });
      await cacheService.set(storageStatsKey, { storageUsed: 1000, storageQuota: 10000 });

      const mockFile = {
        _id: new mongoose.Types.ObjectId(fileId),
        ownerId: new mongoose.Types.ObjectId(userAId),
        name: 'document.pdf',
        size: 500,
        isDeleted: false,
        save: vi.fn().mockResolvedValue(true),
      };

      vi.spyOn(File, 'findById').mockResolvedValue(mockFile as any);

      const res = await request(app)
        .delete(`/api/v1/files/${fileId}`)
        .set('Authorization', `Bearer ${tokenUserA}`);

      expect(res.status).toBe(200);

      // All affected caches must be invalidated
      expect(await cacheService.get(fileDetailKey)).toBeNull();
      expect(await cacheService.get(fileListKey)).toBeNull();
      expect(await cacheService.get(storageStatsKey)).toBeNull();
    });
  });

  describe('5. Distributed Rate Limiting Middleware', () => {
    it('allows requests within the limit and sets standard headers', async () => {
      const app = express();
      app.set('trust proxy', 1);
      app.use(express.json());

      // Custom route with 3 requests / min limit
      const testLimiter = createRateLimiter({
        prefix: 'test-limit',
        windowMs: 60000,
        max: 3,
      });

      app.get('/test-rate-limit-ok', testLimiter, (_req, res) => {
        res.json({ success: true, message: 'ok' });
      });

      // Request 1
      const res1 = await request(app).get('/test-rate-limit-ok');
      expect(res1.status).toBe(200);
      expect(res1.headers['ratelimit-limit']).toBe('3');
      expect(res1.headers['ratelimit-remaining']).toBe('2');
      expect(res1.headers['ratelimit-reset']).toBeDefined();

      // Request 2
      const res2 = await request(app).get('/test-rate-limit-ok');
      expect(res2.status).toBe(200);
      expect(res2.headers['ratelimit-remaining']).toBe('1');
    });

    it('rejects requests exceeding the limit with 429 Too Many Requests and Retry-After', async () => {
      const app = express();
      app.set('trust proxy', 1);
      app.use(express.json());

      const testLimiter = createRateLimiter({
        prefix: 'test-limit-exceed',
        windowMs: 60000,
        max: 2,
        message: 'Custom rate limit exceeded message',
      });

      app.get('/test-rate-limit-exceed', testLimiter, (_req, res) => {
        res.json({ success: true });
      });

      // Hit limit (2 requests)
      await request(app).get('/test-rate-limit-exceed');
      await request(app).get('/test-rate-limit-exceed');

      // Request 3: Exceeds limit
      const res3 = await request(app).get('/test-rate-limit-exceed');
      expect(res3.status).toBe(429);
      expect(res3.headers['ratelimit-remaining']).toBe('0');
      expect(res3.headers['retry-after']).toBeDefined();
      expect(res3.body.success).toBe(false);
      expect(res3.body.error.code).toBe('TOO_MANY_REQUESTS');
      expect(res3.body.error.message).toBe('Custom rate limit exceeded message');
      expect(res3.body.error.details.retryAfter).toBeGreaterThanOrEqual(1);
    });

    it('isolates rate limits between authenticated users independently', async () => {
      const app = express();
      app.set('trust proxy', 1);
      app.use(express.json());

      const userLimiter = createRateLimiter({
        prefix: 'user-isolated',
        windowMs: 60000,
        max: 1,
      });

      app.get('/test-user-isolated', (req: any, _res, next) => {
        // Simple auth simulation
        const auth = req.headers.authorization;
        if (auth?.includes('tokenA')) req.user = { _id: new mongoose.Types.ObjectId(userAId) };
        if (auth?.includes('tokenB')) req.user = { _id: new mongoose.Types.ObjectId(userBId) };
        next();
      }, userLimiter, (_req, res) => {
        res.json({ success: true });
      });

      // User A hits limit
      const resA1 = await request(app).get('/test-user-isolated').set('Authorization', 'tokenA');
      expect(resA1.status).toBe(200);

      const resA2 = await request(app).get('/test-user-isolated').set('Authorization', 'tokenA');
      expect(resA2.status).toBe(429);

      // User B should NOT be rate limited
      const resB1 = await request(app).get('/test-user-isolated').set('Authorization', 'tokenB');
      expect(resB1.status).toBe(200);
    });

    it('applies in-memory fallback rate limiting during Redis outages', async () => {
      const app = express();
      app.set('trust proxy', 1);
      app.use(express.json());

      setRedisClient(null); // Disconnect Redis

      const outageLimiter = createRateLimiter({
        prefix: 'outage-test',
        windowMs: 60000,
        max: 2,
        failClosed: false,
      });

      app.get('/test-outage-limit', outageLimiter, (_req, res) => {
        res.json({ success: true });
      });

      // Should still enforce rate limits locally using in-memory bucket
      const res1 = await request(app).get('/test-outage-limit');
      expect(res1.status).toBe(200);

      const res2 = await request(app).get('/test-outage-limit');
      expect(res2.status).toBe(200);

      const res3 = await request(app).get('/test-outage-limit');
      expect(res3.status).toBe(429);
      expect(res3.body.error.code).toBe('TOO_MANY_REQUESTS');
    });

    it('protects auth login endpoint with rate limiting', async () => {
      const app = createApp();

      // Mock User.findOne so it does not hang on MongoDB buffering
      vi.spyOn(User, 'findOne').mockResolvedValue(null);

      // Attempt rapid multiple logins from same IP (RATE_LIMIT_AUTH_LIMIT is 10)
      for (let i = 0; i < 10; i++) {
        await request(app)
          .post('/api/v1/auth/login')
          .send({ email: 'test@example.com', password: 'password123' });
      }

      // The 11th request must receive 429 Too Many Requests
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: 'test@example.com', password: 'password123' });

      expect(res.status).toBe(429);
      expect(res.body.error.code).toBe('TOO_MANY_REQUESTS');
    });
  });

  describe('6. User Storage Stats Endpoint Caching', () => {
    it('caches user storage stats and returns 200', async () => {
      const app = createApp();

      const res1 = await request(app)
        .get('/api/v1/users/me/storage')
        .set('Authorization', `Bearer ${tokenUserA}`);

      expect(res1.status).toBe(200);
      expect(res1.body.success).toBe(true);
      expect(res1.body.data.stats.storageUsed).toBe(2048);

      // Verify it was stored in Redis cache
      const cached = await cacheService.get<any>(CacheKeys.userStorageStats(userAId));
      expect(cached).not.toBeNull();
      expect(cached.storageUsed).toBe(2048);
    });
  });
});

