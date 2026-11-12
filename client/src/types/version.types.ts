export interface VersionUploader {
  _id: string;
  name: string;
  email: string;
}

export interface FileVersionItem {
  _id: string;
  fileId: string;
  versionNumber: number;
  name: string;
  size: number;
  mimeType: string;
  checksum: string;
  uploadedBy?: VersionUploader | string;
  isCurrent: boolean;
  createdAt: string;
  updatedAt?: string;
}

export interface VersionListFileSummary {
  _id: string;
  name: string;
  size: number;
  mimeType: string;
  currentVersionId?: string | null;
  versionCount: number;
}

export interface VersionListResponse {
  file: VersionListFileSummary;
  versions: FileVersionItem[];
}

export interface VersionActionResponse {
  newVersion: FileVersionItem;
  file: VersionListFileSummary;
}

