# DriveScale — AGENTS.md

## 1. Project Overview

DriveScale is a self-hosted cloud file storage platform inspired by Google Drive and Dropbox.

The goal is to build a production-quality portfolio project that demonstrates:

* Full-stack development
* REST API design
* Authentication and authorization
* Hierarchical file/folder management
* Large-file uploads
* Chunked uploads
* Resumable uploads
* Streaming
* Object storage
* File sharing
* Access permissions
* File versioning
* Trash/recovery
* Redis caching
* Distributed rate limiting
* Background job processing
* Docker containerization
* Testing
* Production-oriented architecture

The application must NOT depend on AWS.

Object storage will use MinIO locally/self-hosted.

---

# 2. Core Technology Stack

## Frontend

* React
* TypeScript
* Vite
* React Router
* TanStack Query
* Zustand
* Tailwind CSS
* Axios
* React Hook Form
* Zod
* Lucide React

## Backend

* Node.js
* Express.js
* TypeScript
* MongoDB
* Mongoose
* Redis
* BullMQ
* JWT
* Argon2
* Zod
* Pino
* Node.js Streams

## Infrastructure

* Docker
* Docker Compose
* MongoDB
* Redis
* MinIO
* Nginx

## Testing

* Vitest
* Supertest
* React Testing Library

No AWS services are required.

Do not introduce Firebase, Supabase, Clerk, Auth0, or another managed backend unless explicitly requested.

---

# 3. Architecture Philosophy

Use a modular monolith architecture initially.

Do NOT split the application into microservices.

The backend should have clear boundaries between:

* Routes
* Controllers
* Services
* Models
* Middleware
* Infrastructure
* Background workers

Business logic belongs in services, not controllers.

Controllers should remain thin.

Storage access must be abstracted behind a storage service.

The application must not directly depend on filesystem implementation details.

---

# 4. High-Level Architecture

```text
                         DriveScale
                             |
              +--------------+--------------+
              |                             |
              v                             v
       React Frontend                Express API
       TypeScript                   Node + TypeScript
              |                             |
              |                       +-----+------+
              |                       |            |
              |                       v            v
              |                    MongoDB       Redis
              |                    Metadata      Cache
              |                                  Rate Limit
              |                                  BullMQ
              |                                    |
              |                                    v
              |                                  Worker
              |
              |
              v
          MinIO Object Storage
```

Production-style architecture:

```text
                         Internet
                            |
                            v
                          Nginx
                       /          \
                      /            \
                     v              v
                  Client           API
                                    |
                    +---------------+---------------+
                    |               |               |
                    v               v               v
                 MongoDB          Redis           MinIO
                                    |
                                    v
                                  BullMQ
                                    |
                                    v
                                  Worker
```

---

# 5. Repository Structure

The repository must eventually have this structure:

