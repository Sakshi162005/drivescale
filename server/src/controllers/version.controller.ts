import { Response, NextFunction } from 'express';
import busboy from 'busboy';
import { versionService } from '../services/version.service.js';
import { fileService } from '../services/file.service.js';
import { sendSuccess, sendError } from '../utils/response.js';
import { AuthenticatedRequest } from '../middleware/auth.middleware.js';
import { asyncHandler } from '../utils/async.js';
import { BadRequestError } from '../utils/errors.js';

export const listVersions = asyncHandler(
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const userId = req.user!._id.toString();
    const fileId = (req.params.fileId || req.params.id) as string;

    const result = await versionService.listVersions(userId, fileId);
    sendSuccess(res, result);
  }
);

export const getVersion = asyncHandler(
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const userId = req.user!._id.toString();
    const fileId = (req.params.fileId || req.params.id) as string;
    const versionId = req.params.versionId as string;

    const result = await versionService.getVersion(userId, fileId, versionId);
    sendSuccess(res, result);
  }
);

export const downloadVersion = asyncHandler(
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const userId = req.user!._id.toString();
    const fileId = (req.params.fileId || req.params.id) as string;
    const versionId = req.params.versionId as string;

    const { stream, version, file } = await versionService.getVersionForDownload(
      userId,
      fileId,
      versionId
    );

    const safeFilename = encodeURIComponent(version.name || file.name);
    res.setHeader('Content-Type', version.mimeType || 'application/octet-stream');
    res.setHeader('Content-Length', version.size);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${safeFilename}"; filename*=UTF-8''${safeFilename}`
    );

    stream.pipe(res);
  }
);

export const restoreVersion = asyncHandler(
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const userId = req.user!._id.toString();
    const fileId = (req.params.fileId || req.params.id) as string;
    const versionId = req.params.versionId as string;

    const result = await versionService.restoreVersion(userId, fileId, versionId);
    sendSuccess(res, {
      message: `Restored to version ${result.restoredFromVersion.versionNumber} successfully`,
      ...result,
    });
  }
);

export const uploadNewVersion = (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void => {
  const userId = req.user!._id.toString();
  const fileId = (req.params.fileId || req.params.id) as string;
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

  let uploadPromise: Promise<unknown> | null = null;
  let fileHandled = false;

  bb.on('file', (_fieldname: string, fileStream: NodeJS.ReadableStream, info: busboy.FileInfo) => {
    fileHandled = true;
    const { filename, mimeType } = info;

    uploadPromise = fileService.uploadFile(userId, {
      fileName: filename,
      mimeType: mimeType || 'application/octet-stream',
      stream: fileStream,
      replaceFileId: fileId,
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
      sendSuccess(res, { file, message: 'New version uploaded successfully' }, 201);
    } catch (err) {
      next(err);
    }
  });

  req.pipe(bb);
};

