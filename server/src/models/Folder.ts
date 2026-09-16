import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IFolder extends Document {
  name: string;
  ownerId: Types.ObjectId;
  parentId: Types.ObjectId | null;
  isDeleted: boolean;
  deletedAt: Date | null;
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

export const Folder = mongoose.model<IFolder>('Folder', folderSchema);
