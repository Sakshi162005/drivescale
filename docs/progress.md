# DriveScale Progress

## Phase 0 — Repository Initialization
Status: COMPLETE

## Phase 1 — Authentication
Status: COMPLETE

## Phase 2 — Folder Management
Status: COMPLETE

## Phase 3 — Basic File Storage
Status: COMPLETE

### Overview & Architecture
- **Storage Abstraction**: Implemented `IStorageService` and `LocalStorageService` (`server/src/services/storage/`) providing stream-based upload and download pipelines with zero whole-file memory buffering.
- **Path Traversal Protection**: Storage keys validated against `..` markers and directory escaping. Keys are server-generated using randomized hashes with two-level directory sharding (`objects/xx/hash`).
- **Metadata Separation**: MongoDB `File` model stores metadata (name, ownerId, folderId, storageKey, size, mimeType, checksum, timestamps). File bytes are never stored in MongoDB.
- **Quota & Storage Usage Tracking**: User `storageUsed` is incremented on upload and decremented on file deletion. Uploads exceeding `storageQuota` are rejected.
- **Compensating Actions**: Failed database writes automatically purge stored filesystem bytes to prevent orphaned files.

### Endpoints
- `POST /api/v1/files` (or `/api/v1/files?folderId=<id>`): Multipart/form-data streaming upload via `busboy`.
- `GET /api/v1/files`: Paginated file listing scoped to authenticated user and optional folder (`root`, `all`, or folder ID).
- `GET /api/v1/files/:id`: File metadata retrieval.
- `GET /api/v1/files/:id/download`: Authenticated streaming file download with sanitized Content-Disposition headers.
- `PATCH /api/v1/files/:id`: Rename file with destination uniqueness check.
- `POST /api/v1/files/:id/move`: Move file between folders with destination ownership and name collision validation.
- `DELETE /api/v1/files/:id`: Soft delete file and decrement user storage usage.

### Frontend Integration
- File display in `Drive.tsx` with file type icons, size formatting, and modified dates.
- Direct multipart file upload button with folder context.
- Authenticated download action utilizing Bearer token.
- Modals for renaming, moving, and deleting files.

### Verification
- 19 automated tests in `server/tests/file.test.ts` covering streaming, security, quota, cross-user authorization, upload, download, move, rename, delete.
- Full test suite: 62 passed tests across 5 test files.
- TypeScript checks (`npm run typecheck`) passed with 0 errors.
- ESLint (`npm run lint`) passed with 0 errors.
- Production build (`npm run build`) succeeded for both client and server.

## Phase 4 — Chunked Uploads
Status: COMPLETE

### Overview & Architecture
- **UploadSession Model**: Persists upload state with `_id`, `userId`, `fileName`, `folderId`, `totalSize`, `chunkSize`, `totalChunks`, `uploadedChunks` (metadata with chunkNumber, size, checksum), `storageKey`, `status` (`PENDING`, `UPLOADING`, `ASSEMBLING`, `COMPLETED`, `FAILED`, `EXPIRED`, `CANCELLED`), and `expiresAt` (24h TTL).
- **Temporary Chunk Storage**: Isolated chunk files saved to `data/storage/chunks/<uploadId>/chunk_<chunkNumber>` with atomic renaming to avoid partial writes.
- **Chunk Stream Assembly**: Node.js stream pipeline assembles chunks in strict numerical order into the final storage key, calculating final SHA-256 and byte size on the fly without in-memory buffering.
- **Controlled Concurrency**: Frontend orchestrates uploads via a worker pool with a default limit of 3 concurrent chunks.
- **Duplicate & Conflict Handling**: Duplicate identical chunks are acknowledged idempotently (200 OK), while conflicting duplicate chunks are safely rejected with 409 Conflict.
- **Assembly Concurrency Guard**: Atomic acquisition of `ASSEMBLING` state prevents race conditions during file finalization.

### Endpoints
- `POST /api/v1/uploads/init`: Initialize a chunked upload session with filename, total size, folder target, and chunk configuration.
- `PUT /api/v1/uploads/:uploadId/chunks/:chunkNumber`: Upload individual chunks using either multipart streaming or raw binary stream.
- `POST /api/v1/uploads/:uploadId/complete`: Assemble all chunks into the final file, create metadata, update user storage quota, and purge temporary chunks.
- `GET /api/v1/uploads/:uploadId/status`: Check session progress and list of uploaded chunks.
- `DELETE /api/v1/uploads/:uploadId`: Cancel session and clean up temporary chunk files.

