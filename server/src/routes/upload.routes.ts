import { Router } from 'express';
import * as uploadController from '../controllers/upload.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { validate } from '../middleware/validation.middleware.js';
import { initUploadSchema } from '../schemas/upload.schema.js';

const router = Router();

// All upload routes require authentication
router.use(authenticate);

// Initialize a chunked upload session
router.post(
  '/init',
  validate({ body: initUploadSchema }),
  uploadController.initUpload
);

// Upload a single chunk
router.put(
  '/:uploadId/chunks/:chunkNumber',
  uploadController.uploadChunk
);

// Complete an upload session by assembling chunks
router.post(
  '/:uploadId/complete',
  uploadController.completeUpload
);

// Get session status and uploaded chunks
router.get(
  '/:uploadId/status',
  uploadController.getUploadStatus
);

// Cancel upload session and delete chunks
router.delete(
  '/:uploadId',
  uploadController.cancelUpload
);

export const uploadRoutes = router;

