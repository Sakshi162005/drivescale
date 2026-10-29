import { z } from 'zod';

const fileNameRegex = /^[^/\\<>:"|?*]+$/;

export const DEFAULT_CHUNK_SIZE = 5 * 1024 * 1024; // 5 MB default chunk size
export const MIN_CHUNK_SIZE = 256 * 1024; // 256 KB minimum chunk size
export const MAX_CHUNK_SIZE = 50 * 1024 * 1024; // 50 MB maximum chunk size

export const initUploadSchema = z.object({
  fileName: z
    .string({ required_error: 'File name is required' })
    .trim()
    .min(1, 'File name cannot be empty')
    .max(255, 'File name cannot exceed 255 characters')
    .regex(fileNameRegex, 'File name cannot contain illegal characters (/ \\ < > : " | ? *)'),
  totalSize: z
    .number({ required_error: 'Total size is required' })
    .min(0, 'Total size cannot be negative'),
  chunkSize: z
    .number()
    .min(MIN_CHUNK_SIZE, `Chunk size must be at least ${MIN_CHUNK_SIZE} bytes`)
    .max(MAX_CHUNK_SIZE, `Chunk size cannot exceed ${MAX_CHUNK_SIZE} bytes`)
    .default(DEFAULT_CHUNK_SIZE),
  folderId: z.string().nullable().optional(),
  mimeType: z.string().optional().default('application/octet-stream'),
});

export type InitUploadInput = z.infer<typeof initUploadSchema>;

