import { Queue, QueueOptions, JobsOptions } from 'bullmq';
import { createBullMQConnection } from '../config/redis.js';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import {
  CleanupExpiredUploadPayload,
  cleanupExpiredUploadPayloadSchema,
  CleanupTrashPayload,
  cleanupTrashPayloadSchema,
} from '../schemas/job.schema.js';

export const CLEANUP_QUEUE_NAME = 'cleanup-queue';

export const CLEANUP_JOB_NAMES = {
  CLEANUP_EXPIRED_UPLOAD: 'cleanup-expired-upload',
  CLEANUP_TRASH: 'cleanup-trash',
} as const;

let cleanupQueue: Queue | null = null;

export const getDefaultCleanupJobOptions = (): JobsOptions => ({
  attempts: env.BULLMQ_MAX_RETRIES,
  backoff: {
    type: 'exponential',
    delay: env.BULLMQ_BACKOFF_DELAY_MS,
  },
  removeOnComplete: {
    count: env.BULLMQ_COMPLETED_RETENTION_COUNT,
  },
  removeOnFail: {
    count: env.BULLMQ_FAILED_RETENTION_COUNT,
    age: env.BULLMQ_FAILED_RETENTION_AGE_SECONDS,
  },
});

export const getCleanupQueue = (customOptions?: Partial<QueueOptions>): Queue => {
  if (!cleanupQueue) {
    const connection = customOptions?.connection || createBullMQConnection();
    cleanupQueue = new Queue(CLEANUP_QUEUE_NAME, {
      connection,
      defaultJobOptions: getDefaultCleanupJobOptions(),
      ...customOptions,
    });

    cleanupQueue.on('error', (err) => {
      logger.error({ err: err.message, queue: CLEANUP_QUEUE_NAME }, 'Cleanup queue error');
    });
  }
  return cleanupQueue;
};

export const setCleanupQueue = (queue: Queue | null): void => {
  cleanupQueue = queue;
};

export const enqueueExpiredUploadCleanup = async (
  payload: Partial<CleanupExpiredUploadPayload> = {},
  options?: JobsOptions
) => {
  const validated = cleanupExpiredUploadPayloadSchema.parse({
    batchSize: payload.batchSize ?? 50,
    triggeredAt: payload.triggeredAt ?? new Date().toISOString(),
  });

  const queue = getCleanupQueue();
  const job = await queue.add(CLEANUP_JOB_NAMES.CLEANUP_EXPIRED_UPLOAD, validated, options);
  logger.info({ jobId: job.id, batchSize: validated.batchSize }, 'Enqueued expired upload cleanup job');
  return job;
};

export const enqueueTrashCleanup = async (
  payload: CleanupTrashPayload,
  options?: JobsOptions
) => {
  const validated = cleanupTrashPayloadSchema.parse(payload);
  const queue = getCleanupQueue();
  const job = await queue.add(CLEANUP_JOB_NAMES.CLEANUP_TRASH, validated, options);
  logger.info({ jobId: job.id, olderThanDays: validated.olderThanDays }, 'Enqueued trash cleanup scaffold job');
  return job;
};

export const closeCleanupQueue = async (): Promise<void> => {
  if (cleanupQueue) {
    if (typeof cleanupQueue.close === 'function') {
      await cleanupQueue.close();
    }
    cleanupQueue = null;
  }
};

