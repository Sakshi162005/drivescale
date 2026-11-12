import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../middleware/auth.middleware.js';
import { trashService } from '../services/trash.service.js';
import {
  listTrashQuerySchema,
  trashIdParamSchema,
  restoreTrashItemSchema,
} from '../schemas/trash.schema.js';

export const listTrash = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const query = listTrashQuerySchema.parse(req.query);
    const userId = req.user!._id.toString();
    const result = await trashService.listTrash(userId, query);

    res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

export const restoreItem = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = trashIdParamSchema.parse(req.params);
    const body = restoreTrashItemSchema.parse(req.body);
    const userId = req.user!._id.toString();

    const result = await trashService.restoreItem(userId, id, body);

    res.json({
      success: true,
      message: `${result.type === 'file' ? 'File' : 'Folder'} restored successfully`,
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

export const restoreFile = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = trashIdParamSchema.parse(req.params);
    const body = restoreTrashItemSchema.parse(req.body);
    const userId = req.user!._id.toString();

    const result = await trashService.restoreFile(userId, id, body);

    res.json({
      success: true,
      message: 'File restored successfully',
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

export const restoreFolder = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = trashIdParamSchema.parse(req.params);
    const body = restoreTrashItemSchema.parse(req.body);
    const userId = req.user!._id.toString();

    const result = await trashService.restoreFolder(userId, id, body);

    res.json({
      success: true,
      message: 'Folder restored successfully',
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

export const permanentlyDeleteItem = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = trashIdParamSchema.parse(req.params);
    const userId = req.user!._id.toString();

    const result = await trashService.permanentlyDeleteItem(userId, id);

    res.json({
      success: true,
      message: `${result.type === 'file' ? 'File' : 'Folder'} permanently deleted`,
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

export const permanentlyDeleteFile = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = trashIdParamSchema.parse(req.params);
    const userId = req.user!._id.toString();

    await trashService.permanentlyDeleteFile(userId, id);

    res.json({
      success: true,
      message: 'File permanently deleted',
    });
  } catch (error) {
    next(error);
  }
};

export const permanentlyDeleteFolder = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = trashIdParamSchema.parse(req.params);
    const userId = req.user!._id.toString();

    await trashService.permanentlyDeleteFolder(userId, id);

    res.json({
      success: true,
      message: 'Folder permanently deleted',
    });
  } catch (error) {
    next(error);
  }
};

export const emptyTrash = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const userId = req.user!._id.toString();
    const result = await trashService.emptyTrash(userId);

    res.json({
      success: true,
      message: 'Trash emptied successfully',
      data: result,
    });
  } catch (error) {
    next(error);
  }
};
