import mongoose, { Schema, Document, Types } from 'mongoose';

export type ShareResourceType = 'FILE' | 'FOLDER';
export type SharePermission = 'VIEW' | 'DOWNLOAD' | 'EDIT';

export interface IShare extends Document {
  ownerId: Types.ObjectId;
  recipientId: Types.ObjectId;
  userId?: Types.ObjectId; // Alias for recipientId
  resourceType: ShareResourceType;
  resourceId: Types.ObjectId;
  permission: SharePermission;
  expiresAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const shareSchema = new Schema<IShare>(
  {
    ownerId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    recipientId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    resourceType: {
      type: String,
      enum: ['FILE', 'FOLDER'],
      required: true,
    },
    resourceId: {
      type: Schema.Types.ObjectId,
      required: true,
      index: true,
    },
    permission: {
      type: String,
      enum: ['VIEW', 'DOWNLOAD', 'EDIT'],
      required: true,
      default: 'VIEW',
    },
    expiresAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Virtual alias 'userId' for recipientId
shareSchema.virtual('userId')
  .get(function (this: IShare) {
    return this.recipientId;
  })
  .set(function (this: IShare, val: Types.ObjectId) {
    this.recipientId = val;
  });

// Unique compound index: prevents multiple active shares for same recipient on same resource
shareSchema.index(
  { resourceType: 1, resourceId: 1, recipientId: 1 },
  { unique: true }
);

// Compound index for querying resources shared with a user
shareSchema.index({ recipientId: 1, resourceType: 1, createdAt: -1 });

// Compound index for querying shares of a resource by owner
shareSchema.index({ ownerId: 1, resourceType: 1, resourceId: 1 });

export const Share = mongoose.model<IShare>('Share', shareSchema);

