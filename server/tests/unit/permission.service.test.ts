import { describe, it, expect, vi, beforeEach } from 'vitest';
import mongoose, { Types } from 'mongoose';
import { PermissionService } from '../../src/services/permission.service.js';
import { Share, IShare } from '../../src/models/Share.js';
import { Folder } from '../../src/models/Folder.js';
import { IFile } from '../../src/models/File.js';

describe('PermissionService Unit Tests', () => {
  let permissionService: PermissionService;

  const ownerId = new mongoose.Types.ObjectId().toString();
  const recipientId = new mongoose.Types.ObjectId().toString();
  const unauthorizedId = new mongoose.Types.ObjectId().toString();

  const mockFile: IFile = {
    _id: new mongoose.Types.ObjectId(),
    name: 'quarterly-report.pdf',
    ownerId: new mongoose.Types.ObjectId(ownerId),
    folderId: null,
    storageKey: 'objects/aa/report-key',
    size: 1024,
    mimeType: 'application/pdf',
    checksum: 'mock-checksum',
    versionCount: 1,
    isDeleted: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as any;

  beforeEach(() => {
    vi.restoreAllMocks();
    permissionService = new PermissionService();
  });

  describe('1. Permission Weight and Comparison', () => {
    it('compares permissions correctly and returns the most permissive', () => {
      expect(permissionService.getMostPermissive('VIEW', 'DOWNLOAD')).toBe('DOWNLOAD');
      expect(permissionService.getMostPermissive('DOWNLOAD', 'EDIT')).toBe('EDIT');
      expect(permissionService.getMostPermissive('VIEW', 'EDIT')).toBe('EDIT');
      expect(permissionService.getMostPermissive('EDIT', 'VIEW')).toBe('EDIT');
      expect(permissionService.getMostPermissive(null, 'VIEW')).toBe('VIEW');
      expect(permissionService.getMostPermissive('DOWNLOAD', null)).toBe('DOWNLOAD');
      expect(permissionService.getMostPermissive(null, null)).toBeNull();
    });

    it('verifies share active status based on expiresAt timestamp', () => {
      const activeShare = {
        expiresAt: new Date(Date.now() + 3600000), // 1 hour in future
      } as IShare;
      expect(permissionService.isShareActive(activeShare)).toBe(true);

      const indefiniteShare = {} as IShare;
      expect(permissionService.isShareActive(indefiniteShare)).toBe(true);

      const expiredShare = {
        expiresAt: new Date(Date.now() - 3600000), // 1 hour in past
      } as IShare;
      expect(permissionService.isShareActive(expiredShare)).toBe(false);
    });
  });

  describe('2. Resource Ownership Privileges', () => {
    it('grants full OWNER access to the file owner', async () => {
      const perm = await permissionService.getFilePermission(ownerId, mockFile);
      expect(perm).toBe('OWNER');

      expect(permissionService.canView(perm)).toBe(true);
      expect(permissionService.canDownload(perm)).toBe(true);
      expect(permissionService.canEdit(perm)).toBe(true);
      expect(permissionService.canDelete(perm)).toBe(true);
      expect(permissionService.canShare(perm)).toBe(true);

      expect(await permissionService.canViewFile(ownerId, mockFile)).toBe(true);
      expect(await permissionService.canDownloadFile(ownerId, mockFile)).toBe(true);
      expect(await permissionService.canEditFile(ownerId, mockFile)).toBe(true);
    });

    it('grants full OWNER access to the folder owner', async () => {
      const mockFolder = {
        _id: new mongoose.Types.ObjectId(),
        name: 'Project Docs',
        ownerId: new mongoose.Types.ObjectId(ownerId),
        parentId: null,
        isDeleted: false,
      } as any;

      const perm = await permissionService.getFolderPermission(ownerId, mockFolder);
      expect(perm).toBe('OWNER');
      expect(await permissionService.canViewFolder(ownerId, mockFolder)).toBe(true);
      expect(await permissionService.canEditFolder(ownerId, mockFolder)).toBe(true);
    });
  });

  describe('3. Direct File Shares (VIEW, DOWNLOAD, EDIT)', () => {
    it('evaluates direct VIEW permission correctly', async () => {
      vi.spyOn(Share, 'findOne').mockResolvedValue({
        resourceType: 'FILE',
        resourceId: mockFile._id,
        recipientId: new mongoose.Types.ObjectId(recipientId),
        permission: 'VIEW',
      } as any);

      const perm = await permissionService.getFilePermission(recipientId, mockFile);
      expect(perm).toBe('VIEW');

      expect(permissionService.canView(perm)).toBe(true);
      expect(permissionService.canDownload(perm)).toBe(false);
      expect(permissionService.canEdit(perm)).toBe(false);
      expect(permissionService.canDelete(perm)).toBe(false);
      expect(permissionService.canShare(perm)).toBe(false);
    });

    it('evaluates direct DOWNLOAD permission correctly', async () => {
      vi.spyOn(Share, 'findOne').mockResolvedValue({
        resourceType: 'FILE',
        resourceId: mockFile._id,
        recipientId: new mongoose.Types.ObjectId(recipientId),
        permission: 'DOWNLOAD',
      } as any);

      const perm = await permissionService.getFilePermission(recipientId, mockFile);
      expect(perm).toBe('DOWNLOAD');

      expect(permissionService.canView(perm)).toBe(true);
      expect(permissionService.canDownload(perm)).toBe(true);
      expect(permissionService.canEdit(perm)).toBe(false);
      expect(permissionService.canDelete(perm)).toBe(false);
    });

    it('evaluates direct EDIT permission correctly', async () => {
      vi.spyOn(Share, 'findOne').mockResolvedValue({
        resourceType: 'FILE',
        resourceId: mockFile._id,
        recipientId: new mongoose.Types.ObjectId(recipientId),
        permission: 'EDIT',
      } as any);

      const perm = await permissionService.getFilePermission(recipientId, mockFile);
      expect(perm).toBe('EDIT');

      expect(permissionService.canView(perm)).toBe(true);
      expect(permissionService.canDownload(perm)).toBe(true);
      expect(permissionService.canEdit(perm)).toBe(true);
      expect(permissionService.canDelete(perm)).toBe(false);
    });
  });

  describe('4. Inherited Folder Sharing & Hierarchy Traversal', () => {
    it('inherits parent folder share permissions for nested files', async () => {
      const parentFolderId = new mongoose.Types.ObjectId();
      const fileInFolder: IFile = {
        ...mockFile,
        folderId: parentFolderId,
      } as any;

      // Mock ancestor traversal
      vi.spyOn(permissionService, 'getAncestorFolderIds').mockResolvedValue([parentFolderId]);

      // Direct file share: null
      vi.spyOn(Share, 'findOne').mockResolvedValue(null);

      // Folder share: EDIT
      vi.spyOn(Share, 'find').mockResolvedValue([
        {
          resourceType: 'FOLDER',
          resourceId: parentFolderId,
          recipientId: new mongoose.Types.ObjectId(recipientId),
          ownerId: mockFile.ownerId,
          permission: 'EDIT',
        } as any,
      ]);

      const perm = await permissionService.getFilePermission(recipientId, fileInFolder);
      expect(perm).toBe('EDIT');
      expect(await permissionService.canEditFile(recipientId, fileInFolder)).toBe(true);
    });

    it('combines direct and inherited shares and chooses the highest privilege', async () => {
      const parentFolderId = new mongoose.Types.ObjectId();
      const fileInFolder: IFile = {
        ...mockFile,
        folderId: parentFolderId,
      } as any;

      vi.spyOn(permissionService, 'getAncestorFolderIds').mockResolvedValue([parentFolderId]);

      // Direct file share: VIEW
      vi.spyOn(Share, 'findOne').mockResolvedValue({
        resourceType: 'FILE',
        resourceId: mockFile._id,
        recipientId: new mongoose.Types.ObjectId(recipientId),
        permission: 'VIEW',
      } as any);

      // Parent folder share: DOWNLOAD
      vi.spyOn(Share, 'find').mockResolvedValue([
        {
          resourceType: 'FOLDER',
          resourceId: parentFolderId,
          recipientId: new mongoose.Types.ObjectId(recipientId),
          ownerId: mockFile.ownerId,
          permission: 'DOWNLOAD',
        } as any,
      ]);

      const perm = await permissionService.getFilePermission(recipientId, fileInFolder);
      expect(perm).toBe('DOWNLOAD'); // DOWNLOAD > VIEW
    });
  });

  describe('5. Access Denied & Boundary Protections', () => {
    it('denies access to unrelated user with no direct or inherited share', async () => {
      vi.spyOn(Share, 'findOne').mockResolvedValue(null);
      vi.spyOn(Share, 'find').mockResolvedValue([]);

      const perm = await permissionService.getFilePermission(unauthorizedId, mockFile);
      expect(perm).toBeNull();

      expect(permissionService.canView(perm)).toBe(false);
      expect(permissionService.canDownload(perm)).toBe(false);
      expect(permissionService.canEdit(perm)).toBe(false);
      expect(permissionService.canDelete(perm)).toBe(false);
      expect(permissionService.canShare(perm)).toBe(false);
    });

    it('denies access when share has expired', async () => {
      vi.spyOn(Share, 'findOne').mockResolvedValue({
        resourceType: 'FILE',
        resourceId: mockFile._id,
        recipientId: new mongoose.Types.ObjectId(recipientId),
        permission: 'EDIT',
        expiresAt: new Date(Date.now() - 3600000), // Expired
      } as any);

      const perm = await permissionService.getFilePermission(recipientId, mockFile);
      expect(perm).toBeNull();
      expect(permissionService.canView(perm)).toBe(false);
    });

    it('traverses folder hierarchy safely and prevents cyclic infinite loops', async () => {
      const folderA = new mongoose.Types.ObjectId();
      const folderB = new mongoose.Types.ObjectId();

      // Simulate a cycle: A -> B -> A
      const mockFindById = vi.spyOn(Folder, 'findById');
      mockFindById.mockImplementation((id: any) => {
        const idStr = id.toString();
        if (idStr === folderA.toString()) {
          return {
            select: vi.fn().mockReturnValue({
              lean: vi.fn().mockResolvedValue({ _id: folderA, parentId: folderB, isDeleted: false }),
            }),
          } as any;
        }
        if (idStr === folderB.toString()) {
          return {
            select: vi.fn().mockReturnValue({
              lean: vi.fn().mockResolvedValue({ _id: folderB, parentId: folderA, isDeleted: false }),
            }),
          } as any;
        }
        return { select: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue(null) }) } as any;
      });

      const ancestors = await permissionService.getAncestorFolderIds(folderA);
      // Must terminate gracefully with visited cycle guard without hanging
      expect(ancestors.length).toBe(2);
      expect(ancestors.map((id) => id.toString())).toContain(folderA.toString());
      expect(ancestors.map((id) => id.toString())).toContain(folderB.toString());
    });
  });
});

