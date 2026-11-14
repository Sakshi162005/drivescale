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
- **Structured Logging Redaction**: Pino structured JSON logger with automated redaction of sensitive credentials (`authorization`, `password`, `refreshToken`, `JWT_ACCESS_SECRET`, `MINIO_SECRET_KEY`).
- **Request Tracing**: Automated `X-Request-Id` header generation and context propagation across all HTTP requests.

---

## 7. Production Containerization & Ingress

### A. Nginx Reverse Proxy (`docker/nginx/nginx.conf`)
- Acts as the single public gateway on port 80.
- Routes `/api/v1/` to backend Express container (`server:5000`) and `/` to frontend SPA container (`client:80`).
- **Zero-Buffering Streaming**:
  - `proxy_request_buffering off;`: Ensures large multi-part and chunked uploads stream directly into the Node.js application process without Nginx spooling entire gigabyte files to disk.
  - `proxy_buffering off;`: Enables real-time streaming downloads directly to the client browser without intermediate proxy buffering.
- **Resilience**: `proxy_connect_timeout 60s`, `proxy_read_timeout 300s`, and `client_max_body_size 500M`.
- **Security Headers**: Enforces `X-Content-Type-Options nosniff`, `X-Frame-Options SAMEORIGIN`, `Referrer-Policy strict-origin-when-cross-origin`, and `Permissions-Policy`.

### B. Multi-Stage Dockerfiles
- **Client (`docker/client/Dockerfile`)**: Multi-stage build with `node:20-alpine` compiling React via Vite, served via `nginx:1.27-alpine` with gzip compression and SPA route fallback.
- **Server (`docker/server/Dockerfile`)**: Multi-stage build with native build tools, compiled TypeScript, unprivileged non-root execution (`USER node`), and container liveness probe.
- **Worker (`docker/worker/Dockerfile`)**: Multi-stage build running `dist/worker.js` with non-root security and heartbeat health check.

---

## 8. Health Check Architecture & Probes

| Probe / Endpoint | Target | Purpose | Success Condition |
|---|---|---|---|
| `GET /nginx-health` | Nginx Proxy | Ingress health | 200 OK |
| `GET /api/v1/health/live` | Express API | Process liveness | 200 OK (`{ status: 'alive' }`) |
| `GET /api/v1/health/ready` | Express API | Service readiness | 200 OK (Database connected) / 503 (Unavailable) |
| `GET /api/v1/health` | Express API | Full component report | 200 OK with `database`, `redis`, `storage` statuses |
| `node dist/worker-health.js` | Worker Container | Worker process health | Fresh heartbeat file (`< 30s` old) |
| `mongosh db.adminCommand('ping')` | MongoDB Container | Database availability | MongoDB responds to ping |
| `redis-cli ping` | Redis Container | Redis availability | Redis responds with PONG |
| `curl /minio/health/live` | MinIO Container | Object storage availability | MinIO returns 200 |

---

## 9. Graceful Shutdown Protocol

Both the API server (`server.ts`) and background worker (`worker.ts`) handle `SIGTERM` and `SIGINT`:
1. **Draining**: The HTTP server halts acceptance of incoming requests and closes idle keep-alive connections while allowing active in-flight requests to complete.
2. **Worker & Queue Pause**: BullMQ workers stop accepting new jobs and active worker jobs are allowed to complete.
3. **Queue Disconnection**: Producer queues (`file-queue`, `cleanup-queue`, `notification-queue`) are cleanly closed.
4. **Infrastructure Teardown**: Redis and MongoDB connections are gracefully disconnected.
5. **Bounded Timeout**: A 10-second unref'd timer (`setTimeout(..., 10000).unref()`) prevents hanging processes from holding container stops indefinitely.


