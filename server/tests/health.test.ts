import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';

describe('API v1 Health & Middleware Tests', () => {
  const app = createApp();

  it('GET /api/v1/health returns 200 with correct schema', async () => {
    const res = await request(app).get('/api/v1/health');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toBeDefined();
    expect(res.body.data.version).toBe('0.1.0');
    expect(typeof res.body.data.uptime).toBe('number');
    expect(typeof res.body.data.timestamp).toBe('string');
    expect(['healthy', 'degraded', 'unhealthy']).toContain(res.body.data.status);
    expect(res.body.data.services).toBeDefined();
    expect(res.body.data.services.database).toBeDefined();
    expect(res.body.data.services.redis).toBeDefined();
  });

  it('GET /api/v1/unknown-route returns 404 with structured error', async () => {
    const res = await request(app).get('/api/v1/unknown-route');

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toBeDefined();
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(res.body.error.message).toContain('/api/v1/unknown-route');
  });
});