```text
drivescale/
│
├── AGENTS.md
├── README.md
├── LICENSE
├── .gitignore
├── .env.example
├── docker-compose.yml
├── package.json
│
├── client/
│   ├── public/
│   │
│   ├── src/
│   │   ├── assets/
│   │   │
│   │   ├── components/
│   │   │   ├── ui/
│   │   │   ├── layout/
│   │   │   ├── file/
│   │   │   ├── folder/
│   │   │   ├── upload/
│   │   │   ├── sharing/
│   │   │   └── version/
│   │   │
│   │   ├── pages/
│   │   │   ├── Login.tsx
│   │   │   ├── Register.tsx
│   │   │   ├── Drive.tsx
│   │   │   ├── Shared.tsx
│   │   │   ├── Recent.tsx
│   │   │   ├── Starred.tsx
│   │   │   ├── Trash.tsx
│   │   │   ├── Settings.tsx
│   │   │   └── NotFound.tsx
│   │   │
│   │   ├── hooks/
│   │   │
│   │   ├── services/
│   │   │   ├── api.ts
│   │   │   ├── auth.service.ts
│   │   │   ├── file.service.ts
│   │   │   ├── folder.service.ts
│   │   │   ├── upload.service.ts
│   │   │   └── share.service.ts
│   │   │
│   │   ├── stores/
│   │   │   ├── auth.store.ts
│   │   │   ├── upload.store.ts
│   │   │   └── ui.store.ts
│   │   │
│   │   ├── types/
│   │   │
│   │   ├── utils/
│   │   │
│   │   ├── routes/
│   │   │
│   │   ├── App.tsx
│   │   └── main.tsx
│   │
│   ├── package.json
│   ├── tsconfig.json
│   └── vite.config.ts
│
├── server/
│   ├── src/
│   │   │
│   │   ├── config/
│   │   │   ├── env.ts
│   │   │   ├── database.ts
│   │   │   ├── redis.ts
│   │   │   └── storage.ts
│   │   │
│   │   ├── controllers/
│   │   │   ├── auth.controller.ts
│   │   │   ├── user.controller.ts
│   │   │   ├── file.controller.ts
│   │   │   ├── folder.controller.ts
│   │   │   ├── upload.controller.ts
│   │   │   ├── share.controller.ts
│   │   │   └── version.controller.ts
│   │   │
│   │   ├── middleware/
│   │   │   ├── auth.middleware.ts
│   │   │   ├── error.middleware.ts
│   │   │   ├── rate-limit.middleware.ts
│   │   │   ├── validation.middleware.ts
│   │   │   └── not-found.middleware.ts
│   │   │
│   │   ├── models/
│   │   │   ├── User.ts
│   │   │   ├── Folder.ts
│   │   │   ├── File.ts
│   │   │   ├── FileVersion.ts
│   │   │   ├── Share.ts
│   │   │   ├── UploadSession.ts
│   │   │   └── RefreshToken.ts
│   │   │
│   │   ├── routes/
│   │   │   ├── auth.routes.ts
│   │   │   ├── user.routes.ts
│   │   │   ├── file.routes.ts
│   │   │   ├── folder.routes.ts
│   │   │   ├── upload.routes.ts
│   │   │   ├── share.routes.ts
│   │   │   └── version.routes.ts
│   │   │
│   │   ├── services/
│   │   │   ├── auth.service.ts
│   │   │   ├── user.service.ts
│   │   │   ├── file.service.ts
│   │   │   ├── folder.service.ts
│   │   │   ├── upload.service.ts
│   │   │   ├── share.service.ts
│   │   │   ├── version.service.ts
│   │   │   ├── permission.service.ts
│   │   │   └── storage.service.ts
│   │   │
│   │   ├── repositories/
│   │   │   ├── user.repository.ts
│   │   │   ├── file.repository.ts
│   │   │   ├── folder.repository.ts
│   │   │   └── share.repository.ts
│   │   │
│   │   ├── schemas/
│   │   │   ├── auth.schema.ts
│   │   │   ├── file.schema.ts
│   │   │   ├── folder.schema.ts
│   │   │   ├── upload.schema.ts
│   │   │   └── share.schema.ts
│   │   │
│   │   ├── queues/
│   │   │   ├── file.queue.ts
│   │   │   ├── cleanup.queue.ts
│   │   │   └── notification.queue.ts
│   │   │
│   │   ├── workers/
│   │   │   ├── file.worker.ts
│   │   │   ├── cleanup.worker.ts
│   │   │   └── notification.worker.ts
│   │   │
│   │   ├── utils/
│   │   │   ├── hash.ts
│   │   │   ├── jwt.ts
│   │   │   ├── logger.ts
│   │   │   ├── pagination.ts
│   │   │   ├── errors.ts
│   │   │   └── response.ts
│   │   │
│   │   ├── types/
│   │   │
│   │   ├── app.ts
│   │   └── server.ts
│   │
│   ├── tests/
│   │   ├── unit/
│   │   └── integration/
│   │
│   ├── package.json
│   └── tsconfig.json
│
├── docker/
│   ├── client/
│   │   └── Dockerfile
│   ├── server/
│   │   └── Dockerfile
│   ├── worker/
│   │   └── Dockerfile
│   └── nginx/
│       └── nginx.conf
│
└── docs/
    ├── architecture.md
    ├── api.md
    ├── database.md
    └── upload-system.md
```

Do not create every file immediately.

Directories and files should be introduced when their phase requires them.

---

# 6. Database Models

## User

```text
User
├── _id
├── name
├── email
├── passwordHash
├── avatar
├── storageQuota
├── storageUsed
├── role
├── isVerified
├── isActive
├── createdAt
└── updatedAt
```

Email must be unique.

Passwords must never be stored in plaintext.

---

## Folder

```text
Folder
├── _id
├── name
├── ownerId
├── parentId
├── isDeleted
├── deletedAt
├── createdAt
└── updatedAt
```

