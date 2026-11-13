import { Worker, Job, WorkerOptions, UnrecoverableError } from 'bullmq';
import { CLEANUP_QUEUE_NAME, CLEANUP_JOB_NAMES } from '../queues/cleanup.queue.js';
import { createBullMQConnection } from '../config/redis.js';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { UploadSession } from '../models/UploadSession.js';
import { User } from '../models/User.js';
import { storageService } from '../services/storage/index.js';
import { trashService } from '../services/trash.service.js';
import {
  cleanupExpiredUploadPayloadSchema,
  cleanupTrashPayloadSchema,
} from '../schemas/job.schema.js';

let cleanupWorker: Worker | null = null;

/**
 * Processor for cleanup queue jobs.
 * Exported separately for easy, deterministic unit testing.
 */
export const processCleanupJob = async (job: Job) => {
  logger.info({ jobId: job.id, jobName: job.name }, 'Processing cleanup job');

  switch (job.name) {
    case CLEANUP_JOB_NAMES.CLEANUP_EXPIRED_UPLOAD: {
      const parseResult = cleanupExpiredUploadPayloadSchema.safeParse(job.data);
      if (!parseResult.success) {
        logger.error({ jobId: job.id, errors: parseResult.error.format() }, 'Invalid expired upload cleanup payload');
        throw new UnrecoverableError(`Invalid payload: ${parseResult.error.message}`);
      }

      const { batchSize } = parseResult.data;
      const now = new Date();

      // Find candidates eligible for expiration
      const candidates = await UploadSession.find({
        status: { $in: ['PENDING', 'UPLOADING', 'FAILED'] },
        expiresAt: { $lt: now },
      })
        .limit(batchSize)
        .select('_id status expiresAt');

      let cleanedCount = 0;
      let skippedCount = 0;

      for (const candidate of candidates) {
        // Atomic immediate eligibility check before destructive action:
        // Ensures completed or assembling sessions are NEVER deleted.
        const session = await UploadSession.findOneAndUpdate(
          {
            _id: candidate._id,
            status: { $in: ['PENDING', 'UPLOADING', 'FAILED'] },
            expiresAt: { $lt: now },
          },
          {
            $set: { status: 'EXPIRED' },
          },
          { new: true }
        );

        if (session) {
          if (session.reservedBytes && session.reservedBytes > 0) {
            try {
              await User.findByIdAndUpdate(session.userId, {
                $inc: { storageReserved: -session.reservedBytes },
              });
              await UploadSession.findByIdAndUpdate(session._id, {
                $set: { reservedBytes: 0 },
              });
            } catch (quotaErr) {
              logger.warn(
                { uploadId: session._id, err: quotaErr instanceof Error ? quotaErr.message : 'Unknown' },
                'Failed to release quota reservation for expired session'
              );
            }
          }

          try {
            await storageService.deleteChunks(session._id.toString());
            cleanedCount++;
          } catch (chunkErr) {
            logger.warn(
              { uploadId: session._id, err: chunkErr instanceof Error ? chunkErr.message : 'Unknown' },
              'Failed to delete temporary chunks for expired session (non-fatal)'
            );
          }
        } else {
          skippedCount++;
        }
      }

      logger.info(
        { jobId: job.id, cleanedCount, skippedCount, totalCandidates: candidates.length },
        'Expired upload cleanup completed'
      );

      return {
        cleanedCount,
        skippedCount,
        totalCandidates: candidates.length,
      };
    }

    case CLEANUP_JOB_NAMES.CLEANUP_TRASH: {
      const parseResult = cleanupTrashPayloadSchema.safeParse(job.data);
      if (!parseResult.success) {
        logger.error({ jobId: job.id, errors: parseResult.error.format() }, 'Invalid trash cleanup payload');
        throw new UnrecoverableError(`Invalid payload: ${parseResult.error.message}`);
      }

      const { olderThanDays, batchSize } = parseResult.data;
      logger.info(
        { jobId: job.id, olderThanDays, batchSize },
        'Starting automatic trash cleanup'
      );

      const result = await trashService.cleanupExpiredTrash(olderThanDays, batchSize);

      logger.info(
        {
          jobId: job.id,
          cleanedFilesCount: result.cleanedFilesCount,
          cleanedFoldersCount: result.cleanedFoldersCount,
        },
        'Automatic trash cleanup completed successfully'
      );

      return {
        scaffold: false,
        olderThanDays,
        batchSize,
        cleanedFilesCount: result.cleanedFilesCount,
        cleanedFoldersCount: result.cleanedFoldersCount,
      };
    }

    default:
      logger.warn({ jobId: job.id, jobName: job.name }, 'Unknown cleanup job type');
      throw new UnrecoverableError(`Unknown cleanup job name: ${job.name}`);
  }
};

export const createCleanupWorker = (customOptions?: Partial<WorkerOptions>): Worker => {
  if (!cleanupWorker) {
    const connection = customOptions?.connection || createBullMQConnection();
    cleanupWorker = new Worker(CLEANUP_QUEUE_NAME, processCleanupJob, {
      connection,
      concurrency: env.BULLMQ_CONCURRENCY,
      ...customOptions,
    });

    cleanupWorker.on('completed', (job) => {
      logger.info({ jobId: job.id, jobName: job.name }, 'Cleanup job completed successfully');
    });

    cleanupWorker.on('failed', (job, err) => {
      logger.error(
        { jobId: job?.id, jobName: job?.name, attempts: job?.attemptsMade, err: err.message },
        'Cleanup job failed'
      );
    });

    cleanupWorker.on('error', (err) => {
      logger.error({ err: err.message }, 'Cleanup worker error');
    });
  }

  return cleanupWorker;
};

export const getCleanupWorker = (): Worker | null => cleanupWorker;

export const closeCleanupWorker = async (): Promise<void> => {
  if (cleanupWorker) {
    if (typeof cleanupWorker.close === 'function') {
      await cleanupWorker.close();
    }
    cleanupWorker = null;
  }
};

