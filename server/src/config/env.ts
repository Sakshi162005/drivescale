import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { z } from 'zod';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env from server dir or root workspace dir
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

export const DEV_DEFAULT_ACCESS_SECRET = 'drivescale-development-access-secret-32-chars-min!';
export const DEV_DEFAULT_REFRESH_SECRET = 'drivescale-development-refresh-secret-32-chars-min!';

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(5000),
    MONGODB_URI: z.string().min(1).default('mongodb://localhost:27017/drivescale'),
    REDIS_URL: z.string().min(1).default('redis://localhost:6379'),
    REDIS_CACHE_TTL: z.coerce.number().default(300), // 5 minutes default cache TTL
    RATE_LIMIT_GENERAL_LIMIT: z.coerce.number().default(100), // 100 req/min
    RATE_LIMIT_GENERAL_WINDOW_MS: z.coerce.number().default(60000), // 1 minute
    RATE_LIMIT_AUTH_LIMIT: z.coerce.number().default(10), // 10 req/min for auth
    RATE_LIMIT_AUTH_WINDOW_MS: z.coerce.number().default(60000),
    RATE_LIMIT_UPLOAD_INIT_LIMIT: z.coerce.number().default(20), // 20 req/min for upload init
    RATE_LIMIT_UPLOAD_INIT_WINDOW_MS: z.coerce.number().default(60000),
    // BullMQ & Background Worker configuration
    BULLMQ_CONCURRENCY: z.coerce.number().default(5),
    BULLMQ_MAX_RETRIES: z.coerce.number().default(3),
    BULLMQ_BACKOFF_DELAY_MS: z.coerce.number().default(2000),
    BULLMQ_COMPLETED_RETENTION_COUNT: z.coerce.number().default(100),
    BULLMQ_FAILED_RETENTION_COUNT: z.coerce.number().default(500),
    BULLMQ_FAILED_RETENTION_AGE_SECONDS: z.coerce.number().default(604800), // 7 days
    BULLMQ_CLEANUP_INTERVAL_MS: z.coerce.number().default(3600000), // 1 hour
    // Trash & Recovery configuration
    TRASH_RETENTION_DAYS: z.coerce.number().default(30),
    TRASH_CLEANUP_BATCH_SIZE: z.coerce.number().default(100),
    // Storage Quota configuration
    DEFAULT_STORAGE_QUOTA_BYTES: z.coerce.number().default(10 * 1024 * 1024 * 1024), // 10 GB default
    // MinIO Object Storage configuration
    MINIO_ENDPOINT: z.string().default('localhost'),
    MINIO_PORT: z.coerce.number().int().min(1).max(65535).default(9000),
    MINIO_USE_SSL: z
      .union([z.boolean(), z.string()])
      .default(false)
      .transform((val) => (typeof val === 'boolean' ? val : val === 'true' || val === '1')),
    MINIO_ACCESS_KEY: z.string().default('minioadmin'),
    MINIO_SECRET_KEY: z.string().default('minioadmin'),
    MINIO_BUCKET: z.string().default('drivescale'),
    // Storage Driver: 'minio' for self-hosted object store, 'local' for filesystem compatibility
    STORAGE_DRIVER: z.enum(['minio', 'local']).default('minio'),
    STORAGE_LOCAL_DIR: z.string().optional(),
    STORAGE_CHUNKS_DIR: z.string().optional(),
    CLIENT_URL: z.string().default('http://localhost:5173'),
    ALLOWED_ORIGINS: z.string().optional(),
    LOG_LEVEL: z.string().optional().default('info'),
    JWT_ACCESS_SECRET: z.string().default(DEV_DEFAULT_ACCESS_SECRET),
    JWT_REFRESH_SECRET: z.string().default(DEV_DEFAULT_REFRESH_SECRET),
    ACCESS_TOKEN_EXPIRES_IN: z.string().default('15m'),
    REFRESH_TOKEN_EXPIRES_IN: z.string().default('7d'),
  })
  .superRefine((data, ctx) => {
    if (data.NODE_ENV === 'production') {
      if (data.JWT_ACCESS_SECRET === DEV_DEFAULT_ACCESS_SECRET) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['JWT_ACCESS_SECRET'],
          message: 'Must not use the default development access secret in production mode',
        });
      }
      if (data.JWT_ACCESS_SECRET.length < 32) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['JWT_ACCESS_SECRET'],
          message: 'JWT_ACCESS_SECRET must be at least 32 characters in production',
        });
      }
      if (data.JWT_REFRESH_SECRET === DEV_DEFAULT_REFRESH_SECRET) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['JWT_REFRESH_SECRET'],
          message: 'Must not use the default development refresh secret in production mode',
        });
      }
      if (data.JWT_REFRESH_SECRET.length < 32) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['JWT_REFRESH_SECRET'],
          message: 'JWT_REFRESH_SECRET must be at least 32 characters in production',
        });
      }
      if (data.JWT_ACCESS_SECRET === data.JWT_REFRESH_SECRET) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['JWT_REFRESH_SECRET'],
          message: 'JWT_REFRESH_SECRET must be different from JWT_ACCESS_SECRET',
        });
      }
    }
  });

export interface ParsedEnv extends z.infer<typeof envSchema> {
  allowedOrigins: string[];
}

export const parseEnv = (customEnv: Record<string, unknown> = process.env): ParsedEnv => {
  const result = envSchema.safeParse(customEnv);
  if (!result.success) {
    const errorMessages = result.error.errors
      .map((e) => `  - ${e.path.join('.')}: ${e.message}`)
      .join('\n');
    console.error(`Invalid environment configuration:\n${errorMessages}`);
    if (process.env.NODE_ENV !== 'test') {
      process.exit(1);
    }
    throw new Error(`Invalid environment configuration:\n${errorMessages}`);
  }

  const parsed = result.data;
  const origins = parsed.ALLOWED_ORIGINS
    ? parsed.ALLOWED_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean)
    : [parsed.CLIENT_URL, 'http://localhost', 'http://localhost:80', 'http://localhost:5173', 'http://127.0.0.1:5173'];

  return {
    ...parsed,
    allowedOrigins: Array.from(new Set(origins)),
  };
};

export const env = parseEnv();
export type Env = ParsedEnv;
