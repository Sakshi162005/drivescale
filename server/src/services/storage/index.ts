import { IStorageService } from './storage.interface.js';
import { LocalStorageService } from './local-storage.service.js';

export * from './storage.interface.js';
export * from './local-storage.service.js';

// Default storage service instance using local filesystem in Phase 3
export const storageService: IStorageService = new LocalStorageService();
