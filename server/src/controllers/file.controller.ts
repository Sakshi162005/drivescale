import { Response, NextFunction } from 'express';
import busboy from 'busboy';
import { fileService } from '../services/file.service.js';
import { sendSuccess, sendError } from '../utils/response.js';
import { AuthenticatedRequest } from '../middleware/auth.middleware.js';
import { asyncHandler } from '../utils/async.js';
import { listFilesQuerySchema } from '../schemas/file.schema.js';
import { BadRequestError } from '../utils/errors.js';

export const uploadFile = (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
  const userId = req.user!._id.toString();
  const contentType = req.headers['content-type'] || '';

  if (!contentType.includes('multipart/form-data')) {
    sendError(res, 'INVALID_CONTENT_TYPE', 'Request must be multipart/form-data', 400);
    return;
  }

  let bb: busboy.Busboy;
  try {
    bb = busboy({ headers: req.headers, limits: { files: 1 } });
  } catch (err: unknown) {
    next(new BadRequestError(err instanceof Error ? err.message : 'Malformed multipart request'));
    return;
  }

  let folderId: string | null = (req.query['folderId'] as string) || null;
  let uploadPromise: Promise<unknown> | null = null;
  let fileHandled = false;

  bb.on('field', (name: string, val: string) => {
    if (name === 'folderId') {
      folderId = val.trim() || null;
    }
  });

  bb.on('file', (_fieldname: string, fileStream: NodeJS.ReadableStream, info: busboy.FileInfo) => {
    fileHandled = true;
    const { filename, mimeType } = info;

    uploadPromise = fileService.uploadFile(userId, {
      folderId,
      fileName: filename,
      mimeType: mimeType || 'application/octet-stream',
      stream: fileStream,
    });
    uploadPromise.catch(() => {});
  });

  bb.on('error', (err: Error) => {
    next(err);
  });

  bb.on('finish', async () => {
    if (!fileHandled || !uploadPromise) {
      sendError(res, 'NO_FILE_UPLOADED', 'No file was provided in the request', 400);
      return;
    }

    try {
      const file = await uploadPromise;
      sendSuccess(res, { file }, 201);
    } catch (err) {
      next(err);
    }
  });

  req.pipe(bb);
};

export const listFiles = asyncHandler(async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const userId = req.user!._id.toString();
  const query = listFilesQuerySchema.parse(req.query);
  const result = await fileService.listFiles(userId, query);
  sendSuccess(res, result, 200);
});

export const getFile = asyncHandler(async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const userId = req.user!._id.toString();
  const file = await fileService.getFile(userId, req.params['id'] as string);
  sendSuccess(res, { file }, 200);
});

export const downloadFile = asyncHandler(async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const userId = req.user!._id.toString();
  const { file, stream } = await fileService.getFileForDownload(userId, req.params['id'] as string);

  res.setHeader('Content-Type', file.mimeType);
  res.setHeader('Content-Length', file.size.toString());
  // Encode filename safely for Content-Disposition header
  const encodedFilename = encodeURIComponent(file.name).replace(/['()]/g, escape).replace(/\*/g, '%2A');
  res.setHeader('Content-Disposition', `attachment; filename="${file.name.replace(/"/g, '')}"; filename*=UTF-8''${encodedFilename}`);

  stream.pipe(res);
});

export const renameFile = asyncHandler(async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const userId = req.user!._id.toString();
  const file = await fileService.renameFile(userId, req.params['id'] as string, req.body.name);
  sendSuccess(res, { file }, 200);
});

export const moveFile = asyncHandler(async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const userId = req.user!._id.toString();
  const file = await fileService.moveFile(userId, req.params['id'] as string, req.body.targetFolderId);
  sendSuccess(res, { file }, 200);
});

export const deleteFile = asyncHandler(async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const userId = req.user!._id.toString();
  await fileService.deleteFile(userId, req.params['id'] as string);
  sendSuccess(res, { message: 'File deleted successfully' }, 200);
});
