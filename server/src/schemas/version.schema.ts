import { z } from 'zod';

export const fileIdParamSchema = z.object({
  fileId: z.string().optional(),
  id: z.string().optional(),
});

export const versionIdParamSchema = z.object({
  fileId: z.string().optional(),
  id: z.string().optional(),
  versionId: z.string().min(1, 'Version ID is required'),
});

export const listVersionsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export type ListVersionsQueryInput = z.infer<typeof listVersionsQuerySchema>;

