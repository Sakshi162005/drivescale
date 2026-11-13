import { z } from 'zod';

export const updateStorageQuotaSchema = z.object({
  storageQuota: z
    .number({ required_error: 'storageQuota is required' })
    .int('storageQuota must be an integer')
    .min(1024 * 1024, 'Storage quota must be at least 1 MB (1,048,576 bytes)')
    .max(100 * 1024 * 1024 * 1024 * 1024, 'Storage quota cannot exceed 100 TB'),
});

export type UpdateStorageQuotaInput = z.infer<typeof updateStorageQuotaSchema>;
