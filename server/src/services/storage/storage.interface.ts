export interface StorageMetadata {
  size: number;
  lastModified?: Date;
  contentType?: string;
  checksum?: string;
}

export interface StorageUploadResult {
  size: number;
  checksum: string;
}

export interface IStorageService {
  /**
   * Uploads a stream to storage at the given key and returns size & SHA-256 checksum
   */
  upload(key: string, stream: NodeJS.ReadableStream): Promise<StorageUploadResult>;

  /**
   * Creates a readable stream for reading file bytes
   */
  createReadStream(key: string): Promise<NodeJS.ReadableStream>;

  /**
   * Downloads the file content as a Buffer
   */
  download(key: string): Promise<Buffer>;

  /**
   * Deletes the stored object
   */
  delete(key: string): Promise<void>;

  /**
   * Checks if an object exists at the given key
   */
  exists(key: string): Promise<boolean>;

  /**
   * Retrieves metadata of the stored object
   */
  getMetadata(key: string): Promise<StorageMetadata>;

  /**
   * Saves a chunk stream for an upload session.
   * If expectedChecksum is specified and doesn't match, throws ConflictError without replacing stored chunk.
   */
  saveChunk(
    uploadId: string,
    chunkNumber: number,
    stream: NodeJS.ReadableStream,
    expectedChecksum?: string
  ): Promise<StorageUploadResult>;

  /**
   * Checks if a specific chunk file physically exists in storage and is readable
   */
  chunkExists(uploadId: string, chunkNumber: number): Promise<boolean>;

  /**
   * Deletes all temporary chunks for an upload session
   */
  deleteChunks(uploadId: string): Promise<void>;

  /**
   * Assembles all chunks in numerical order into targetKey using streams
   */
  assembleChunks(uploadId: string, totalChunks: number, targetKey: string): Promise<StorageUploadResult>;
}
