import { Router } from 'express';
import * as authController from '../controllers/auth.controller.js';
import { validate } from '../middleware/validation.middleware.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { authRateLimiter } from '../middleware/rate-limit.middleware.js';
import { registerSchema, loginSchema, refreshSchema } from '../schemas/auth.schema.js';

const router = Router();

router.post(
  '/register',
  authRateLimiter,
  validate({ body: registerSchema }),
  authController.register
);

router.post(
  '/login',
  authRateLimiter,
  validate({ body: loginSchema }),
  authController.login
);

router.post(
  '/refresh',
  validate({ body: refreshSchema }),
  authController.refresh
);

router.post(
  '/logout',
  authController.logout
);

router.get(
  '/me',
  authenticate,
  authController.getMe
);

export const authRoutes = router;
