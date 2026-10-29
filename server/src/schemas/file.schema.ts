import { z } from 'zod';

const fileNameRegex = /^[^/\\<>:"|?*]+$/;

export const renameFileSchema = z.object({
  name: z
    .string({ required_error: 'File name is required' })
    .trim()
    .min(1, 'File name cannot be empty')
    .max(255, 'File name cannot exceed 255 characters')
    .regex(fileNameRegex, 'File name cannot contain path separators or illegal characters (/ \\ < > : " | ? *)'),
});

export const moveFileSchema = z.object({
  targetFolderId: z.string().nullable(),
});

export const listFilesQuerySchema = z.object({
  folderId: z.string().nullable().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  sortBy: z.enum(['name', 'size', 'createdAt', 'updatedAt']).default('name'),
  sortOrder: z.enum(['asc', 'desc']).default('asc'),
});

export type RenameFileInput = z.infer<typeof renameFileSchema>;
export type MoveFileInput = z.infer<typeof moveFileSchema>;
export type ListFilesQueryInput = z.infer<typeof listFilesQuerySchema>;
