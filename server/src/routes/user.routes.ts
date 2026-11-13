import { Router } from 'express';
import * as userController from '../controllers/user.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { validate } from '../middleware/validation.middleware.js';
import { updateStorageQuotaSchema } from '../schemas/storage.schema.js';

const router = Router();

// All user routes require authentication
router.use(authenticate);

// GET /api/v1/users/me
router.get('/me', userController.getMe);

// GET /api/v1/users/me/storage
router.get('/me/storage', userController.getStorageStats);

// PATCH /api/v1/users/me/quota
router.patch('/me/quota', validate({ body: updateStorageQuotaSchema }), userController.updateQuota);

export const userRoutes = router;

