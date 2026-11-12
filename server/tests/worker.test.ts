import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import mongoose from 'mongoose';
import RedisMock from 'ioredis-mock';
import { Queue, Job, UnrecoverableError } from 'bullmq';
import {
  setBullMQConnectionFactory,
  closeBullMQConnections,
  createBullMQConnection,
} from '../src/config/redis.js';
import {
  CLEANUP_QUEUE_NAME,
  CLEANUP_JOB_NAMES,
  getCleanupQueue,
  setCleanupQueue,
  closeCleanupQueue,
  enqueueExpiredUploadCleanup,
  enqueueTrashCleanup,
  getDefaultCleanupJobOptions,
} from '../src/queues/cleanup.queue.js';
import {
  FILE_QUEUE_NAME,
  FILE_JOB_NAMES,
  getFileQueue,
  setFileQueue,
  closeFileQueue,
  enqueueThumbnailGeneration,
  getDefaultFileJobOptions,
} from '../src/queues/file.queue.js';
import {
  NOTIFICATION_QUEUE_NAME,
  NOTIFICATION_JOB_NAMES,
  getNotificationQueue,
  setNotificationQueue,
  closeNotificationQueue,
  enqueueNotification,
  getDefaultNotificationJobOptions,
} from '../src/queues/notification.queue.js';
import {
  processCleanupJob,
  createCleanupWorker,
  closeCleanupWorker,
} from '../src/workers/cleanup.worker.js';
import {
  processFileJob,
  createFileWorker,
  closeFileWorker,
} from '../src/workers/file.worker.js';
import {
  processNotificationJob,
  createNotificationWorker,
  closeNotificationWorker,
  setNotificationProvider,
  LogNotificationProvider,
  INotificationProvider,
} from '../src/workers/notification.worker.js';
import { UploadSession } from '../src/models/UploadSession.js';
import { storageService } from '../src/services/storage/index.js';
import { trashService } from '../src/services/trash.service.js';

