import { Router } from 'express';
import * as searchController from '../controllers/search.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { validate } from '../middleware/validation.middleware.js';
import { searchQuerySchema } from '../schemas/search.schema.js';

const router = Router();

// All search routes require authentication
router.use(authenticate);

// GET /api/v1/search?q=...&type=all&page=1&limit=20
router.get('/', validate({ query: searchQuerySchema }), searchController.search);

export const searchRoutes = router;
