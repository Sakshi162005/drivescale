import mongoose, { Schema, Document } from 'mongoose';
import { env } from '../config/env.js';

export interface IUser extends Document {
  name: string;
  email: string;
  passwordHash: string;
  avatar?: string;
  storageQuota: number;
  storageUsed: number;
  storageReserved: number;
  role: 'user' | 'admin';
  isVerified: boolean;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const userSchema = new Schema<IUser>(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      minlength: 2,
      maxlength: 100,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    passwordHash: {
      type: String,
      required: true,
      select: false, // Never return password hash by default
    },
    avatar: {
      type: String,
      default: '',
    },
    storageQuota: {
      type: Number,
      default: () => env.DEFAULT_STORAGE_QUOTA_BYTES,
      min: 0,
    },
    storageUsed: {
      type: Number,
      default: 0,
      min: 0,
    },
    storageReserved: {
      type: Number,
      default: 0,
      min: 0,
    },
    role: {
      type: String,
      enum: ['user', 'admin'],
      default: 'user',
    },
    isVerified: {
      type: Boolean,
      default: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
    toJSON: {
      transform(_doc, ret) {
        delete (ret as Record<string, unknown>)['__v'];
        delete (ret as Record<string, unknown>)['passwordHash'];
        return ret;
      },
    },
  }
);

export const User = mongoose.model<IUser>('User', userSchema);
