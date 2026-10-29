export interface UploadedChunkInfo {
  chunkNumber: number;
  size: number;
  checksum: string;
  uploadedAt: string;
}

export interface UploadSession {
  _id: string;
  userId: string;
  fileName: string;
  folderId: string | null;
  mimeType: string;
  totalSize: number;
  chunkSize: number;
  totalChunks: number;
  uploadedChunks: UploadedChunkInfo[];
  storageKey: string;
  status: 'PENDING' | 'UPLOADING' | 'ASSEMBLING' | 'COMPLETED' | 'FAILED' | 'EXPIRED' | 'CANCELLED';
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface InitUploadParams {
  fileName: string;
  totalSize: number;
  chunkSize?: number;
  folderId?: string | null;
  mimeType?: string;
}

export interface ChunkProgressCallback {
  (progress: {
    uploadedChunks: number;
    totalChunks: number;
    percent: number;
    uploadedBytes: number;
    totalBytes: number;
    activeConcurrency: number;
  }): void;
}

export interface UploadStatusResponse {
  uploadId: string;
  fileName: string;
  totalSize: number;
  chunkSize: number;
  totalChunks: number;
  uploadedChunks: number[];
  missingChunks: number[];
  status: 'PENDING' | 'UPLOADING' | 'ASSEMBLING' | 'COMPLETED' | 'FAILED' | 'EXPIRED' | 'CANCELLED';
  expiresAt: string;
  canAcceptChunks: boolean;
  isAssembling: boolean;
  isCompleted: boolean;
  fileId?: string;
  session?: UploadSession;
}

export interface ActiveUploadMetadata {
  uploadId: string;
  fileName: string;
  totalSize: number;
  chunkSize: number;
  totalChunks: number;
  folderId: string | null;
  mimeType: string;
  createdAt: string;
}

export interface ResumeUploadOptions {
  concurrency?: number;
  maxRetries?: number;
  onProgress?: ChunkProgressCallback;
  signal?: AbortSignal;
}

