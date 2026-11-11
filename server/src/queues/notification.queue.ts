import { Queue, QueueOptions, JobsOptions } from 'bullmq';
import { createBullMQConnection } from '../config/redis.js';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import {
  SendNotificationPayload,
  sendNotificationPayloadSchema,
} from '../schemas/job.schema.js';

export const NOTIFICATION_QUEUE_NAME = 'notification-queue';

export const NOTIFICATION_JOB_NAMES = {
  SEND_NOTIFICATION: 'send-notification',
} as const;

let notificationQueue: Queue | null = null;

export const getDefaultNotificationJobOptions = (): JobsOptions => ({
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

export const getNotificationQueue = (customOptions?: Partial<QueueOptions>): Queue => {
  if (!notificationQueue) {
    const connection = customOptions?.connection || createBullMQConnection();
    notificationQueue = new Queue(NOTIFICATION_QUEUE_NAME, {
      connection,
      defaultJobOptions: getDefaultNotificationJobOptions(),
      ...customOptions,
    });

    notificationQueue.on('error', (err) => {
      logger.error({ err: err.message, queue: NOTIFICATION_QUEUE_NAME }, 'Notification queue error');
    });
  }
  return notificationQueue;
};

export const setNotificationQueue = (queue: Queue | null): void => {
  notificationQueue = queue;
};

export const enqueueNotification = async (
  payload: SendNotificationPayload,
  options?: JobsOptions
) => {
  const validated = sendNotificationPayloadSchema.parse(payload);
  const queue = getNotificationQueue();
  const job = await queue.add(NOTIFICATION_JOB_NAMES.SEND_NOTIFICATION, validated, options);
  logger.info({ jobId: job.id, userId: validated.userId, type: validated.type }, 'Enqueued notification job');
  return job;
};

export const closeNotificationQueue = async (): Promise<void> => {
  if (notificationQueue) {
    if (typeof notificationQueue.close === 'function') {
      await notificationQueue.close();
    }
    notificationQueue = null;
  }
};

