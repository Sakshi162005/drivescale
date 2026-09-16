export interface Folder {
  _id: string;
  name: string;
  ownerId: string;
  parentId: string | null;
  isDeleted: boolean;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BreadcrumbItem {
  _id: string;
  name: string;
  parentId: string | null;
}

export interface CreateFolderInput {
  name: string;
  parentId?: string | null;
}

export interface RenameFolderInput {
  name: string;
}

export interface MoveFolderInput {
  targetParentId: string | null;
}
