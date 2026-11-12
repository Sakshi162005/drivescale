import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IFolder extends Document {
  name: string;
  ownerId: Types.ObjectId;
  parentId: Types.ObjectId | null;
  isDeleted: boolean;
  deletedAt: Date | null;
  deletedBy?: Types.ObjectId | null;
  originalParentId?: Types.ObjectId | null;
  deletedWithFolderId?: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const folderSchema = new Schema<IFolder>(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      minlength: 1,
      maxlength: 255,
    },
    ownerId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    parentId: {
      type: Schema.Types.ObjectId,
      ref: 'Folder',
      default: null,
      index: true,
    },
    isDeleted: {
      type: Boolean,
      default: false,
      index: true,
    },
    deletedAt: {
      type: Date,
      default: null,
    },
    deletedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    originalParentId: {
      type: Schema.Types.ObjectId,
      ref: 'Folder',
      default: null,
    },
    deletedWithFolderId: {
      type: Schema.Types.ObjectId,
      ref: 'Folder',
      default: null,
      index: true,
    },
  },
  {
    timestamps: true,
    toJSON: {
      transform(_doc, ret) {
        delete (ret as Record<string, unknown>)['__v'];
        return ret;
      },
    },
  }
);

// Compound index for querying active folders by owner and parent
folderSchema.index({ ownerId: 1, parentId: 1, isDeleted: 1 });

// Compound index for querying user's top-level trashed folders
folderSchema.index({ ownerId: 1, isDeleted: 1, deletedWithFolderId: 1, deletedAt: -1 });

// Index for background expiration cleanup worker
folderSchema.index({ isDeleted: 1, deletedAt: 1 });

export const Folder = mongoose.model<IFolder>('Folder', folderSchema);
