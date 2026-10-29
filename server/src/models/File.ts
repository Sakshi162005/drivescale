import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IFile extends Document {
  name: string;
  ownerId: Types.ObjectId;
  folderId: Types.ObjectId | null;
  storageKey: string;
  size: number;
  mimeType: string;
  checksum: string;
  currentVersionId: Types.ObjectId | null;
  isDeleted: boolean;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const fileSchema = new Schema<IFile>(
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
    folderId: {
      type: Schema.Types.ObjectId,
      ref: 'Folder',
      default: null,
      index: true,
    },
    storageKey: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    size: {
      type: Number,
      required: true,
      min: 0,
    },
    mimeType: {
      type: String,
      required: true,
      default: 'application/octet-stream',
    },
    checksum: {
      type: String,
      required: true,
    },
    currentVersionId: {
      type: Schema.Types.ObjectId,
      ref: 'FileVersion',
      default: null,
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

// Compound index for querying active files in a folder
fileSchema.index({ ownerId: 1, folderId: 1, isDeleted: 1 });

// Compound index for unique check of active file name within same folder
fileSchema.index({ ownerId: 1, folderId: 1, name: 1, isDeleted: 1 });

export const File = mongoose.model<IFile>('File', fileSchema);