### Frontend Integration
- `client/src/services/upload.service.ts`: Implements `uploadFileChunked` with 3-worker concurrency pool, progress callbacks, and session assembly.
- `client/src/pages/Drive.tsx`: Updated with live chunked upload progress card showing chunk count, concurrency, byte progress, and percentage.

### Verification
- 18 automated tests in `server/tests/upload.test.ts` verifying session creation, chunk size validation, out-of-order ingestion, duplicate handling, missing chunks, assembly, and concurrency.
- Full workspace test suite: 80 passed tests across 6 test suites.
- TypeScript checks (`npm run typecheck`) passed with 0 errors.
- ESLint (`npm run lint`) passed with 0 errors.
- Production build (`npm run build`) succeeded for both client and server.

## Phase 5 — Resumable Uploads
Status: COMPLETE

### Overview & Architecture
- **Storage Physical Integrity Verification**: Added `chunkExists(uploadId, chunkNumber)` to `IStorageService` and implemented it in `LocalStorageService`. The upload status endpoint verifies physical chunk files on disk before reporting them as uploaded, automatically recovering from storage loss or orphan chunk states.
- **Dynamic Missing Chunk Calculation**: `GET /api/v1/uploads/:uploadId/status` computes sorted `missingChunks` as $\{ i \in [0, \text{totalChunks}-1] \mid i \notin \text{verifiedChunks} \}$.
- **Status API Enrichment**: `/status` returns `uploadId`, `fileName`, `totalSize`, `chunkSize`, `totalChunks`, `uploadedChunks`, `missingChunks`, `status`, `expiresAt`, `canAcceptChunks`, `isAssembling`, `isCompleted`, and `fileId`.
- **Atomic Race & Safety Guards**:
  - `cancelUpload` rejects cancellation of completed sessions (`400 SESSION_ALREADY_COMPLETED`) and assembling sessions (`409 SESSION_ASSEMBLING`).
  - Concurrent complete requests are guarded by atomic transition from `PENDING`/`UPLOADING` to `ASSEMBLING`.
  - Repeated `/complete` calls on completed uploads return the existing file idempotently.
- **Duplicate & Conflict Handling**: Retrying an identical chunk returns 200 OK (`isDuplicate: true`) without re-writing or corrupting state. Uploading a chunk with conflicting content returns 409 Conflict (`DUPLICATE_CHUNK_CONFLICT`) while preserving the valid stored chunk on disk.
- **Frontend Resume Manager**:
  - Persists non-sensitive upload metadata (`uploadId`, `fileName`, `totalSize`, `folderId`, `createdAt`) in browser `localStorage` (never storing file bytes or binary handles).
  - Implements `resumeUpload(uploadId, file, options)` which queries server status, uploads only missing chunks via a 3-worker concurrency pool, and applies exponential backoff retries (3 attempts).
  - Added an "Incomplete Upload Found" notification banner in `Drive.tsx` with a single-click "Resume Upload" action and a "Dismiss" action.

### Endpoints
- `GET /api/v1/uploads/:uploadId/status`: Returns enriched upload status, verified uploaded chunks, and sorted missing chunks.
- `PUT /api/v1/uploads/:uploadId/chunks/:chunkNumber`: Ingests chunk, acknowledges identical retries idempotently (200 OK), rejects conflicting checksums (409 Conflict), and rejects cancelled/expired sessions.
- `POST /api/v1/uploads/:uploadId/complete`: Assembles missing-free uploads; idempotently returns existing file if already complete; rejects racing cancellations.
- `DELETE /api/v1/uploads/:uploadId`: Safely cancels active sessions, deletes temporary chunks, and rejects cancelling completed/assembling uploads.

### Verification
- 15 automated unit and integration tests in `server/tests/resumable-upload.test.ts` verifying status calculation, out-of-order uploads, physical chunk validation, resume flow, retry idempotency, conflict detection, expiration, cancellation race guards, and cross-user authorization.
- 18 existing chunked upload tests in `server/tests/upload.test.ts` pass without regressions.
- Full workspace test suite: 95 passed tests across 7 test suites.
- TypeScript checks (`npm run typecheck`) passed with 0 errors.
- ESLint (`npm run lint`) passed with 0 errors.
- Production build (`npm run build`) succeeded for both client and server.

