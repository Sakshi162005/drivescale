import mongoose from 'mongoose';
import { env } from './env.js';
import { logger } from '../utils/logger.js';

let isConnected = false;

mongoose.connection.on('connected', () => {
  isConnected = true;
  logger.info('MongoDB connection established');
});

mongoose.connection.on('error', (err) => {
  isConnected = false;
  logger.error({ err }, 'MongoDB connection error');
});

mongoose.connection.on('disconnected', () => {
  isConnected = false;
  logger.warn('MongoDB disconnected');
});

export const isDatabaseConnected = (): boolean => {
  return isConnected && mongoose.connection.readyState === 1;
};

export const connectDatabase = async (): Promise<boolean> => {
  try {
    await mongoose.connect(env.MONGODB_URI, {
      serverSelectionTimeoutMS: 5000,
    });
    isConnected = true;
    return true;
  } catch (err) {
    isConnected = false;
    logger.error({ err }, 'Failed to connect to MongoDB');
    return false;
  }
};

export const disconnectDatabase = async (): Promise<void> => {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
    isConnected = false;
    logger.info('MongoDB disconnected gracefully');
  }
};

export type DatabaseStatus = 'connected' | 'connecting' | 'disconnecting' | 'disconnected';

export const getDatabaseStatus = (): DatabaseStatus => {
  const state = mongoose.connection.readyState;
  switch (state) {
    case 1:
      return 'connected';
    case 2:
      return 'connecting';
    case 3:
      return 'disconnecting';
    default:
      return 'disconnected';
  }
};
