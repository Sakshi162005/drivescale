import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import mongoose, { Types } from 'mongoose';
import { createApp } from '../src/app.js';
import { Share } from '../src/models/Share.js';
import { File } from '../src/models/File.js';
import { Folder } from '../src/models/Folder.js';
import { User } from '../src/models/User.js';
import { signAccessToken } from '../src/utils/jwt.js';
import { permissionService } from '../src/services/permission.service.js';
import { shareService } from '../src/services/share.service.js';
import { cacheService } from '../src/services/cache.service.js';

describe('Phase 8 Sharing & Permissions Test Suite', () => {
  const app = createApp();

  const ownerId = new mongoose.Types.ObjectId().toString();
  const recipientId = new mongoose.Types.ObjectId().toString();
  const strangerId = new mongoose.Types.ObjectId().toString();

  const tokenOwner = signAccessToken({ userId: ownerId, email: 'owner@example.com', role: 'user' });
  const tokenRecipient = signAccessToken({ userId: recipientId, email: 'recipient@example.com', role: 'user' });
  const tokenStranger = signAccessToken({ userId: strangerId, email: 'stranger@example.com', role: 'user' });

  const ownerUser = {
    _id: new mongoose.Types.ObjectId(ownerId),
    name: 'Owner User',
    email: 'owner@example.com',
    isActive: true,
  };

  const recipientUser = {
    _id: new mongoose.Types.ObjectId(recipientId),
    name: 'Recipient User',
    email: 'recipient@example.com',
    isActive: true,
  };

  const strangerUser = {
    _id: new mongoose.Types.ObjectId(strangerId),
    name: 'Stranger User',
    email: 'stranger@example.com',
    isActive: true,
  };

  beforeEach(() => {
    vi.restoreAllMocks();

    // Mock cacheService
    vi.spyOn(cacheService, 'get').mockResolvedValue(null);
    vi.spyOn(cacheService, 'set').mockResolvedValue(undefined);
    vi.spyOn(cacheService, 'del').mockResolvedValue(undefined);
    vi.spyOn(cacheService, 'delByPattern').mockResolvedValue(undefined);

    // Mock User.findById for auth middleware
    vi.spyOn(User, 'findById').mockImplementation((id: any) => {
      const idStr = id?.toString();
      if (idStr === ownerId) return Promise.resolve(ownerUser as any);
      if (idStr === recipientId) return Promise.resolve(recipientUser as any);
      if (idStr === strangerId) return Promise.resolve(strangerUser as any);
      return Promise.resolve(null);
    });

    // Mock User.findOne for recipient lookup
    vi.spyOn(User, 'findOne').mockImplementation((query: any) => {
      if (query?.email === 'recipient@example.com' || query?._id?.toString() === recipientId) {
        return Promise.resolve(recipientUser as any);
      }
      if (query?.email === 'owner@example.com' || query?._id?.toString() === ownerId) {
        return Promise.resolve(ownerUser as any);
      }
      return Promise.resolve(null);
    });
  });

  describe('1. PermissionService Unit Tests', () => {
    it('grants OWNER effective permission to resource owner', async () => {
      const file = {
        _id: new Types.ObjectId(),
        name: 'test.pdf',
        ownerId: new Types.ObjectId(ownerId),
        folderId: null,
      } as any;

      const perm = await permissionService.getFilePermission(ownerId, file);
      expect(perm).toBe('OWNER');
      expect(permissionService.canView(perm)).toBe(true);
      expect(permissionService.canDownload(perm)).toBe(true);
      expect(permissionService.canEdit(perm)).toBe(true);
      expect(permissionService.canDelete(perm)).toBe(true);
      expect(permissionService.canShare(perm)).toBe(true);
    });

    it('returns null for unshared file and stranger user', async () => {
      const file = {
        _id: new Types.ObjectId(),
        name: 'private.pdf',
        ownerId: new Types.ObjectId(ownerId),
        folderId: null,
      } as any;

      vi.spyOn(Share, 'findOne').mockResolvedValue(null);

      const perm = await permissionService.getFilePermission(strangerId, file);
      expect(perm).toBeNull();
      expect(permissionService.canView(perm)).toBe(false);
      expect(permissionService.canDownload(perm)).toBe(false);
      expect(permissionService.canEdit(perm)).toBe(false);
    });

    it('enforces permission hierarchy: EDIT > DOWNLOAD > VIEW', () => {
      expect(permissionService.canView('VIEW')).toBe(true);
      expect(permissionService.canDownload('VIEW')).toBe(false);
      expect(permissionService.canEdit('VIEW')).toBe(false);

      expect(permissionService.canView('DOWNLOAD')).toBe(true);
      expect(permissionService.canDownload('DOWNLOAD')).toBe(true);
      expect(permissionService.canEdit('DOWNLOAD')).toBe(false);

      expect(permissionService.canView('EDIT')).toBe(true);
      expect(permissionService.canDownload('EDIT')).toBe(true);
      expect(permissionService.canEdit('EDIT')).toBe(true);
    });

    it('resolves direct file share permission accurately', async () => {
      const file = {
        _id: new Types.ObjectId(),
        name: 'shared.pdf',
        ownerId: new Types.ObjectId(ownerId),
        folderId: null,
      } as any;

      vi.spyOn(Share, 'findOne').mockResolvedValue({
        _id: new Types.ObjectId(),
        resourceType: 'FILE',
        resourceId: file._id,
        recipientId: new Types.ObjectId(recipientId),
        permission: 'DOWNLOAD',
        expiresAt: null,
      } as any);

      const perm = await permissionService.getFilePermission(recipientId, file);
      expect(perm).toBe('DOWNLOAD');
      expect(permissionService.canView(perm)).toBe(true);
      expect(permissionService.canDownload(perm)).toBe(true);
      expect(permissionService.canEdit(perm)).toBe(false);
    });

    it('ignores expired shares', async () => {
      const file = {
        _id: new Types.ObjectId(),
        name: 'expired.pdf',
        ownerId: new Types.ObjectId(ownerId),
        folderId: null,
      } as any;

      vi.spyOn(Share, 'findOne').mockResolvedValue({
        _id: new Types.ObjectId(),
        resourceType: 'FILE',
        resourceId: file._id,
        recipientId: new Types.ObjectId(recipientId),
        permission: 'EDIT',
        expiresAt: new Date(Date.now() - 60000), // Expired 1 min ago
      } as any);

      const perm = await permissionService.getFilePermission(recipientId, file);
      expect(perm).toBeNull();
    });

    it('inherits permission from parent folder when file is not directly shared', async () => {
      const parentFolderId = new Types.ObjectId();
      const parentFolder = {
        _id: parentFolderId,
        name: 'Shared Folder',
        ownerId: new Types.ObjectId(ownerId),
        parentId: null,
        isDeleted: false,
      };

      const file = {
        _id: new Types.ObjectId(),
        name: 'nested.pdf',
        ownerId: new Types.ObjectId(ownerId),
        folderId: parentFolderId,
      } as any;

      vi.spyOn(Folder, 'findById').mockResolvedValue(parentFolder as any);

      // File has no direct share, but parent folder is shared with EDIT
      vi.spyOn(Share, 'find').mockImplementation((filter: any) => {
        if (filter.resourceType === 'FOLDER' && filter.resourceId?.$in?.some((id: any) => id.equals(parentFolderId))) {
          return Promise.resolve([
            {
              resourceType: 'FOLDER',
              resourceId: parentFolderId,
              recipientId: new Types.ObjectId(recipientId),
              permission: 'EDIT',
              expiresAt: null,
            },
          ] as any);
        }
        return Promise.resolve([] as any);
      });

      const perm = await permissionService.getFilePermission(recipientId, file);
      expect(perm).toBe('EDIT');
      expect(permissionService.canEdit(perm)).toBe(true);
    });

    it('resolves to most permissive when file has direct VIEW but folder has EDIT', async () => {
      const parentFolderId = new Types.ObjectId();
      const parentFolder = {
        _id: parentFolderId,
        name: 'Shared Folder',
        ownerId: new Types.ObjectId(ownerId),
        parentId: null,
        isDeleted: false,
      };

      const file = {
        _id: new Types.ObjectId(),
        name: 'nested.pdf',
        ownerId: new Types.ObjectId(ownerId),
        folderId: parentFolderId,
      } as any;

      vi.spyOn(Folder, 'findById').mockResolvedValue(parentFolder as any);

      vi.spyOn(Share, 'find').mockImplementation((filter: any) => {
        if (filter.resourceType === 'FILE') {
          return Promise.resolve([
            {
              resourceType: 'FILE',
              resourceId: file._id,
              recipientId: new Types.ObjectId(recipientId),
              permission: 'VIEW', // Direct share is only VIEW
              expiresAt: null,
            },
          ] as any);
        }
        if (filter.resourceType === 'FOLDER') {
          return Promise.resolve([
            {
              resourceType: 'FOLDER',
              resourceId: parentFolderId,
              recipientId: new Types.ObjectId(recipientId),
              permission: 'EDIT', // Folder share is EDIT
              expiresAt: null,
            },
          ] as any);
        }
        return Promise.resolve([] as any);
      });

      const perm = await permissionService.getFilePermission(recipientId, file);
      expect(perm).toBe('EDIT'); // Highest wins
    });

    it('handles cyclic folder hierarchy gracefully without hanging', async () => {
      const folderAId = new Types.ObjectId();
      const folderBId = new Types.ObjectId();

      const folderA = { _id: folderAId, parentId: folderBId, isDeleted: false };
      const folderB = { _id: folderBId, parentId: folderAId, isDeleted: false };

      vi.spyOn(Folder, 'findById').mockImplementation((id: any) => {
        if (id.equals(folderAId)) return Promise.resolve(folderA as any);
        if (id.equals(folderBId)) return Promise.resolve(folderB as any);
        return Promise.resolve(null);
      });

      const ancestors = await permissionService.getAncestorFolderIds(folderAId);
      expect(ancestors.length).toBeLessThanOrEqual(2);
    });
  });

  describe('2. ShareService Unit Tests', () => {
    it('prevents a user from sharing a resource with themselves', async () => {
      const fileId = new Types.ObjectId().toString();
      vi.spyOn(File, 'findById').mockResolvedValue({
        _id: new Types.ObjectId(fileId),
        ownerId: new Types.ObjectId(ownerId),
        name: 'test.txt',
        isDeleted: false,
      } as any);

      await expect(
        shareService.shareResource(ownerId, 'FILE', fileId, {
          recipientEmail: 'owner@example.com',
          permission: 'VIEW',
        })
      ).rejects.toThrow('You cannot share a resource with yourself');
    });

    it('rejects sharing if requester is not the resource owner', async () => {
      const fileId = new Types.ObjectId().toString();
      vi.spyOn(File, 'findById').mockResolvedValue({
        _id: new Types.ObjectId(fileId),
        ownerId: new Types.ObjectId(ownerId), // owned by ownerId
        name: 'test.txt',
        isDeleted: false,
      } as any);

      await expect(
        shareService.shareResource(strangerId, 'FILE', fileId, {
          recipientEmail: 'recipient@example.com',
          permission: 'VIEW',
        })
      ).rejects.toThrow('Only the file owner can manage sharing');
    });

    it('creates a new share if none exists', async () => {
      const fileId = new Types.ObjectId().toString();
      vi.spyOn(File, 'findById').mockResolvedValue({
        _id: new Types.ObjectId(fileId),
        ownerId: new Types.ObjectId(ownerId),
        name: 'test.txt',
        isDeleted: false,
      } as any);

      vi.spyOn(Share, 'findOne').mockResolvedValue(null);

      const fakeShare = {
        _id: new Types.ObjectId(),
        ownerId: new Types.ObjectId(ownerId),
        recipientId: new Types.ObjectId(recipientId),
        resourceType: 'FILE',
        resourceId: new Types.ObjectId(fileId),
        permission: 'VIEW',
        populate: vi.fn().mockResolvedValue(true),
      };
      vi.spyOn(Share, 'create').mockResolvedValue(fakeShare as any);

      const result = await shareService.shareResource(ownerId, 'FILE', fileId, {
        recipientEmail: 'recipient@example.com',
        permission: 'VIEW',
      });

      expect(result).toBeDefined();
      expect(Share.create).toHaveBeenCalled();
    });

    it('updates existing share if already shared (upsert)', async () => {
      const fileId = new Types.ObjectId().toString();
      vi.spyOn(File, 'findById').mockResolvedValue({
        _id: new Types.ObjectId(fileId),
        ownerId: new Types.ObjectId(ownerId),
        name: 'test.txt',
        isDeleted: false,
      } as any);

      const existingShare = {
        _id: new Types.ObjectId(),
        permission: 'VIEW',
        expiresAt: null,
        save: vi.fn().mockResolvedValue(true),
        populate: vi.fn().mockResolvedValue(true),
      };
      vi.spyOn(Share, 'findOne').mockResolvedValue(existingShare as any);

      const result = await shareService.shareResource(ownerId, 'FILE', fileId, {
        recipientEmail: 'recipient@example.com',
        permission: 'EDIT',
      });

      expect(existingShare.permission).toBe('EDIT');
      expect(existingShare.save).toHaveBeenCalled();
    });

    it('revokes an existing share and invalidates caches', async () => {
      const shareId = new Types.ObjectId().toString();
      const existingShare = {
        _id: new Types.ObjectId(shareId),
        ownerId: new Types.ObjectId(ownerId),
        recipientId: new Types.ObjectId(recipientId),
      };

      vi.spyOn(Share, 'findById').mockResolvedValue(existingShare as any);
      const deleteSpy = vi.spyOn(Share, 'findByIdAndDelete').mockResolvedValue(existingShare as any);

      await shareService.revokeShare(ownerId, shareId);
      expect(deleteSpy).toHaveBeenCalledWith(shareId);
      expect(cacheService.delByPattern).toHaveBeenCalled();
    });
  });

  describe('3. File Sharing HTTP Endpoints', () => {
    it('POST /api/v1/shares/files/:fileId shares a file with a recipient', async () => {
      const fileId = new Types.ObjectId().toString();
      vi.spyOn(File, 'findById').mockResolvedValue({
        _id: new Types.ObjectId(fileId),
        ownerId: new Types.ObjectId(ownerId),
        name: 'report.pdf',
        isDeleted: false,
      } as any);

      vi.spyOn(Share, 'findOne').mockResolvedValue(null);

      const fakeShare = {
        _id: new Types.ObjectId(),
        ownerId: new Types.ObjectId(ownerId),
        recipientId: recipientUser,
        resourceType: 'FILE',
        resourceId: new Types.ObjectId(fileId),
        permission: 'DOWNLOAD',
        expiresAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        populate: vi.fn().mockImplementation(function (this: any) {
          return Promise.resolve(this);
        }),
      };
      vi.spyOn(Share, 'create').mockResolvedValue(fakeShare as any);

      const res = await request(app)
        .post(`/api/v1/shares/files/${fileId}`)
        .set('Authorization', `Bearer ${tokenOwner}`)
        .send({
          recipientEmail: 'recipient@example.com',
          permission: 'DOWNLOAD',
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.share.permission).toBe('DOWNLOAD');
    });

    it('rejects POST /api/v1/shares/files/:fileId from non-owner (403)', async () => {
      const fileId = new Types.ObjectId().toString();
      vi.spyOn(File, 'findById').mockResolvedValue({
        _id: new Types.ObjectId(fileId),
        ownerId: new Types.ObjectId(ownerId),
        name: 'report.pdf',
        isDeleted: false,
      } as any);

      const res = await request(app)
        .post(`/api/v1/shares/files/${fileId}`)
        .set('Authorization', `Bearer ${tokenStranger}`)
        .send({
          recipientEmail: 'recipient@example.com',
          permission: 'VIEW',
        });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('GET /api/v1/shares/files/:fileId lists shares for a file (owner only)', async () => {
      const fileId = new Types.ObjectId().toString();
      vi.spyOn(File, 'findById').mockResolvedValue({
        _id: new Types.ObjectId(fileId),
        ownerId: new Types.ObjectId(ownerId),
        name: 'report.pdf',
        isDeleted: false,
      } as any);

      const mockShares = [
        {
          _id: new Types.ObjectId(),
          ownerId: new Types.ObjectId(ownerId),
          recipientId: recipientUser,
          resourceType: 'FILE',
          resourceId: new Types.ObjectId(fileId),
          permission: 'VIEW',
          createdAt: new Date(),
        },
      ];

      vi.spyOn(Share, 'find').mockReturnValue({
        populate: vi.fn().mockReturnValue({
          sort: vi.fn().mockResolvedValue(mockShares),
        }),
      } as any);

      const res = await request(app)
        .get(`/api/v1/shares/files/${fileId}`)
        .set('Authorization', `Bearer ${tokenOwner}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.shares.length).toBe(1);
    });

    it('PATCH /api/v1/shares/files/:fileId/:shareId updates share permission', async () => {
      const fileId = new Types.ObjectId().toString();
      const shareId = new Types.ObjectId().toString();

      const existingShare = {
        _id: new Types.ObjectId(shareId),
        ownerId: new Types.ObjectId(ownerId),
        recipientId: new Types.ObjectId(recipientId),
        resourceType: 'FILE',
        resourceId: new Types.ObjectId(fileId),
        permission: 'VIEW',
        save: vi.fn().mockResolvedValue(true),
        populate: vi.fn().mockResolvedValue(true),
      };

      vi.spyOn(Share, 'findById').mockResolvedValue(existingShare as any);

      const res = await request(app)
        .patch(`/api/v1/shares/files/${fileId}/${shareId}`)
        .set('Authorization', `Bearer ${tokenOwner}`)
        .send({ permission: 'EDIT' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(existingShare.permission).toBe('EDIT');
    });

    it('DELETE /api/v1/shares/files/:fileId/:shareId revokes access', async () => {
      const fileId = new Types.ObjectId().toString();
      const shareId = new Types.ObjectId().toString();

      const existingShare = {
        _id: new Types.ObjectId(shareId),
        ownerId: new Types.ObjectId(ownerId),
        recipientId: new Types.ObjectId(recipientId),
      };

      vi.spyOn(Share, 'findById').mockResolvedValue(existingShare as any);
      vi.spyOn(Share, 'findByIdAndDelete').mockResolvedValue(existingShare as any);

      const res = await request(app)
        .delete(`/api/v1/shares/files/${fileId}/${shareId}`)
        .set('Authorization', `Bearer ${tokenOwner}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.revoked).toBe(true);
    });
  });

  describe('4. Folder Sharing HTTP Endpoints', () => {
    it('POST /api/v1/shares/folders/:folderId shares a folder with a recipient', async () => {
      const folderId = new Types.ObjectId().toString();
      vi.spyOn(Folder, 'findById').mockResolvedValue({
        _id: new Types.ObjectId(folderId),
        ownerId: new Types.ObjectId(ownerId),
        name: 'Shared Docs',
        isDeleted: false,
      } as any);

      vi.spyOn(Share, 'findOne').mockResolvedValue(null);

      const fakeShare = {
        _id: new Types.ObjectId(),
        ownerId: new Types.ObjectId(ownerId),
        recipientId: recipientUser,
        resourceType: 'FOLDER',
        resourceId: new Types.ObjectId(folderId),
        permission: 'EDIT',
        expiresAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        populate: vi.fn().mockImplementation(function (this: any) {
          return Promise.resolve(this);
        }),
      };
      vi.spyOn(Share, 'create').mockResolvedValue(fakeShare as any);

      const res = await request(app)
        .post(`/api/v1/shares/folders/${folderId}`)
        .set('Authorization', `Bearer ${tokenOwner}`)
        .send({
          recipientEmail: 'recipient@example.com',
          permission: 'EDIT',
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.share.permission).toBe('EDIT');
    });

    it('GET /api/v1/shares/folders/:folderId lists folder shares', async () => {
      const folderId = new Types.ObjectId().toString();
      vi.spyOn(Folder, 'findById').mockResolvedValue({
        _id: new Types.ObjectId(folderId),
        ownerId: new Types.ObjectId(ownerId),
        name: 'Shared Docs',
        isDeleted: false,
      } as any);

      vi.spyOn(Share, 'find').mockReturnValue({
        populate: vi.fn().mockReturnValue({
          sort: vi.fn().mockResolvedValue([]),
        }),
      } as any);

      const res = await request(app)
        .get(`/api/v1/shares/folders/${folderId}`)
        .set('Authorization', `Bearer ${tokenOwner}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.shares).toEqual([]);
    });
  });

  describe('5. Shared With Me Endpoints', () => {
    it('GET /api/v1/shares/with-me lists items shared with current user', async () => {
      const fileId = new Types.ObjectId();
      const mockShare = {
        _id: new Types.ObjectId(),
        ownerId: ownerUser,
        recipientId: new Types.ObjectId(recipientId),
        resourceType: 'FILE',
        resourceId: fileId,
        permission: 'DOWNLOAD',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      vi.spyOn(Share, 'find').mockReturnValue({
        populate: vi.fn().mockReturnValue({
          sort: vi.fn().mockResolvedValue([mockShare]),
        }),
      } as any);

      const mockFile = {
        _id: fileId,
        name: 'shared-notes.txt',
        size: 512,
        mimeType: 'text/plain',
        ownerId: new Types.ObjectId(ownerId),
        folderId: null,
        isDeleted: false,
      };

      vi.spyOn(File, 'findById').mockResolvedValue(mockFile as any);
      vi.spyOn(permissionService, 'getFilePermission').mockResolvedValue('DOWNLOAD');

      const res = await request(app)
        .get('/api/v1/shares/with-me')
        .set('Authorization', `Bearer ${tokenRecipient}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.items.length).toBe(1);
      expect(res.body.data.items[0].name).toBe('shared-notes.txt');
      expect(res.body.data.items[0].permission).toBe('DOWNLOAD');
      expect(res.body.data.items[0].effectivePermission).toBe('DOWNLOAD');
      expect(res.body.data.items[0].owner.email).toBe('owner@example.com');
    });

    it('GET /api/v1/shares/with-me/folders/:folderId navigates shared folder hierarchy', async () => {
      const folderId = new Types.ObjectId().toString();
      const sharedFolder = {
        _id: new Types.ObjectId(folderId),
        name: 'Shared Project',
        ownerId: new Types.ObjectId(ownerId),
        parentId: null,
        isDeleted: false,
      };

      vi.spyOn(Folder, 'findById').mockResolvedValue(sharedFolder as any);
      vi.spyOn(permissionService, 'getFolderPermission').mockResolvedValue('EDIT');

      const subFolder = {
        _id: new Types.ObjectId(),
        name: 'Subfolder',
        parentId: sharedFolder._id,
        isDeleted: false,
      };
      const subFile = {
        _id: new Types.ObjectId(),
        name: 'subfile.txt',
        folderId: sharedFolder._id,
        isDeleted: false,
      };

      vi.spyOn(Folder, 'find').mockReturnValue({
        sort: vi.fn().mockResolvedValue([subFolder]),
      } as any);

      vi.spyOn(File, 'find').mockReturnValue({
        sort: vi.fn().mockResolvedValue([subFile]),
      } as any);

      const res = await request(app)
        .get(`/api/v1/shares/with-me/folders/${folderId}`)
        .set('Authorization', `Bearer ${tokenRecipient}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.effectivePermission).toBe('EDIT');
      expect(res.body.data.subfolders.length).toBe(1);
      expect(res.body.data.files.length).toBe(1);
    });
  });

  describe('6. Permission Enforcement on Files and Folders Endpoints', () => {
    it('allows recipient with VIEW to get file metadata, but blocks download (403)', async () => {
      const fileId = new Types.ObjectId().toString();
      const mockFile = {
        _id: new Types.ObjectId(fileId),
        name: 'view-only.pdf',
        size: 1024,
        mimeType: 'application/pdf',
        ownerId: new Types.ObjectId(ownerId),
        folderId: null,
        isDeleted: false,
      };

      vi.spyOn(File, 'findById').mockResolvedValue(mockFile as any);
      // Recipient has VIEW permission
      vi.spyOn(permissionService, 'getFilePermission').mockResolvedValue('VIEW');

      // Metadata GET /api/v1/files/:id
      const metaRes = await request(app)
        .get(`/api/v1/files/${fileId}`)
        .set('Authorization', `Bearer ${tokenRecipient}`);

      expect(metaRes.status).toBe(200);
      expect(metaRes.body.success).toBe(true);
      expect(metaRes.body.data.file.name).toBe('view-only.pdf');

      // Download GET /api/v1/files/:id/download -> 403 Forbidden
      const downloadRes = await request(app)
        .get(`/api/v1/files/${fileId}/download`)
        .set('Authorization', `Bearer ${tokenRecipient}`);

      expect(downloadRes.status).toBe(403);
      expect(downloadRes.body.success).toBe(false);
      expect(downloadRes.body.error.code).toBe('FORBIDDEN');
    });

    it('blocks recipient with VIEW or DOWNLOAD from renaming file (403)', async () => {
      const fileId = new Types.ObjectId().toString();
      const mockFile = {
        _id: new Types.ObjectId(fileId),
        name: 'no-rename.pdf',
        ownerId: new Types.ObjectId(ownerId),
        folderId: null,
        isDeleted: false,
        save: vi.fn().mockResolvedValue(true),
      };

      vi.spyOn(File, 'findById').mockResolvedValue(mockFile as any);
      vi.spyOn(permissionService, 'getFilePermission').mockResolvedValue('DOWNLOAD');

      const renameRes = await request(app)
        .patch(`/api/v1/files/${fileId}`)
        .set('Authorization', `Bearer ${tokenRecipient}`)
        .send({ name: 'HackedName.pdf' });

      expect(renameRes.status).toBe(403);
      expect(renameRes.body.success).toBe(false);
      expect(renameRes.body.error.code).toBe('FORBIDDEN');
    });

    it('allows recipient with EDIT to rename file', async () => {
      const fileId = new Types.ObjectId().toString();
      const mockFile = {
        _id: new Types.ObjectId(fileId),
        name: 'old-name.pdf',
        ownerId: new Types.ObjectId(ownerId),
        folderId: null,
        isDeleted: false,
        save: vi.fn().mockResolvedValue(true),
      };

      vi.spyOn(File, 'findById').mockResolvedValue(mockFile as any);
      vi.spyOn(File, 'findOne').mockResolvedValue(null); // No collision
      vi.spyOn(permissionService, 'getFilePermission').mockResolvedValue('EDIT');

      const renameRes = await request(app)
        .patch(`/api/v1/files/${fileId}`)
        .set('Authorization', `Bearer ${tokenRecipient}`)
        .send({ name: 'new-name.pdf' });

      expect(renameRes.status).toBe(200);
      expect(renameRes.body.success).toBe(true);
      expect(mockFile.name).toBe('new-name.pdf');
    });

    it('allows recipient with VIEW to list folder children, but blocks folder rename', async () => {
      const folderId = new Types.ObjectId().toString();
      const mockFolder = {
        _id: new Types.ObjectId(folderId),
        name: 'Team Docs',
        ownerId: new Types.ObjectId(ownerId),
        parentId: null,
        isDeleted: false,
        save: vi.fn().mockResolvedValue(true),
      };

      vi.spyOn(Folder, 'findById').mockResolvedValue(mockFolder as any);
      vi.spyOn(permissionService, 'getFolderPermission').mockResolvedValue('VIEW');

      // GET folder details -> allowed
      const getRes = await request(app)
        .get(`/api/v1/folders/${folderId}`)
        .set('Authorization', `Bearer ${tokenRecipient}`);

      expect(getRes.status).toBe(200);
      expect(getRes.body.success).toBe(true);

      // PATCH folder rename -> blocked with 403
      const patchRes = await request(app)
        .patch(`/api/v1/folders/${folderId}`)
        .set('Authorization', `Bearer ${tokenRecipient}`)
        .send({ name: 'Changed Folder' });

      expect(patchRes.status).toBe(403);
      expect(patchRes.body.success).toBe(false);
      expect(patchRes.body.error.code).toBe('FORBIDDEN');
    });
  });

  describe('7. General Share Endpoints (/api/v1/shares)', () => {
    it('POST /api/v1/shares creates a general share for FILE or FOLDER', async () => {
      const fileId = new Types.ObjectId().toString();
      vi.spyOn(File, 'findById').mockResolvedValue({
        _id: new Types.ObjectId(fileId),
        ownerId: new Types.ObjectId(ownerId),
        name: 'shared.txt',
        isDeleted: false,
      } as any);

      vi.spyOn(Share, 'findOne').mockResolvedValue(null);

      const fakeShare = {
        _id: new Types.ObjectId(),
        ownerId: new Types.ObjectId(ownerId),
        recipientId: recipientUser,
        resourceType: 'FILE',
        resourceId: new Types.ObjectId(fileId),
        permission: 'VIEW',
        expiresAt: null,
        populate: vi.fn().mockImplementation(function (this: any) {
          return Promise.resolve(this);
        }),
      };
      vi.spyOn(Share, 'create').mockResolvedValue(fakeShare as any);

      const res = await request(app)
        .post('/api/v1/shares')
        .set('Authorization', `Bearer ${tokenOwner}`)
        .send({
          resourceType: 'FILE',
          resourceId: fileId,
          recipientEmail: 'recipient@example.com',
          permission: 'VIEW',
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.share.resourceType).toBe('FILE');
    });

    it('DELETE /api/v1/shares/:id revokes a share by id', async () => {
      const shareId = new Types.ObjectId().toString();
      const existingShare = {
        _id: new Types.ObjectId(shareId),
        ownerId: new Types.ObjectId(ownerId),
        recipientId: new Types.ObjectId(recipientId),
      };

      vi.spyOn(Share, 'findById').mockResolvedValue(existingShare as any);
      vi.spyOn(Share, 'findByIdAndDelete').mockResolvedValue(existingShare as any);

      const res = await request(app)
        .delete(`/api/v1/shares/${shareId}`)
        .set('Authorization', `Bearer ${tokenOwner}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.revoked).toBe(true);
    });
  });
});
