import { Router } from 'express';
import { healthRoutes } from './health.routes.js';

const router = Router();

// Phase 0: Health routes
router.use('/health', healthRoutes);

export const apiV1Routes = router;
