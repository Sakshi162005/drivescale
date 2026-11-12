import { Router } from 'express';
import * as versionController from '../controllers/version.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';

const router = Router({ mergeParams: true });

// All version routes require authentication
router.use(authenticate);

// List versions for a file (and upload new version)
router.get('/', versionController.listVersions);
router.post('/', versionController.uploadNewVersion);

// Single version endpoints
router.get('/:versionId', versionController.getVersion);
router.get('/:versionId/download', versionController.downloadVersion);
router.post('/:versionId/restore', versionController.restoreVersion);

export const versionRoutes = router;

