import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware.js';
import {
  listTrash,
  restoreItem,
  restoreFile,
  restoreFolder,
  permanentlyDeleteItem,
  permanentlyDeleteFile,
  permanentlyDeleteFolder,
  emptyTrash,
} from '../controllers/trash.controller.js';

const router = Router();

// All trash routes require authentication
router.use(authenticate);

// Listing trash
router.get('/', listTrash);

// Empty trash
router.delete('/empty', emptyTrash);

// Explicit sub-resource restoration
router.post('/files/:id/restore', restoreFile);
router.post('/folders/:id/restore', restoreFolder);

// Explicit sub-resource permanent deletion
router.delete('/files/:id/permanent', permanentlyDeleteFile);
router.delete('/folders/:id/permanent', permanentlyDeleteFolder);

// Generic ID restoration and permanent deletion
router.post('/:id/restore', restoreItem);
router.delete('/:id/permanent', permanentlyDeleteItem);

export const trashRoutes = router;
