import { Response } from 'express';
import { folderService } from '../services/folder.service.js';
import { sendSuccess } from '../utils/response.js';
import { AuthenticatedRequest } from '../middleware/auth.middleware.js';
import { asyncHandler } from '../utils/async.js';

export const createFolder = asyncHandler(async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const userId = req.user!._id.toString();
  const folder = await folderService.createFolder(userId, req.body);
  sendSuccess(res, { folder }, 201);
});

export const getFolder = asyncHandler(async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const userId = req.user!._id.toString();
  const result = await folderService.getFolder(userId, req.params['id'] as string);
  sendSuccess(res, result, 200);
});

export const getFolderChildren = asyncHandler(async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const userId = req.user!._id.toString();
  const folderId = (req.params['id'] as string) || 'root';
  const folders = await folderService.getFolderChildren(userId, folderId);
  sendSuccess(res, { folders }, 200);
});

export const renameFolder = asyncHandler(async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const userId = req.user!._id.toString();
  const folder = await folderService.renameFolder(userId, req.params['id'] as string, req.body.name);
  sendSuccess(res, { folder }, 200);
});

export const deleteFolder = asyncHandler(async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const userId = req.user!._id.toString();
  await folderService.deleteFolder(userId, req.params['id'] as string);
  sendSuccess(res, { message: 'Folder deleted successfully' }, 200);
});

export const moveFolder = asyncHandler(async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const userId = req.user!._id.toString();
  const folder = await folderService.moveFolder(
    userId,
    req.params['id'] as string,
    req.body.targetParentId
  );
  sendSuccess(res, { folder }, 200);
});

export const getAllFolders = asyncHandler(async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const userId = req.user!._id.toString();
  const folders = await folderService.getAllFolders(userId);
  sendSuccess(res, { folders }, 200);
});
