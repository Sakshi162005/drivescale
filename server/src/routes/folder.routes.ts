import { Router } from 'express';
import * as folderController from '../controllers/folder.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { validate } from '../middleware/validation.middleware.js';
import {
  createFolderSchema,
  renameFolderSchema,
  moveFolderSchema,
} from '../schemas/folder.schema.js';

const router = Router();

// All folder routes require authentication
router.use(authenticate);

router.get('/all', folderController.getAllFolders);

// GET / returns root children (alias for /root/children)
router.get('/', folderController.getFolderChildren);

router.post(
  '/',
  validate({ body: createFolderSchema }),
  folderController.createFolder
);

router.get('/:id', folderController.getFolder);

router.get('/:id/children', folderController.getFolderChildren);

router.patch(
  '/:id',
  validate({ body: renameFolderSchema }),
  folderController.renameFolder
);

router.delete('/:id', folderController.deleteFolder);

router.post(
  '/:id/move',
  validate({ body: moveFolderSchema }),
  folderController.moveFolder
);

export const folderRoutes = router;
