import { apiFetch } from './api.js';
import { ApiResponse } from '../types/auth.types.js';
import { FileItem } from '../types/file.types.js';
import {
  UploadSession,
  InitUploadParams,
  ChunkProgressCallback,
} from '../types/upload.types.js';

export const uploadService = {
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
  ): Promise<ApiResponse<{ chunkNumber: number; size: number; checksum: string }>> {
    const formData = new FormData();
    formData.append('chunk', chunkBlob, `chunk_${chunkNumber}.bin`);

    return apiFetch<{ chunkNumber: number; size: number; checksum: string }>(
      `/api/v1/uploads/${uploadId}/chunks/${chunkNumber}`,
      {
        method: 'PUT',
        body: formData,
      }
    );
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
  async getUploadStatus(uploadId: string): Promise<ApiResponse<{ session: UploadSession }>> {
    return apiFetch<{ session: UploadSession }>(`/api/v1/uploads/${uploadId}/status`);
  },

  /**
   * Cancels an upload session and cleans up server resources
   */
  async cancelUpload(uploadId: string): Promise<ApiResponse<{ message: string }>> {
    return apiFetch<{ message: string }>(`/api/v1/uploads/${uploadId}`, {
      method: 'DELETE',
    });
  },

  /**
   * Orchestrates a full chunked upload with controlled concurrency (default: 3 concurrent chunks)
   */
  async uploadFileChunked(
    file: File,
    folderId: string | null = null,
    options: {
      concurrency?: number;
      chunkSize?: number;
      onProgress?: ChunkProgressCallback;
      signal?: AbortSignal;
    } = {}
  ): Promise<FileItem> {
    const concurrency = options.concurrency ?? 3;

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
          const chunkRes = await this.uploadChunk(session._id, chunkIndex, chunkBlob);
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
      // Best-effort cleanup on server
      try {
        await this.cancelUpload(session._id);
      } catch {
        // Ignore
      }
      throw err;
    }

    // 4. Complete upload
    const completeRes = await this.completeUpload(session._id);
    if (!completeRes.success || !completeRes.data?.file) {
      throw new Error(completeRes.error?.message || 'Failed to assemble and complete file upload');
    }

    return completeRes.data.file;
  },
};

