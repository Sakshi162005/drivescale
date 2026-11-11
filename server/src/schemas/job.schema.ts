import { z } from 'zod';

export const cleanupExpiredUploadPayloadSchema = z.object({
  batchSize: z.number().int().positive().default(50),
  triggeredAt: z.string().datetime().optional(),
});
export type CleanupExpiredUploadPayload = z.infer<typeof cleanupExpiredUploadPayloadSchema>;

export const cleanupTrashPayloadSchema = z.object({
  olderThanDays: z.number().int().min(1).default(30),
  batchSize: z.number().int().positive().default(100),
});
export type CleanupTrashPayload = z.infer<typeof cleanupTrashPayloadSchema>;

export const generateThumbnailPayloadSchema = z.object({
  fileId: z.string().min(1, 'File ID is required'),
  ownerId: z.string().min(1, 'Owner ID is required'),
  mimeType: z.string().min(1, 'MIME type is required'),
  storageKey: z.string().min(1, 'Storage key is required'),
});
export type GenerateThumbnailPayload = z.infer<typeof generateThumbnailPayloadSchema>;

export const sendNotificationPayloadSchema = z.object({
  userId: z.string().min(1, 'User ID is required'),
  type: z.enum(['UPLOAD_COMPLETED', 'FILE_SHARED', 'SYSTEM_ALERT']),
  title: z.string().min(1, 'Title is required').max(200),
  message: z.string().min(1, 'Message is required').max(1000),
  metadata: z.record(z.unknown()).optional(),
});
export type SendNotificationPayload = z.infer<typeof sendNotificationPayloadSchema>;

