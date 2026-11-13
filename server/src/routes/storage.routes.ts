import { Router } from 'express';
import * as storageController from '../controllers/storage.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { validate } from '../middleware/validation.middleware.js';
import { updateStorageQuotaSchema } from '../schemas/storage.schema.js';

const router = Router();

// All storage routes require authentication
router.use(authenticate);

// GET /api/v1/storage/usage
router.get('/usage', storageController.getStorageUsage);

// PATCH /api/v1/storage/quota
router.patch('/quota', validate({ body: updateStorageQuotaSchema }), storageController.updateStorageQuota);

export const storageRoutes = router;
