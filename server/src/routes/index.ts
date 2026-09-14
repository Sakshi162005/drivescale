import { Router } from 'express';
import { healthRoutes } from './health.routes.js';
import { authRoutes } from './auth.routes.js';

const router = Router();

// Phase 0: Health routes
router.use('/health', healthRoutes);

// Phase 1: Authentication routes
router.use('/auth', authRoutes);

export const apiV1Routes = router;
