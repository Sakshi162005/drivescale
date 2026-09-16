import { Router } from 'express';
import { healthRoutes } from './health.routes.js';
import { authRoutes } from './auth.routes.js';
import { folderRoutes } from './folder.routes.js';

const router = Router();

// Phase 0: Health routes
router.use('/health', healthRoutes);

// Phase 1: Authentication routes
router.use('/auth', authRoutes);

// Phase 2: Folder routes
router.use('/folders', folderRoutes);

export const apiV1Routes = router;
