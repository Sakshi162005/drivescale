# DriveScale — API Reference (`/api/v1`)

All endpoints in DriveScale are versioned under `/api/v1` and follow standard REST principles with JSON response bodies.

---

## 1. Response & Error Envelopes

### Standard Success Envelope
```json
{
  "success": true,
  "data": { ... }
}
```

### Standard Error Envelope
```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable error description",
    "details": null
  }
}
```

### Common HTTP Status Codes & Error Codes
| Status Code | Error Code | Description |
|---|---|---|
| `200 OK` | — | Request succeeded. |
| `201 Created` | — | Resource successfully created. |
| `400 Bad Request` | `BAD_REQUEST` | Validation failed, missing required fields, or invalid format. |
| `400 Bad Request` | `STORAGE_QUOTA_EXCEEDED` | Target file upload would exceed user's available quota. |
| `400 Bad Request` | `MISSING_CHUNKS` | Attempted completion before all chunks were received. |
| `400 Bad Request` | `CHECKSUM_MISMATCH` | Provided client checksum does not match computed checksum. |
| `400 Bad Request` | `SESSION_EXPIRED` | Upload session exceeded its 24-hour TTL. |
| `401 Unauthorized` | `UNAUTHORIZED` | Missing, expired, or invalid JWT access token. |
| `401 Unauthorized` | `FORBIDDEN` | Access denied for this resource or session. |
| `403 Forbidden` | `ACCOUNT_DEACTIVATED` | User account has been deactivated by an administrator. |
| `404 Not Found` | `NOT_FOUND` | Target file, folder, version, or session not found. |
| `409 Conflict` | `CONFLICT` | Resource collision (e.g. duplicate email or folder name). |
| `409 Conflict` | `DUPLICATE_CHUNK_CONFLICT` | Duplicate chunk submitted with conflicting checksum. |
| `409 Conflict` | `CONCURRENT_COMPLETION` | Upload session is already undergoing active assembly. |
| `429 Too Many Requests`| `TOO_MANY_REQUESTS` | Rate limit threshold exceeded for current IP or user window. |
| `503 Service Unavailable`| `SERVICE_UNAVAILABLE` | Database or critical infrastructure dependency is offline. |

---

## 2. Health & Diagnostic Probes (`/api/v1/health`)

### `GET /api/v1/health/live`
- **Purpose**: Fast process liveness check for container orchestrators.
- **Auth**: None
- **Response `200 OK`**:
  ```json
  {
    "status": "alive",
    "uptime": 142
  }
  ```

### `GET /api/v1/health/ready`
- **Purpose**: Service readiness probe verifying MongoDB connection before accepting traffic.
- **Auth**: None
- **Response `200 OK`**:
  ```json
  {
    "success": true,
    "data": {
      "ready": true,
      "database": "connected"
    }
  }
  ```

### `GET /api/v1/health`
- **Purpose**: Full infrastructure status report (MongoDB, Redis, MinIO).
- **Auth**: None
- **Response `200 OK`**:
  ```json
  {
    "success": true,
    "data": {
      "status": "healthy",
      "version": "0.1.0",
      "uptime": 142,
      "timestamp": "2026-10-30T12:00:00.000Z",
      "services": {
        "database": { "status": "connected" },
        "redis": { "status": "connected" },
        "storage": { "status": "connected" }
      }
    }
  }
  ```

---

## 3. Authentication (`/api/v1/auth`)

### `POST /api/v1/auth/register`
- **Purpose**: Register a new user account with default 10 GB quota.
- **Auth**: None (Rate limited: 10 req/min per IP)
- **Request Body**:
  ```json
  {
    "name": "Alex Mercer",
    "email": "alex@example.com",
    "password": "StrongPassword123!"
  }
  ```
- **Response `201 Created`**:
  ```json
  {
    "success": true,
    "data": {
      "user": {
        "_id": "65b82e91a03f4c0012ab3450",
        "name": "Alex Mercer",
        "email": "alex@example.com",
        "storageQuota": 10737418240,
        "storageUsed": 0,
        "role": "user"
      },
      "accessToken": "eyJhbGciOiJIUzI1NiIs..."
    }
  }
  ```
  *Sets HTTP-only cookie `refreshToken`.*

### `POST /api/v1/auth/login`
- **Purpose**: Authenticate user credentials and issue token pair.
- **Auth**: None (Rate limited: 10 req/min per IP)
- **Request Body**:
  ```json
  {
    "email": "alex@example.com",
    "password": "StrongPassword123!"
  }
  ```
- **Response `200 OK`**: Same structure as registration.

### `POST /api/v1/auth/refresh`
- **Purpose**: Rotate refresh token and issue a fresh 15-minute access token.
- **Auth**: Refresh Token in HTTP-only cookie or `{ "refreshToken": "..." }` body.
- **Response `200 OK`**: Returns new `accessToken`.

### `POST /api/v1/auth/logout`
- **Purpose**: Invalidate current refresh token family and clear auth cookies.
- **Auth**: Bearer JWT

