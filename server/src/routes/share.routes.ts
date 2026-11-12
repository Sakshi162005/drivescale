import { Router } from 'express';
import * as shareController from '../controllers/share.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { validate } from '../middleware/validation.middleware.js';
import {
  createShareSchema,
  updateShareSchema,
  listSharedWithMeQuerySchema,
} from '../schemas/share.schema.js';

const router = Router();

// All sharing endpoints require authentication
router.use(authenticate);

// Resources shared with the current user
router.get(
  '/with-me',
  validate({ query: listSharedWithMeQuerySchema }),
  shareController.listSharedWithMe
);

router.get(
  '/with-me/folders/:folderId',
  shareController.getSharedFolderContents
);

// File-specific sharing endpoints
router.post(
  '/files/:fileId',
  validate({ body: createShareSchema }),
  shareController.shareFile
);

router.get(
  '/files/:fileId',
  shareController.getFileShares
);

router.patch(
  '/files/:fileId/:shareId',
  validate({ body: updateShareSchema }),
  shareController.updateShare
);

router.delete(
  '/files/:fileId/:shareId',
  shareController.revokeShare
);

// Folder-specific sharing endpoints
router.post(
  '/folders/:folderId',
  validate({ body: createShareSchema }),
  shareController.shareFolder
);

router.get(
  '/folders/:folderId',
  shareController.getFolderShares
);

router.patch(
  '/folders/:folderId/:shareId',
  validate({ body: updateShareSchema }),
  shareController.updateShare
);

router.delete(
  '/folders/:folderId/:shareId',
  shareController.revokeShare
);

// General share endpoints
router.post(
  '/',
  shareController.createGeneralShare
);

router.patch(
  '/:id',
  validate({ body: updateShareSchema }),
  shareController.updateShare
);

router.delete(
  '/:id',
  shareController.revokeShare
);

export const shareRoutes = router;

