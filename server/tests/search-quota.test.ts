import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { createApp } from '../src/app.js';
import { File } from '../src/models/File.js';
import { Folder } from '../src/models/Folder.js';
import { Share } from '../src/models/Share.js';
import { User } from '../src/models/User.js';
import { UploadSession } from '../src/models/UploadSession.js';
import { signAccessToken } from '../src/utils/jwt.js';
import { cacheService } from '../src/services/cache.service.js';

describe('Phase 11 Search and Storage Quotas Test Suite', () => {
  const app = createApp();

  const userAId = new mongoose.Types.ObjectId().toString();
  const userBId = new mongoose.Types.ObjectId().toString();

  const tokenUserA = signAccessToken({ userId: userAId, email: 'usera@example.com', role: 'user' });
  const tokenUserB = signAccessToken({ userId: userBId, email: 'userb@example.com', role: 'user' });

  const mockUserA = {
    _id: new mongoose.Types.ObjectId(userAId),
    name: 'User A',
    email: 'usera@example.com',
    isActive: true,
    storageQuota: 10 * 1024 * 1024 * 1024, // 10 GB
    storageUsed: 1024 * 1024, // 1 MB
    storageReserved: 0,
    save: vi.fn().mockResolvedValue(true),
  };

  const mockUserB = {
    _id: new mongoose.Types.ObjectId(userBId),
    name: 'User B',
    email: 'userb@example.com',
    isActive: true,
    storageQuota: 5 * 1024 * 1024 * 1024, // 5 GB
    storageUsed: 500 * 1024,
    storageReserved: 0,
    save: vi.fn().mockResolvedValue(true),
  };

  beforeEach(() => {
    vi.restoreAllMocks();

    // Default User.findById mock for auth middleware and service lookups
    vi.spyOn(User, 'findById').mockImplementation((id: any) => {
      const idStr = id?.toString();
      if (idStr === userAId) return Promise.resolve(mockUserA as any);
      if (idStr === userBId) return Promise.resolve(mockUserB as any);
      return Promise.resolve(null);
    });

    // Default User.find mock for batch resolution
    vi.spyOn(User, 'find').mockImplementation(() => {
      return {
        select: vi.fn().mockReturnValue({
          lean: vi.fn().mockResolvedValue([
            { _id: new mongoose.Types.ObjectId(userAId), name: 'User A', email: 'usera@example.com' },
            { _id: new mongoose.Types.ObjectId(userBId), name: 'User B', email: 'userb@example.com' },
          ]),
        }),
      } as any;
    });

    // Default Share.find and Share.findOne mocks
    vi.spyOn(Share, 'find').mockImplementation(() => {
      return Object.assign(
        Promise.resolve([]),
        {
          select: vi.fn().mockReturnValue(
            Object.assign(Promise.resolve([]), { lean: vi.fn().mockResolvedValue([]) })
          ),
          lean: vi.fn().mockResolvedValue([]),
        }
      ) as any;
    });

    vi.spyOn(Share, 'findOne').mockImplementation(() => {
      return Object.assign(
        Promise.resolve(null),
        {
          select: vi.fn().mockReturnValue(
            Object.assign(Promise.resolve(null), { lean: vi.fn().mockResolvedValue(null) })
          ),
          lean: vi.fn().mockResolvedValue(null),
        }
      ) as any;
    });

    // Default Folder.find mock
    vi.spyOn(Folder, 'find').mockImplementation(() => {
      return Object.assign(
        Promise.resolve([]),
        {
          select: vi.fn().mockReturnValue(
            Object.assign(Promise.resolve([]), { lean: vi.fn().mockResolvedValue([]) })
          ),
          lean: vi.fn().mockResolvedValue([]),
        }
      ) as any;
    });

    // Default File.find mock
    vi.spyOn(File, 'find').mockImplementation(() => {
      return Object.assign(
        Promise.resolve([]),
        {
          select: vi.fn().mockReturnValue(
            Object.assign(Promise.resolve([]), { lean: vi.fn().mockResolvedValue([]) })
          ),
          lean: vi.fn().mockResolvedValue([]),
        }
      ) as any;
    });

    // Default File.findOne and Folder.findOne mocks
    vi.spyOn(File, 'findOne').mockResolvedValue(null);
    vi.spyOn(Folder, 'findOne').mockResolvedValue(null);

    // Default User.findByIdAndUpdate mock
    vi.spyOn(User, 'findByIdAndUpdate').mockImplementation((id: any) => {
      const idStr = id?.toString();
      if (idStr === userAId) return Promise.resolve(mockUserA as any);
      if (idStr === userBId) return Promise.resolve(mockUserB as any);
      return Promise.resolve(mockUserA as any);
    });

    // Default CacheService mock to avoid Redis dependency in tests
    vi.spyOn(cacheService, 'get').mockResolvedValue(null);
    vi.spyOn(cacheService, 'set').mockResolvedValue(undefined);
    vi.spyOn(cacheService, 'del').mockResolvedValue(undefined);
    vi.spyOn(cacheService, 'delByPattern').mockResolvedValue(undefined);
  });

  describe('1. File and Folder Search (GET /api/v1/search)', () => {
    it('rejects unauthenticated requests (401 UNAUTHORIZED)', async () => {
      const res = await request(app).get('/api/v1/search?q=test');
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it('returns empty results when query string is empty or whitespace', async () => {
      const res = await request(app)
        .get('/api/v1/search?q=')
        .set('Authorization', `Bearer ${tokenUserA}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.items).toEqual([]);
      expect(res.body.data.pagination.total).toBe(0);
    });

    it('searches user files by name with case-insensitive partial match', async () => {
      const file1Id = new mongoose.Types.ObjectId();
      const file2Id = new mongoose.Types.ObjectId();

      vi.spyOn(File, 'find').mockReturnValue({
        select: vi.fn().mockReturnValue({
          lean: vi.fn().mockResolvedValue([
            {
              _id: file1Id,
              name: 'Q3_Financial_Report.pdf',
              size: 204800,
              mimeType: 'application/pdf',
              folderId: null,
              ownerId: new mongoose.Types.ObjectId(userAId),
              createdAt: new Date('2026-03-01'),
              updatedAt: new Date('2026-03-02'),
            },
            {
              _id: file2Id,
              name: 'annual-report.docx',
              size: 102400,
              mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
              folderId: null,
              ownerId: new mongoose.Types.ObjectId(userAId),
              createdAt: new Date('2026-03-03'),
              updatedAt: new Date('2026-03-04'),
            },
          ]),
        }),
      } as any);

      vi.spyOn(Folder, 'find').mockReturnValue({
        select: vi.fn().mockReturnValue({
          lean: vi.fn().mockResolvedValue([]),
        }),
      } as any);

      const res = await request(app)
        .get('/api/v1/search?q=report&type=file')
        .set('Authorization', `Bearer ${tokenUserA}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.items.length).toBe(2);
      expect(res.body.data.items[0].name).toBe('annual-report.docx'); // sorted by updatedAt desc
      expect(res.body.data.items[0].type).toBe('file');
      expect(res.body.data.items[0].isOwner).toBe(true);
      expect(res.body.data.pagination.total).toBe(2);
    });

    it('searches user folders by name with case-insensitive partial match', async () => {
      const folderId = new mongoose.Types.ObjectId();

      vi.spyOn(File, 'find').mockReturnValue({
        select: vi.fn().mockReturnValue({
          lean: vi.fn().mockResolvedValue([]),
        }),
      } as any);

      vi.spyOn(Folder, 'find').mockReturnValue({
        select: vi.fn().mockReturnValue({
          lean: vi.fn().mockResolvedValue([
            {
              _id: folderId,
              name: 'Project Alpha Docs',
              parentId: null,
              ownerId: new mongoose.Types.ObjectId(userAId),
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          ]),
        }),
      } as any);

      const res = await request(app)
        .get('/api/v1/search?q=alpha&type=folder')
        .set('Authorization', `Bearer ${tokenUserA}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.items.length).toBe(1);
      expect(res.body.data.items[0].type).toBe('folder');
      expect(res.body.data.items[0].name).toBe('Project Alpha Docs');
    });

    it('searches both files and folders when type=all and respects pagination', async () => {
      const fileId = new mongoose.Types.ObjectId();
      const folderId = new mongoose.Types.ObjectId();

      vi.spyOn(File, 'find').mockReturnValue({
        select: vi.fn().mockReturnValue({
          lean: vi.fn().mockResolvedValue([
            {
              _id: fileId,
              name: 'design_specs.pdf',
              size: 50000,
              mimeType: 'application/pdf',
              folderId: null,
              ownerId: new mongoose.Types.ObjectId(userAId),
              createdAt: new Date('2026-01-01'),
              updatedAt: new Date('2026-01-01'),
            },
          ]),
        }),
      } as any);

      vi.spyOn(Folder, 'find').mockReturnValue({
        select: vi.fn().mockReturnValue({
          lean: vi.fn().mockResolvedValue([
            {
              _id: folderId,
              name: 'design_assets',
              parentId: null,
              ownerId: new mongoose.Types.ObjectId(userAId),
              createdAt: new Date('2026-01-02'),
              updatedAt: new Date('2026-01-02'),
            },
          ]),
        }),
      } as any);

      const res = await request(app)
        .get('/api/v1/search?q=design&type=all&page=1&limit=1')
        .set('Authorization', `Bearer ${tokenUserA}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.items.length).toBe(1); // limit = 1
      expect(res.body.data.pagination.total).toBe(2);
      expect(res.body.data.pagination.totalPages).toBe(2);
      expect(res.body.data.pagination.hasNextPage).toBe(true);
    });

    it('excludes deleted files and folders from search results', async () => {
      const findFileSpy = vi.spyOn(File, 'find').mockReturnValue({
        select: vi.fn().mockReturnValue({
          lean: vi.fn().mockResolvedValue([]),
        }),
      } as any);

      const findFolderSpy = vi.spyOn(Folder, 'find').mockReturnValue({
        select: vi.fn().mockReturnValue({
          lean: vi.fn().mockResolvedValue([]),
        }),
      } as any);

      await request(app)
        .get('/api/v1/search?q=archive&type=all')
        .set('Authorization', `Bearer ${tokenUserA}`);

      expect(findFileSpy).toHaveBeenCalledWith(
        expect.objectContaining({ isDeleted: false })
      );
      expect(findFolderSpy).toHaveBeenCalledWith(
        expect.objectContaining({ isDeleted: false })
      );
    });

    it('allows discovering resources shared with the requesting user', async () => {
      const sharedFileId = new mongoose.Types.ObjectId();

      // Mock Share to return sharedFileId for User B
      vi.spyOn(Share, 'find').mockImplementation((query: any) => {
        if (query.resourceType === 'FILE') {
          return Object.assign(
            Promise.resolve([{ resourceId: sharedFileId }]),
            {
              select: vi.fn().mockReturnValue(
                Object.assign(Promise.resolve([{ resourceId: sharedFileId }]), {
                  lean: vi.fn().mockResolvedValue([{ resourceId: sharedFileId }]),
                })
              ),
              lean: vi.fn().mockResolvedValue([{ resourceId: sharedFileId }]),
            }
          ) as any;
        }
        return Object.assign(
          Promise.resolve([]),
          {
            select: vi.fn().mockReturnValue(
              Object.assign(Promise.resolve([]), { lean: vi.fn().mockResolvedValue([]) })
            ),
            lean: vi.fn().mockResolvedValue([]),
          }
        ) as any;
      });

      vi.spyOn(Share, 'findOne').mockResolvedValue({
        permission: 'VIEW',
        expiresAt: null,
      } as any);

      vi.spyOn(File, 'find').mockReturnValue({
        select: vi.fn().mockReturnValue({
          lean: vi.fn().mockResolvedValue([
            {
              _id: sharedFileId,
              name: 'shared_budget.xlsx',
              size: 50000,
              mimeType: 'application/vnd.ms-excel',
              folderId: null,
              ownerId: new mongoose.Types.ObjectId(userAId), // Owned by User A
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          ]),
        }),
      } as any);

      vi.spyOn(Folder, 'find').mockReturnValue({
        select: vi.fn().mockReturnValue({
          lean: vi.fn().mockResolvedValue([]),
        }),
      } as any);

      const res = await request(app)
        .get('/api/v1/search?q=budget&type=file')
        .set('Authorization', `Bearer ${tokenUserB}`); // Requesting as User B

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.items.length).toBe(1);
      expect(res.body.data.items[0].name).toBe('shared_budget.xlsx');
      expect(res.body.data.items[0].isOwner).toBe(false);
      expect(res.body.data.items[0].locationName).toBe('Shared with me');
    });
  });

  describe('2. Storage Quota Management & Indicators', () => {
    it('GET /api/v1/storage/usage returns accurate storage stats', async () => {
      const res = await request(app)
        .get('/api/v1/storage/usage')
        .set('Authorization', `Bearer ${tokenUserA}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.storageUsed).toBe(mockUserA.storageUsed);
      expect(res.body.data.storageQuota).toBe(mockUserA.storageQuota);
      expect(res.body.data.storageRemaining).toBe(mockUserA.storageQuota - mockUserA.storageUsed);
      expect(typeof res.body.data.percentageUsed).toBe('number');
    });

    it('GET /api/v1/users/me/storage returns consistent storage stats', async () => {
      const res = await request(app)
        .get('/api/v1/users/me/storage')
        .set('Authorization', `Bearer ${tokenUserA}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.stats.storageUsed).toBe(mockUserA.storageUsed);
      expect(res.body.data.stats.storageQuota).toBe(mockUserA.storageQuota);
    });

    it('PATCH /api/v1/storage/quota updates user quota with validation', async () => {
      const newQuota = 20 * 1024 * 1024 * 1024; // 20 GB
      const updatedUser = { ...mockUserA, storageQuota: newQuota };

      vi.spyOn(User, 'findByIdAndUpdate').mockResolvedValue(updatedUser as any);
      vi.spyOn(User, 'findById').mockResolvedValue(updatedUser as any);

      const res = await request(app)
        .patch('/api/v1/storage/quota')
        .set('Authorization', `Bearer ${tokenUserA}`)
        .send({ storageQuota: newQuota });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.storageQuota).toBe(newQuota);
    });

    it('rejects invalid quota update (e.g. non-positive or non-integer)', async () => {
      const res = await request(app)
        .patch('/api/v1/storage/quota')
        .set('Authorization', `Bearer ${tokenUserA}`)
        .send({ storageQuota: -100 });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('3. Upload Quota Validation & Concurrent Reservation', () => {
    it('rejects upload initialization when quota would be exceeded (400 STORAGE_QUOTA_EXCEEDED)', async () => {
      vi.spyOn(User, 'findById').mockResolvedValue({
        ...mockUserA,
        storageQuota: 1000,
        storageUsed: 800,
        storageReserved: 0,
      } as any);

      const res = await request(app)
        .post('/api/v1/uploads/init')
        .set('Authorization', `Bearer ${tokenUserA}`)
        .send({
          fileName: 'toolarge.bin',
          totalSize: 300, // 800 + 300 > 1000
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('STORAGE_QUOTA_EXCEEDED');
    });

    it('accounts for active storageReserved when validating incoming upload sessions', async () => {
      vi.spyOn(User, 'findById').mockResolvedValue({
        ...mockUserA,
        storageQuota: 1000,
        storageUsed: 500,
        storageReserved: 400, // 500 used + 400 reserved = 900
      } as any);

      const res = await request(app)
        .post('/api/v1/uploads/init')
        .set('Authorization', `Bearer ${tokenUserA}`)
        .send({
          fileName: 'second_concurrent.bin',
          totalSize: 200, // 900 + 200 > 1000
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('STORAGE_QUOTA_EXCEEDED');
    });

    it('atomically increments storageReserved upon successful upload initialization', async () => {
      const findAndUpdateSpy = vi.spyOn(User, 'findByIdAndUpdate').mockResolvedValue(mockUserA as any);
      vi.spyOn(UploadSession, 'create').mockResolvedValue({
        _id: new mongoose.Types.ObjectId(),
        totalChunks: 1,
        chunkSize: 262144,
        totalSize: 1000,
        fileName: 'file.bin',
        status: 'PENDING',
        reservedBytes: 1000,
      } as any);

      const res = await request(app)
        .post('/api/v1/uploads/init')
        .set('Authorization', `Bearer ${tokenUserA}`)
        .send({
          fileName: 'file.bin',
          totalSize: 1000,
        });

      expect(res.status).toBe(201);
      expect(findAndUpdateSpy).toHaveBeenCalledWith(
        userAId,
        expect.objectContaining({
          $inc: { storageReserved: 1000 },
        })
      );
    });

    it('releases storageReserved when an upload session is cancelled', async () => {
      const sessionId = new mongoose.Types.ObjectId();
      const findAndUpdateSpy = vi.spyOn(User, 'findByIdAndUpdate').mockResolvedValue(mockUserA as any);

      const mockSession = {
        _id: sessionId,
        userId: new mongoose.Types.ObjectId(userAId),
        status: 'UPLOADING',
        reservedBytes: 5000,
        save: vi.fn().mockResolvedValue(true),
      };

      vi.spyOn(UploadSession, 'findById').mockResolvedValue(mockSession as any);

      const res = await request(app)
        .delete(`/api/v1/uploads/${sessionId.toString()}`)
        .set('Authorization', `Bearer ${tokenUserA}`);

      expect(res.status).toBe(200);
      expect(findAndUpdateSpy).toHaveBeenCalledWith(
        mockSession.userId,
        expect.objectContaining({
          $inc: { storageReserved: -5000 },
        })
      );
    });

    it('rejects restoring a file from trash when restoration would exceed quota', async () => {
      const fileId = new mongoose.Types.ObjectId();
      const mockTrashedFile = {
        _id: fileId,
        ownerId: new mongoose.Types.ObjectId(userAId),
        size: 5000,
        name: 'deleted_heavy.iso',
        isDeleted: true,
      };

      vi.spyOn(File, 'findById').mockResolvedValue(mockTrashedFile as any);
      vi.spyOn(File, 'findOne').mockResolvedValue(null);

      vi.spyOn(User, 'findById').mockResolvedValue({
        ...mockUserA,
        storageQuota: 10000,
        storageUsed: 8000, // 8000 + 5000 = 13000 > 10000
        storageReserved: 0,
      } as any);

      const res = await request(app)
        .post(`/api/v1/trash/files/${fileId.toString()}/restore`)
        .set('Authorization', `Bearer ${tokenUserA}`);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('STORAGE_QUOTA_EXCEEDED');
    });
  });
});