### `GET /api/v1/auth/me`
- **Purpose**: Retrieve profile of authenticated caller.
- **Auth**: Bearer JWT

---

## 4. Users & Storage Quotas (`/api/v1/users` & `/api/v1/storage`)

### `GET /api/v1/users/me`
- **Purpose**: Fetch current user details and storage summary.
- **Auth**: Bearer JWT

### `PATCH /api/v1/users/me`
- **Purpose**: Update user profile information.
- **Auth**: Bearer JWT
- **Request Body**: `{ "name": "Alex Mercer Updated" }`

### `GET /api/v1/storage/usage`
- **Purpose**: Detailed storage metrics and percentage usage.
- **Auth**: Bearer JWT
- **Response `200 OK`**:
  ```json
  {
    "success": true,
    "data": {
      "storageQuota": 10737418240,
      "storageUsed": 2147483648,
      "storageReserved": 52428800,
      "availableBytes": 8537505792,
      "percentageUsed": 20.0
    }
  }
  ```

---

## 5. Folders (`/api/v1/folders`)

### `POST /api/v1/folders`
- **Purpose**: Create a new folder.
- **Auth**: Bearer JWT
- **Request Body**:
  ```json
  {
    "name": "Design Assets",
    "parentId": null
  }
  ```
- **Response `201 Created`**: Returns created `Folder` record.

### `GET /api/v1/folders/:id`
- **Purpose**: Get metadata and breadcrumb hierarchy for a folder (`:id = 'root'` for root).
- **Auth**: Bearer JWT

### `GET /api/v1/folders/:id/children`
- **Purpose**: List child folders and files within target directory.
- **Auth**: Bearer JWT
- **Query Parameters**:
  - `page`: Page index (default: `1`)
  - `limit`: Page size (default: `50`)
  - `sortBy`: Field to sort by (`name`, `size`, `updatedAt`)
  - `sortOrder`: `asc` or `desc`

### `PATCH /api/v1/folders/:id`
- **Purpose**: Rename folder.
- **Auth**: Bearer JWT (`EDIT` permission required)
- **Request Body**: `{ "name": "Brand Guidelines" }`

### `POST /api/v1/folders/:id/move`
- **Purpose**: Move folder into a new parent folder.
- **Auth**: Bearer JWT
- **Request Body**: `{ "targetParentId": "65b82e91a03f4c0012ab3452" }` (or `null` for root).

### `DELETE /api/v1/folders/:id`
- **Purpose**: Soft delete folder and recursively move contents to trash.
- **Auth**: Bearer JWT

---

## 6. Files (`/api/v1/files`)

### `POST /api/v1/files`
- **Purpose**: Direct streaming multipart upload for smaller files.
- **Auth**: Bearer JWT
- **Form Data**:
  - `file`: Binary file stream
  - `folderId`: Optional parent folder ID

### `GET /api/v1/files`
- **Purpose**: Paginated list of active files.
- **Auth**: Bearer JWT
- **Query Parameters**: `folderId`, `page`, `limit`, `sortBy`, `sortOrder`

### `GET /api/v1/files/:id`
- **Purpose**: Retrieve file metadata, current version number, and permissions.
- **Auth**: Bearer JWT (`VIEW` permission required)

### `GET /api/v1/files/:id/download`
- **Purpose**: Stream raw file bytes directly from MinIO with sanitized `Content-Disposition`.
- **Auth**: Bearer JWT (`DOWNLOAD` permission required)
- **Headers Returned**:
  - `Content-Type`: File MIME type (e.g. `application/pdf`)
  - `Content-Length`: Exact file size
  - `Content-Disposition`: `attachment; filename="document.pdf"`

### `PATCH /api/v1/files/:id`
- **Purpose**: Rename a file.
- **Auth**: Bearer JWT (`EDIT` permission required)
- **Request Body**: `{ "name": "final_presentation.pdf" }`

### `POST /api/v1/files/:id/move`
- **Purpose**: Move file into a different folder or root.
- **Auth**: Bearer JWT (`EDIT` permission required)
- **Request Body**: `{ "targetFolderId": "65b82e91a03f4c0012ab3452" }`

### `DELETE /api/v1/files/:id`
- **Purpose**: Soft delete file and move to trash.
- **Auth**: Bearer JWT (`EDIT` permission required)

---

## 7. Chunked & Resumable Uploads (`/api/v1/uploads`)

### `POST /api/v1/uploads/init`
- **Purpose**: Initialize a chunked upload session and reserve quota.
- **Auth**: Bearer JWT (Rate limited: 20 req/min per user)
- **Request Body**:
  ```json
  {
    "fileName": "large_archive.zip",
    "totalSize": 104857600,
    "chunkSize": 5242880,
    "folderId": null,
    "mimeType": "application/zip",
    "replaceFileId": null
  }
  ```
- **Response `201 Created`**:
  ```json
  {
    "success": true,
    "data": {
      "uploadId": "65b82e91a03f4c0012ab3456",
      "totalChunks": 20,
      "chunkSize": 5242880,
      "expiresAt": "2026-10-31T12:00:00.000Z"
    }
  }
  ```

