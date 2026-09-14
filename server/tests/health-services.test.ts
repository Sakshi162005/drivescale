import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import * as databaseModule from '../src/config/database.js';
import * as redisModule from '../src/config/redis.js';

describe('Health Service State Transitions', () => {
  const app = createApp();

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns "healthy" when both MongoDB and Redis are connected', async () => {
    vi.spyOn(databaseModule, 'getDatabaseStatus').mockReturnValue('connected');
    vi.spyOn(redisModule, 'getRedisStatus').mockResolvedValue('connected');

    const res = await request(app).get('/api/v1/health');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('healthy');
    expect(res.body.data.services.database.status).toBe('connected');
    expect(res.body.data.services.redis.status).toBe('connected');
  });

  it('returns "degraded" when MongoDB is connected but Redis is disconnected', async () => {
    vi.spyOn(databaseModule, 'getDatabaseStatus').mockReturnValue('connected');
    vi.spyOn(redisModule, 'getRedisStatus').mockResolvedValue('disconnected');

    const res = await request(app).get('/api/v1/health');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('degraded');
    expect(res.body.data.services.database.status).toBe('connected');
    expect(res.body.data.services.redis.status).toBe('disconnected');
  });

  it('returns "degraded" when Redis is connected but MongoDB is disconnected', async () => {
    vi.spyOn(databaseModule, 'getDatabaseStatus').mockReturnValue('disconnected');
    vi.spyOn(redisModule, 'getRedisStatus').mockResolvedValue('connected');

    const res = await request(app).get('/api/v1/health');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('degraded');
    expect(res.body.data.services.database.status).toBe('disconnected');
    expect(res.body.data.services.redis.status).toBe('connected');
  });

  it('returns "unhealthy" when both MongoDB and Redis are disconnected', async () => {
    vi.spyOn(databaseModule, 'getDatabaseStatus').mockReturnValue('disconnected');
    vi.spyOn(redisModule, 'getRedisStatus').mockResolvedValue('disconnected');

    const res = await request(app).get('/api/v1/health');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('unhealthy');
    expect(res.body.data.services.database.status).toBe('disconnected');
    expect(res.body.data.services.redis.status).toBe('disconnected');
  });
});
