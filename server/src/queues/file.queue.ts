import { Queue, QueueOptions, JobsOptions } from 'bullmq';
import { createBullMQConnection } from '../config/redis.js';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import {
  GenerateThumbnailPayload,
  generateThumbnailPayloadSchema,
} from '../schemas/job.schema.js';

export const FILE_QUEUE_NAME = 'file-queue';

export const FILE_JOB_NAMES = {
  GENERATE_THUMBNAIL: 'generate-thumbnail',
} as const;

let fileQueue: Queue | null = null;

export const getDefaultFileJobOptions = (): JobsOptions => ({
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

export const getFileQueue = (customOptions?: Partial<QueueOptions>): Queue => {
  if (!fileQueue) {
    const connection = customOptions?.connection || createBullMQConnection();
    fileQueue = new Queue(FILE_QUEUE_NAME, {
      connection,
      defaultJobOptions: getDefaultFileJobOptions(),
      ...customOptions,
    });

    fileQueue.on('error', (err) => {
      logger.error({ err: err.message, queue: FILE_QUEUE_NAME }, 'File queue error');
    });
  }
  return fileQueue;
};

export const setFileQueue = (queue: Queue | null): void => {
  fileQueue = queue;
};

export const enqueueThumbnailGeneration = async (
  payload: GenerateThumbnailPayload,
  options?: JobsOptions
) => {
  const validated = generateThumbnailPayloadSchema.parse(payload);
  const queue = getFileQueue();
  const job = await queue.add(FILE_JOB_NAMES.GENERATE_THUMBNAIL, validated, options);
  logger.info({ jobId: job.id, fileId: validated.fileId, mimeType: validated.mimeType }, 'Enqueued thumbnail generation job');
  return job;
};

export const closeFileQueue = async (): Promise<void> => {
  if (fileQueue) {
    if (typeof fileQueue.close === 'function') {
      await fileQueue.close();
    }
    fileQueue = null;
  }
};