## Phase 6 — Redis
Status: COMPLETE

### Overview & Architecture
- **Centralized Shared Singleton**: Implemented `getRedisClient()`, `connectRedis()`, `disconnectRedis()`, `setRedisClient()`, `isRedisReady()`, and `getRedisStatus()` in `server/src/config/redis.ts`. Manages a single connection instance with `lazyConnect: true`, 5s connect timeout, 3s command timeout, bounded exponential backoff retry strategy (capped at 5 attempts to prevent connection storms), sanitized URL logging (masks credentials), and structured lifecycle events (`connect`, `ready`, `error`, `close`, `reconnecting`, `end`).
- **Dependency Injection**: Testable architecture with `setRedisClient` allowing injection of mock Redis clients (e.g. `ioredis-mock`) for deterministic testing.
- **Cache Service (`ICacheService` & `CacheService`)**:
  - Encapsulates `get`, `set` (explicit TTL), `del`, and `delByPattern` (non-blocking cursor-based `SCAN` in batches of 100).
  - Handles JSON serialization/deserialization safely; automatically purges corrupted or malformed keys on `JSON.parse` failures to prevent repeated crashes.
  - Strict user isolation via namespaced keys: `drivescale:user:<userId>:...`.
  - Zero file byte caching: Redis caches only read-heavy non-sensitive metadata (folder listings, file listings, storage statistics); never caches file bytes, chunks, passwords, or tokens.
- **Cache Invalidation on Mutations**:
  - Folder creation/rename/delete/move: invalidates `folderChildren` for parent and destination folders, `folderDetail`, and `folderAllPattern`.
  - File upload/rename/move/delete: invalidates `fileDetail`, `userAllFilesPattern`, and `userStorageStats`.
  - Upload session completion: invalidates `userAllFilesPattern` and `userStorageStats`.
- **Distributed Rate Limiting Middleware (`createRateLimiter`)**:
  - Atomic Redis execution via Lua script (`INCR` + conditional `PEXPIRE` / `PTTL`) ensuring distributed consistency across multiple API instances without read-then-write race conditions.
  - Returns `429 Too Many Requests` with standard headers: `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset`, and `Retry-After`.
  - Uses standard structured JSON error responses (`TOO_MANY_REQUESTS`).
  - Identity boundaries: Authenticated requests use `req.user._id`; unauthenticated requests use sanitized client IP (`req.ip`) with `trust proxy: 1` enabled for reverse proxy environments. Clients cannot supply spoofed headers to bypass limits.
  - Tailored limit presets:
    - `authRateLimiter`: 10 requests / 15 minutes per IP for `/api/v1/auth/login` and `/register`.
    - `uploadInitRateLimiter`: 20 sessions / minute per user for `/api/v1/uploads/init`.
    - `chunkUploadRateLimiter`: 200 chunks / minute per user for `/api/v1/uploads/:uploadId/chunks/:chunkNumber`.
    - `generalRateLimiter`: 100 requests / minute globally across `/api/v1` (excluding `/health`).
- **Redis Outage & Resilience Policy**:
  - **Cache Fail-Safe**: Cache reads return `null` during Redis outages, cleanly falling back to MongoDB without throwing errors or blocking API requests. Cache writes fail silently with structured warning logs.
  - **Rate Limiter Local Fallback**: When Redis is unreachable, the rate limiter falls back to an in-memory sliding window bucket per instance with warning logs, maintaining protection against endpoint abuse without crashing the application.

### Endpoints Integrated
- `GET /api/v1/users/me/storage`: Returns cached storage stats (`storageUsed`, `storageQuota`, `percentageUsed`, `availableBytes`).
- `GET /api/v1/users/me`: Returns cached user profile data.
- `GET /api/v1/folders/:id/children`: Cached with 60s TTL; invalidated on folder/file mutations.
- `GET /api/v1/folders/:id`: Virtual breadcrumb and folder metadata cached with 300s TTL.
- `GET /api/v1/files`: Paginated file listings cached with 60s TTL.
- `GET /api/v1/files/:id`: File metadata cached with 300s TTL.
- `POST /api/v1/auth/login` & `POST /api/v1/auth/register`: Rate limited by `authRateLimiter`.
- `POST /api/v1/uploads/init`: Rate limited by `uploadInitRateLimiter`.
- `PUT /api/v1/uploads/:uploadId/chunks/:chunkNumber`: Rate limited by `chunkUploadRateLimiter`.
- All `/api/v1/*` routes: Protected by global `generalRateLimiter`.

