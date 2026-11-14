import pino from 'pino';

const isDevelopment = process.env['NODE_ENV'] !== 'production';

export const REDACTED_PATHS = [
  'req.headers.authorization',
  'headers.authorization',
  'authorization',
  '*.authorization',
  'password',
  '*.password',
  'passwordHash',
  '*.passwordHash',
  'token',
  '*.token',
  'accessToken',
  '*.accessToken',
  'refreshToken',
  '*.refreshToken',
  'MINIO_SECRET_KEY',
  '*.MINIO_SECRET_KEY',
  'MINIO_ACCESS_KEY',
  '*.MINIO_ACCESS_KEY',
  'JWT_ACCESS_SECRET',
  '*.JWT_ACCESS_SECRET',
  'JWT_REFRESH_SECRET',
  '*.JWT_REFRESH_SECRET',
];

export const logger = pino({
  level: process.env['LOG_LEVEL'] || (isDevelopment ? 'debug' : 'info'),
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: REDACTED_PATHS,
    censor: '[REDACTED]',
  },
  transport: isDevelopment
    ? {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'HH:MM:ss Z',
          ignore: 'pid,hostname',
        },
      }
    : undefined,
});
