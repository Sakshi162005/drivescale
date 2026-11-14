# DriveScale — Architecture Documentation

## 1. Architectural Philosophy

DriveScale is structured as a **modular monolith** with clear architectural boundaries between routing, controller orchestration, domain business services, repository models, and infrastructure adapters.

Key architectural tenets:
* **Separation of Concerns**: Controllers remain thin, validating inputs and orchestrating service calls. Domain and business logic live strictly within services.
* **Storage Independence**: The application does not couple domain logic to filesystem paths or MinIO SDK primitives. All object persistence operations route through a strict storage abstraction interface (`IStorageService`).
* **Metadata vs. Bytes**: MongoDB stores metadata, authorization, folder hierarchies, and version catalogs. Object bytes reside exclusively in self-hosted MinIO object storage (or local storage adapter during testing).
* **Zero Whole-File In-Memory Buffering**: All upload, assembly, and download operations stream bytes continuously using Node.js Streams and Transform streams to maintain predictable memory usage.
* **Resilience & Scalability**: Redis powers rate limiting, multi-tiered caching, and background job queues via BullMQ.

---

## 2. High-Level Component Architecture

```text
                                Internet
                                   |
                                   v
                                Nginx (Reverse Proxy)
                                /       \
                               /         \
                              v           v
                        React Client     Express API
                        (TypeScript)     (Node.js + TS)
                                               |
                     +-------------------------+-------------------------+
                     |                         |                         |
                     v                         v                         v
                  MongoDB                    Redis                     MinIO
              (Metadata & Auth)       (Cache, Rate Limits,       (Object Storage)
                                           BullMQ)                       ^
                                               |                         |
                                               v                         |
                                            BullMQ                       |
                                            Worker ----------------------+
                                      (Thumbnails, Cleanup)
```

---

## 3. Storage Subsystem & Abstraction

### Interface: `IStorageService`
All file storage interactions adhere to `IStorageService`:

```typescript
export interface IStorageService {
  upload(key: string, stream: Readable, size?: number, contentType?: string): Promise<{ size: number; checksum: string }>;
  download(key: string): Promise<Buffer>;
  createReadStream(key: string): Promise<Readable>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  getMetadata(key: string): Promise<StorageMetadata>;
  saveChunk(uploadId: string, chunkNumber: number, chunkStream: Readable): Promise<{ size: number; checksum: string }>;
  chunkExists(uploadId: string, chunkNumber: number): Promise<boolean>;
  deleteChunks(uploadId: string): Promise<void>;
  assembleChunks(uploadId: string, totalChunks: number, targetKey: string): Promise<{ size: number; checksum: string }>;
}
```

### Implementations
1. **`MinioStorageService`** (Default / Production):
   - Direct integration with MinIO S3 API via official `@minio` SDK.
   - Generates and enforces storage keys with two-level prefix sharding (`objects/xx/<hash>`).
   - Strict path traversal prevention: rejects keys with `..`, null bytes, or leading slashes.
   - Calculates on-the-fly SHA-256 and byte sizes during streaming uploads.
   - Uses an async generator stream (`Readable.from(streamChunks())`) to assemble staged chunks directly into MinIO with constant memory consumption.
2. **`LocalStorageService`** (Fallback / Test Driver):
   - Stores objects in `data/storage/` on the local filesystem.
   - Useful for lightweight development environments where Docker services are not running.

### Dynamic Storage Delegation
The exported `storageService` instance is a delegating proxy to the active underlying storage driver (`minio` or `local`), configured via `STORAGE_DRIVER` and switchable at runtime via `setStorageService(...)` for unit testing.

---

## 4. Cache & Rate Limiting (Redis)

- **Caching Layer**: Cache-aside pattern for folder listings, file details, trash queries, storage usage stats, and search queries with TTLs between 30 and 300 seconds. Granular invalidation triggers on mutation.
- **Distributed Rate Limiting**:
  - `auth`: 5 requests / minute / IP
  - `upload-init`: 20 requests / minute / user
  - `upload-chunk`: 120 requests / minute / user
  - `general`: 100 requests / minute / user / IP
- **Fallback**: Graceful fallback to local in-memory stores if Redis is temporarily unreachable.

---

## 5. Background Workers (BullMQ)

The worker process (`server/src/worker.ts`) operates independently from the main API process, processing jobs across dedicated queues:
- **`file-queue`**: Image thumbnail generation and metadata extraction.
- **`cleanup-queue`**: Purging expired upload sessions, orphaned chunks, and soft-deleted files past retention periods.
- **`notification-queue`**: Asynchronous notification dispatch for file shares.

---

## 6. Security & Authorization

- **Authentication**: Stateless JWT access tokens (15m expiry) paired with rotating refresh tokens stored in MongoDB with Argon2id password hashing.
- **Authorization (`PermissionService`)**: Centralized access evaluation checking ownership, direct file sharing, direct folder sharing, and inherited nested folder permissions (`VIEW`, `DOWNLOAD`, `EDIT`).
- **HTTP Protection**: Helmet HTTP security headers, CORS origin restrictions, and Zod schema validation across all request params, bodies, and queries.

