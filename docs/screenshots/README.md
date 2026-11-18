# DriveScale — UI & Screenshot Gallery Guide

This directory documents the user interface views and screenshots of the DriveScale cloud storage platform.

> [!NOTE]
> Per the repository guidelines, binary image captures are not committed directly to Git to prevent repository bloat and avoid fabricated stock assets. The genuine UI views can be experienced live by launching the local development environment or production Docker stack.

---

## Intended Visual Asset Catalog

When running DriveScale locally (`npm run dev` or `docker compose up -d`), the frontend application provides the following responsive UI screens:

### 1. Authentication & Onboarding
- **`01_login.png`**: Clean authentication portal featuring email/password sign-in with instant error feedback, link to registration, and input validation powered by React Hook Form and Zod.
- **`02_register.png`**: New user registration with automatic 10 GB quota provisioning, Argon2id security guarantees, and real-time password strength validation.

### 2. Main Drive Dashboard
- **`03_drive_dashboard.png`**: The primary dashboard showing:
  - Top navigation bar with breadcrumbs reflecting current folder depth.
  - Action bar with "New Folder", "Upload File", and sorting controls.
  - Active storage quota indicator in the sidebar showing used bytes vs. 10 GB total quota.
  - Quick navigation links for "My Drive", "Recent", "Starred", "Shared with Me", and "Trash".

### 3. File & Folder Management
- **`04_file_listing.png`**: Unified grid and table views displaying folders and files with Lucide icons categorized by MIME type (PDF, image, audio, archive, code, document), file size, and last modified date.
- **`05_context_menu.png`**: Contextual actions on files/folders: Rename, Move, Download, Share, Version History, and Move to Trash.

### 4. Upload System & Progress Manager
- **`06_chunked_upload_progress.png`**: Real-time floating upload tray showing:
  - Current file name and total size.
  - Concurrent chunk workers (3-worker concurrency pool).
  - Progress bar with byte count, chunk count (e.g. `24/100`), and transfer speed.
- **`07_resumable_upload_prompt.png`**: The "Incomplete Upload Found" banner that automatically surfaces upon reconnecting after an interrupted upload, offering a 1-click "Resume Upload" button to transmit only missing chunks.

### 5. Sharing & Permissions
- **`08_sharing_dialog.png`**: Modal dialog allowing file/folder owners to grant granular access (`VIEW`, `DOWNLOAD`, `EDIT`) to other registered users by email address, with optional expiration timestamps and revocation controls.

### 6. File Version History
- **`09_version_history.png`**: Version timeline drawer displaying historical snapshots of a file (v1, v2, v3), upload timestamps, contributor details, download buttons for earlier versions, and a 1-click "Restore this Version" action.

### 7. Trash & Recovery
- **`10_trash_view.png`**: Soft-deletion holding area with countdown to automatic 30-day purge, individual "Restore" and "Delete Permanently" actions, and an "Empty Trash" bulk purge button.

---

## Instructions for Capturing Genuine Screenshots

To capture screenshots of the actual running application:

1. **Start the Production Stack**:
   ```bash
   docker compose up -d --build
   ```
2. **Access the Client Interface**:
   Open `http://localhost` (or `http://localhost:5173` in development mode) in your browser.
3. **Register a Test Account**:
   Navigate to `/register` and create an account (e.g., `user@example.com`).
4. **Capture Views**:
   Use your OS screenshot utility (or headless browser tools) to capture the views listed above at standard 1920x1080 resolution and save them into this directory using the naming convention `NN_description.png`.