`parentId = null` represents the root folder.

---

## File

```text
File
├── _id
├── name
├── ownerId
├── folderId
├── storageKey
├── size
├── mimeType
├── checksum
├── currentVersionId
├── isDeleted
├── deletedAt
├── createdAt
└── updatedAt
```

Actual file bytes must NOT be stored in MongoDB.

---

## FileVersion

```text
FileVersion
├── _id
├── fileId
├── versionNumber
├── storageKey
├── size
├── checksum
├── uploadedBy
└── createdAt
```

---

## Share

```text
Share
├── _id
├── resourceType
├── resourceId
├── ownerId
├── userId
├── permission
├── expiresAt
└── createdAt
```

Permissions initially:

```text
VIEW
DOWNLOAD
EDIT
```

---

## UploadSession

```text
UploadSession
├── _id
├── userId
├── fileName
├── folderId
├── totalSize
├── chunkSize
├── totalChunks
├── uploadedChunks
├── storageKey
├── status
├── expiresAt
├── createdAt
└── updatedAt
```

Statuses:

```text
PENDING
UPLOADING
COMPLETED
FAILED
EXPIRED
CANCELLED
```

---

# 7. API Structure

All APIs must be versioned:

```text
/api/v1
```

## Authentication

```text
POST /api/v1/auth/register
POST /api/v1/auth/login
POST /api/v1/auth/logout
POST /api/v1/auth/refresh
GET  /api/v1/auth/me
```

## Users

```text
GET /api/v1/users/me
PATCH /api/v1/users/me
```

## Folders

```text
POST   /api/v1/folders
GET    /api/v1/folders/:id
GET    /api/v1/folders/:id/children
PATCH  /api/v1/folders/:id
DELETE /api/v1/folders/:id
POST   /api/v1/folders/:id/move
```

## Files

```text
GET    /api/v1/files
GET    /api/v1/files/:id
PATCH  /api/v1/files/:id
DELETE /api/v1/files/:id
POST   /api/v1/files/:id/move
GET    /api/v1/files/:id/download
```

## Uploads

```text
POST   /api/v1/uploads/init
PUT    /api/v1/uploads/:uploadId/chunks/:chunkNumber
GET    /api/v1/uploads/:uploadId/status
POST   /api/v1/uploads/:uploadId/complete
DELETE /api/v1/uploads/:uploadId
```

## Sharing

```text
POST   /api/v1/shares
GET    /api/v1/shares
PATCH  /api/v1/shares/:id
DELETE /api/v1/shares/:id
```

## Versions

```text
GET  /api/v1/files/:id/versions
GET  /api/v1/files/:id/versions/:versionId
POST /api/v1/files/:id/versions/:versionId/restore
```

## Trash

```text
GET    /api/v1/trash
POST   /api/v1/files/:id/restore
DELETE /api/v1/files/:id/permanent
```

## Search

```text
GET /api/v1/search?q=<query>
```

---

# 8. Upload Architecture

Large files must never be loaded completely into server memory.

Use Node.js streams.

Basic flow:

```text
Browser
   |
   | File
   v
Split into chunks
   |
   +---- Chunk 1
   +---- Chunk 2
   +---- Chunk 3
   +---- ...
   |
   v
Express
   |
   v
UploadSession
   |
   v
Temporary chunk storage
   |
   v
Finalize
   |
   v
MinIO
   |
   v
MongoDB metadata
```

---

# 9. Chunked Upload Requirements

The upload system must support:

* Configurable chunk size
* Chunk numbering
* Upload sessions
* Multiple chunks
* Missing chunks
* Duplicate chunks
* Out-of-order chunks
* Retry
* Resume
* Cancellation
* Expiration
* Checksum verification
* Completion validation
* Concurrent chunk uploads

Do not allow unlimited concurrent chunk uploads.

The frontend should use controlled concurrency such as 3–5 simultaneous chunks.

---

# 10. Resumable Upload Flow

Example:

```text
200 chunks

0-100 uploaded
101-200 missing
```

Client disconnects.

After reconnect:

```text
GET /uploads/:uploadId/status
```

Server returns missing chunks.

Frontend uploads only missing chunks.

Never restart the entire upload unnecessarily.

---

# 11. Storage Abstraction

Implement a storage interface.

Conceptually:

```text
StorageService
├── upload
├── download
├── delete
├── exists
├── getMetadata
└── createReadStream
```

