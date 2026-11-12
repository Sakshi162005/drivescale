import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth.middleware.js';
import { shareService } from '../services/share.service.js';
import { sendSuccess } from '../utils/response.js';
import { CreateShareInput, UpdateShareInput, ListSharedWithMeQueryInput } from '../schemas/share.schema.js';
import { ShareResourceType } from '../models/Share.js';
import { BadRequestError } from '../utils/errors.js';
import { asyncHandler } from '../utils/async.js';

export const shareFile = asyncHandler(async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const userId = req.user!._id.toString();
  const fileId = req.params.fileId;
  const input = req.body as CreateShareInput;

  const share = await shareService.shareResource(userId, 'FILE', fileId, input);
  sendSuccess(res, { share }, 201);
});

export const getFileShares = asyncHandler(async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const userId = req.user!._id.toString();
  const fileId = req.params.fileId;

  const shares = await shareService.getSharesForResource(userId, 'FILE', fileId);
  sendSuccess(res, { shares });
});

export const shareFolder = asyncHandler(async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const userId = req.user!._id.toString();
  const folderId = req.params.folderId;
  const input = req.body as CreateShareInput;

  const share = await shareService.shareResource(userId, 'FOLDER', folderId, input);
  sendSuccess(res, { share }, 201);
});

export const getFolderShares = asyncHandler(async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const userId = req.user!._id.toString();
  const folderId = req.params.folderId;

  const shares = await shareService.getSharesForResource(userId, 'FOLDER', folderId);
  sendSuccess(res, { shares });
});

export const updateShare = asyncHandler(async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const userId = req.user!._id.toString();
  const shareId = req.params.shareId || req.params.id;
  const input = req.body as UpdateShareInput;

  const updated = await shareService.updateShare(userId, shareId, input);
  sendSuccess(res, { share: updated });
});

export const revokeShare = asyncHandler(async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const userId = req.user!._id.toString();
  const shareId = req.params.shareId || req.params.id;

  await shareService.revokeShare(userId, shareId);
  sendSuccess(res, { message: 'Share access revoked successfully', revoked: true });
});

export const createGeneralShare = asyncHandler(async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const userId = req.user!._id.toString();
  const { resourceType, resourceId, ...input } = req.body;

  if (!resourceType || !['FILE', 'FOLDER'].includes(resourceType)) {
    throw new BadRequestError('resourceType must be FILE or FOLDER', 'INVALID_RESOURCE_TYPE');
  }
  if (!resourceId) {
    throw new BadRequestError('resourceId is required', 'MISSING_RESOURCE_ID');
  }

  const share = await shareService.shareResource(
    userId,
    resourceType as ShareResourceType,
    resourceId,
    input as CreateShareInput
  );
  sendSuccess(res, { share }, 201);
});

export const listSharedWithMe = asyncHandler(async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const userId = req.user!._id.toString();
  const query = req.query as unknown as ListSharedWithMeQueryInput;

  const result = await shareService.listSharedWithMe(userId, query);
  sendSuccess(res, result);
});

export const getSharedFolderContents = asyncHandler(async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const userId = req.user!._id.toString();
  const folderId = req.params.folderId;

  const result = await shareService.getSharedFolderChildren(userId, folderId);
  sendSuccess(res, result);
});