### Verification
- 19 automated unit and integration tests in `server/tests/redis-cache-ratelimit.test.ts` covering:
  - Redis client singleton lifecycle and connection states.
  - Cache hit, miss, explicit TTL, JSON serialization, and corrupted key recovery.
  - Cross-user namespace isolation and targeted pattern invalidation.
  - Mutation-triggered invalidations across folder creation, folder rename, and file deletion.
  - Distributed rate limiting headers, window limits, HTTP 429 rejection, Retry-After header, user isolation, and in-memory outage fallback.
  - User storage stats caching and retrieval.
- Full workspace test suite: 114 passed tests across 8 test suites with 0 failures and 0 regressions.
- TypeScript checks (`npm run typecheck`) passed with 0 errors across all workspaces.
- ESLint (`npm run lint`) passed with 0 errors and 0 warnings.
- Production build (`npm run build`) succeeded for both client and server.

## Phase 7 — Background Workers
Status: COMPLETE

### Overview & Architecture
- **BullMQ Integration with Shared Redis**: Centralized queue creation using `createBullMQConnection()` in `server/src/config/redis.ts` configured with `maxRetriesPerRequest: null`, bounded retry backoff, and connection tracking for graceful shutdown.
- **Modular Monolith Worker Process**:
  - Independent entry point `server/src/worker.ts` executed via `npm run worker` (or `npm run dev:server` for API only).
  - Connects to MongoDB and Redis independently, initializes workers, registers repeatable upload cleanup schedule, and handles `SIGINT`/`SIGTERM` with graceful queue/worker/connection drainage.
- **Queues & Job Producers (`server/src/queues/`)**:
  - `cleanup-queue` (`cleanup.queue.ts`): Producers for `cleanup-expired-upload` and `cleanup-trash` (scaffold).
  - `file-queue` (`file.queue.ts`): Producer for `generate-thumbnail`.
  - `notification-queue` (`notification.queue.ts`): Producer for `send-notification`.
  - Configurable default retry policies: 3 attempts with exponential backoff (2000ms delay), retention of 100 completed jobs and 500 failed jobs (7-day TTL).
- **Worker Processors (`server/src/workers/`)**:
  - `cleanup.worker.ts`:
    - `cleanup-expired-upload`: Identifies sessions with `status: { $in: ['PENDING', 'UPLOADING', 'FAILED'] }` and `expiresAt < now`. Employs immediate atomic status transition to `EXPIRED` before deleting chunks, guaranteeing that active, completed, or assembling uploads are never deleted. Idempotently ignores already-removed chunk files.
    - `cleanup-trash`: Typed payload validation scaffold for Phase 10 without premature deletion.
  - `file.worker.ts`:
    - `generate-thumbnail`: Validates payload (`fileId`, `storageKey`, `mimeType`), verifies supported image MIME type (`image/jpeg`, `png`, `webp`, `gif`), verifies storage file existence, and safely handles unsupported types or missing files.
  - `notification.worker.ts`:
    - `send-notification`: Validates payload, dispatches via `INotificationProvider` (`LogNotificationProvider` default in development), and retries on delivery failure.
- **API Integration**:
  - Non-blocking enqueuing of thumbnail generation on single file uploads (`FileService.uploadFile`) and chunked upload completion (`UploadService.completeUpload`).
  - Non-blocking enqueuing of upload completion notification in `UploadService.completeUpload`.
- **Docker Compose**:
  - Documented dedicated `worker` service in `docker-compose.yml` sharing network and Redis/MongoDB dependencies without running duplicate worker threads inside the API container.

### Verification
- 21 automated unit and integration tests in `server/tests/worker.test.ts` covering:
  - Queue initialization and default retry/retention options.
  - Job payload schema validation and rejection of invalid data.
  - Expired upload session cleanup, preservation of active/completed/assembling sessions, and idempotent handling of missing files.
  - Trash cleanup scaffold verification without file deletions.
  - Thumbnail job MIME type filtering, storage checks, and error handling.
  - Notification job provider dispatch and retryable delivery failure.
  - Worker lifecycle and clean shutdown.