The rest of the application must interact with storage through this abstraction.

Storage implementations may include:

```text
LocalStorage
MinioStorage
```

The production/local deployment should use MinIO.

Do not couple business logic directly to MinIO SDK calls.

---

# 12. MinIO

MinIO will be used as self-hosted object storage.

Architecture:

```text
MongoDB
    |
    | metadata
    v

MinIO
    |
    | actual bytes
    v

Objects
```

Use generated storage keys.

Do not use raw user-provided filenames as storage paths.

Example:

```text
objects/
    a8/
       a8c93f...
```

---

# 13. Redis Responsibilities

Redis must have real responsibilities.

Use Redis for:

## Caching

Cache appropriate read-heavy resources such as:

* Folder listings
* Storage statistics
* Frequently accessed metadata

## Rate limiting

Examples:

```text
Login:
5 requests/minute/IP

Upload initialization:
20 requests/minute/user

General API:
100 requests/minute/user
```

These are initial values and may be adjusted during implementation.

## Background jobs

BullMQ will use Redis.

Do not use Redis as the primary persistent database.

---

# 14. Background Jobs

Use BullMQ.

Initial jobs:

```text
cleanup-expired-upload
cleanup-trash
generate-thumbnail
send-notification
```

Workers must run separately from the API server.

Architecture:

```text
API
 |
 v
BullMQ
 |
 v
Redis
 |
 v
Worker
 |
 v
Job execution
```

Jobs must be idempotent where practical.

---

# 15. Authentication Rules

Use:

* Argon2id for password hashing
* Short-lived access tokens
* Refresh tokens
* Refresh-token rotation
* Protected API routes
* Secure cookie strategy where appropriate
* Authentication middleware

Never:

* Store plaintext passwords
* Put passwords in logs
* Return password hashes
* Commit secrets
* Hardcode JWT secrets

---

# 16. Authorization

Authentication answers:

```text
Who are you?
```

Authorization answers:

```text
Are you allowed to perform this action?
```

Every protected file/folder operation must verify authorization.

Implement a dedicated permission service.

Conceptual methods:

```text
canRead()
canDownload()
canEdit()
canDelete()
canShare()
```

Never trust `ownerId`, `userId`, or permission information supplied directly by the client.

---

# 17. Security Requirements

Implement:

* Helmet
* CORS configuration
* Request validation
* Rate limiting
* Authentication middleware
* Authorization checks
* Secure password hashing
* Safe file naming
* Path traversal prevention
* File size limits
* MIME/type validation
* Error sanitization
* No secrets in source code

Never expose arbitrary filesystem paths.

Bad:

```text
/download?path=/home/user/file.pdf
```

Good:

```text
/files/:fileId/download
```

The server resolves the file ID to a storage key.

---

# 18. Git Repository Rules

The repository uses:

```text
main
```

as the stable branch.

Never directly develop large features on `main`.

Use feature branches.

Examples:

```text
feature/project-foundation
feature/authentication
feature/folders
feature/basic-file-storage
feature/chunked-upload
feature/resumable-upload
feature/redis
feature/background-jobs
feature/sharing
feature/versioning
feature/trash
feature/search
feature/minio
feature/testing
feature/production-docker
```

---

# 19. Git Workflow

For each phase:

```bash
git checkout main
git pull

git checkout -b feature/<phase-name>
```

Implement the phase.

Run:

```bash
npm run lint
npm run typecheck
npm test
```

if those scripts exist for the current phase.

Then:

```bash
git status
git add .
git commit -m "feat(scope): description"
git push -u origin feature/<phase-name>
```

Merge into `main`.

After merging:

```bash
git checkout main
git pull
```

Delete the feature branch when appropriate.

---

# 20. Commit Convention

Use Conventional Commits.

Allowed prefixes:

```text
feat
fix
refactor
test
docs
chore
perf
security
```

Examples:

```text
feat(auth): implement JWT authentication
feat(folders): add hierarchical folder management
feat(files): implement basic file storage
feat(upload): add chunked uploads
feat(upload): add resumable uploads
feat(redis): add caching and rate limiting
feat(worker): add background job processing
feat(sharing): implement file sharing
feat(versioning): add file version history
feat(trash): implement recovery
feat(storage): integrate MinIO
test(upload): add resumable upload tests
fix(upload): reject duplicate chunks safely
perf(files): optimize folder listing query
security(auth): harden refresh token handling
docs: document upload architecture
```

