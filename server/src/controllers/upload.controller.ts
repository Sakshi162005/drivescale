import { Response, NextFunction } from 'express';
import busboy from 'busboy';
import { uploadService } from '../services/upload.service.js';
import { sendSuccess, sendError } from '../utils/response.js';
import { AuthenticatedRequest } from '../middleware/auth.middleware.js';
import { asyncHandler } from '../utils/async.js';
import { initUploadSchema } from '../schemas/upload.schema.js';
import { BadRequestError } from '../utils/errors.js';

export const initUpload = asyncHandler(async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const userId = req.user!._id.toString();
  const input = initUploadSchema.parse(req.body);
  const session = await uploadService.initUpload(userId, input);
  sendSuccess(res, { session }, 201);
});

export const uploadChunk = (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
  const userId = req.user!._id.toString();
  const uploadId = req.params['uploadId'] as string;
  const chunkNumber = parseInt(req.params['chunkNumber'] as string, 10);

  if (isNaN(chunkNumber) || chunkNumber < 0) {
    sendError(res, 'INVALID_CHUNK_NUMBER', 'Chunk number must be a non-negative integer', 400);
    return;
  }

  const contentType = req.headers['content-type'] || '';

  if (contentType.includes('multipart/form-data')) {
    let bb: busboy.Busboy;
    try {
      bb = busboy({ headers: req.headers, limits: { files: 1 } });
    } catch (err: unknown) {
      next(new BadRequestError(err instanceof Error ? err.message : 'Malformed multipart request'));
      return;
    }

    let chunkHandled = false;
    let chunkPromise: Promise<unknown> | null = null;

    bb.on('file', (_fieldname, fileStream) => {
      chunkHandled = true;
      chunkPromise = uploadService.uploadChunk(userId, uploadId, chunkNumber, fileStream);
      chunkPromise.catch(() => {});
    });

    bb.on('error', (err) => {
      next(err);
    });

    bb.on('finish', async () => {
      if (!chunkHandled || !chunkPromise) {
        sendError(res, 'NO_CHUNK_DATA', 'No chunk data was provided in the multipart request', 400);
        return;
      }
      try {
        const result = await chunkPromise;
        sendSuccess(res, result, 200);
      } catch (err) {
        next(err);
      }
    });

    req.pipe(bb);
  } else {
    // Direct stream (e.g. application/octet-stream or binary PUT)
    uploadService
      .uploadChunk(userId, uploadId, chunkNumber, req)
      .then((result) => {
        sendSuccess(res, result, 200);
      })
      .catch(next);
  }
};

export const completeUpload = asyncHandler(async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const userId = req.user!._id.toString();
  const uploadId = req.params['uploadId'] as string;
  const file = await uploadService.completeUpload(userId, uploadId);
  sendSuccess(res, { file }, 201);
});

export const getUploadStatus = asyncHandler(async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const userId = req.user!._id.toString();
  const uploadId = req.params['uploadId'] as string;
  const session = await uploadService.getUploadStatus(userId, uploadId);
  sendSuccess(res, { session }, 200);
});

export const cancelUpload = asyncHandler(async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const userId = req.user!._id.toString();
  const uploadId = req.params['uploadId'] as string;
  await uploadService.cancelUpload(userId, uploadId);
  sendSuccess(res, { message: 'Upload session cancelled successfully' }, 200);
});

