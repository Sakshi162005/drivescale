import { Router } from 'express';
import { healthRoutes } from './health.routes.js';
import { authRoutes } from './auth.routes.js';
import { userRoutes } from './user.routes.js';
import { folderRoutes } from './folder.routes.js';
import { fileRoutes } from './file.routes.js';
import { uploadRoutes } from './upload.routes.js';
import { shareRoutes } from './share.routes.js';

const router = Router();

// Phase 0: Health routes
router.use('/health', healthRoutes);

// Phase 1: Authentication routes
router.use('/auth', authRoutes);

// User routes (Profile & Storage statistics)
router.use('/users', userRoutes);

// Phase 2: Folder routes
router.use('/folders', folderRoutes);

// Phase 3: File routes
router.use('/files', fileRoutes);

// Phase 4: Chunked upload routes
router.use('/uploads', uploadRoutes);

// Phase 8: Sharing routes
router.use('/shares', shareRoutes);

export const apiV1Routes = router;
