import mongoose, { Schema, Document, Types } from 'mongoose';

export type UploadSessionStatus =
  | 'PENDING'
  | 'UPLOADING'
  | 'ASSEMBLING'
  | 'COMPLETED'
  | 'FAILED'
  | 'EXPIRED'
  | 'CANCELLED';

export interface IUploadedChunk {
  chunkNumber: number;
  size: number;
  checksum: string;
  uploadedAt: Date;
}

export interface IUploadSession extends Document {
  userId: Types.ObjectId;
  fileName: string;
  folderId: Types.ObjectId | null;
  mimeType: string;
  totalSize: number;
  chunkSize: number;
  totalChunks: number;
  uploadedChunks: IUploadedChunk[];
  storageKey: string;
  status: UploadSessionStatus;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const uploadedChunkSchema = new Schema<IUploadedChunk>(
  {
    chunkNumber: { type: Number, required: true },
    size: { type: Number, required: true },
    checksum: { type: String, required: true },
    uploadedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const uploadSessionSchema = new Schema<IUploadSession>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    fileName: {
      type: String,
      required: true,
      trim: true,
      minlength: 1,
      maxlength: 255,
    },
    folderId: {
      type: Schema.Types.ObjectId,
      ref: 'Folder',
      default: null,
      index: true,
    },
    mimeType: {
      type: String,
      default: 'application/octet-stream',
    },
    totalSize: {
      type: Number,
      required: true,
      min: 0,
    },
    chunkSize: {
      type: Number,
      required: true,
      min: 1,
    },
    totalChunks: {
      type: Number,
      required: true,
      min: 1,
    },
    uploadedChunks: {
      type: [uploadedChunkSchema],
      default: [],
    },
    storageKey: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    status: {
      type: String,
      enum: ['PENDING', 'UPLOADING', 'ASSEMBLING', 'COMPLETED', 'FAILED', 'EXPIRED', 'CANCELLED'],
      default: 'PENDING',
      index: true,
    },
    expiresAt: {
      type: Date,
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

// Compound index for user session queries
uploadSessionSchema.index({ userId: 1, status: 1 });

export const UploadSession = mongoose.model<IUploadSession>('UploadSession', uploadSessionSchema);

