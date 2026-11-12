import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IFileVersion extends Document {
  fileId: Types.ObjectId;
  versionNumber: number;
  storageKey: string;
  name: string;
  size: number;
  mimeType: string;
  checksum: string;
  uploadedBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const fileVersionSchema = new Schema<IFileVersion>(
  {
    fileId: {
      type: Schema.Types.ObjectId,
      ref: 'File',
      required: true,
      index: true,
    },
    versionNumber: {
      type: Number,
      required: true,
      min: 1,
    },
    storageKey: {
      type: String,
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
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
    uploadedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
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

// Unique compound index: prevents duplicate version numbers for the same file
fileVersionSchema.index({ fileId: 1, versionNumber: 1 }, { unique: true });

// Compound index for querying versions ordered by version number descending
fileVersionSchema.index({ fileId: 1, versionNumber: -1 });

// Compound index for querying versions ordered by creation time descending
fileVersionSchema.index({ fileId: 1, createdAt: -1 });

export const FileVersion = mongoose.model<IFileVersion>('FileVersion', fileVersionSchema);