- Full workspace test suite: 135 passed tests across 9 test suites with 0 failures and 0 regressions.
- TypeScript checks (`npm run typecheck`) passed with 0 errors across all workspaces.
- ESLint (`npm run lint`) passed with 0 errors and 0 warnings.
- Production build (`npm run build`) succeeded for both client and server.

## Phase 8 — Sharing and Permissions
Status: COMPLETE

### Overview & Architecture
- **Share Model (`server/src/models/Share.ts`)**:
  - Fully typed Mongoose model supporting both file and folder sharing with fields: `ownerId` (ref User), `recipientId` (ref User), virtual alias `userId` (for recipientId compatibility), `resourceType` (`FILE` | `FOLDER`), `resourceId` (ObjectId), `permission` (`VIEW` | `DOWNLOAD` | `EDIT`), optional `expiresAt` (Date TTL), and timestamps.
  - Compound indexes for high-performance querying and integrity enforcement:
    - Unique compound index `{ resourceType: 1, resourceId: 1, recipientId: 1 }` preventing duplicate active shares for the same recipient on the same resource.
    - Index `{ recipientId: 1, resourceType: 1, createdAt: -1 }` for fast retrieval of resources shared with a user.
    - Index `{ ownerId: 1, resourceType: 1, resourceId: 1 }` for fast retrieval of shares created by an owner.
- **Centralized Permission Service (`server/src/services/permission.service.ts`)**:
  - Implements a unified authorization engine enforcing permissions across both file and folder operations:
    - `getFilePermission(userId, file)` & `getFolderPermission(userId, folder)`
    - Permission levels: `OWNER`, `EDIT`, `DOWNLOAD`, `VIEW`, `null` (no access).
    - Permission hierarchy: `EDIT > DOWNLOAD > VIEW`.
    - Helper methods: `canView`, `canRead`, `canDownload`, `canEdit`, `canDelete`, `canShare`.
  - **Folder Inheritance**: When a folder is shared with a recipient, all nested files and subfolders automatically inherit the folder's permissions down the hierarchy.
  - **Most-Permissive Resolution**: If a file or subfolder has both a direct share and an inherited ancestor folder share, the most permissive permission wins (`EDIT > DOWNLOAD > VIEW`).
  - **Cycle-Safe Traversal**: `getAncestorFolderIds` uses visited-set tracking to detect and safely terminate upon encountering folder hierarchy cycles.
  - **Cross-Owner Boundaries**: Folder inheritance strictly enforces matching resource ownership, preventing unauthorized privilege escalation across user boundaries.
- **Enforcement on Core APIs**:
  - `FileService`:
    - `getFile`: Allowed for `VIEW`, `DOWNLOAD`, `EDIT`, `OWNER`.
    - `getFileForDownload`: Blocked for `VIEW` (403 Forbidden); permitted for `DOWNLOAD`, `EDIT`, `OWNER`.
    - `renameFile`: Blocked for `VIEW` and `DOWNLOAD` (403 Forbidden); permitted for `EDIT` and `OWNER`.
    - `moveFile` & `deleteFile`: Permitted only for resource `OWNER`.
  - `FolderService`:
    - `getFolder` & `getFolderChildren`: Allowed for `VIEW`, `DOWNLOAD`, `EDIT`, `OWNER`.
    - `renameFolder`: Blocked for `VIEW` and `DOWNLOAD` (403 Forbidden); permitted for `EDIT` and `OWNER`.
    - `deleteFolder` & `moveFolder`: Permitted only for resource `OWNER`.
  - `UploadService`:
    - `initUpload`: Verifies destination folder permission with `canEditFolder(userId, folder)`.
- **Redis Cache Integration & Invalidation**:
  - User shares list cached with pattern `drivescale:user:<userId>:shares:*`.
  - Share mutations (create, update permission, revoke) trigger immediate cache invalidations for recipient's shares, folders, and files caches.

