import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { z } from 'zod';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env from server dir or root workspace dir
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(5000),
  MONGODB_URI: z.string().default('mongodb://localhost:27017/drivescale'),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  REDIS_CACHE_TTL: z.coerce.number().default(300), // 5 minutes default cache TTL
  RATE_LIMIT_GENERAL_LIMIT: z.coerce.number().default(100), // 100 req/min
  RATE_LIMIT_GENERAL_WINDOW_MS: z.coerce.number().default(60000), // 1 minute
  RATE_LIMIT_AUTH_LIMIT: z.coerce.number().default(10), // 10 req/min for auth
  RATE_LIMIT_AUTH_WINDOW_MS: z.coerce.number().default(60000),
  RATE_LIMIT_UPLOAD_INIT_LIMIT: z.coerce.number().default(20), // 20 req/min for upload init
  RATE_LIMIT_UPLOAD_INIT_WINDOW_MS: z.coerce.number().default(60000),
  CLIENT_URL: z.string().default('http://localhost:5173'),
  LOG_LEVEL: z.string().optional().default('info'),
  JWT_ACCESS_SECRET: z.string().default('drivescale-development-access-secret-32-chars-min!'),
  JWT_REFRESH_SECRET: z.string().default('drivescale-development-refresh-secret-32-chars-min!'),
  ACCESS_TOKEN_EXPIRES_IN: z.string().default('15m'),
  REFRESH_TOKEN_EXPIRES_IN: z.string().default('7d'),
});

const parseEnv = () => {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    console.error('Invalid environment variables:', result.error.format());
    process.exit(1);
  }
  return result.data;
};

export const env = parseEnv();
export type Env = z.infer<typeof envSchema>;
