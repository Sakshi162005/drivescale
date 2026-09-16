import { z } from 'zod';

const folderNameRegex = /^[^/\\<>:"|?*]+$/;

export const createFolderSchema = z.object({
  name: z
    .string({ required_error: 'Folder name is required' })
    .trim()
    .min(1, 'Folder name cannot be empty')
    .max(255, 'Folder name cannot exceed 255 characters')
    .regex(folderNameRegex, 'Folder name cannot contain path separators or illegal characters (/ \\ < > : " | ? *)'),
  parentId: z.string().nullable().optional(),
});

export const renameFolderSchema = z.object({
  name: z
    .string({ required_error: 'New folder name is required' })
    .trim()
    .min(1, 'Folder name cannot be empty')
    .max(255, 'Folder name cannot exceed 255 characters')
    .regex(folderNameRegex, 'Folder name cannot contain path separators or illegal characters (/ \\ < > : " | ? *)'),
});

export const moveFolderSchema = z.object({
  targetParentId: z.string().nullable(),
});

export type CreateFolderInput = z.infer<typeof createFolderSchema>;
export type RenameFolderInput = z.infer<typeof renameFolderSchema>;
export type MoveFolderInput = z.infer<typeof moveFolderSchema>;