Avoid meaningless commits such as:

```text
update
changes
stuff
final
final-final
```

---

# 21. Phase Development Rules

Do NOT implement multiple major phases simultaneously.

Each phase must:

1. Have a clear goal.
2. Have a defined scope.
3. Be implemented completely.
4. Have tests appropriate to the phase.
5. Pass linting.
6. Pass TypeScript checks.
7. Pass relevant tests.
8. Update documentation where necessary.
9. Be committed.
10. Be pushed.
11. Stop before starting the next phase.

Do not automatically continue to the next phase.

---

# 22. Development Phases

## Phase 0 — Repository Initialization

Goal:

Create the Git repository and project skeleton.

Tasks:

* Initialize Git
* Create GitHub repository
* Create monorepo structure
* Add README
* Add AGENTS.md
* Add .gitignore
* Add .env.example
* Add root package.json
* Configure client
* Configure server
* Add initial Docker Compose
* Add MongoDB
* Add Redis
* Add health endpoint

Acceptance:

```text
React starts successfully.
Express starts successfully.
MongoDB connects.
Redis connects.
GET /api/v1/health returns success.
```

Commit:

```text
chore: initialize DriveScale repository
```

---

# Phase 1 — Authentication

Goal:

Implement complete user authentication.

Tasks:

* User model
* Registration
* Login
* Logout
* Access tokens
* Refresh tokens
* Password hashing
* Auth middleware
* `/me`
* Protected routes
* Frontend login
* Frontend registration
* Auth state

Acceptance:

```text
User can register.
User can login.
User can refresh session.
User can logout.
Protected endpoints reject unauthenticated requests.
```

Commit:

```text
feat(auth): implement JWT authentication
```

---

# Phase 2 — Folder Management

Goal:

Build hierarchical folder management.

Tasks:

* Folder model
* Root folder
* Create folder
* Rename folder
* Delete folder
* Move folder
* Nested folders
* Folder listing
* Breadcrumb navigation
* Frontend folder UI

Acceptance:

```text
Users can create nested folders.
Users can navigate folders.
Users cannot access another user's folders.
```

Commit:

```text
feat(folders): implement hierarchical folder management
```

---

# Phase 3 — Basic File Storage

Goal:

Implement basic file upload/download.

Initial storage:

```text
Local filesystem
```

Tasks:

* File model
* Upload endpoint
* Streaming upload
* Download endpoint
* Rename
* Delete
* Move
* File listing
* File metadata
* Storage usage

Do not store file bytes in MongoDB.

Acceptance:

```text
User can upload files.
User can download files.
User can rename files.
User can delete files.
User can move files between folders.
Large files do not require loading the entire file into memory.
```

Commit:

```text
feat(files): implement basic file storage
```

---

# Phase 4 — Chunked Uploads

Goal:

Split large files into chunks.

Tasks:

* UploadSession model
* Upload initialization
* Chunk endpoint
* Chunk numbering
* Temporary chunk storage
* Completion endpoint
* Chunk validation
* Controlled concurrency
* Frontend upload manager

Acceptance:

```text
Large file can be uploaded in chunks.
Chunks can arrive independently.
Duplicate chunks are handled safely.
Upload completion verifies all chunks exist.
```

Commit:

```text
feat(upload): implement chunked file uploads
```

---

# Phase 5 — Resumable Uploads

Goal:

Allow interrupted uploads to continue.

Tasks:

* Upload status endpoint
* Missing chunk detection
* Retry
* Resume
* Cancellation
* Expiration
* Upload progress persistence
* Frontend resume support

Test:

```text
Start upload.
Interrupt connection.
Reconnect.
Resume.
Complete.
```

Acceptance:

```text
Interrupted upload does not restart from zero.
Only missing chunks are uploaded.
Expired sessions are rejected.
```

Commit:

```text
feat(upload): add resumable upload support
```

---

# Phase 6 — Redis

Goal:

Introduce Redis for performance and protection.

Tasks:

* Redis client
* Cache layer
* Cache invalidation
* Rate limiting
* Redis configuration
* Cache folder listings
* Cache storage statistics

Acceptance:

```text
Repeated reads can use cache.
Cache invalidates after mutations.
Rate limits work across multiple API instances.
```

Commit:

