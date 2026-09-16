import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { createApp } from '../src/app.js';
import { Folder } from '../src/models/Folder.js';
import { User } from '../src/models/User.js';
import { signAccessToken } from '../src/utils/jwt.js';

describe('Phase 2 Folder Management Test Suite', () => {
  const app = createApp();

  const userAId = new mongoose.Types.ObjectId().toString();
  const userBId = new mongoose.Types.ObjectId().toString();

  const tokenUserA = signAccessToken({ userId: userAId, email: 'usera@example.com', role: 'user' });
  const tokenUserB = signAccessToken({ userId: userBId, email: 'userb@example.com', role: 'user' });

  beforeEach(() => {
    vi.restoreAllMocks();

    // Mock User.findById for auth middleware
    vi.spyOn(User, 'findById').mockImplementation((id: any) => {
      const idStr = id?.toString();
      if (idStr === userAId) {
        return Promise.resolve({
          _id: new mongoose.Types.ObjectId(userAId),
          name: 'User A',
          email: 'usera@example.com',
          isActive: true,
        } as any);
      }
      if (idStr === userBId) {
        return Promise.resolve({
          _id: new mongoose.Types.ObjectId(userBId),
          name: 'User B',
          email: 'userb@example.com',
          isActive: true,
        } as any);
      }
      return Promise.resolve(null);
    });
  });

  describe('POST /api/v1/folders (Create Folder)', () => {
    it('creates a root folder when parentId is null or omitted', async () => {
      vi.spyOn(Folder, 'findOne').mockResolvedValue(null);

      const fakeFolder = {
        _id: new mongoose.Types.ObjectId(),
        name: 'Documents',
        ownerId: new mongoose.Types.ObjectId(userAId),
        parentId: null,
        isDeleted: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      vi.spyOn(Folder, 'create').mockResolvedValue(fakeFolder as any);

      const res = await request(app)
        .post('/api/v1/folders')
        .set('Authorization', `Bearer ${tokenUserA}`)
        .send({ name: 'Documents' });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.folder.name).toBe('Documents');
      expect(res.body.data.folder.parentId).toBeNull();
    });

    it('creates a nested folder inside an existing parent', async () => {
      const parentId = new mongoose.Types.ObjectId();
      const parentFolder = {
        _id: parentId,
        name: 'Documents',
        ownerId: new mongoose.Types.ObjectId(userAId),
        parentId: null,
        isDeleted: false,
      };

      vi.spyOn(Folder, 'findById').mockResolvedValue(parentFolder as any);
      vi.spyOn(Folder, 'findOne').mockResolvedValue(null);

      const childFolder = {
        _id: new mongoose.Types.ObjectId(),
        name: 'Invoices',
        ownerId: new mongoose.Types.ObjectId(userAId),
        parentId,
        isDeleted: false,
      };
      vi.spyOn(Folder, 'create').mockResolvedValue(childFolder as any);

      const res = await request(app)
        .post('/api/v1/folders')
        .set('Authorization', `Bearer ${tokenUserA}`)
        .send({ name: 'Invoices', parentId: parentId.toString() });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.folder.name).toBe('Invoices');
      expect(res.body.data.folder.parentId).toBe(parentId.toString());
    });

    it('rejects folder creation with illegal path characters (/ \\)', async () => {
      const res = await request(app)
        .post('/api/v1/folders')
        .set('Authorization', `Bearer ${tokenUserA}`)
        .send({ name: 'Invalid/Folder/Name' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('rejects folder creation with duplicate name in the same parent', async () => {
      vi.spyOn(Folder, 'findOne').mockResolvedValue({
        _id: new mongoose.Types.ObjectId(),
        name: 'Duplicate',
        ownerId: new mongoose.Types.ObjectId(userAId),
        parentId: null,
      } as any);

      const res = await request(app)
        .post('/api/v1/folders')
        .set('Authorization', `Bearer ${tokenUserA}`)
        .send({ name: 'Duplicate' });

      expect(res.status).toBe(409);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('FOLDER_ALREADY_EXISTS');
    });
  });

  describe('GET /api/v1/folders/:id/children (List Children)', () => {
    it('lists root children when :id is "root"', async () => {
      const mockChildren = [
        { _id: new mongoose.Types.ObjectId(), name: 'Docs', parentId: null },
        { _id: new mongoose.Types.ObjectId(), name: 'Photos', parentId: null },
      ];

      vi.spyOn(Folder, 'find').mockReturnValue({
        sort: vi.fn().mockResolvedValue(mockChildren),
      } as any);

      const res = await request(app)
        .get('/api/v1/folders/root/children')
        .set('Authorization', `Bearer ${tokenUserA}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.folders.length).toBe(2);
      expect(res.body.data.folders[0].name).toBe('Docs');
    });

    it('lists subfolder children when :id is a valid ObjectId', async () => {
      const parentId = new mongoose.Types.ObjectId();
      vi.spyOn(Folder, 'findById').mockResolvedValue({
        _id: parentId,
        ownerId: new mongoose.Types.ObjectId(userAId),
        isDeleted: false,
      } as any);

      const mockChildren = [
        { _id: new mongoose.Types.ObjectId(), name: '2026', parentId },
      ];
      vi.spyOn(Folder, 'find').mockReturnValue({
        sort: vi.fn().mockResolvedValue(mockChildren),
      } as any);

      const res = await request(app)
        .get(`/api/v1/folders/${parentId.toString()}/children`)
        .set('Authorization', `Bearer ${tokenUserA}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.folders.length).toBe(1);
    });
  });

  describe('GET /api/v1/folders/:id (Get Folder & Breadcrumbs)', () => {
    it('returns root virtual folder info for :id="root"', async () => {
      const res = await request(app)
        .get('/api/v1/folders/root')
        .set('Authorization', `Bearer ${tokenUserA}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.folder.name).toBe('My Drive');
      expect(res.body.data.breadcrumbs).toEqual([]);
    });

    it('returns folder details and breadcrumb hierarchy', async () => {
      const rootFolderId = new mongoose.Types.ObjectId();
      const childFolderId = new mongoose.Types.ObjectId();

      const childFolder = {
        _id: childFolderId,
        name: 'Projects',
        ownerId: new mongoose.Types.ObjectId(userAId),
        parentId: rootFolderId,
        isDeleted: false,
      };

      const parentFolder = {
        _id: rootFolderId,
        name: 'Work',
        ownerId: new mongoose.Types.ObjectId(userAId),
        parentId: null,
        isDeleted: false,
      };

      vi.spyOn(Folder, 'findById').mockResolvedValue(childFolder as any);
      vi.spyOn(Folder, 'findOne').mockResolvedValue(parentFolder as any);

      const res = await request(app)
        .get(`/api/v1/folders/${childFolderId.toString()}`)
        .set('Authorization', `Bearer ${tokenUserA}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.folder.name).toBe('Projects');
      expect(res.body.data.breadcrumbs.length).toBe(2);
      expect(res.body.data.breadcrumbs[0].name).toBe('Work');
      expect(res.body.data.breadcrumbs[1].name).toBe('Projects');
    });
  });

  describe('PATCH /api/v1/folders/:id (Rename)', () => {
    it('successfully renames a folder', async () => {
      const folderId = new mongoose.Types.ObjectId();
      const mockFolder = {
        _id: folderId,
        name: 'OldName',
        ownerId: new mongoose.Types.ObjectId(userAId),
        parentId: null,
        isDeleted: false,
        save: vi.fn().mockResolvedValue(true),
      };

      vi.spyOn(Folder, 'findById').mockResolvedValue(mockFolder as any);
      vi.spyOn(Folder, 'findOne').mockResolvedValue(null);

      const res = await request(app)
        .patch(`/api/v1/folders/${folderId.toString()}`)
        .set('Authorization', `Bearer ${tokenUserA}`)
        .send({ name: 'NewName' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(mockFolder.name).toBe('NewName');
      expect(mockFolder.save).toHaveBeenCalled();
    });
  });

  describe('DELETE /api/v1/folders/:id (Soft Delete & Cascade)', () => {
    it('soft deletes folder and all its descendants', async () => {
      const folderId = new mongoose.Types.ObjectId();
      const childId = new mongoose.Types.ObjectId();

      vi.spyOn(Folder, 'findById').mockResolvedValue({
        _id: folderId,
        ownerId: new mongoose.Types.ObjectId(userAId),
        isDeleted: false,
      } as any);

      // BFS mock for descendant gathering
      vi.spyOn(Folder, 'find').mockReturnValue({
        select: vi.fn()
          .mockResolvedValueOnce([{ _id: childId }])
          .mockResolvedValueOnce([]),
      } as any);

      const updateManySpy = vi.spyOn(Folder, 'updateMany').mockResolvedValue({} as any);

      const res = await request(app)
        .delete(`/api/v1/folders/${folderId.toString()}`)
        .set('Authorization', `Bearer ${tokenUserA}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(updateManySpy).toHaveBeenCalledWith(
        expect.objectContaining({
          _id: { $in: [folderId, childId] },
          ownerId: userAId,
        }),
        expect.objectContaining({
          $set: expect.objectContaining({ isDeleted: true }),
        })
      );
    });
  });

  describe('POST /api/v1/folders/:id/move (Move & Cycle Prevention)', () => {
    it('moves a folder to root (targetParentId: null)', async () => {
      const folderId = new mongoose.Types.ObjectId();
      const oldParentId = new mongoose.Types.ObjectId();

      const mockFolder = {
        _id: folderId,
        name: 'FolderToMove',
        ownerId: new mongoose.Types.ObjectId(userAId),
        parentId: oldParentId,
        isDeleted: false,
        save: vi.fn().mockResolvedValue(true),
      };

      vi.spyOn(Folder, 'findById').mockResolvedValue(mockFolder as any);
      vi.spyOn(Folder, 'findOne').mockResolvedValue(null);

      const res = await request(app)
        .post(`/api/v1/folders/${folderId.toString()}/move`)
        .set('Authorization', `Bearer ${tokenUserA}`)
        .send({ targetParentId: null });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(mockFolder.parentId).toBeNull();
      expect(mockFolder.save).toHaveBeenCalled();
    });

    it('rejects moving a folder into itself (400 INVALID_MOVE_DESTINATION)', async () => {
      const folderId = new mongoose.Types.ObjectId().toString();

      vi.spyOn(Folder, 'findById').mockResolvedValue({
        _id: new mongoose.Types.ObjectId(folderId),
        ownerId: new mongoose.Types.ObjectId(userAId),
        isDeleted: false,
      } as any);

      const res = await request(app)
        .post(`/api/v1/folders/${folderId}/move`)
        .set('Authorization', `Bearer ${tokenUserA}`)
        .send({ targetParentId: folderId });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('INVALID_MOVE_DESTINATION');
    });

    it('rejects moving a folder into its descendant (400 CANNOT_MOVE_INTO_DESCENDANT)', async () => {
      const folderAId = new mongoose.Types.ObjectId();
      const subFolderBId = new mongoose.Types.ObjectId();

      const folderA = {
        _id: folderAId,
        name: 'ParentA',
        ownerId: new mongoose.Types.ObjectId(userAId),
        parentId: null,
        isDeleted: false,
      };

      const subFolderB = {
        _id: subFolderBId,
        name: 'ChildB',
        ownerId: new mongoose.Types.ObjectId(userAId),
        parentId: folderAId, // Subfolder B's parent is folder A!
        isDeleted: false,
      };

      vi.spyOn(Folder, 'findById').mockImplementation((id: any) => {
        const idStr = id?.toString();
        if (idStr === folderAId.toString()) return Promise.resolve(folderA as any);
        if (idStr === subFolderBId.toString()) return Promise.resolve(subFolderB as any);
        return Promise.resolve(null);
      });

      // Attempt to move Parent A into its child Subfolder B
      const res = await request(app)
        .post(`/api/v1/folders/${folderAId.toString()}/move`)
        .set('Authorization', `Bearer ${tokenUserA}`)
        .send({ targetParentId: subFolderBId.toString() });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('CANNOT_MOVE_INTO_DESCENDANT');
    });
  });

  describe('Authorization & Cross-User Isolation', () => {
    it('prevents User B from accessing User A folder (401/403)', async () => {
      const folderAId = new mongoose.Types.ObjectId();
      vi.spyOn(Folder, 'findById').mockResolvedValue({
        _id: folderAId,
        ownerId: new mongoose.Types.ObjectId(userAId), // Owned by User A
        isDeleted: false,
      } as any);

      const res = await request(app)
        .get(`/api/v1/folders/${folderAId.toString()}`)
        .set('Authorization', `Bearer ${tokenUserB}`); // Requested by User B

      expect(res.status).toBe(401); // UnauthorizedError('...FORBIDDEN') with code FORBIDDEN
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('prevents User B from renaming User A folder', async () => {
      const folderAId = new mongoose.Types.ObjectId();
      vi.spyOn(Folder, 'findById').mockResolvedValue({
        _id: folderAId,
        ownerId: new mongoose.Types.ObjectId(userAId),
        isDeleted: false,
      } as any);

      const res = await request(app)
        .patch(`/api/v1/folders/${folderAId.toString()}`)
        .set('Authorization', `Bearer ${tokenUserB}`)
        .send({ name: 'HackedName' });

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('prevents User B from deleting User A folder', async () => {
      const folderAId = new mongoose.Types.ObjectId();
      vi.spyOn(Folder, 'findById').mockResolvedValue({
        _id: folderAId,
        ownerId: new mongoose.Types.ObjectId(userAId),
        isDeleted: false,
      } as any);

      const res = await request(app)
        .delete(`/api/v1/folders/${folderAId.toString()}`)
        .set('Authorization', `Bearer ${tokenUserB}`);

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('prevents User A from moving a folder into User B folder (cross-user destination isolation)', async () => {
      const folderAId = new mongoose.Types.ObjectId();
      const folderBId = new mongoose.Types.ObjectId();

      const folderA = {
        _id: folderAId,
        name: 'FolderA',
        ownerId: new mongoose.Types.ObjectId(userAId),
        parentId: null,
        isDeleted: false,
      };

      const folderB = {
        _id: folderBId,
        name: 'FolderB',
        ownerId: new mongoose.Types.ObjectId(userBId), // Owned by User B
        parentId: null,
        isDeleted: false,
      };

      vi.spyOn(Folder, 'findById').mockImplementation((id: any) => {
        const idStr = id?.toString();
        if (idStr === folderAId.toString()) return Promise.resolve(folderA as any);
        if (idStr === folderBId.toString()) return Promise.resolve(folderB as any);
        return Promise.resolve(null);
      });

      const res = await request(app)
        .post(`/api/v1/folders/${folderAId.toString()}/move`)
        .set('Authorization', `Bearer ${tokenUserA}`)
        .send({ targetParentId: folderBId.toString() });

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('rejects unauthenticated requests without token (401 UNAUTHORIZED)', async () => {
      const res = await request(app).get('/api/v1/folders/root/children');
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('GET /api/v1/folders lists root children as an alias for /root/children', async () => {
      const mockChildren = [
        { _id: new mongoose.Types.ObjectId(), name: 'Alpha', parentId: null },
      ];

      vi.spyOn(Folder, 'find').mockReturnValue({
        sort: vi.fn().mockResolvedValue(mockChildren),
      } as any);

      const res = await request(app)
        .get('/api/v1/folders')
        .set('Authorization', `Bearer ${tokenUserA}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.folders.length).toBe(1);
      expect(res.body.data.folders[0].name).toBe('Alpha');
    });

    it('rejects move with 409 when destination already has a folder with same name', async () => {
      const folderId = new mongoose.Types.ObjectId();
      const targetParentId = new mongoose.Types.ObjectId();

      const folderToMove = {
        _id: folderId,
        name: 'Report',
        ownerId: new mongoose.Types.ObjectId(userAId),
        parentId: null,
        isDeleted: false,
      };

      const targetParent = {
        _id: targetParentId,
        name: 'TargetFolder',
        ownerId: new mongoose.Types.ObjectId(userAId),
        parentId: null,
        isDeleted: false,
      };

      vi.spyOn(Folder, 'findById').mockImplementation((id: any) => {
        const idStr = id?.toString();
        if (idStr === folderId.toString()) return Promise.resolve(folderToMove as any);
        if (idStr === targetParentId.toString()) return Promise.resolve(targetParent as any);
        return Promise.resolve(null);
      });

      // Existing folder in destination with name "Report"
      vi.spyOn(Folder, 'findOne').mockResolvedValue({
        _id: new mongoose.Types.ObjectId(),
        name: 'Report',
        ownerId: new mongoose.Types.ObjectId(userAId),
        parentId: targetParentId,
      } as any);

      const res = await request(app)
        .post(`/api/v1/folders/${folderId.toString()}/move`)
        .set('Authorization', `Bearer ${tokenUserA}`)
        .send({ targetParentId: targetParentId.toString() });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('FOLDER_ALREADY_EXISTS');
    });
  });
});
