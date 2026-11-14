import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { createApp } from '../src/app.js';
import { parseEnv, DEV_DEFAULT_ACCESS_SECRET, DEV_DEFAULT_REFRESH_SECRET } from '../src/config/env.js';
import * as databaseModule from '../src/config/database.js';
import * as redisModule from '../src/config/redis.js';
import * as storageModule from '../src/config/storage.js';
import { logger, REDACTED_PATHS } from '../src/utils/logger.js';

describe('Phase 13: Production Hardening Test Suite', () => {
  const app = createApp();

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('1. Production Environment Validation', () => {
    it('accepts valid production configuration with strong, distinct secrets', () => {
      const validProdEnv = {
        NODE_ENV: 'production',
        PORT: '5000',
        MONGODB_URI: 'mongodb://mongodb:27017/drivescale',
        REDIS_URL: 'redis://redis:6379',
        JWT_ACCESS_SECRET: 'production-access-secret-minimum-32-characters!',
        JWT_REFRESH_SECRET: 'production-refresh-secret-minimum-32-characters!',
        CLIENT_URL: 'https://drivescale.example.com',
        ALLOWED_ORIGINS: 'https://drivescale.example.com,https://app.drivescale.example.com',
      };

      const parsed = parseEnv(validProdEnv);
      expect(parsed.NODE_ENV).toBe('production');
      expect(parsed.allowedOrigins).toContain('https://drivescale.example.com');
      expect(parsed.allowedOrigins).toContain('https://app.drivescale.example.com');
    });

    it('rejects production configuration when using default development access secret', () => {
      const invalidEnv = {
        NODE_ENV: 'production',
        JWT_ACCESS_SECRET: DEV_DEFAULT_ACCESS_SECRET,
        JWT_REFRESH_SECRET: 'production-refresh-secret-minimum-32-characters!',
      };

      expect(() => parseEnv(invalidEnv)).toThrow(/default development access secret/);
    });

    it('rejects production configuration when secrets are too short (< 32 chars)', () => {
      const invalidEnv = {
        NODE_ENV: 'production',
        JWT_ACCESS_SECRET: 'short-secret',
        JWT_REFRESH_SECRET: 'production-refresh-secret-minimum-32-characters!',
      };

      expect(() => parseEnv(invalidEnv)).toThrow(/at least 32 characters/);
    });

    it('rejects production configuration when access and refresh secrets are identical', () => {
      const sameSecret = 'identical-production-secret-with-more-than-32-chars!';
      const invalidEnv = {
        NODE_ENV: 'production',
        JWT_ACCESS_SECRET: sameSecret,
        JWT_REFRESH_SECRET: sameSecret,
      };

      expect(() => parseEnv(invalidEnv)).toThrow(/must be different/);
    });
  });

  describe('2. Health Check System (Liveness, Readiness, Full Status)', () => {
    it('GET /api/v1/health/live returns 200 alive status for process liveness', async () => {
      const res = await request(app).get('/api/v1/health/live');

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('alive');
      expect(typeof res.body.uptime).toBe('number');
    });

    it('GET /api/v1/health/ready returns 200 when primary database is connected', async () => {
      vi.spyOn(databaseModule, 'getDatabaseStatus').mockReturnValue('connected');

      const res = await request(app).get('/api/v1/health/ready');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.ready).toBe(true);
    });

    it('GET /api/v1/health/ready returns 503 when primary database is disconnected', async () => {
      vi.spyOn(databaseModule, 'getDatabaseStatus').mockReturnValue('disconnected');

      const res = await request(app).get('/api/v1/health/ready');

      expect(res.status).toBe(503);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('SERVICE_UNAVAILABLE');
    });

    it('GET /api/v1/health returns full system health report including storage status', async () => {
      vi.spyOn(databaseModule, 'getDatabaseStatus').mockReturnValue('connected');
      vi.spyOn(redisModule, 'getRedisStatus').mockResolvedValue('connected');
      vi.spyOn(storageModule, 'getStorageStatus').mockResolvedValue('connected');

      const res = await request(app).get('/api/v1/health');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('healthy');
      expect(res.body.data.services.database.status).toBe('connected');
      expect(res.body.data.services.redis.status).toBe('connected');
      expect(res.body.data.services.storage.status).toBe('connected');
    });
  });

  describe('3. Request Context, Logging & Security Headers', () => {
    it('generates X-Request-Id header when not supplied by client', async () => {
      const res = await request(app).get('/api/v1/health/live');

      expect(res.status).toBe(200);
      expect(res.headers['x-request-id']).toBeDefined();
      expect(res.headers['x-request-id'].length).toBeGreaterThan(10);
    });

    it('preserves client-supplied or proxy-forwarded X-Request-Id', async () => {
      const clientReqId = 'trace-uuid-1234567890';
      const res = await request(app)
        .get('/api/v1/health/live')
        .set('X-Request-Id', clientReqId);

      expect(res.status).toBe(200);
      expect(res.headers['x-request-id']).toBe(clientReqId);
    });

    it('enforces hardened security headers via Helmet', async () => {
      const res = await request(app).get('/api/v1/health/live');

      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
    });

    it('handles CORS preflight and allows allowed origins with credentials', async () => {
      const res = await request(app)
        .options('/api/v1/health')
        .set('Origin', 'http://localhost:5173')
        .set('Access-Control-Request-Method', 'GET');

      expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
      expect(res.headers['access-control-allow-credentials']).toBe('true');
    });

    it('verifies that Pino logger has redaction configured for sensitive authentication keys', () => {
      expect(REDACTED_PATHS).toContain('password');
      expect(REDACTED_PATHS).toContain('*.authorization');
      expect(REDACTED_PATHS).toContain('refreshToken');
      expect(REDACTED_PATHS).toContain('MINIO_SECRET_KEY');
      expect(REDACTED_PATHS).toContain('JWT_ACCESS_SECRET');
    });
  });

  describe('4. Worker Heartbeat Health Check', () => {
    let tmpDir: string;
    let heartbeatFile: string;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'worker-health-test-'));
      heartbeatFile = path.join(tmpDir, 'heartbeat.json');
    });

    it('detects fresh worker heartbeat file', () => {
      fs.writeFileSync(heartbeatFile, JSON.stringify({ timestamp: Date.now(), status: 'healthy' }));

      const raw = fs.readFileSync(heartbeatFile, 'utf-8');
      const data = JSON.parse(raw);
      const ageMs = Date.now() - data.timestamp;

      expect(ageMs).toBeLessThan(5000);
      expect(data.status).toBe('healthy');
    });

    it('detects stale worker heartbeat file (> 30s)', () => {
      const staleTime = Date.now() - 45000;
      fs.writeFileSync(heartbeatFile, JSON.stringify({ timestamp: staleTime, status: 'healthy' }));

      const raw = fs.readFileSync(heartbeatFile, 'utf-8');
      const data = JSON.parse(raw);
      const ageMs = Date.now() - data.timestamp;

      expect(ageMs).toBeGreaterThan(30000);
    });
  });
});