### Endpoints
- `POST /api/v1/shares/files/:fileId`: Share a file with another user by email or user ID (`VIEW`, `DOWNLOAD`, `EDIT`).
- `GET /api/v1/shares/files/:fileId`: List all active shares on a file (owner only).
- `PATCH /api/v1/shares/files/:fileId/:shareId`: Update permission on a file share (owner only).
- `DELETE /api/v1/shares/files/:fileId/:shareId`: Revoke a file share immediately (owner only).
- `POST /api/v1/shares/folders/:folderId`: Share a folder with another user by email or user ID (`VIEW`, `DOWNLOAD`, `EDIT`).
- `GET /api/v1/shares/folders/:folderId`: List all active shares on a folder (owner only).
- `PATCH /api/v1/shares/folders/:folderId/:shareId`: Update permission on a folder share (owner only).
- `DELETE /api/v1/shares/folders/:folderId/:shareId`: Revoke a folder share immediately (owner only).
- `POST /api/v1/shares`: General share endpoint accepting `{ resourceType, resourceId, recipientEmail, permission, expiresAt }`.
- `PATCH /api/v1/shares/:id`: General share permission update.
- `DELETE /api/v1/shares/:id`: General share revocation.
- `GET /api/v1/shares/with-me`: Returns paginated list of all files and folders shared with the authenticated user, populated with owner info, direct/effective permissions, and metadata.
- `GET /api/v1/shares/with-me/folders/:folderId`: Returns child folders and files inside a shared folder respecting inherited permissions.

### Frontend Integration
- `client/src/types/share.types.ts`: TypeScript definitions for share models, inputs, responses, and effective permissions.
- `client/src/services/share.service.ts`: API client functions for sharing, listing, updating, revoking, and navigating shared resources.
- `client/src/components/sharing/ShareModal.tsx`:
  - Recipient email input and permission selector (`VIEW`, `DOWNLOAD`, `EDIT`).
  - Active shares listing showing recipients, avatar badges, current permissions, and inline revocation button.
  - Inline permission modification dropdown.
  - Explanatory callout of the permission hierarchy.
- `client/src/pages/Shared.tsx`:
  - Dedicated `/shared` page route with quick navigation between "My Drive" and "Shared with me".
  - Sectioned display of shared folders and shared files with owner badges, permission pills, and file type icons.
  - Subfolder hierarchy navigation (`/shared/:folderId`) with breadcrumb trails and effective permission banners.
  - Permission-aware action controls: Download button hidden/disabled for `VIEW` users; Rename enabled for `EDIT` users.
- `client/src/pages/Drive.tsx`:
  - Added "Share" option to folder and file dropdown menus in both Grid and List views.
  - Added "Shared with me" header navigation button.
  - Modal integration triggering `<ShareModal>`.
- `client/src/App.tsx`:
  - Registered `/shared` and `/shared/:folderId` routes.
  - Updated Architecture Phase Roadmap to display Phase 8 as Implemented.

### Verification
- 28 automated tests in `server/tests/share.test.ts` covering:
  - Centralized permission evaluation, hierarchy validation (`EDIT > DOWNLOAD > VIEW`), and expiration handling.
  - Recursive folder inheritance, ancestor cycle safety, and most-permissive conflict resolution.
  - Self-share prevention (400), non-owner sharing rejection (403), and share upsert behavior.
  - File and folder sharing CRUD endpoints, cache invalidation, and response formats.
  - Permission enforcement on file metadata vs download (blocking `VIEW` with 403) and rename (blocking `VIEW`/`DOWNLOAD` with 403, allowing `EDIT`).
  - Permission enforcement on folder details vs rename.
- Full project test suite: 163 passed tests across 10 test suites with 0 failures and 0 regressions.
- TypeScript checks (`npm run typecheck`) passed with 0 errors across all workspaces.
- ESLint checks (`npm run lint`) passed with 0 errors and 0 warnings across all workspaces.
- Production build (`npm run build`) succeeded for both client and server.

## Phase 9 — File Versioning
Status: NOT STARTED

## Phase 10 — Trash and Recovery
Status: NOT STARTED

## Phase 11 — Search and Storage Quotas
Status: NOT STARTED

## Phase 12 — MinIO
Status: NOT STARTED

## Phase 13 — Production Hardening
Status: NOT STARTED

## Phase 14 — Testing
Status: NOT STARTED

## Phase 15 — Documentation
Status: NOT STARTED