```text
feat(redis): add caching and distributed rate limiting
```

---

# Phase 7 — Background Workers

Goal:

Move non-critical work out of API requests.

Tasks:

* BullMQ
* Queue configuration
* Worker process
* Cleanup expired uploads
* Trash cleanup
* Thumbnail job infrastructure
* Notification job infrastructure

Acceptance:

```text
API can enqueue jobs.
Worker processes jobs independently.
Failed jobs can retry.
Workers can run separately from API.
```

Commit:

```text
feat(worker): add background job processing
```

---

# Phase 8 — Sharing and Permissions

Goal:

Allow users to share files/folders.

Tasks:

* Share model
* Share file
* Share folder
* Revoke access
* Permission levels
* Permission service
* Shared page
* Authorization enforcement

Permissions:

```text
VIEW
DOWNLOAD
EDIT
```

Acceptance:

```text
Owner can share.
Recipient can access according to permission.
Unauthorized operations return 403.
Owner can revoke access.
```

Commit:

```text
feat(sharing): implement file sharing and permissions
```

---

# Phase 9 — File Versioning

Goal:

Maintain previous versions.

Tasks:

* FileVersion model
* Version creation
* Version listing
* Version download
* Restore version
* Current version tracking

Acceptance:

```text
Uploading a replacement creates a new version.
Old versions remain available.
A previous version can be restored.
```

Commit:

```text
feat(versioning): implement file version history
```

---

# Phase 10 — Trash and Recovery

Goal:

Implement soft deletion.

Tasks:

* Soft delete
* Trash listing
* Restore
* Permanent deletion
* Automatic cleanup worker

Acceptance:

```text
Deleted files appear in trash.
Files can be restored.
Permanent deletion removes object storage data.
Old trash can be cleaned automatically.
```

Commit:

```text
feat(trash): implement file recovery and permanent deletion
```

---

# Phase 11 — Search and Storage Quotas

Goal:

Improve usability.

Tasks:

* File search
* Folder search
* Search indexes
* Storage quota
* Storage usage
* Upload quota validation
* Dashboard storage indicator

Acceptance:

```text
Users can search files.
Uploads exceeding quota are rejected.
Storage usage remains accurate.
```

Commit:

```text
feat(storage): add search and storage quotas
```

---

# Phase 12 — MinIO Object Storage

Goal:

Replace local filesystem storage with self-hosted object storage.

Tasks:

* Add MinIO to Docker Compose
* Create bucket configuration
* Implement MinIO storage adapter
* Move file operations to storage abstraction
* Update upload system
* Update download system
* Update deletion
* Configure persistent MinIO volume

Architecture:

```text
Application
     |
     v
StorageService
     |
     v
MinioStorage
     |
     v
MinIO
```

Acceptance:

```text
Application stores files in MinIO.
Application does not depend directly on filesystem paths.
Files survive container restarts through persistent volumes.
```

Commit:

```text
feat(storage): integrate MinIO object storage
```

---

# Phase 13 — Production Hardening

Goal:

Make the application production-oriented.

Tasks:

* Dockerfiles
* Production Docker Compose
* Nginx
* Health checks
* Graceful shutdown
* Structured logging
* Error handling
* Environment validation
* Resource limits where appropriate
* Persistent volumes
* Security headers
* CORS configuration

Acceptance:

```text
Entire application can be started through Docker Compose.
Services communicate correctly.
Data persists after container restart.
Health checks work.
```

Commit:

```text
chore(docker): finalize production container setup
```

---

# Phase 14 — Testing

Goal:

Establish meaningful automated tests.

Unit tests:

```text
auth service
permission service
upload service
storage service
```

Integration tests:

```text
register
login
folder creation
file upload
download
sharing
versioning
trash
```

Upload edge cases:

```text
missing chunk
duplicate chunk
out-of-order chunk
interrupted upload
expired upload
checksum mismatch
unauthorized upload
```

Acceptance:

```text
npm test
```

passes.

Commit:

```text
test: add unit and integration test coverage
```

---

# Phase 15 — Documentation and Portfolio Preparation

Goal:

Make the repository understandable to another developer.

README must contain:

* Project overview
* Features
* Architecture diagram
* Tech stack
* Local setup
* Environment variables
* Docker setup
* API overview
* Upload architecture
* Database architecture
* Screenshots
* Testing instructions
* Future improvements

Create:

