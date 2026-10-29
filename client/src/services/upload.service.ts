import { apiFetch } from './api.js';
import { ApiResponse } from '../types/auth.types.js';
import { FileItem } from '../types/file.types.js';
import {
  UploadSession,
  InitUploadParams,
  ChunkProgressCallback,
  UploadStatusResponse,
  ActiveUploadMetadata,
  ResumeUploadOptions,
} from '../types/upload.types.js';

const ACTIVE_UPLOADS_STORAGE_KEY = 'drivescale_active_uploads';

export const uploadService = {
  /**
   * Retrieves all active unfinished upload sessions stored in localStorage
   */
  getActiveUploads(): ActiveUploadMetadata[] {
    try {
      const data = localStorage.getItem(ACTIVE_UPLOADS_STORAGE_KEY);
      if (!data) return [];
      const parsed = JSON.parse(data);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  },

  /**
   * Retrieves metadata for a specific active upload
   */
  getActiveUpload(uploadId: string): ActiveUploadMetadata | null {
    const list = this.getActiveUploads();
    return list.find((item) => item.uploadId === uploadId) || null;
  },

  /**
   * Saves or updates an active upload session's metadata in localStorage
   */
  saveActiveUpload(metadata: ActiveUploadMetadata): void {
    try {
      const list = this.getActiveUploads().filter((item) => item.uploadId !== metadata.uploadId);
      list.push(metadata);
      localStorage.setItem(ACTIVE_UPLOADS_STORAGE_KEY, JSON.stringify(list));
    } catch {
      // Ignore localStorage errors (e.g. quota in private browsing)
    }
  },

  /**
   * Removes an active upload session from localStorage
   */
  removeActiveUpload(uploadId: string): void {
    try {
      const list = this.getActiveUploads().filter((item) => item.uploadId !== uploadId);
      localStorage.setItem(ACTIVE_UPLOADS_STORAGE_KEY, JSON.stringify(list));
    } catch {
      // Ignore
    }
  },

  /**
   * Initializes a chunked upload session
   */
  async initUpload(params: InitUploadParams): Promise<ApiResponse<{ session: UploadSession }>> {
    return apiFetch<{ session: UploadSession }>('/api/v1/uploads/init', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  },

  /**
   * Uploads an individual chunk using multipart/form-data
   */
  async uploadChunk(
    uploadId: string,
    chunkNumber: number,
    chunkBlob: Blob
  ): Promise<ApiResponse<{ chunkNumber: number; size: number; checksum: string; isDuplicate?: boolean }>> {
    const formData = new FormData();
    formData.append('chunk', chunkBlob, `chunk_${chunkNumber}.bin`);

    return apiFetch<{ chunkNumber: number; size: number; checksum: string; isDuplicate?: boolean }>(
      `/api/v1/uploads/${uploadId}/chunks/${chunkNumber}`,
      {
        method: 'PUT',
        body: formData,
      }
    );
  },

  /**
   * Helper to upload chunk with bounded exponential backoff retries
   */
  async uploadChunkWithRetry(
    uploadId: string,
    chunkNumber: number,
    chunkBlob: Blob,
    maxRetries = 3
  ): Promise<ApiResponse<{ chunkNumber: number; size: number; checksum: string; isDuplicate?: boolean }>> {
    let lastError: Error | null = null;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const res = await this.uploadChunk(uploadId, chunkNumber, chunkBlob);
        if (res.success) {
          return res;
        }
        // If conflict or fatal client error, do not retry
        if (
          res.error?.code === 'DUPLICATE_CHUNK_CONFLICT' ||
          res.error?.code === 'INVALID_CHUNK_SIZE' ||
          res.error?.code === 'INVALID_CHUNK_NUMBER' ||
          res.error?.code === 'SESSION_EXPIRED' ||
          res.error?.code === 'SESSION_ALREADY_COMPLETED' ||
          res.error?.code === 'FORBIDDEN'
        ) {
          return res;
        }
        lastError = new Error(res.error?.message || `Failed to upload chunk ${chunkNumber}`);
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(`Failed to upload chunk ${chunkNumber}`);
      }

      if (attempt < maxRetries) {
        const delay = 500 * Math.pow(2, attempt - 1);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
    throw lastError || new Error(`Failed to upload chunk ${chunkNumber} after ${maxRetries} attempts`);
  },

  /**
   * Completes an upload session, triggering chunk assembly
   */
  async completeUpload(uploadId: string): Promise<ApiResponse<{ file: FileItem }>> {
    return apiFetch<{ file: FileItem }>(`/api/v1/uploads/${uploadId}/complete`, {
      method: 'POST',
    });
  },

  /**
   * Gets session upload progress and chunk status
   */
  async getUploadStatus(uploadId: string): Promise<ApiResponse<UploadStatusResponse>> {
    return apiFetch<UploadStatusResponse>(`/api/v1/uploads/${uploadId}/status`);
  },

  /**
   * Cancels an upload session and cleans up server resources
   */
  async cancelUpload(uploadId: string): Promise<ApiResponse<{ message: string }>> {
    this.removeActiveUpload(uploadId);
    return apiFetch<{ message: string }>(`/api/v1/uploads/${uploadId}`, {
      method: 'DELETE',
    });
  },

  /**
   * Resumes an interrupted upload session, querying server status and uploading only missing chunks
   */
  async resumeUpload(
    uploadId: string,
    file: File,
    options: ResumeUploadOptions = {}
  ): Promise<FileItem> {
    const concurrency = options.concurrency ?? 3;
    const maxRetries = options.maxRetries ?? 3;

    // 1. Fetch current status of upload session
    const statusRes = await this.getUploadStatus(uploadId);
    if (!statusRes.success || !statusRes.data) {
      this.removeActiveUpload(uploadId);
      throw new Error(statusRes.error?.message || 'Failed to retrieve upload session status');
    }

    const status = statusRes.data;

    // 2. Validate file matches the session
    if (file.name !== status.fileName || file.size !== status.totalSize) {
      throw new Error(
        `Selected file (${file.name}, ${file.size} bytes) does not match upload session (${status.fileName}, ${status.totalSize} bytes)`
      );
    }

    // 3. Handle session states
    if (status.isCompleted) {
      this.removeActiveUpload(uploadId);
      if (status.fileId) {
        return {
          _id: status.fileId,
          name: status.fileName,
          size: status.totalSize,
          mimeType: file.type || 'application/octet-stream',
          storageKey: '',
          ownerId: '',
          folderId: null,
          checksum: '',
          isDeleted: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        } as FileItem;
      }
      throw new Error('Upload session has already been completed');
    }

    if (status.status === 'EXPIRED' || status.status === 'CANCELLED' || status.status === 'FAILED') {
      this.removeActiveUpload(uploadId);
      throw new Error(`Cannot resume upload: session is in ${status.status} state`);
    }

    const missingChunks = status.missingChunks || [];
    const totalChunks = status.totalChunks;
    const chunkSize = status.chunkSize;

    // 4. If no chunks are missing, complete upload directly
    if (missingChunks.length === 0) {
      const completeRes = await this.completeUpload(uploadId);
      if (!completeRes.success || !completeRes.data?.file) {
        throw new Error(completeRes.error?.message || 'Failed to complete assembly');
      }
      this.removeActiveUpload(uploadId);
      return completeRes.data.file;
    }

    // 5. Setup progress tracking starting from already uploaded chunks
    let completedChunks = totalChunks - missingChunks.length;
    let uploadedBytes = completedChunks * chunkSize;
    let activeWorkers = 0;

    const reportProgress = () => {
      if (options.onProgress) {
        const percent = totalChunks === 0 ? 100 : Math.round((completedChunks / totalChunks) * 100);
        options.onProgress({
          uploadedChunks: completedChunks,
          totalChunks,
          percent,
          uploadedBytes: Math.min(uploadedBytes, file.size),
          totalBytes: file.size,
          activeConcurrency: activeWorkers,
        });
      }
    };

    reportProgress();

    // 6. Queue only the missing chunks
    const queue = [...missingChunks];

    const worker = async () => {
      while (queue.length > 0) {
        if (options.signal?.aborted) {
          throw new Error('Resume aborted');
        }

        const chunkIndex = queue.shift()!;
        activeWorkers++;
        reportProgress();

        const start = chunkIndex * chunkSize;
        const end = Math.min(start + chunkSize, file.size);
        const chunkBlob = file.slice(start, end);

        try {
          const chunkRes = await this.uploadChunkWithRetry(
            uploadId,
            chunkIndex,
            chunkBlob,
            maxRetries
          );
          if (!chunkRes.success) {
            throw new Error(chunkRes.error?.message || `Failed to upload chunk ${chunkIndex}`);
          }
          completedChunks++;
          uploadedBytes += chunkBlob.size;
        } finally {
          activeWorkers--;
          reportProgress();
        }
      }
    };

    const workerPool = Array.from(
      { length: Math.min(concurrency, queue.length) },
      () => worker()
    );

    await Promise.all(workerPool);

    // 7. Complete upload assembly
    const completeRes = await this.completeUpload(uploadId);
    if (!completeRes.success || !completeRes.data?.file) {
      throw new Error(completeRes.error?.message || 'Failed to assemble and complete file upload');
    }

    this.removeActiveUpload(uploadId);
    return completeRes.data.file;
  },

  /**
   * Orchestrates a full chunked upload with controlled concurrency (default: 3 concurrent workers)
   */
  async uploadFileChunked(
    file: File,
    folderId: string | null = null,
    options: {
      concurrency?: number;
      chunkSize?: number;
      maxRetries?: number;
      onProgress?: ChunkProgressCallback;
      signal?: AbortSignal;
    } = {}
  ): Promise<FileItem> {
    const concurrency = options.concurrency ?? 3;
    const maxRetries = options.maxRetries ?? 3;

    // 1. Initialize upload session
    const initRes = await this.initUpload({
      fileName: file.name,
      totalSize: file.size,
      folderId: folderId && folderId !== 'root' ? folderId : null,
      chunkSize: options.chunkSize,
      mimeType: file.type || 'application/octet-stream',
    });

    if (!initRes.success || !initRes.data?.session) {
      throw new Error(initRes.error?.message || 'Failed to initialize chunked upload');
    }

    const session = initRes.data.session;
    const totalChunks = session.totalChunks;
    const chunkSize = session.chunkSize;

    // Save active upload to localStorage for resume persistence
    this.saveActiveUpload({
      uploadId: session._id,
      fileName: file.name,
      totalSize: file.size,
      chunkSize,
      totalChunks,
      folderId: folderId && folderId !== 'root' ? folderId : null,
      mimeType: file.type || 'application/octet-stream',
      createdAt: new Date().toISOString(),
    });

    // 2. Queue chunk indices for controlled concurrency execution
    const queue: number[] = Array.from({ length: totalChunks }, (_, i) => i);
    let completedChunks = 0;
    let uploadedBytes = 0;
    let activeWorkers = 0;

    const reportProgress = () => {
      if (options.onProgress) {
        const percent = totalChunks === 0 ? 100 : Math.round((completedChunks / totalChunks) * 100);
        options.onProgress({
          uploadedChunks: completedChunks,
          totalChunks,
          percent,
          uploadedBytes: Math.min(uploadedBytes, file.size),
          totalBytes: file.size,
          activeConcurrency: activeWorkers,
        });
      }
    };

    reportProgress();

    // 3. Worker routine
    const worker = async () => {
      while (queue.length > 0) {
        if (options.signal?.aborted) {
          throw new Error('Upload cancelled');
        }

        const chunkIndex = queue.shift()!;
        activeWorkers++;
        reportProgress();

        const start = chunkIndex * chunkSize;
        const end = Math.min(start + chunkSize, file.size);
        const chunkBlob = file.slice(start, end);

        try {
          const chunkRes = await this.uploadChunkWithRetry(
            session._id,
            chunkIndex,
            chunkBlob,
            maxRetries
          );
          if (!chunkRes.success) {
            throw new Error(chunkRes.error?.message || `Failed to upload chunk ${chunkIndex}`);
          }
          completedChunks++;
          uploadedBytes += chunkBlob.size;
        } finally {
          activeWorkers--;
          reportProgress();
        }
      }
    };

    // Run up to `concurrency` concurrent workers
    const workerPool = Array.from(
      { length: Math.min(concurrency, totalChunks) },
      () => worker()
    );

    try {
      await Promise.all(workerPool);
    } catch (err) {
      if (options.signal?.aborted) {
        // User aborted explicitly: clean up server and localStorage
        try {
          await this.cancelUpload(session._id);
        } catch {
          // Ignore
        }
      }
      throw err;
    }

    // 4. Complete upload
    const completeRes = await this.completeUpload(session._id);
    if (!completeRes.success || !completeRes.data?.file) {
      throw new Error(completeRes.error?.message || 'Failed to assemble and complete file upload');
    }

    // Remove from active uploads
    this.removeActiveUpload(session._id);

    return completeRes.data.file;
  },
};
