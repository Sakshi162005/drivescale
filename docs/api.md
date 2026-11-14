# DriveScale — API Reference (`/api/v1`)

All endpoints are versioned under `/api/v1` and return standardized JSON responses.

```json
{
  "success": true,
  "data": { ... }
}
```

Error responses:
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

---

## 1. Authentication (`/api/v1/auth`)

| Method | Endpoint | Description | Auth Required |
|---|---|---|---|
| `POST` | `/auth/register` | Register a new user | No |
| `POST` | `/auth/login` | Authenticate with email and password | No |
| `POST` | `/auth/logout` | Revoke refresh token and logout | Yes |
| `POST` | `/auth/refresh` | Exchange valid refresh token for new access token | No (Cookie/Body) |
| `GET` | `/auth/me` | Retrieve authenticated user profile | Yes |

---

## 2. Users & Quotas (`/api/v1/users` & `/api/v1/storage`)

| Method | Endpoint | Description | Auth Required |
|---|---|---|---|
| `GET` | `/users/me` | Retrieve profile and storage overview | Yes |
| `PATCH` | `/users/me` | Update user profile | Yes |
| `GET` | `/storage/usage` | Detailed storage stats (used, reserved, quota, remaining) | Yes |
| `PATCH` | `/storage/quota` | Update user storage quota | Yes |

---

## 3. Folders (`/api/v1/folders`)

| Method | Endpoint | Description | Auth Required |
|---|---|---|---|
| `POST` | `/folders` | Create a new folder | Yes |
| `GET` | `/folders/:id` | Get folder metadata | Yes |
| `GET` | `/folders/:id/children` | List child folders and files | Yes |
| `PATCH` | `/folders/:id` | Rename folder | Yes |
| `DELETE` | `/folders/:id` | Soft delete folder and its contents | Yes |
| `POST` | `/folders/:id/move` | Move folder to a new parent folder or root | Yes |

---

## 4. Files (`/api/v1/files`)

| Method | Endpoint | Description | Auth Required |
|---|---|---|---|
| `POST` | `/files` | Multipart direct streaming file upload | Yes |
| `GET` | `/files` | Paginated file listing (`?folderId=...&page=...&limit=...`) | Yes |
| `GET` | `/files/:id` | Get file metadata | Yes |
| `GET` | `/files/:id/download` | Stream object bytes directly from MinIO | Yes |
| `PATCH` | `/files/:id` | Rename file | Yes |
| `DELETE` | `/files/:id` | Soft delete file (moves to trash) | Yes |
| `POST` | `/files/:id/move` | Move file to another folder or root | Yes |

---

## 5. Chunked & Resumable Uploads (`/api/v1/uploads`)

| Method | Endpoint | Description | Auth Required |
|---|---|---|---|
| `POST` | `/uploads/init` | Initialize chunked upload session and reserve quota | Yes |
| `PUT` | `/uploads/:uploadId/chunks/:chunkNumber` | Ingest chunk stream and stage to disk | Yes |
| `GET` | `/uploads/:uploadId/status` | Query upload progress and calculate missing chunks | Yes |
| `POST` | `/uploads/:uploadId/complete` | Sequentially stream assemble chunks into MinIO | Yes |
| `DELETE` | `/uploads/:uploadId` | Cancel upload session and release reserved quota | Yes |

---

## 6. Sharing & Permissions (`/api/v1/shares`)

| Method | Endpoint | Description | Auth Required |
|---|---|---|---|
| `POST` | `/shares` | Share a file or folder (`VIEW`, `DOWNLOAD`, `EDIT`) | Yes |
| `GET` | `/shares` | List resources shared with or by the user | Yes |
| `PATCH` | `/shares/:id` | Update permission level or expiration | Yes |
| `DELETE` | `/shares/:id` | Revoke a share | Yes |

---

## 7. File Versions (`/api/v1/files/:id/versions`)

| Method | Endpoint | Description | Auth Required |
|---|---|---|---|
| `GET` | `/files/:id/versions` | List all historical versions of a file | Yes |
| `GET` | `/files/:id/versions/:versionId` | Get version metadata | Yes |
| `GET` | `/files/:id/versions/:versionId/download` | Download historical version from MinIO | Yes |
| `POST` | `/files/:id/versions/:versionId/restore` | Restore historical version as current file | Yes |

---

## 8. Trash & Recovery (`/api/v1/trash`)

| Method | Endpoint | Description | Auth Required |
|---|---|---|---|
| `GET` | `/trash` | List trashed files and folders | Yes |
| `POST` | `/trash/files/:id/restore` | Restore soft-deleted file | Yes |
| `POST` | `/trash/folders/:id/restore` | Restore soft-deleted folder hierarchy | Yes |
| `DELETE` | `/trash/files/:id/permanent` | Permanently remove file and versions from MinIO | Yes |
| `DELETE` | `/trash/folders/:id/permanent` | Permanently remove folder and all descendant objects | Yes |
| `DELETE` | `/trash/empty` | Empty entire trash for authenticated user | Yes |

---

## 9. Search (`/api/v1/search`)

| Method | Endpoint | Description | Auth Required |
|---|---|---|---|
| `GET` | `/search?q=...` | Case-insensitive search across user & shared items | Yes |

