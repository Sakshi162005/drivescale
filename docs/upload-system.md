# DriveScale — Upload Subsystem Architecture

## 1. Overview

DriveScale implements a high-performance, fault-tolerant file upload architecture designed for large files. Files are never loaded entirely into server RAM; streaming pipelines transfer data directly to persistent storage while calculating cryptographic checksums on the fly.

Key features:
- **Chunked Ingestion**: Large files are segmented into deterministic chunks.
- **Resumability**: Interrupted or stalled uploads resume from where they left off by querying server state and transmitting only missing chunks.
- **Controlled Concurrency**: Frontend manages a worker pool with a concurrency limit of 3 parallel chunk uploads.
- **Storage Integrity**: Physical chunk verification validates on-disk files against database metadata, re-queuing any orphan or corrupted chunks.
- **Race Safety**: Atomic state transitions guard against race conditions between assembly, completion, and cancellation.
- **Duplicate & Conflict Guards**: Retries of identical chunks succeed idempotently (200 OK), while conflicting duplicate chunks are rejected (409 Conflict).

---

## 2. Upload Lifecycle & State Machine

Upload sessions progress through strict states:

```text
                  +-----------------------------------+
                  |                                   |
                  v                                   |
+---------+     +------------+     +------------+     |
| PENDING | --> | UPLOADING  | --> | ASSEMBLING | ----+ (missing chunks detected)
+---------+     +------------+     +------------+
     |                 |                 |
     |                 |                 v
     |                 |          +-----------+
     |                 +--------> | COMPLETED |
     |                            +-----------+
     v                                  |
+-----------+                           |
| CANCELLED | <-------------------------+ (rejected: 400 SESSION_ALREADY_COMPLETED)
+-----------+
     ^
     |
+-----------+
|  EXPIRED  | (after 24-hour TTL)
+-----------+
```

### State Definitions
- `PENDING`: Session initialized; awaiting first chunk.
- `UPLOADING`: One or more chunks received and validated; remaining chunks pending.
- `ASSEMBLING`: Atomic completion initiated. Stream pipeline actively concatenates chunks in numerical order into the final storage key.
- `COMPLETED`: Assembly succeeded, SHA-256 and byte sizes verified, MongoDB `File` record created, and temporary chunk files cleaned up.
- `EXPIRED`: 24-hour expiration threshold exceeded. Chunks can no longer be uploaded.
- `CANCELLED`: Session manually cancelled. Temporary chunk files purged from storage.

---

## 3. Resumable Upload Architecture

### A. Missing Chunk Detection & Physical Storage Verification
When a client disconnects or refreshes, it calls `GET /api/v1/uploads/:uploadId/status`.
The server does not blindly trust MongoDB records:
1. It iterates through all recorded `uploadedChunks` and checks physical disk availability via `storage.chunkExists(uploadId, chunkNumber)`.
2. Any chunk missing from storage is dropped from the database session and added back to `missingChunks`.
3. The server computes the missing chunks list:
   $$\text{missingChunks} = \{ i \in [0, \text{totalChunks}-1] \mid i \notin \text{verifiedChunks} \}$$
4. The client receives `missingChunks` sorted in ascending order and streams only those specific missing chunks.

### B. Status API Response
`GET /api/v1/uploads/:uploadId/status`

```json
{
  "success": true,
  "data": {
    "uploadId": "65b82e91a03f4c0012ab3456",
    "fileName": "dataset.zip",
    "totalSize": 15728640,
    "chunkSize": 5242880,
    "totalChunks": 3,
    "uploadedChunks": [0, 2],
    "missingChunks": [1],
    "status": "UPLOADING",
    "expiresAt": "2026-10-30T10:00:00.000Z",
    "canAcceptChunks": true,
    "isAssembling": false,
    "isCompleted": false,
    "fileId": null
  }
}
```

### C. Client-Side Resume Workflow
1. **Metadata Persistence**: When an upload is initiated, non-sensitive metadata (session ID, file name, total size, target folder, creation timestamp) is saved to `localStorage` under `drivescale_active_uploads`. File bytes and binary handles are **never** stored in browser storage.
2. **Reconnection & Detection**: On page load, `Drive.tsx` checks `getActiveUploads()`. If incomplete uploads exist, an "Incomplete Upload Found" banner is displayed.
3. **User Action**: The user selects "Resume Upload" and picks the local file. The client verifies that `file.name === metadata.fileName` and `file.size === metadata.totalSize`.
4. **Targeted Transmission**: The client queries `/status`, extracts `missingChunks`, and uploads only the missing pieces using 3 concurrent workers.
5. **Assembly**: Once all chunks are uploaded, `POST /complete` triggers assembly and the active upload metadata is removed from `localStorage`.

### D. Exponential Backoff Retry Strategy
Transient network failures during chunk upload are handled with bounded exponential backoff:
- Maximum attempts: 3 attempts per chunk.
- Backoff formula: $\text{delay} = 500 \text{ ms} \times 2^{(\text{attempt}-1)}$ (500ms, 1000ms, 2000ms).
- Fatal client errors (`409 Conflict`, `400 Invalid Chunk Size`, `401/403 Forbidden`) immediately abort without retrying.

---

## 4. Concurrency & Race Condition Guards

- **Atomic Assembly Transition**: `completeUpload` uses Mongoose's atomic `findOneAndUpdate` matching `{ status: { $in: ['PENDING', 'UPLOADING'] } }` to set `status: 'ASSEMBLING'`. Concurrent complete requests are rejected with `409 CONCURRENT_COMPLETION`.
- **Cancellation Race Guard**: `cancelUpload` checks for `ASSEMBLING` status and rejects cancellation with `409 SESSION_ASSEMBLING` to prevent deleting chunk files while assembly is in progress.
- **Completion Inviolability**: `cancelUpload` rejects cancellation if `status === 'COMPLETED'` with `400 SESSION_ALREADY_COMPLETED`, ensuring valid files and quota are never deleted.
- **Repeated Completion Idempotency**: Calling `/complete` on an already completed session safely returns the existing `File` record with 200/201 without re-assembling.