```text
docs/
├── architecture.md
├── api.md
├── database.md
└── upload-system.md
```

Commit:

```text
docs: finalize DriveScale documentation
```

---

# 23. Environment Variables

Never commit `.env`.

Commit only:

```text
.env.example
```

Example structure:

```text
NODE_ENV=development

PORT=5000

MONGODB_URI=mongodb://localhost:27017/drivescale

REDIS_URL=redis://localhost:6379

JWT_ACCESS_SECRET=
JWT_REFRESH_SECRET=

ACCESS_TOKEN_EXPIRES_IN=
REFRESH_TOKEN_EXPIRES_IN=

MINIO_ENDPOINT=localhost
MINIO_PORT=9000
MINIO_ACCESS_KEY=
MINIO_SECRET_KEY=
MINIO_BUCKET=drivescale

CLIENT_URL=http://localhost:5173
```

Secrets must remain local.

---

# 24. Docker Development Environment

Development infrastructure should eventually include:

```text
services:
  client
  server
  worker
  mongodb
  redis
  minio
  nginx
```

Persistent volumes must be used for:

```text
MongoDB
MinIO
Redis where appropriate
```

Do not depend on container filesystem state for persistent user files.

---

# 25. Coding Standards

Use TypeScript strict mode.

Avoid:

```text
any
```

unless absolutely necessary.

Prefer:

```text
unknown
```

with proper narrowing.

Use async/await.

Use centralized error handling.

Use typed API responses.

Use meaningful variable names.

Avoid giant functions.

Keep functions focused.

Do not duplicate business logic.

Do not put database queries directly inside route handlers.

Do not put business logic directly inside React components.

---

# 26. Backend Layer Responsibilities

## Routes

Define HTTP endpoints.

Routes should not contain business logic.

## Controllers

Handle:

```text
request
validation result
service call
response
```

## Services

Contain business logic.

Example:

```text
upload.service.ts
```

should coordinate:

```text
upload validation
permission checks
storage
database
checksum
upload session
```

## Models

Define MongoDB schemas.

## Repositories

Encapsulate complex database access when useful.

## Middleware

Handle cross-cutting concerns:

```text
authentication
validation
rate limiting
errors
```

---

# 27. Frontend Architecture Rules

Do not put all logic into `App.tsx`.

Use:

```text
pages
components
hooks
services
stores
types
utils
```

Server state should primarily use TanStack Query.

Client/UI state should use Zustand only where appropriate.

Do not duplicate server state unnecessarily in Zustand.

API calls should be centralized.

Upload logic should be isolated from presentation components.

---

# 28. Error Response Format

Use a consistent API error format.

Example:

```json
{
  "success": false,
  "error": {
    "code": "FILE_NOT_FOUND",
    "message": "File not found"
  }
}
```

Successful responses should follow a consistent structure where practical.

Never expose stack traces in production responses.

---

# 29. Pagination

List endpoints must support pagination.

Example:

```text
GET /api/v1/files?folderId=<id>&page=1&limit=50
```

Do not load an unbounded number of files into memory.

---

# 30. Database Indexing

Add indexes based on actual query patterns.

Important candidates include:

```text
User.email

File.ownerId
File.folderId
File.ownerId + folderId

Folder.ownerId + parentId

Share.userId + resourceId

UploadSession.userId
UploadSession.status
UploadSession.expiresAt
```

Do not add unnecessary indexes without reason.

---

# 31. Performance Rules

Never load an entire large file into memory.

Prefer:

```text
createReadStream()
createWriteStream()
pipeline()
```

Use streaming wherever appropriate.

Avoid N+1 database queries.

Use pagination.

Use indexes.

Use caching for appropriate read-heavy operations.

Limit upload concurrency.

Do not perform expensive synchronous work inside API request handlers.

---

# 32. Idempotency

Operations that may be retried must be designed carefully.

Chunk uploads should be safe to retry.

Completing an already completed upload should not corrupt state.

Background jobs should be idempotent where possible.

Retries must not create duplicate files or duplicate versions accidentally.

---

# 33. Important Upload Invariants

The upload system must guarantee:

```text
1. Every chunk belongs to one upload session.
2. A chunk cannot belong to another user's session.
3. Duplicate chunks do not corrupt the upload.
4. Completion cannot happen when chunks are missing.
5. Expired sessions cannot continue uploading.
6. Final file metadata is created only after successful completion.
7. Failed completion does not create a partially valid file.
8. Temporary chunks are eventually cleaned.
```

