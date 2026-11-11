import { Worker, Job, WorkerOptions, UnrecoverableError } from 'bullmq';
import { FILE_QUEUE_NAME, FILE_JOB_NAMES } from '../queues/file.queue.js';
import { createBullMQConnection } from '../config/redis.js';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { storageService } from '../services/storage/index.js';
import { generateThumbnailPayloadSchema } from '../schemas/job.schema.js';

let fileWorker: Worker | null = null;

const SUPPORTED_THUMBNAIL_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
]);

/**
 * Processor for file queue jobs.
 * Exported separately for easy, deterministic unit testing.
 */
export const processFileJob = async (job: Job) => {
  logger.info({ jobId: job.id, jobName: job.name }, 'Processing file job');

  switch (job.name) {
    case FILE_JOB_NAMES.GENERATE_THUMBNAIL: {
      const parseResult = generateThumbnailPayloadSchema.safeParse(job.data);
      if (!parseResult.success) {
        logger.error({ jobId: job.id, errors: parseResult.error.format() }, 'Invalid thumbnail payload');
        throw new UnrecoverableError(`Invalid payload: ${parseResult.error.message}`);
      }

      const { fileId, storageKey, mimeType } = parseResult.data;

      // 1. Verify MIME type support
      if (!SUPPORTED_THUMBNAIL_MIME_TYPES.has(mimeType)) {
        logger.info(
          { jobId: job.id, fileId, mimeType },
          'Thumbnail generation safely skipped: unsupported MIME type'
        );
        return {
          success: true,
          skipped: true,
          reason: 'UNSUPPORTED_MIME_TYPE',
          fileId,
        };
      }

      // 2. Verify file existence in storage abstraction
      const exists = await storageService.exists(storageKey);
      if (!exists) {
        logger.warn(
          { jobId: job.id, fileId, storageKey },
          'Thumbnail generation safely skipped: target file does not exist in storage'
        );
        return {
          success: false,
          skipped: true,
          reason: 'FILE_NOT_FOUND',
          fileId,
        };
      }

      // 3. Image manipulation scaffold
      // Note: Full image manipulation (e.g. sharp/canvas) is deferred until thumbnail library integration.
      logger.info(
        { jobId: job.id, fileId, storageKey },
        'Thumbnail generation scaffold completed successfully'
      );

      return {
        success: true,
        scaffold: true,
        fileId,
        thumbnailKey: null,
      };
    }

    default:
      logger.warn({ jobId: job.id, jobName: job.name }, 'Unknown file job type');
      throw new UnrecoverableError(`Unknown file job name: ${job.name}`);
  }
};

export const createFileWorker = (customOptions?: Partial<WorkerOptions>): Worker => {
  if (!fileWorker) {
    const connection = customOptions?.connection || createBullMQConnection();
    fileWorker = new Worker(FILE_QUEUE_NAME, processFileJob, {
      connection,
      concurrency: env.BULLMQ_CONCURRENCY,
      ...customOptions,
    });

    fileWorker.on('completed', (job) => {
      logger.info({ jobId: job.id, jobName: job.name }, 'File job completed successfully');
    });

    fileWorker.on('failed', (job, err) => {
      logger.error(
        { jobId: job?.id, jobName: job?.name, attempts: job?.attemptsMade, err: err.message },
        'File job failed'
      );
    });

    fileWorker.on('error', (err) => {
      logger.error({ err: err.message }, 'File worker error');
    });
  }

  return fileWorker;
};

export const getFileWorker = (): Worker | null => fileWorker;

export const closeFileWorker = async (): Promise<void> => {
  if (fileWorker) {
    if (typeof fileWorker.close === 'function') {
      await fileWorker.close();
    }
    fileWorker = null;
  }
};

