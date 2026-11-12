import { z } from 'zod';

const objectIdRegex = /^[0-9a-fA-F]{24}$/;

export const trashIdParamSchema = z.object({
  id: z
    .string({ required_error: 'Item ID is required' })
    .regex(objectIdRegex, 'Invalid item ID format'),
});

export const listTrashQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  type: z.enum(['all', 'file', 'folder']).default('all'),
  sortBy: z.enum(['name', 'deletedAt', 'size']).default('deletedAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

export const restoreTrashItemSchema = z.object({
  targetFolderId: z.string().regex(objectIdRegex).nullable().optional(),
  targetParentId: z.string().regex(objectIdRegex).nullable().optional(),
});

export type TrashIdParam = z.infer<typeof trashIdParamSchema>;
export type ListTrashQuery = z.infer<typeof listTrashQuerySchema>;
export type RestoreTrashItemInput = z.infer<typeof restoreTrashItemSchema>;

