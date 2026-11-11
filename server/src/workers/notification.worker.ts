import { Worker, Job, WorkerOptions, UnrecoverableError } from 'bullmq';
import { NOTIFICATION_QUEUE_NAME, NOTIFICATION_JOB_NAMES } from '../queues/notification.queue.js';
import { createBullMQConnection } from '../config/redis.js';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import {
  SendNotificationPayload,
  sendNotificationPayloadSchema,
} from '../schemas/job.schema.js';

export interface INotificationProvider {
  send(notification: SendNotificationPayload): Promise<boolean>;
}

export class LogNotificationProvider implements INotificationProvider {
  async send(notification: SendNotificationPayload): Promise<boolean> {
    logger.info(
      {
        userId: notification.userId,
        type: notification.type,
        title: notification.title,
      },
      'Notification dispatched (Development Log Provider)'
    );
    return true;
  }
}

let notificationProvider: INotificationProvider = new LogNotificationProvider();

export const setNotificationProvider = (provider: INotificationProvider): void => {
  notificationProvider = provider;
};

export const getNotificationProvider = (): INotificationProvider => notificationProvider;

let notificationWorker: Worker | null = null;

/**
 * Processor for notification queue jobs.
 * Exported separately for easy, deterministic unit testing.
 */
export const processNotificationJob = async (job: Job) => {
  logger.info({ jobId: job.id, jobName: job.name }, 'Processing notification job');

  switch (job.name) {
    case NOTIFICATION_JOB_NAMES.SEND_NOTIFICATION: {
      const parseResult = sendNotificationPayloadSchema.safeParse(job.data);
      if (!parseResult.success) {
        logger.error({ jobId: job.id, errors: parseResult.error.format() }, 'Invalid notification payload');
        throw new UnrecoverableError(`Invalid payload: ${parseResult.error.message}`);
      }

      const payload = parseResult.data;
      const delivered = await notificationProvider.send(payload);

      if (!delivered) {
        throw new Error(`Notification provider failed to deliver message to user ${payload.userId}`);
      }

      return {
        delivered: true,
        userId: payload.userId,
        type: payload.type,
      };
    }

    default:
      logger.warn({ jobId: job.id, jobName: job.name }, 'Unknown notification job type');
      throw new UnrecoverableError(`Unknown notification job name: ${job.name}`);
  }
};

export const createNotificationWorker = (customOptions?: Partial<WorkerOptions>): Worker => {
  if (!notificationWorker) {
    const connection = customOptions?.connection || createBullMQConnection();
    notificationWorker = new Worker(NOTIFICATION_QUEUE_NAME, processNotificationJob, {
      connection,
      concurrency: env.BULLMQ_CONCURRENCY,
      ...customOptions,
    });

    notificationWorker.on('completed', (job) => {
      logger.info({ jobId: job.id, jobName: job.name }, 'Notification job completed successfully');
    });

    notificationWorker.on('failed', (job, err) => {
      logger.error(
        { jobId: job?.id, jobName: job?.name, attempts: job?.attemptsMade, err: err.message },
        'Notification job failed'
      );
    });

    notificationWorker.on('error', (err) => {
      logger.error({ err: err.message }, 'Notification worker error');
    });
  }

  return notificationWorker;
};

export const getNotificationWorker = (): Worker | null => notificationWorker;

export const closeNotificationWorker = async (): Promise<void> => {
  if (notificationWorker) {
    if (typeof notificationWorker.close === 'function') {
      await notificationWorker.close();
    }
    notificationWorker = null;
  }
};

