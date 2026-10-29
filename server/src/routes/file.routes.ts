import { Router } from 'express';
import * as fileController from '../controllers/file.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { validate } from '../middleware/validation.middleware.js';
import { renameFileSchema, moveFileSchema } from '../schemas/file.schema.js';

const router = Router();

// All file routes require authentication
router.use(authenticate);

// Upload endpoints
router.post('/', fileController.uploadFile);
router.post('/upload', fileController.uploadFile);

// List files with pagination
router.get('/', fileController.listFiles);

// Download file stream
router.get('/:id/download', fileController.downloadFile);

// Move file
router.post(
  '/:id/move',
  validate({ body: moveFileSchema }),
  fileController.moveFile
);

// Get file metadata
router.get('/:id', fileController.getFile);

// Rename file
router.patch(
  '/:id',
  validate({ body: renameFileSchema }),
  fileController.renameFile
);

// Delete file
router.delete('/:id', fileController.deleteFile);

export const fileRoutes = router;
