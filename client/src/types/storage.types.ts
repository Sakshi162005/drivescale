export interface StorageUsageStats {
  storageUsed: number;
  storageReserved: number;
  storageQuota: number;
  storageRemaining: number;
  percentageUsed: number;
}

export interface UpdateStorageQuotaInput {
  storageQuota: number;
}
