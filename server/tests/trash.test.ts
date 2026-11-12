import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import mongoose, { Types } from 'mongoose';
import { createApp } from '../src/app.js';
import { File } from '../src/models/File.js';
import { Folder } from '../src/models/Folder.js';
import { FileVersion } from '../src/models/FileVersion.js';
import { Share } from '../src/models/Share.js';
import { User } from '../src/models/User.js';
import { signAccessToken } from '../src/utils/jwt.js';
import { cacheService } from '../src/services/cache.service.js';
import { storageService } from '../src/services/storage/index.js';
import { trashService } from '../src/services/trash.service.js';
import { processCleanupJob } from '../src/workers/cleanup.worker.js';
import { CLEANUP_JOB_NAMES } from '../src/queues/cleanup.queue.js';

describe('Phase 10 Trash and Recovery Test Suite', () => {
  const app = createApp();

  const userAId = new mongoose.Types.ObjectId().toString();
  const userBId = new mongoose.Types.ObjectId().toString();

  const tokenUserA = signAccessToken({ userId: userAId, email: 'usera@example.com', role: 'user' });
  const tokenUserB = signAccessToken({ userId: userBId, email: 'userb@example.com', role: 'user' });

  const mockUserA = {
    _id: new mongoose.Types.ObjectId(userAId),
    name: 'User A',
    email: 'usera@example.com',
    storageQuota: 10 * 1024 * 1024 * 1024,
    storageUsed: 50 * 1024 * 1024,
    isActive: true,
  };

  const mockUserB = {
    _id: new mongoose.Types.ObjectId(userBId),
    name: 'User B',
    email: 'userb@example.com',
    storageQuota: 10 * 1024 * 1024 * 1024,
    storageUsed: 10 * 1024 * 1024,
    isActive: true,
  };

  beforeEach(() => {
    vi.restoreAllMocks();

    // Mock cacheService
    vi.spyOn(cacheService, 'get').mockResolvedValue(null);
    vi.spyOn(cacheService, 'set').mockResolvedValue(undefined);
    vi.spyOn(cacheService, 'del').mockResolvedValue(undefined);
    vi.spyOn(cacheService, 'delByPattern').mockResolvedValue(undefined);

    // Mock storageService delete
    vi.spyOn(storageService, 'delete').mockResolvedValue(undefined);

    // Mock User.findById
    vi.spyOn(User, 'findById').mockImplementation((id: any) => {
      const idStr = id?.toString();
      if (idStr === userAId) return Promise.resolve(mockUserA as any);
      if (idStr === userBId) return Promise.resolve(mockUserB as any);
      return Promise.resolve(null);
    });

    vi.spyOn(User, 'findByIdAndUpdate').mockResolvedValue(mockUserA as any);
  });

  describe('1. Soft Deletion & Metadata Tracking', () => {
    it('soft deletes a file, records deletion metadata, and decrements user storage', async () => {
      const fileId = new mongoose.Types.ObjectId();
      const parentFolderId = new mongoose.Types.ObjectId();

      const mockFile = {
        _id: fileId,
        name: 'document.pdf',
        ownerId: new mongoose.Types.ObjectId(userAId),
        folderId: parentFolderId,
        size: 5000,
        isDeleted: false,
        deletedAt: null,
        deletedBy: null,
        originalFolderId: null,
        deletedWithFolderId: null,
        save: vi.fn().mockResolvedValue(true),
      };

      vi.spyOn(File, 'findById').mockResolvedValue(mockFile as any);
      const userUpdateSpy = vi.spyOn(User, 'findByIdAndUpdate').mockResolvedValue(mockUserA as any);

      const res = await request(app)
        .delete(`/api/v1/files/${fileId.toString()}`)
        .set('Authorization', `Bearer ${tokenUserA}`);

      expect(res.status).toBe(200);
      expect(mockFile.isDeleted).toBe(true);
      expect(mockFile.deletedAt).toBeInstanceOf(Date);
      expect(mockFile.deletedBy?.toString()).toBe(userAId);
      expect(mockFile.originalFolderId?.toString()).toBe(parentFolderId.toString());
      expect(mockFile.deletedWithFolderId).toBeNull();
      expect(mockFile.save).toHaveBeenCalled();
      expect(userUpdateSpy).toHaveBeenCalledWith(userAId, {
        $inc: { storageUsed: -5000 },
      });
    });

    it('soft deletes a folder and cascades deletion to descendant files and subfolders', async () => {
      const folderId = new mongoose.Types.ObjectId();
      const subfolderId = new mongoose.Types.ObjectId();
      const fileInsideSubfolderId = new mongoose.Types.ObjectId();

      const mockFolder = {
        _id: folderId,
        name: 'Project',
        ownerId: new mongoose.Types.ObjectId(userAId),
        parentId: null,
        isDeleted: false,
        deletedAt: null,
        deletedBy: null,
        originalParentId: null,
        deletedWithFolderId: null,
        save: vi.fn().mockResolvedValue(true),
      };

      const mockChildFile = {
        _id: fileInsideSubfolderId,
        name: 'data.csv',
        ownerId: new mongoose.Types.ObjectId(userAId),
        folderId: subfolderId,
        size: 12000,
        isDeleted: false,
        save: vi.fn().mockResolvedValue(true),
      };

      vi.spyOn(Folder, 'findById').mockResolvedValue(mockFolder as any);
      vi.spyOn(Folder, 'find').mockReturnValue({
        select: vi.fn().mockResolvedValue([{ _id: subfolderId, parentId: folderId }]),
      } as any);
      vi.spyOn(Folder, 'updateMany').mockResolvedValue({ modifiedCount: 1 } as any);
      vi.spyOn(File, 'find').mockResolvedValue([mockChildFile] as any);

      const userUpdateSpy = vi.spyOn(User, 'findByIdAndUpdate').mockResolvedValue(mockUserA as any);

      const res = await request(app)
        .delete(`/api/v1/folders/${folderId.toString()}`)
        .set('Authorization', `Bearer ${tokenUserA}`);

      expect(res.status).toBe(200);
      expect(mockFolder.isDeleted).toBe(true);
      expect(mockFolder.deletedWithFolderId).toBeNull();
      expect(mockFolder.save).toHaveBeenCalled();
      expect(mockChildFile.isDeleted).toBe(true);
      expect(mockChildFile.deletedWithFolderId?.toString()).toBe(folderId.toString());
      expect(mockChildFile.originalFolderId?.toString()).toBe(subfolderId.toString());
      expect(mockChildFile.save).toHaveBeenCalled();
      expect(userUpdateSpy).toHaveBeenCalledWith(userAId, {
        $inc: { storageUsed: -12000 },
      });
    });

    it('rejects unauthenticated and cross-user deletion', async () => {
      const fileId = new mongoose.Types.ObjectId();
      const mockFile = {
        _id: fileId,
        name: 'secret.txt',
        ownerId: new mongoose.Types.ObjectId(userAId), // User A
        isDeleted: false,
      };

      vi.spyOn(File, 'findById').mockResolvedValue(mockFile as any);

      const res = await request(app)
        .delete(`/api/v1/files/${fileId.toString()}`)
        .set('Authorization', `Bearer ${tokenUserB}`); // User B

      expect(res.status).toBe(401);
    });
  });

  describe('2. GET /api/v1/trash (Trash Listing)', () => {
    it('returns requesting user deleted items, respecting pagination and item types', async () => {
      const trashedFileId = new mongoose.Types.ObjectId();
      const trashedFolderId = new mongoose.Types.ObjectId();

      const mockFiles = [
        {
          _id: trashedFileId,
          name: 'deleted-doc.docx',
          size: 4096,
          mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          deletedAt: new Date(Date.now() - 5000),
          deletedBy: new mongoose.Types.ObjectId(userAId),
          originalFolderId: null,
          folderId: null,
          versionCount: 2,
          ownerId: new mongoose.Types.ObjectId(userAId),
        },
      ];

      const mockFolders = [
        {
          _id: trashedFolderId,
          name: 'Old Archive',
          deletedAt: new Date(Date.now() - 10000),
          deletedBy: new mongoose.Types.ObjectId(userAId),
          originalParentId: null,
          parentId: null,
          ownerId: new mongoose.Types.ObjectId(userAId),
        },
      ];

      vi.spyOn(File, 'find').mockReturnValue({
        select: vi.fn().mockReturnValue({
          lean: vi.fn().mockResolvedValue(mockFiles),
        }),
      } as any);

      vi.spyOn(Folder, 'find').mockImplementation((query: any) => {
        if (query?._id?.$in) {
          return { select: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue([]) }) } as any;
        }
        return {
          select: vi.fn().mockReturnValue({
            lean: vi.fn().mockResolvedValue(mockFolders),
          }),
        } as any;
      });

      const res = await request(app)
        .get('/api/v1/trash?type=all&page=1&limit=10')
        .set('Authorization', `Bearer ${tokenUserA}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.items).toHaveLength(2);
      expect(res.body.data.pagination.total).toBe(2);
      expect(res.body.data.items[0]._id).toBe(trashedFileId.toString());
      expect(res.body.data.items[1]._id).toBe(trashedFolderId.toString());
    });

    it('enforces user isolation so User B cannot view User A trash', async () => {
      vi.spyOn(File, 'find').mockReturnValue({
        select: vi.fn().mockReturnValue({
          lean: vi.fn().mockResolvedValue([]),
        }),
      } as any);

      vi.spyOn(Folder, 'find').mockReturnValue({
        select: vi.fn().mockReturnValue({
          lean: vi.fn().mockResolvedValue([]),
        }),
      } as any);

      const res = await request(app)
        .get('/api/v1/trash')
        .set('Authorization', `Bearer ${tokenUserB}`);

      expect(res.status).toBe(200);
      expect(res.body.data.items).toHaveLength(0);
      expect(File.find).toHaveBeenCalledWith(
        expect.objectContaining({
          ownerId: new Types.ObjectId(userBId),
          isDeleted: true,
          deletedWithFolderId: null,
        })
      );
    });
  });

  describe('3. File & Folder Restoration', () => {
    it('restores a deleted file to its original location and increments active storage', async () => {
      const fileId = new mongoose.Types.ObjectId();
      const parentFolderId = new mongoose.Types.ObjectId();

      const mockFile = {
        _id: fileId,
        name: 'notes.txt',
        ownerId: new mongoose.Types.ObjectId(userAId),
        size: 2048,
        isDeleted: true,
        deletedAt: new Date(),
        deletedBy: new mongoose.Types.ObjectId(userAId),
        originalFolderId: parentFolderId,
        folderId: parentFolderId,
        save: vi.fn().mockResolvedValue(true),
      };

      vi.spyOn(File, 'findById').mockResolvedValue(mockFile as any);
      vi.spyOn(File, 'findOne').mockImplementation((query: any) => {
        if (query?._id?.toString() === fileId.toString()) {
          return Promise.resolve(mockFile as any);
        }
        return Promise.resolve(null); // No name collision
      });
      vi.spyOn(Folder, 'findOne').mockResolvedValue({ _id: parentFolderId, name: 'Documents', isDeleted: false } as any);
      const userUpdateSpy = vi.spyOn(User, 'findByIdAndUpdate').mockResolvedValue(mockUserA as any);

      const res = await request(app)
        .post(`/api/v1/trash/${fileId.toString()}/restore`)
        .set('Authorization', `Bearer ${tokenUserA}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(mockFile.isDeleted).toBe(false);
      expect(mockFile.deletedAt).toBeNull();
      expect(mockFile.deletedBy).toBeNull();
      expect(mockFile.folderId?.toString()).toBe(parentFolderId.toString());
      expect(mockFile.save).toHaveBeenCalled();
      expect(userUpdateSpy).toHaveBeenCalledWith(userAId, {
        $inc: { storageUsed: 2048 },
      });
    });

    it('falls back to root if original parent folder was deleted or missing', async () => {
      const fileId = new mongoose.Types.ObjectId();
      const deletedParentId = new mongoose.Types.ObjectId();

      const mockFile = {
        _id: fileId,
        name: 'standalone.txt',
        ownerId: new mongoose.Types.ObjectId(userAId),
        size: 1000,
        isDeleted: true,
        originalFolderId: deletedParentId,
        folderId: deletedParentId,
        save: vi.fn().mockResolvedValue(true),
      };

      vi.spyOn(File, 'findById').mockResolvedValue(mockFile as any);
      vi.spyOn(Folder, 'findOne').mockResolvedValue(null); // Deleted or missing parent folder
      vi.spyOn(File, 'findOne').mockResolvedValue(null);

      const res = await request(app)
        .post(`/api/v1/trash/files/${fileId.toString()}/restore`)
        .set('Authorization', `Bearer ${tokenUserA}`);

      expect(res.status).toBe(200);
      expect(mockFile.isDeleted).toBe(false);
      expect(mockFile.folderId).toBeNull(); // Fallback to root
    });

    it('resolves filename collisions safely by appending (restored)', async () => {
      const fileId = new mongoose.Types.ObjectId();
      const mockFile = {
        _id: fileId,
        name: 'report.pdf',
        ownerId: new mongoose.Types.ObjectId(userAId),
        size: 5000,
        isDeleted: true,
        originalFolderId: null,
        folderId: null,
        save: vi.fn().mockResolvedValue(true),
      };

      vi.spyOn(File, 'findById').mockResolvedValue(mockFile as any);

      vi.spyOn(File, 'findOne').mockImplementation((query: any) => {
        if (query?._id?.toString() === fileId.toString()) {
          return Promise.resolve(mockFile as any);
        }
        if (query?.name === 'report.pdf') {
          return Promise.resolve({ _id: new mongoose.Types.ObjectId(), name: 'report.pdf' } as any);
        }
        return Promise.resolve(null);
      });

      const res = await request(app)
        .post(`/api/v1/trash/${fileId.toString()}/restore`)
        .set('Authorization', `Bearer ${tokenUserA}`);

      expect(res.status).toBe(200);
      expect(mockFile.name).toBe('report (restored).pdf');
      expect(mockFile.isDeleted).toBe(false);
    });

    it('restores a deleted folder and all descendant files and subfolders deleted with it', async () => {
      const folderId = new mongoose.Types.ObjectId();
      const mockFolder = {
        _id: folderId,
        name: 'Client Project',
        ownerId: new mongoose.Types.ObjectId(userAId),
        parentId: null,
        isDeleted: true,
        originalParentId: null,
        save: vi.fn().mockResolvedValue(true),
      };

      const mockDescendantFiles = [
        { _id: new mongoose.Types.ObjectId(), name: 'f1.txt', size: 3000 },
        { _id: new mongoose.Types.ObjectId(), name: 'f2.txt', size: 7000 },
      ];

      vi.spyOn(Folder, 'findById').mockResolvedValue(mockFolder as any);
      vi.spyOn(Folder, 'findOne').mockResolvedValue(null); // No name collision
      const folderUpdateSpy = vi.spyOn(Folder, 'updateMany').mockResolvedValue({ modifiedCount: 2 } as any);
      vi.spyOn(File, 'find').mockResolvedValue(mockDescendantFiles as any);
      const fileUpdateSpy = vi.spyOn(File, 'updateMany').mockResolvedValue({ modifiedCount: 2 } as any);
      const userUpdateSpy = vi.spyOn(User, 'findByIdAndUpdate').mockResolvedValue(mockUserA as any);

      const res = await request(app)
        .post(`/api/v1/trash/folders/${folderId.toString()}/restore`)
        .set('Authorization', `Bearer ${tokenUserA}`);

      expect(res.status).toBe(200);
      expect(mockFolder.isDeleted).toBe(false);
      expect(mockFolder.save).toHaveBeenCalled();
      expect(folderUpdateSpy).toHaveBeenCalledWith(
        { ownerId: mockFolder.ownerId, deletedWithFolderId: folderId },
        expect.any(Object)
      );
      expect(fileUpdateSpy).toHaveBeenCalledWith(
        { ownerId: mockFolder.ownerId, deletedWithFolderId: folderId },
        expect.any(Object)
      );
      expect(userUpdateSpy).toHaveBeenCalledWith(userAId, {
        $inc: { storageUsed: 10000 },
      });
    });

    it('rejects restoring an item that is not in trash', async () => {
      const fileId = new mongoose.Types.ObjectId();
      const mockActiveFile = {
        _id: fileId,
        name: 'active.txt',
        ownerId: new mongoose.Types.ObjectId(userAId),
        isDeleted: false, // Already active!
      };

      vi.spyOn(File, 'findById').mockResolvedValue(mockActiveFile as any);
      vi.spyOn(File, 'findOne').mockResolvedValue(null);
      vi.spyOn(Folder, 'findOne').mockResolvedValue(null);

      const res = await request(app)
        .post(`/api/v1/trash/${fileId.toString()}/restore`)
        .set('Authorization', `Bearer ${tokenUserA}`);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('TRASH_ITEM_NOT_FOUND');
    });
  });

  describe('4. Permanent Deletion', () => {
    it('permanently deletes a file, removing versions, storage objects, and database records', async () => {
      const fileId = new mongoose.Types.ObjectId();
      const v1StorageKey = 'objects/aa/v1-hash.bin';
      const v2StorageKey = 'objects/bb/v2-hash.bin';

      const mockFile = {
        _id: fileId,
        name: 'versioned-file.pdf',
        ownerId: new mongoose.Types.ObjectId(userAId),
        storageKey: v2StorageKey,
        isDeleted: true,
      };

      const mockVersions = [
        { _id: new mongoose.Types.ObjectId(), fileId, storageKey: v1StorageKey },
        { _id: new mongoose.Types.ObjectId(), fileId, storageKey: v2StorageKey },
      ];

      vi.spyOn(File, 'findById').mockResolvedValue(mockFile as any);
      vi.spyOn(File, 'findOne').mockResolvedValue(mockFile as any);
      vi.spyOn(FileVersion, 'find').mockResolvedValue(mockVersions as any);
      const versionDeleteSpy = vi.spyOn(FileVersion, 'deleteMany').mockResolvedValue({ deletedCount: 2 } as any);
      const shareDeleteSpy = vi.spyOn(Share, 'deleteMany').mockResolvedValue({ deletedCount: 1 } as any);
      const fileDeleteSpy = vi.spyOn(File, 'findByIdAndDelete').mockResolvedValue(mockFile as any);

      const res = await request(app)
        .delete(`/api/v1/trash/${fileId.toString()}/permanent`)
        .set('Authorization', `Bearer ${tokenUserA}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(storageService.delete).toHaveBeenCalledWith(v1StorageKey);
      expect(storageService.delete).toHaveBeenCalledWith(v2StorageKey);
      expect(versionDeleteSpy).toHaveBeenCalledWith({ fileId });
      expect(shareDeleteSpy).toHaveBeenCalledWith({ resourceType: 'FILE', resourceId: fileId });
      expect(fileDeleteSpy).toHaveBeenCalledWith(fileId);
    });

    it('permanently deletes a folder and all its trashed descendant files and subfolders', async () => {
      const folderId = new mongoose.Types.ObjectId();
      const childFolderId = new mongoose.Types.ObjectId();
      const childFileId = new mongoose.Types.ObjectId();

      const mockFolder = {
        _id: folderId,
        name: 'Trashed Folder',
        ownerId: new mongoose.Types.ObjectId(userAId),
        isDeleted: true,
      };

      const mockChildFile = {
        _id: childFileId,
        storageKey: 'objects/cc/file.bin',
        isDeleted: true,
      };

      vi.spyOn(Folder, 'findById').mockResolvedValue(mockFolder as any);
      vi.spyOn(Folder, 'findOne').mockResolvedValue(mockFolder as any);
      vi.spyOn(Folder, 'find').mockResolvedValue([{ _id: childFolderId }] as any);
      vi.spyOn(File, 'find').mockResolvedValue([mockChildFile] as any);
      vi.spyOn(FileVersion, 'find').mockResolvedValue([] as any);

      const fileVersionDeleteSpy = vi.spyOn(FileVersion, 'deleteMany').mockResolvedValue({ deletedCount: 0 } as any);
      const shareDeleteSpy = vi.spyOn(Share, 'deleteMany').mockResolvedValue({ deletedCount: 0 } as any);
      const fileDeleteSpy = vi.spyOn(File, 'deleteMany').mockResolvedValue({ deletedCount: 1 } as any);
      const folderDeleteSpy = vi.spyOn(Folder, 'deleteMany').mockResolvedValue({ deletedCount: 2 } as any);

      const res = await request(app)
        .delete(`/api/v1/trash/folders/${folderId.toString()}/permanent`)
        .set('Authorization', `Bearer ${tokenUserA}`);

      expect(res.status).toBe(200);
      expect(storageService.delete).toHaveBeenCalledWith('objects/cc/file.bin');
      expect(fileVersionDeleteSpy).toHaveBeenCalled();
      expect(shareDeleteSpy).toHaveBeenCalled();
      expect(fileDeleteSpy).toHaveBeenCalled();
      expect(folderDeleteSpy).toHaveBeenCalledWith({ _id: { $in: [folderId, childFolderId] } });
    });

    it('rejects permanent deletion of non-trashed resources with 404', async () => {
      const fileId = new mongoose.Types.ObjectId();
      const mockActiveFile = {
        _id: fileId,
        name: 'safe.txt',
        ownerId: new mongoose.Types.ObjectId(userAId),
        isDeleted: false, // Active!
      };

      vi.spyOn(File, 'findById').mockResolvedValue(mockActiveFile as any);
      vi.spyOn(File, 'findOne').mockResolvedValue(null);
      vi.spyOn(Folder, 'findOne').mockResolvedValue(null);

      const res = await request(app)
        .delete(`/api/v1/trash/${fileId.toString()}/permanent`)
        .set('Authorization', `Bearer ${tokenUserA}`);

      expect(res.status).toBe(404);
      expect(storageService.delete).not.toHaveBeenCalled();
    });

    it('empties all trash items for the requesting user', async () => {
      const file1Id = new mongoose.Types.ObjectId();
      const folder1Id = new mongoose.Types.ObjectId();

      vi.spyOn(File, 'find').mockReturnValue({
        select: vi.fn().mockResolvedValue([{ _id: file1Id }]),
      } as any);

      vi.spyOn(Folder, 'find').mockReturnValue({
        select: vi.fn().mockResolvedValue([{ _id: folder1Id }]),
      } as any);

      const permFileSpy = vi.spyOn(trashService, 'permanentlyDeleteFile').mockResolvedValue(undefined as any);
      const permFolderSpy = vi.spyOn(trashService, 'permanentlyDeleteFolder').mockResolvedValue(undefined as any);

      const res = await request(app)
        .delete('/api/v1/trash/empty')
        .set('Authorization', `Bearer ${tokenUserA}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(permFileSpy).toHaveBeenCalledWith(userAId, file1Id.toString());
      expect(permFolderSpy).toHaveBeenCalledWith(userAId, folder1Id.toString());
    });
  });

  describe('5. Background Cleanup Worker', () => {
    it('cleans up trash items older than retention threshold and preserves non-expired items', async () => {
      const expiredFileId = new mongoose.Types.ObjectId();
      const expiredFolderId = new mongoose.Types.ObjectId();

      const mockEligibleFiles = [{ _id: expiredFileId, ownerId: new mongoose.Types.ObjectId(userAId) }];
      const mockEligibleFolders = [{ _id: expiredFolderId, ownerId: new mongoose.Types.ObjectId(userAId) }];

      vi.spyOn(File, 'find').mockReturnValue({
        limit: vi.fn().mockReturnValue({
          select: vi.fn().mockResolvedValue(mockEligibleFiles),
        }),
      } as any);

      vi.spyOn(Folder, 'find').mockReturnValue({
        limit: vi.fn().mockReturnValue({
          select: vi.fn().mockResolvedValue(mockEligibleFolders),
        }),
      } as any);

      const permFileSpy = vi.spyOn(trashService, 'permanentlyDeleteFile').mockResolvedValue(undefined as any);
      const permFolderSpy = vi.spyOn(trashService, 'permanentlyDeleteFolder').mockResolvedValue(undefined as any);

      const mockJob = {
        id: 'job-trash-cleanup-1',
        name: CLEANUP_JOB_NAMES.CLEANUP_TRASH,
        data: { olderThanDays: 30, batchSize: 50 },
      } as any;

      const result = await processCleanupJob(mockJob);

      expect(result.scaffold).toBe(false);
      expect(result.cleanedFilesCount).toBe(1);
      expect(result.cleanedFoldersCount).toBe(1);
      expect(permFileSpy).toHaveBeenCalledWith(userAId, expiredFileId.toString());
      expect(permFolderSpy).toHaveBeenCalledWith(userAId, expiredFolderId.toString());
    });
  });
});