describe('Phase 7 Background Workers & Queue Infrastructure Test Suite', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    setBullMQConnectionFactory(() => new (RedisMock as any)({ maxRetriesPerRequest: null }));
  });

  afterEach(async () => {
    await closeCleanupQueue();
    await closeFileQueue();
    await closeNotificationQueue();
    await closeCleanupWorker();
    await closeFileWorker();
    await closeNotificationWorker();
    await closeBullMQConnections();
    setBullMQConnectionFactory(null);
  });

  describe('1. Queue Configuration & Job Producer Infrastructure', () => {
    it('initializes queues with standard retry and retention policies', () => {
      const cleanupOpts = getDefaultCleanupJobOptions();
      expect(cleanupOpts.attempts).toBeGreaterThanOrEqual(1);
      expect(cleanupOpts.backoff).toEqual({ type: 'exponential', delay: 2000 });
      expect(cleanupOpts.removeOnComplete).toBeDefined();
      expect(cleanupOpts.removeOnFail).toBeDefined();

      const fileOpts = getDefaultFileJobOptions();
      expect(fileOpts.attempts).toBeGreaterThanOrEqual(1);
      expect(fileOpts.backoff).toEqual({ type: 'exponential', delay: 2000 });

      const notifOpts = getDefaultNotificationJobOptions();
      expect(notifOpts.attempts).toBeGreaterThanOrEqual(1);
      expect(notifOpts.backoff).toEqual({ type: 'exponential', delay: 2000 });
    });

    it('enqueues expired upload cleanup job with validated payload', async () => {
      const mockQueue = {
        add: vi.fn().mockResolvedValue({ id: 'job_cleanup_1' }),
      } as unknown as Queue;
      setCleanupQueue(mockQueue);

      const job = await enqueueExpiredUploadCleanup({ batchSize: 25 });
      expect(mockQueue.add).toHaveBeenCalledWith(
        CLEANUP_JOB_NAMES.CLEANUP_EXPIRED_UPLOAD,
        expect.objectContaining({ batchSize: 25 }),
        undefined
      );
      expect(job.id).toBe('job_cleanup_1');
    });

    it('rejects invalid payload when enqueuing trash cleanup', async () => {
      await expect(
        enqueueTrashCleanup({ olderThanDays: -5 } as any)
      ).rejects.toThrow();
    });

    it('enqueues thumbnail generation job with validated payload', async () => {
      const mockQueue = {
        add: vi.fn().mockResolvedValue({ id: 'job_thumb_1' }),
      } as unknown as Queue;
      setFileQueue(mockQueue);

      const payload = {
        fileId: new mongoose.Types.ObjectId().toString(),
        ownerId: new mongoose.Types.ObjectId().toString(),
        mimeType: 'image/png',
        storageKey: 'objects/ab/abcdef123456',
      };

      const job = await enqueueThumbnailGeneration(payload);
      expect(mockQueue.add).toHaveBeenCalledWith(
        FILE_JOB_NAMES.GENERATE_THUMBNAIL,
        payload,
        undefined
      );
      expect(job.id).toBe('job_thumb_1');
    });

    it('rejects invalid thumbnail generation payload missing required fields', async () => {
      await expect(
        enqueueThumbnailGeneration({ fileId: '', ownerId: '123' } as any)
      ).rejects.toThrow();
    });

    it('enqueues notification job with validated payload', async () => {
      const mockQueue = {
        add: vi.fn().mockResolvedValue({ id: 'job_notif_1' }),
      } as unknown as Queue;
      setNotificationQueue(mockQueue);

      const payload = {
        userId: new mongoose.Types.ObjectId().toString(),
        type: 'UPLOAD_COMPLETED' as const,
        title: 'Upload Successful',
        message: 'Your file has been processed successfully.',
      };

      const job = await enqueueNotification(payload);
      expect(mockQueue.add).toHaveBeenCalledWith(
        NOTIFICATION_JOB_NAMES.SEND_NOTIFICATION,
        payload,
        undefined
      );
      expect(job.id).toBe('job_notif_1');
    });
  });

  describe('2. Expired Upload Session Cleanup Processor', () => {
    it('identifies and cleans up expired sessions and removes temporary chunks', async () => {
      const expiredId1 = new mongoose.Types.ObjectId();
      const expiredId2 = new mongoose.Types.ObjectId();
      const pastDate = new Date(Date.now() - 3600000);

      const mockCandidates = [
        { _id: expiredId1, status: 'UPLOADING', expiresAt: pastDate },
        { _id: expiredId2, status: 'PENDING', expiresAt: pastDate },
      ];

      // Mock finding expired candidates
      vi.spyOn(UploadSession, 'find').mockReturnValue({
        limit: vi.fn().mockReturnValue({
          select: vi.fn().mockResolvedValue(mockCandidates),
        }),
      } as any);

      // Mock atomic findOneAndUpdate
      vi.spyOn(UploadSession, 'findOneAndUpdate').mockImplementation((filter: any) => {
        const id = filter._id.toString();
        if (id === expiredId1.toString() || id === expiredId2.toString()) {
          return Promise.resolve({ _id: filter._id, status: 'EXPIRED' } as any);
        }
        return Promise.resolve(null);
      });

      const deleteChunksSpy = vi.spyOn(storageService, 'deleteChunks').mockResolvedValue();

      const job = {
        id: 'job_clean_1',
        name: CLEANUP_JOB_NAMES.CLEANUP_EXPIRED_UPLOAD,
        data: { batchSize: 50 },
      } as unknown as Job;

      const result = await processCleanupJob(job);

      expect(result.cleanedCount).toBe(2);
      expect(result.skippedCount).toBe(0);
      expect(deleteChunksSpy).toHaveBeenCalledTimes(2);
      expect(deleteChunksSpy).toHaveBeenCalledWith(expiredId1.toString());
      expect(deleteChunksSpy).toHaveBeenCalledWith(expiredId2.toString());
    });

    it('safely preserves unexpired, completed, and assembling upload sessions', async () => {
      const unexpiredId = new mongoose.Types.ObjectId();
      const futureDate = new Date(Date.now() + 3600000);

      // Query returns 0 candidates because expiresAt is in future
      vi.spyOn(UploadSession, 'find').mockReturnValue({
        limit: vi.fn().mockReturnValue({
          select: vi.fn().mockResolvedValue([]),
        }),
      } as any);

      const deleteChunksSpy = vi.spyOn(storageService, 'deleteChunks').mockResolvedValue();

      const job = {
        id: 'job_clean_unexpired',
        name: CLEANUP_JOB_NAMES.CLEANUP_EXPIRED_UPLOAD,
        data: { batchSize: 50 },
      } as unknown as Job;

      const result = await processCleanupJob(job);

      expect(result.cleanedCount).toBe(0);
      expect(result.totalCandidates).toBe(0);
      expect(deleteChunksSpy).not.toHaveBeenCalled();
    });

    it('safely preserves completed sessions if status changed concurrently before destructive action', async () => {
      const sessionId = new mongoose.Types.ObjectId();

      // Candidate was found before completion
      vi.spyOn(UploadSession, 'find').mockReturnValue({
        limit: vi.fn().mockReturnValue({
          select: vi.fn().mockResolvedValue([{ _id: sessionId, status: 'UPLOADING' }]),
        }),
      } as any);

      // But findOneAndUpdate returns null because status is now COMPLETED
      vi.spyOn(UploadSession, 'findOneAndUpdate').mockResolvedValue(null);

      const deleteChunksSpy = vi.spyOn(storageService, 'deleteChunks').mockResolvedValue();

      const job = {
        id: 'job_race_protect',
        name: CLEANUP_JOB_NAMES.CLEANUP_EXPIRED_UPLOAD,
        data: { batchSize: 50 },
      } as unknown as Job;

      const result = await processCleanupJob(job);

      expect(result.cleanedCount).toBe(0);
      expect(result.skippedCount).toBe(1);
      expect(deleteChunksSpy).not.toHaveBeenCalled();
    });

    it('handles missing chunk directories idempotently without failing job', async () => {
      const expiredId = new mongoose.Types.ObjectId();

      vi.spyOn(UploadSession, 'find').mockReturnValue({
        limit: vi.fn().mockReturnValue({
          select: vi.fn().mockResolvedValue([{ _id: expiredId }]),
        }),
      } as any);

      vi.spyOn(UploadSession, 'findOneAndUpdate').mockResolvedValue({
        _id: expiredId,
        status: 'EXPIRED',
      } as any);

      // deleteChunks throws a non-fatal filesystem error
      vi.spyOn(storageService, 'deleteChunks').mockRejectedValue(new Error('ENOENT: file not found'));

      const job = {
        id: 'job_missing_dir',
        name: CLEANUP_JOB_NAMES.CLEANUP_EXPIRED_UPLOAD,
        data: { batchSize: 10 },
      } as unknown as Job;

      // Must complete safely without throwing
      const result = await processCleanupJob(job);
      expect(result.totalCandidates).toBe(1);
    });

    it('throws UnrecoverableError on corrupted cleanup payload to prevent endless retries', async () => {
      const badJob = {
        id: 'job_bad_payload',
        name: CLEANUP_JOB_NAMES.CLEANUP_EXPIRED_UPLOAD,
        data: { batchSize: -999 },
      } as unknown as Job;

      await expect(processCleanupJob(badJob)).rejects.toThrow(UnrecoverableError);
    });

    it('processes trash cleanup job and invokes trashService', async () => {
      const trashJob = {
        id: 'job_trash_scaffold',
        name: CLEANUP_JOB_NAMES.CLEANUP_TRASH,
        data: { olderThanDays: 30, batchSize: 100 },
      } as unknown as Job;

      const trashSpy = vi.spyOn(trashService, 'cleanupExpiredTrash').mockResolvedValue({
        cleanedFilesCount: 0,
        cleanedFoldersCount: 0,
      });

      const result = await processCleanupJob(trashJob);
      expect(result.olderThanDays).toBe(30);
      expect(result.batchSize).toBe(100);
      expect(trashSpy).toHaveBeenCalledWith(30, 100);
    });
  });

  describe('3. Thumbnail Generation Job Processor', () => {
    it('safely skips thumbnail generation for non-image MIME types', async () => {
      const job = {
        id: 'job_pdf_thumb',
        name: FILE_JOB_NAMES.GENERATE_THUMBNAIL,
        data: {
          fileId: 'file_pdf_1',
          ownerId: 'user_1',
          mimeType: 'application/pdf',
          storageKey: 'objects/ab/pdf1',
        },
      } as unknown as Job;

      const result = await processFileJob(job);
      expect(result.success).toBe(true);
      expect(result.skipped).toBe(true);
      expect(result.reason).toBe('UNSUPPORTED_MIME_TYPE');
    });

    it('safely handles missing storage file without crashing', async () => {
      vi.spyOn(storageService, 'exists').mockResolvedValue(false);

      const job = {
        id: 'job_missing_file',
        name: FILE_JOB_NAMES.GENERATE_THUMBNAIL,
        data: {
          fileId: 'file_img_1',
          ownerId: 'user_1',
          mimeType: 'image/png',
          storageKey: 'objects/missing/key',
        },
      } as unknown as Job;

      const result = await processFileJob(job);
      expect(result.success).toBe(false);
      expect(result.skipped).toBe(true);
      expect(result.reason).toBe('FILE_NOT_FOUND');
    });

    it('processes supported image thumbnail scaffold when file exists', async () => {
      vi.spyOn(storageService, 'exists').mockResolvedValue(true);

      const job = {
        id: 'job_png_thumb',
        name: FILE_JOB_NAMES.GENERATE_THUMBNAIL,
        data: {
          fileId: 'file_img_2',
          ownerId: 'user_2',
          mimeType: 'image/jpeg',
          storageKey: 'objects/ok/key',
        },
      } as unknown as Job;

      const result = await processFileJob(job);
      expect(result.success).toBe(true);
      expect(result.scaffold).toBe(true);
      expect(result.fileId).toBe('file_img_2');
    });

    it('throws UnrecoverableError for invalid thumbnail job data', async () => {
      const badJob = {
        id: 'job_bad_thumb',
        name: FILE_JOB_NAMES.GENERATE_THUMBNAIL,
        data: { fileId: '' },
      } as unknown as Job;

      await expect(processFileJob(badJob)).rejects.toThrow(UnrecoverableError);
    });
  });

  describe('4. Notification Job Processor', () => {
    it('dispatches notification through the configured provider', async () => {
      const mockProvider: INotificationProvider = {
        send: vi.fn().mockResolvedValue(true),
      };
      setNotificationProvider(mockProvider);

      const job = {
        id: 'job_notif_send',
        name: NOTIFICATION_JOB_NAMES.SEND_NOTIFICATION,
        data: {
          userId: 'user_notify_1',
          type: 'UPLOAD_COMPLETED',
          title: 'File Uploaded',
          message: 'Your file is ready.',
        },
      } as unknown as Job;

      const result = await processNotificationJob(job);
      expect(result.delivered).toBe(true);
      expect(mockProvider.send).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'user_notify_1', title: 'File Uploaded' })
      );

      // Restore default log provider
      setNotificationProvider(new LogNotificationProvider());
    });

    it('throws retryable error if provider delivery fails', async () => {
      const mockFailingProvider: INotificationProvider = {
        send: vi.fn().mockResolvedValue(false),
      };
      setNotificationProvider(mockFailingProvider);

      const job = {
        id: 'job_notif_fail',
        name: NOTIFICATION_JOB_NAMES.SEND_NOTIFICATION,
        data: {
          userId: 'user_fail_1',
          type: 'SYSTEM_ALERT',
          title: 'Alert',
          message: 'System alert message',
        },
      } as unknown as Job;

      await expect(processNotificationJob(job)).rejects.toThrow('Notification provider failed to deliver');

      setNotificationProvider(new LogNotificationProvider());
    });

    it('throws UnrecoverableError for invalid notification data', async () => {
      const badJob = {
        id: 'job_bad_notif',
        name: NOTIFICATION_JOB_NAMES.SEND_NOTIFICATION,
        data: { userId: '', type: 'INVALID_TYPE' },
      } as unknown as Job;

      await expect(processNotificationJob(badJob)).rejects.toThrow(UnrecoverableError);
    });
  });

  describe('5. Worker & Queue Connection Lifecycle', () => {
    it('creates dedicated Redis connection for BullMQ with maxRetriesPerRequest=null', () => {
      const connection = createBullMQConnection();
      expect(connection).toBeDefined();
    });

    it('safely closes workers and queues during shutdown', async () => {
      const cleanupW = createCleanupWorker({ autorun: false });
      const fileW = createFileWorker({ autorun: false });
      const notifW = createNotificationWorker({ autorun: false });

      expect(cleanupW).toBeDefined();
      expect(fileW).toBeDefined();
      expect(notifW).toBeDefined();

      await expect(closeCleanupWorker()).resolves.toBeUndefined();
      await expect(closeFileWorker()).resolves.toBeUndefined();
      await expect(closeNotificationWorker()).resolves.toBeUndefined();
    });
  });
});

