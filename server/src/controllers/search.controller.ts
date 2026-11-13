import { Response } from 'express';
import { searchService } from '../services/search.service.js';
import { sendSuccess } from '../utils/response.js';
import { AuthenticatedRequest } from '../middleware/auth.middleware.js';
import { asyncHandler } from '../utils/async.js';
import { SearchQueryInput } from '../schemas/search.schema.js';

/**
 * GET /api/v1/search
 * Executes authenticated full-text/regex search across authorized files and folders
 */
export const search = asyncHandler(async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const userId = req.user!._id.toString();
  const queryInput = req.query as unknown as SearchQueryInput;
  const result = await searchService.search(userId, queryInput);
  sendSuccess(res, result, 200);
});
