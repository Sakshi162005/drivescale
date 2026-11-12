import { z } from 'zod';

export const sharePermissionSchema = z.enum(['VIEW', 'DOWNLOAD', 'EDIT']);

export const createShareSchema = z
  .object({
    recipientEmail: z.string().email('Invalid recipient email address').optional(),
    recipientId: z.string().optional(),
    permission: sharePermissionSchema.default('VIEW'),
    expiresAt: z.string().datetime().nullable().optional(),
  })
  .refine(
    (data) => Boolean(data.recipientEmail || data.recipientId),
    {
      message: 'Either recipientEmail or recipientId must be provided',
      path: ['recipientEmail'],
    }
  );

export type CreateShareInput = z.infer<typeof createShareSchema>;

export const updateShareSchema = z.object({
  permission: sharePermissionSchema,
});

export type UpdateShareInput = z.infer<typeof updateShareSchema>;

export const listSharedWithMeQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  resourceType: z.enum(['FILE', 'FOLDER']).optional(),
});

export type ListSharedWithMeQueryInput = z.infer<typeof listSharedWithMeQuerySchema>;