---

# 34. Definition of Done

A phase is NOT complete just because the code compiles.

A phase is complete only when:

```text
[ ] Feature implemented
[ ] API implemented
[ ] Frontend implemented where applicable
[ ] Validation implemented
[ ] Authorization considered
[ ] Error handling implemented
[ ] Tests added where appropriate
[ ] TypeScript passes
[ ] Lint passes
[ ] Existing tests pass
[ ] Documentation updated if necessary
[ ] Manual verification completed
[ ] Git commit created
[ ] Feature pushed
```

---

# 35. Antigravity Execution Rules

When working on DriveScale:

1. Read this AGENTS.md before making changes.
2. Determine the current development phase.
3. Do not implement future phases prematurely.
4. Inspect the existing code before modifying it.
5. Reuse existing abstractions.
6. Do not rewrite working code unnecessarily.
7. Keep changes focused on the current phase.
8. Run appropriate tests after implementation.
9. Run TypeScript checks.
10. Run linting.
11. Fix failures before declaring the phase complete.
12. Update documentation when architecture changes.
13. Show a concise summary of files changed.
14. Show commands used for verification.
15. Do not automatically start another phase.
16. Wait for the user to explicitly request the next phase.

---

# 36. Phase Tracking

Maintain a `docs/progress.md` file.

Example:

```text
# DriveScale Progress

## Phase 0 — Repository Initialization
Status: COMPLETE

## Phase 1 — Authentication
Status: IN PROGRESS

## Phase 2 — Folder Management
Status: NOT STARTED

## Phase 3 — Basic File Storage
Status: NOT STARTED

## Phase 4 — Chunked Uploads
Status: NOT STARTED

## Phase 5 — Resumable Uploads
Status: NOT STARTED

## Phase 6 — Redis
Status: NOT STARTED

## Phase 7 — Background Workers
Status: NOT STARTED

## Phase 8 — Sharing and Permissions
Status: NOT STARTED

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
```

Only mark a phase COMPLETE after its acceptance criteria are verified.

---

# 37. Important Product Decisions

DriveScale is self-hosted.

The project must work locally using Docker.

No AWS dependency.

MinIO is the object-storage implementation.

MongoDB stores metadata.

MinIO stores file bytes.

Redis handles caching, rate limiting, and queues.

BullMQ handles background jobs.

The API is a modular monolith.

The worker is a separate process.

The frontend is a separate React application.

---

# 38. Future Features

Do not implement these until the core system is stable:

```text
Presigned URLs
Direct-to-MinIO uploads
File deduplication
Virus scanning
Thumbnail generation
Public share links
Link expiration
Comments
Starred files
Recent files
Activity history
Storage analytics
WebSockets
Notifications
Audit logs
Optimistic UI
Conflict detection
```

These are future enhancements.

Do not prematurely implement them.

---

# 39. Final Target Architecture

The final project should conceptually look like:

```text
                           DriveScale
                               |
              +----------------+----------------+
              |                                 |
              v                                 v
       React + TypeScript                Node + Express
              |                                 |
              |                    +------------+------------+
              |                    |            |            |
              |                    v            v            v
              |                 MongoDB      Redis        MinIO
              |                 Metadata      Cache       Objects
              |                              Rate Limit
              |                              BullMQ
              |                                 |
              |                                 v
              |                               Worker
              |
              v
       Upload Manager
              |
              v
       Chunked Upload
              |
              v
       Resumable Upload
```

The finished system should demonstrate that DriveScale is more than a CRUD application.

The most important engineering features are:

1. Streaming large-file uploads
2. Chunked uploads
3. Resumable uploads
4. Storage abstraction
5. MinIO object storage
6. Redis caching
7. Distributed rate limiting
8. Background jobs
9. Authorization and permissions
10. File versioning
11. Dockerized deployment
12. Automated testing

---

# 40. Current Instruction

At the beginning of a new task, determine which phase the repository is currently in.

Only implement the requested/current phase.

If the repository is empty, start with Phase 0.

After completing a phase:

* Verify it.
* Update progress.
* Provide the Git commands.
* Create a focused commit.
* Push the feature branch.
* Do not begin the next phase automatically.

The goal is a clean, incremental, production-quality Git history rather than a single large implementation.
