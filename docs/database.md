# DriveScale — Database Schema & Models

DriveScale utilizes **MongoDB** via Mongoose to store metadata, user accounts, folder hierarchies, upload session states, and version histories.

**Critical Principle**: Raw file bytes are never stored in MongoDB. The database stores pointers (`storageKey`) that resolve to objects residing in MinIO object storage.

---

## 1. Collections & Schemas

### `User`
```typescript
{
  _id: ObjectId,
  name: string,
  email: string,           // Unique index
  passwordHash: string,    // Argon2id hash
  avatar?: string,
  storageQuota: number,    // Total allowed quota in bytes (default 10 GB)
  storageUsed: number,     // Currently utilized bytes
  storageReserved: number, // Reserved bytes for active in-progress uploads
  role: 'user' | 'admin',
  isActive: boolean,
  createdAt: Date,
  updatedAt: Date
}
```

### `Folder`
```typescript
{
  _id: ObjectId,
  name: string,
  ownerId: ObjectId,       // Reference to User
  parentId: ObjectId | null, // Root folders have parentId: null
  isDeleted: boolean,
  deletedAt?: Date,
  deletedBy?: ObjectId,
  originalParentId?: ObjectId | null,
  deletedWithFolderId?: ObjectId | null,
  createdAt: Date,
  updatedAt: Date
}
```
**Indexes**:
- `{ ownerId: 1, parentId: 1, name: 1, isDeleted: 1 }` (unique among active siblings)
- `{ ownerId: 1, isDeleted: 1, name: 1 }` (compound search index)
- `{ isDeleted: 1, name: 1 }`

### `File`
```typescript
{
  _id: ObjectId,
  name: string,
  ownerId: ObjectId,       // Reference to User
  folderId: ObjectId | null,
  storageKey: string,      // MinIO object key: "objects/xx/<hash>"
  size: number,            // File size in bytes
  mimeType: string,
  checksum: string,        // SHA-256 hex digest
  currentVersionId?: ObjectId,
  versionCount: number,
  isDeleted: boolean,
  deletedAt?: Date,
  deletedBy?: ObjectId,
  originalFolderId?: ObjectId | null,
  deletedWithFolderId?: ObjectId | null,
  createdAt: Date,
  updatedAt: Date
}
```
**Indexes**:
- `{ ownerId: 1, folderId: 1, name: 1, isDeleted: 1 }` (unique among active siblings)
- `{ ownerId: 1, isDeleted: 1, name: 1 }` (compound search index)
- `{ isDeleted: 1, name: 1 }`
- `{ storageKey: 1 }`

### `FileVersion`
```typescript
{
  _id: ObjectId,
  fileId: ObjectId,        // Reference to parent File
  versionNumber: number,
  storageKey: string,      // MinIO object key for this version snapshot
  size: number,
  mimeType: string,
  checksum: string,
  uploadedBy: ObjectId,
  createdAt: Date
}
```
**Indexes**:
- `{ fileId: 1, versionNumber: 1 }` (unique)

### `Share`
```typescript
{
  _id: ObjectId,
  resourceType: 'FILE' | 'FOLDER',
  resourceId: ObjectId,
  ownerId: ObjectId,
  userId: ObjectId,        // Recipient
  permission: 'VIEW' | 'DOWNLOAD' | 'EDIT',
  expiresAt?: Date,
  createdAt: Date
}
```
**Indexes**:
- `{ resourceType: 1, resourceId: 1, userId: 1 }` (unique)
- `{ userId: 1 }`

### `UploadSession`
```typescript
{
  _id: ObjectId,
  userId: ObjectId,
  fileName: string,
  folderId: ObjectId | null,
  totalSize: number,
  chunkSize: number,
  totalChunks: number,
  uploadedChunks: [{ chunkNumber: number, size: number, checksum: string }],
  storageKey: string,
  reservedBytes: number,   // Quota reserved during upload
  status: 'PENDING' | 'UPLOADING' | 'ASSEMBLING' | 'COMPLETED' | 'FAILED' | 'EXPIRED' | 'CANCELLED',
  expiresAt: Date,         // 24-hour TTL
  createdAt: Date,
  updatedAt: Date
}
```
**Indexes**:
- `{ userId: 1, status: 1 }`
- `{ expiresAt: 1 }`

### `RefreshToken`
```typescript
{
  _id: ObjectId,
  userId: ObjectId,
  tokenHash: string,
  family: string,          // Token rotation tracking
  isRevoked: boolean,
  expiresAt: Date,
  createdAt: Date
}
```

