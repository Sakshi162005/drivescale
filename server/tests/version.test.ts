import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import mongoose, { Types } from 'mongoose';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { Readable } from 'stream';
import { createApp } from '../src/app.js';
import { File } from '../src/models/File.js';
import { FileVersion } from '../src/models/FileVersion.js';
import { Folder } from '../src/models/Folder.js';
import { User } from '../src/models/User.js';
import { Share } from '../src/models/Share.js';
import { signAccessToken } from '../src/utils/jwt.js';
import { permissionService } from '../src/services/permission.service.js';
import { versionService } from '../src/services/version.service.js';
import { cacheService } from '../src/services/cache.service.js';
import { LocalStorageService } from '../src/services/storage/local-storage.service.js';
import { storageService } from '../src/services/storage/index.js';

describe('Phase 9 File Versioning Test Suite', () => {
  const app = createApp();

  const ownerId = new mongoose.Types.ObjectId().toString();
  const editUserId = new mongoose.Types.ObjectId().toString();
  const downloadUserId = new mongoose.Types.ObjectId().toString();
  const viewUserId = new mongoose.Types.ObjectId().toString();
  const strangerId = new mongoose.Types.ObjectId().toString();

  const tokenOwner = signAccessToken({ userId: ownerId, email: 'owner@example.com', role: 'user' });
  const tokenEditUser = signAccessToken({ userId: editUserId, email: 'editor@example.com', role: 'user' });
  const tokenDownloadUser = signAccessToken({ userId: downloadUserId, email: 'downloader@example.com', role: 'user' });
  const tokenViewUser = signAccessToken({ userId: viewUserId, email: 'viewer@example.com', role: 'user' });
  const tokenStranger = signAccessToken({ userId: strangerId, email: 'stranger@example.com', role: 'user' });

  const ownerUser = {
    _id: new mongoose.Types.ObjectId(ownerId),
    name: 'Owner User',
    email: 'owner@example.com',
    storageQuota: 10 * 1024 * 1024 * 1024,
    storageUsed: 1024 * 1024,
    isActive: true,
  };

  const testStorageDir = path.join(os.tmpdir(), `drivescale-version-test-${Date.now()}`);

  afterAll(async () => {
    try {
      await fs.promises.rm(testStorageDir, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  });

  beforeEach(() => {
    vi.restoreAllMocks();

    // Mock cacheService
    vi.spyOn(cacheService, 'get').mockResolvedValue(null);
    vi.spyOn(cacheService, 'set').mockResolvedValue(undefined);
    vi.spyOn(cacheService, 'del').mockResolvedValue(undefined);
    vi.spyOn(cacheService, 'delByPattern').mockResolvedValue(undefined);

    // Mock User.findById for auth & quota
    vi.spyOn(User, 'findById').mockImplementation((id: any) => {
      const idStr = id?.toString();
      if (idStr === ownerId) return Promise.resolve(ownerUser as any);
      if (idStr === editUserId) {
        return Promise.resolve({
          _id: new mongoose.Types.ObjectId(editUserId),
          name: 'Editor User',
          email: 'editor@example.com',
          storageQuota: 10 * 1024 * 1024 * 1024,
          storageUsed: 0,
          isActive: true,
        } as any);
      }
      if (idStr === downloadUserId) {
        return Promise.resolve({
          _id: new mongoose.Types.ObjectId(downloadUserId),
          name: 'Downloader User',
          email: 'downloader@example.com',
          isActive: true,
        } as any);
      }
      if (idStr === viewUserId) {
        return Promise.resolve({
          _id: new mongoose.Types.ObjectId(viewUserId),
          name: 'Viewer User',
          email: 'viewer@example.com',
          isActive: true,
        } as any);
      }
      if (idStr === strangerId) {
        return Promise.resolve({
          _id: new mongoose.Types.ObjectId(strangerId),
          name: 'Stranger User',
          email: 'stranger@example.com',
          isActive: true,
        } as any);
      }
      return Promise.resolve(null);
    });

    vi.spyOn(User, 'findByIdAndUpdate').mockResolvedValue({} as any);
  });

  describe('1. FileVersion Model & Creation', () => {
    it('creates initial version v1 on initial upload', async () => {
      const fileId = new Types.ObjectId();
      const mockFile = {
        _id: fileId,
        name: 'document.txt',
        ownerId: new Types.ObjectId(ownerId),
        folderId: null,
        storageKey: 'objects/aa/key-v1',
        size: 100,
        mimeType: 'text/plain',
        checksum: 'hash-v1',
        currentVersionId: null,
        versionCount: 1,
        save: vi.fn().mockResolvedValue(true),
      };

      vi.spyOn(FileVersion, 'findOne').mockResolvedValue(null);

      const fakeVersion = {
        _id: new Types.ObjectId(),
        fileId,
        versionNumber: 1,
        storageKey: 'objects/aa/key-v1',
        name: 'document.txt',
        size: 100,
        mimeType: 'text/plain',
        checksum: 'hash-v1',
        uploadedBy: new Types.ObjectId(ownerId),
      };
      vi.spyOn(FileVersion, 'create').mockResolvedValue(fakeVersion as any);

      const version = await versionService.createInitialVersion(mockFile as any);

      expect(version.versionNumber).toBe(1);
      expect(mockFile.currentVersionId).toEqual(fakeVersion._id);
      expect(mockFile.save).toHaveBeenCalled();
    });

    it('creates sequential new version on replacement upload', async () => {
      const fileId = new Types.ObjectId();
      const mockFile = {
        _id: fileId,
        name: 'document.txt',
        ownerId: new Types.ObjectId(ownerId),
        folderId: null,
        storageKey: 'objects/aa/key-v1',
        size: 100,
        mimeType: 'text/plain',
        checksum: 'hash-v1',
        currentVersionId: new Types.ObjectId(),
        versionCount: 1,
        isDeleted: false,
        save: vi.fn().mockResolvedValue(true),
      };

      vi.spyOn(File, 'findById').mockResolvedValue(mockFile as any);

      // Existing v1
      vi.spyOn(FileVersion, 'findOne').mockReturnValue({
        sort: vi.fn().mockResolvedValue({
          _id: new Types.ObjectId(),
          fileId,
          versionNumber: 1,
        }),
      } as any);

      const fakeV2 = {
        _id: new Types.ObjectId(),
        fileId,
        versionNumber: 2,
        storageKey: 'objects/bb/key-v2',
        name: 'document.txt',
        size: 250,
        mimeType: 'text/plain',
        checksum: 'hash-v2',
        uploadedBy: new Types.ObjectId(ownerId),
      };
      vi.spyOn(FileVersion, 'create').mockResolvedValue(fakeV2 as any);

      const newVersion = await versionService.createNewVersion(fileId.toString(), ownerId, {
        storageKey: 'objects/bb/key-v2',
        size: 250,
        checksum: 'hash-v2',
        mimeType: 'text/plain',
      });

      expect(newVersion.versionNumber).toBe(2);
      expect(mockFile.storageKey).toBe('objects/bb/key-v2');
      expect(mockFile.size).toBe(250);
      expect(mockFile.currentVersionId).toEqual(fakeV2._id);
      expect(mockFile.save).toHaveBeenCalled();
    });
  });

  describe('2. Version Listing API (GET /api/v1/files/:fileId/versions)', () => {
    it('returns versions ordered descending with current version identified', async () => {
      const fileId = new Types.ObjectId();
      const v1Id = new Types.ObjectId();
      const v2Id = new Types.ObjectId();

      const mockFile = {
        _id: fileId,
        name: 'report.pdf',
        ownerId: new Types.ObjectId(ownerId),
        folderId: null,
        currentVersionId: v2Id, // v2 is current
        isDeleted: false,
      };

      vi.spyOn(File, 'findById').mockResolvedValue(mockFile as any);
      vi.spyOn(permissionService, 'getFilePermission').mockResolvedValue('OWNER');

      const mockVersions = [
        {
          _id: v2Id,
          fileId,
          versionNumber: 2,
          storageKey: 'objects/22/key2',
          name: 'report.pdf',
          size: 2048,
          mimeType: 'application/pdf',
          checksum: 'hash2',
          uploadedBy: ownerUser,
          createdAt: new Date('2026-01-02'),
        },
        {
          _id: v1Id,
          fileId,
          versionNumber: 1,
          storageKey: 'objects/11/key1',
          name: 'report.pdf',
          size: 1024,
          mimeType: 'application/pdf',
          checksum: 'hash1',
          uploadedBy: ownerUser,
          createdAt: new Date('2026-01-01'),
        },
      ];

      vi.spyOn(FileVersion, 'find').mockReturnValue({
        populate: vi.fn().mockReturnValue({
          sort: vi.fn().mockResolvedValue(mockVersions),
        }),
      } as any);

      const res = await request(app)
        .get(`/api/v1/files/${fileId.toString()}/versions`)
        .set('Authorization', `Bearer ${tokenOwner}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.versions.length).toBe(2);
      expect(res.body.data.versions[0].versionNumber).toBe(2);
      expect(res.body.data.versions[0].isCurrent).toBe(true);
      expect(res.body.data.versions[1].versionNumber).toBe(1);
      expect(res.body.data.versions[1].isCurrent).toBe(false);
    });

    it('allows user with VIEW permission to list versions', async () => {
      const fileId = new Types.ObjectId();
      const mockFile = {
        _id: fileId,
        name: 'shared.pdf',
        ownerId: new Types.ObjectId(ownerId),
        folderId: null,
        currentVersionId: new Types.ObjectId(),
        isDeleted: false,
      };

      vi.spyOn(File, 'findById').mockResolvedValue(mockFile as any);
      vi.spyOn(permissionService, 'getFilePermission').mockResolvedValue('VIEW');

      vi.spyOn(FileVersion, 'find').mockReturnValue({
        populate: vi.fn().mockReturnValue({
          sort: vi.fn().mockResolvedValue([
            {
              _id: new Types.ObjectId(),
              fileId,
              versionNumber: 1,
              uploadedBy: ownerUser,
              createdAt: new Date(),
            },
          ]),
        }),
      } as any);

      const res = await request(app)
        .get(`/api/v1/files/${fileId.toString()}/versions`)
        .set('Authorization', `Bearer ${tokenViewUser}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.versions.length).toBe(1);
    });

    it('rejects version listing for stranger user without access (403)', async () => {
      const fileId = new Types.ObjectId();
      const mockFile = {
        _id: fileId,
        name: 'private.pdf',
        ownerId: new Types.ObjectId(ownerId),
        folderId: null,
        isDeleted: false,
      };

      vi.spyOn(File, 'findById').mockResolvedValue(mockFile as any);
      vi.spyOn(permissionService, 'getFilePermission').mockResolvedValue(null);

      const res = await request(app)
        .get(`/api/v1/files/${fileId.toString()}/versions`)
        .set('Authorization', `Bearer ${tokenStranger}`);

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });
  });

  describe('3. Version Download API (GET /api/v1/files/:fileId/versions/:versionId/download)', () => {
    it('downloads historical version content with correct headers', async () => {
      const fileId = new Types.ObjectId();
      const versionId = new Types.ObjectId();
      const v1Key = 'objects/test/v1.txt';

      const mockFile = {
        _id: fileId,
        name: 'data.txt',
        ownerId: new Types.ObjectId(ownerId),
        isDeleted: false,
      };

      const mockVersion = {
        _id: versionId,
        fileId,
        versionNumber: 1,
        storageKey: v1Key,
        name: 'data-v1.txt',
        size: 14,
        mimeType: 'text/plain',
        checksum: 'hash1',
      };

      vi.spyOn(File, 'findById').mockResolvedValue(mockFile as any);
      vi.spyOn(FileVersion, 'findOne').mockResolvedValue(mockVersion as any);
      vi.spyOn(permissionService, 'getFilePermission').mockResolvedValue('DOWNLOAD');
      vi.spyOn(storageService, 'exists').mockResolvedValue(true);
      vi.spyOn(storageService, 'createReadStream').mockResolvedValue(
        Readable.from(Buffer.from('Historical v1!')) as any
      );

      const res = await request(app)
        .get(`/api/v1/files/${fileId.toString()}/versions/${versionId.toString()}/download`)
        .set('Authorization', `Bearer ${tokenDownloadUser}`);

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/plain');
      expect(res.headers['content-disposition']).toContain('data-v1.txt');
      expect(res.text).toBe('Historical v1!');
    });

    it('blocks user with VIEW-only permission from downloading version (403)', async () => {
      const fileId = new Types.ObjectId();
      const versionId = new Types.ObjectId();

      const mockFile = {
        _id: fileId,
        name: 'data.txt',
        ownerId: new Types.ObjectId(ownerId),
        isDeleted: false,
      };

      vi.spyOn(File, 'findById').mockResolvedValue(mockFile as any);
      vi.spyOn(permissionService, 'getFilePermission').mockResolvedValue('VIEW');

      const res = await request(app)
        .get(`/api/v1/files/${fileId.toString()}/versions/${versionId.toString()}/download`)
        .set('Authorization', `Bearer ${tokenViewUser}`);

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('returns 404 when requested version does not belong to file', async () => {
      const fileId = new Types.ObjectId();
      const versionId = new Types.ObjectId();

      const mockFile = {
        _id: fileId,
        name: 'data.txt',
        ownerId: new Types.ObjectId(ownerId),
        isDeleted: false,
      };

      vi.spyOn(File, 'findById').mockResolvedValue(mockFile as any);
      vi.spyOn(permissionService, 'getFilePermission').mockResolvedValue('OWNER');
      vi.spyOn(FileVersion, 'findOne').mockResolvedValue(null); // Not found for this fileId

      const res = await request(app)
        .get(`/api/v1/files/${fileId.toString()}/versions/${versionId.toString()}/download`)
        .set('Authorization', `Bearer ${tokenOwner}`);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('VERSION_NOT_FOUND');
    });
  });

  describe('4. Restore Previous Version (POST /api/v1/files/:fileId/versions/:versionId/restore)', () => {
    it('restores historical version as a new current version preserving previous history', async () => {
      const fileId = new Types.ObjectId();
      const v1Id = new Types.ObjectId();
      const v2Id = new Types.ObjectId();

      const mockFile = {
        _id: fileId,
        name: 'project.docx',
        ownerId: new Types.ObjectId(ownerId),
        storageKey: 'objects/22/key2',
        size: 500,
        mimeType: 'application/vnd.openxmlformats',
        checksum: 'hash2',
        currentVersionId: v2Id,
        versionCount: 2,
        isDeleted: false,
        save: vi.fn().mockResolvedValue(true),
      };

      const targetV1 = {
        _id: v1Id,
        fileId,
        versionNumber: 1,
        storageKey: 'objects/11/key1',
        name: 'project.docx',
        size: 300,
        mimeType: 'application/vnd.openxmlformats',
        checksum: 'hash1',
      };

      vi.spyOn(File, 'findById').mockResolvedValue(mockFile as any);
      vi.spyOn(permissionService, 'getFilePermission').mockResolvedValue('EDIT');
      vi.spyOn(FileVersion, 'findOne')
        .mockResolvedValueOnce(targetV1 as any) // target lookup
        .mockReturnValueOnce({
          sort: vi.fn().mockResolvedValue({ versionNumber: 2 }), // highest version lookup
        } as any);

      vi.spyOn(storageService, 'exists').mockResolvedValue(true);
      vi.spyOn(storageService, 'createReadStream').mockResolvedValue(Readable.from('v1 bytes') as any);
      vi.spyOn(storageService, 'upload').mockResolvedValue({ size: 300, checksum: 'hash1-restored' });

      const fakeV3 = {
        _id: new Types.ObjectId(),
        fileId,
        versionNumber: 3,
        storageKey: 'objects/33/new-key3',
        size: 300,
        name: 'project.docx',
      };
      vi.spyOn(FileVersion, 'create').mockResolvedValue(fakeV3 as any);

      const res = await request(app)
        .post(`/api/v1/files/${fileId.toString()}/versions/${v1Id.toString()}/restore`)
        .set('Authorization', `Bearer ${tokenEditUser}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(mockFile.currentVersionId).toEqual(fakeV3._id);
      expect(mockFile.versionCount).toBe(3);
      expect(cacheService.del).toHaveBeenCalled();
    });

    it('rejects restore from user with only DOWNLOAD permission (403)', async () => {
      const fileId = new Types.ObjectId();
      const v1Id = new Types.ObjectId();

      const mockFile = {
        _id: fileId,
        name: 'project.docx',
        ownerId: new Types.ObjectId(ownerId),
        isDeleted: false,
      };

      vi.spyOn(File, 'findById').mockResolvedValue(mockFile as any);
      vi.spyOn(permissionService, 'getFilePermission').mockResolvedValue('DOWNLOAD');

      const res = await request(app)
        .post(`/api/v1/files/${fileId.toString()}/versions/${v1Id.toString()}/restore`)
        .set('Authorization', `Bearer ${tokenDownloadUser}`);

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });
  });

  describe('5. Replacement Upload Endpoints', () => {
    it('uploads new replacement version via POST /api/v1/files/:fileId/versions', async () => {
      const fileId = new Types.ObjectId();
      const mockFile = {
        _id: fileId,
        name: 'notes.txt',
        ownerId: new Types.ObjectId(ownerId),
        folderId: null,
        storageKey: 'objects/11/old-key',
        size: 50,
        mimeType: 'text/plain',
        checksum: 'old-hash',
        currentVersionId: new Types.ObjectId(),
        versionCount: 1,
        isDeleted: false,
        save: vi.fn().mockResolvedValue(true),
      };

      vi.spyOn(File, 'findById').mockResolvedValue(mockFile as any);
      vi.spyOn(permissionService, 'canEditFile').mockResolvedValue(true);
      vi.spyOn(storageService, 'upload').mockImplementation(async (_key, stream) => {
        stream.resume();
        return { size: 120, checksum: 'new-hash' };
      });

      vi.spyOn(FileVersion, 'findOne').mockReturnValue({
        sort: vi.fn().mockResolvedValue({ versionNumber: 1 }),
      } as any);

      const fakeV2 = {
        _id: new Types.ObjectId(),
        fileId,
        versionNumber: 2,
        storageKey: 'objects/22/new-key',
        size: 120,
      };
      vi.spyOn(FileVersion, 'create').mockResolvedValue(fakeV2 as any);

      const res = await request(app)
        .post(`/api/v1/files/${fileId.toString()}/versions`)
        .set('Authorization', `Bearer ${tokenOwner}`)
        .attach('file', Buffer.from('Updated version 2 content'), 'notes.txt');

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(mockFile.currentVersionId).toEqual(fakeV2._id);
    });

    it('rejects replacement upload if requester lacks edit permission (403)', async () => {
      const fileId = new Types.ObjectId();
      const mockFile = {
        _id: fileId,
        name: 'notes.txt',
        ownerId: new Types.ObjectId(ownerId),
        isDeleted: false,
      };

      vi.spyOn(File, 'findById').mockResolvedValue(mockFile as any);
      vi.spyOn(permissionService, 'canEditFile').mockResolvedValue(false);
      vi.spyOn(storageService, 'upload').mockImplementation(async (_key, stream) => {
        stream.resume();
        return { size: 120, checksum: 'new-hash' };
      });

      const res = await request(app)
        .post(`/api/v1/files/${fileId.toString()}/versions`)
        .set('Authorization', `Bearer ${tokenViewUser}`)
        .attach('file', Buffer.from('Updated version 2 content'), 'notes.txt');

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('creates initial version record on initial POST /api/v1/files upload', async () => {
      vi.spyOn(File, 'findOne').mockResolvedValue(null);
      vi.spyOn(storageService, 'upload').mockImplementation(async (_key, stream) => {
        stream.resume();
        return { size: 80, checksum: 'initial-hash' };
      });

      const fakeFileId = new Types.ObjectId();
      const fakeFile = {
        _id: fakeFileId,
        name: 'brand-new.pdf',
        ownerId: new Types.ObjectId(ownerId),
        folderId: null,
        storageKey: 'objects/33/key',
        size: 80,
        mimeType: 'application/pdf',
        checksum: 'initial-hash',
        currentVersionId: null,
        save: vi.fn().mockResolvedValue(true),
      };
      vi.spyOn(File, 'create').mockResolvedValue(fakeFile as any);

      const fakeV1 = {
        _id: new Types.ObjectId(),
        fileId: fakeFileId,
        versionNumber: 1,
      };
      const vCreateSpy = vi.spyOn(FileVersion, 'create').mockResolvedValue(fakeV1 as any);

      const res = await request(app)
        .post('/api/v1/files')
        .set('Authorization', `Bearer ${tokenOwner}`)
        .attach('file', Buffer.from('brand-new-pdf-bytes'), 'brand-new.pdf');

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(vCreateSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          versionNumber: 1,
        })
      );
    });

    it('GET /api/v1/files/:fileId/versions/:versionId returns version metadata', async () => {
      const fileId = new Types.ObjectId();
      const versionId = new Types.ObjectId();

      const mockFile = {
        _id: fileId,
        name: 'notes.txt',
        ownerId: new Types.ObjectId(ownerId),
        currentVersionId: versionId,
        isDeleted: false,
      };

      const mockVersion = {
        _id: versionId,
        fileId,
        versionNumber: 1,
        storageKey: 'objects/11/key',
        name: 'notes.txt',
        size: 100,
        mimeType: 'text/plain',
        checksum: 'hash',
        uploadedBy: ownerUser,
      };

      vi.spyOn(File, 'findById').mockResolvedValue(mockFile as any);
      vi.spyOn(permissionService, 'getFilePermission').mockResolvedValue('VIEW');
      vi.spyOn(FileVersion, 'findOne').mockReturnValue({
        populate: vi.fn().mockResolvedValue(mockVersion),
      } as any);

      const res = await request(app)
        .get(`/api/v1/files/${fileId.toString()}/versions/${versionId.toString()}`)
        .set('Authorization', `Bearer ${tokenViewUser}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.version.versionNumber).toBe(1);
      expect(res.body.data.isCurrent).toBe(true);
    });
  });
});