### `PUT /api/v1/uploads/:uploadId/chunks/:chunkNumber`
- **Purpose**: Upload an individual chunk (0-indexed). Supports raw stream or multipart.
- **Auth**: Bearer JWT (Rate limited: 120 req/min per user)
- **Headers / Query**: Optional `?checksum=<sha256>` or `x-checksum: <sha256>`.
- **Response `200 OK`**:
  ```json
  {
    "success": true,
    "data": {
      "chunkNumber": 0,
      "size": 5242880,
      "checksum": "8f4e2...",
      "isDuplicate": false
    }
  }
  ```

### `GET /api/v1/uploads/:uploadId/status`
- **Purpose**: Query upload session state, verified physical chunks, and missing chunk indices.
- **Auth**: Bearer JWT
- **Response `200 OK`**:
  ```json
  {
    "success": true,
    "data": {
      "uploadId": "65b82e91a03f4c0012ab3456",
      "status": "UPLOADING",
      "uploadedChunks": [0, 1, 2],
      "missingChunks": [3, 4, 5],
      "canAcceptChunks": true,
      "isAssembling": false,
      "isCompleted": false
    }
  }
  ```

### `POST /api/v1/uploads/:uploadId/complete`
- **Purpose**: Trigger sequential streaming assembly of all chunks into MinIO.
- **Auth**: Bearer JWT
- **Request Body**: Optional `{ "checksum": "<assembled-file-sha256>" }`
- **Response `201 Created`**: Returns the finalized `File` metadata record.

### `DELETE /api/v1/uploads/:uploadId`
- **Purpose**: Cancel active upload session, release reserved quota, and purge staged chunk files.
- **Auth**: Bearer JWT

---

## 8. Sharing & Permissions (`/api/v1/shares`)

### `POST /api/v1/shares`
- **Purpose**: Share a file or folder with another user by email.
- **Auth**: Bearer JWT (Owner only)
- **Request Body**:
  ```json
  {
    "resourceType": "FILE",
    "resourceId": "65b82e91a03f4c0012ab3453",
    "email": "teammate@example.com",
    "permission": "DOWNLOAD",
    "expiresAt": "2026-11-30T00:00:00.000Z"
  }
  ```

### `GET /api/v1/shares`
- **Purpose**: List all shares created by or granted to current user.
- **Auth**: Bearer JWT
- **Query Parameters**: `type=inbound|outbound`

### `PATCH /api/v1/shares/:id`
- **Purpose**: Update permission level (`VIEW`, `DOWNLOAD`, `EDIT`) or expiration date.
- **Auth**: Bearer JWT (Owner only)

### `DELETE /api/v1/shares/:id`
- **Purpose**: Revoke shared access grant.
- **Auth**: Bearer JWT (Owner only)

---

## 9. File Versions (`/api/v1/files/:id/versions`)

### `GET /api/v1/files/:id/versions`
- **Purpose**: List chronological version snapshot history for a file.
- **Auth**: Bearer JWT (`VIEW` permission required)

### `GET /api/v1/files/:id/versions/:versionId`
- **Purpose**: Retrieve specific historical version metadata.
- **Auth**: Bearer JWT (`VIEW` permission required)

### `GET /api/v1/files/:id/versions/:versionId/download`
- **Purpose**: Stream download specific historical version bytes from MinIO.
- **Auth**: Bearer JWT (`DOWNLOAD` permission required)

### `POST /api/v1/files/:id/versions/:versionId/restore`
- **Purpose**: Restore selected historical version as current active file version.
- **Auth**: Bearer JWT (`EDIT` permission required)

---

## 10. Trash & Recovery (`/api/v1/trash`)

### `GET /api/v1/trash`
- **Purpose**: List soft-deleted files and folders belonging to user.
- **Auth**: Bearer JWT

### `POST /api/v1/trash/files/:id/restore`
- **Purpose**: Restore soft-deleted file to original folder (or root if parent was deleted).
- **Auth**: Bearer JWT

### `POST /api/v1/trash/folders/:id/restore`
- **Purpose**: Restore soft-deleted folder and all cascading contents.
- **Auth**: Bearer JWT

### `DELETE /api/v1/trash/files/:id/permanent`
- **Purpose**: Permanently delete file metadata from MongoDB and delete bytes from MinIO.
- **Auth**: Bearer JWT

### `DELETE /api/v1/trash/folders/:id/permanent`
- **Purpose**: Recursively and permanently delete folder and all descendant objects from MinIO.
- **Auth**: Bearer JWT

### `DELETE /api/v1/trash/empty`
- **Purpose**: Permanently purge all trashed items and reclaim storage space.
- **Auth**: Bearer JWT

---

## 11. Search (`/api/v1/search`)

### `GET /api/v1/search`
- **Purpose**: Query file and folder names across owned and shared resources.
- **Auth**: Bearer JWT
- **Query Parameters**:
  - `q`: Search keyword (case-insensitive substring/regex match)
  - `type`: `all`, `file`, or `folder` (default: `all`)
  - `page`: Page index (default: `1`)
  - `limit`: Page limit (default: `20`)
