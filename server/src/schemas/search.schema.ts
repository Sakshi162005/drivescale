import { z } from 'zod';

const objectIdRegex = /^[0-9a-fA-F]{24}$/;

export const searchQuerySchema = z.object({
  q: z.string().default('').transform((val) => val.trim()),
  type: z.enum(['all', 'file', 'folder']).default('all'),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  folderId: z
    .string()
    .refine((val) => val === 'root' || objectIdRegex.test(val), {
      message: 'Invalid folder ID format',
    })
    .optional(),
  mimeType: z.string().max(100).optional(),
  sortBy: z.enum(['name', 'size', 'createdAt', 'updatedAt']).default('updatedAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

export type SearchQueryInput = z.infer<typeof searchQuerySchema>;
