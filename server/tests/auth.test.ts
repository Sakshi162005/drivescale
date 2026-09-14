import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { User } from '../src/models/User.js';
import { RefreshToken } from '../src/models/RefreshToken.js';
import { hashPassword, verifyPassword } from '../src/utils/hash.js';
import { signAccessToken, signRefreshToken, verifyAccessToken, verifyRefreshToken } from '../src/utils/jwt.js';

describe('Phase 1 Authentication Test Suite', () => {
  const app = createApp();

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('Argon2id Hashing & JWT Utilities', () => {
    it('hashes passwords using Argon2id format', async () => {
      const plaintext = 'SuperSecret123!';
      const hash = await hashPassword(plaintext);

      expect(hash).toBeDefined();
      expect(hash.startsWith('$argon2id$')).toBe(true);
      expect(hash).not.toContain(plaintext);

      const isValid = await verifyPassword(hash, plaintext);
      expect(isValid).toBe(true);

      const isInvalid = await verifyPassword(hash, 'WrongPassword456');
      expect(isInvalid).toBe(false);
    });

    it('signs and verifies access tokens correctly', () => {
      const payload = { userId: 'user123', email: 'test@drivescale.io', role: 'user' };
      const token = signAccessToken(payload);
      expect(token).toBeDefined();

      const verified = verifyAccessToken(token);
      expect(verified.userId).toBe(payload.userId);
      expect(verified.email).toBe(payload.email);
      expect(verified.role).toBe(payload.role);
    });

    it('signs and verifies refresh tokens correctly', () => {
      const payload = { userId: 'user456', email: 'refresh@drivescale.io', role: 'user' };
      const token = signRefreshToken(payload);
      expect(token).toBeDefined();

      const verified = verifyRefreshToken(token);
      expect(verified.userId).toBe(payload.userId);
      expect(verified.email).toBe(payload.email);
    });
  });

  describe('Validation Middleware', () => {
    it('rejects registration with invalid email format', async () => {
      const res = await request(app)
        .post('/api/v1/auth/register')
        .send({
          name: 'Alice',
          email: 'not-an-email',
          password: 'Password123',
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.message).toContain('Invalid email');
    });

    it('rejects registration with short password (< 8 chars)', async () => {
      const res = await request(app)
        .post('/api/v1/auth/register')
        .send({
          name: 'Alice',
          email: 'alice@example.com',
          password: 'short',
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('rejects login with missing password', async () => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: 'alice@example.com',
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('POST /api/v1/auth/register', () => {
    it('successfully registers a user and returns tokens & httpOnly cookie', async () => {
      vi.spyOn(User, 'findOne').mockResolvedValue(null);

      const fakeUser = {
        _id: { toString: () => 'mockUserId123' },
        name: 'John Doe',
        email: 'john@example.com',
        role: 'user',
        isActive: true,
        isVerified: true,
        storageQuota: 10737418240,
        storageUsed: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      vi.spyOn(User, 'create').mockResolvedValue(fakeUser as any);
      vi.spyOn(RefreshToken, 'create').mockResolvedValue({} as any);

      const res = await request(app)
        .post('/api/v1/auth/register')
        .send({
          name: 'John Doe',
          email: 'john@example.com',
          password: 'Password123',
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.user.name).toBe('John Doe');
      expect(res.body.data.user.email).toBe('john@example.com');
      expect(res.body.data.user.passwordHash).toBeUndefined();
      expect(res.body.data.accessToken).toBeDefined();
      expect(res.headers['set-cookie']).toBeDefined();
      expect(res.headers['set-cookie'][0]).toContain('refreshToken=');
      expect(res.headers['set-cookie'][0]).toContain('HttpOnly');
    });

    it('rejects registration when email is already registered (409 Conflict)', async () => {
      vi.spyOn(User, 'findOne').mockResolvedValue({ email: 'taken@example.com' } as any);

      const res = await request(app)
        .post('/api/v1/auth/register')
        .send({
          name: 'Jane Doe',
          email: 'taken@example.com',
          password: 'Password123',
        });

      expect(res.status).toBe(409);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('EMAIL_ALREADY_EXISTS');
    });
  });

  describe('POST /api/v1/auth/login', () => {
    it('authenticates user with valid credentials and sets refresh cookie', async () => {
      const hashedPassword = await hashPassword('ValidPassword123');

      const fakeUser = {
        _id: { toString: () => 'mockUserIdLogin' },
        name: 'Login User',
        email: 'login@example.com',
        passwordHash: hashedPassword,
        role: 'user',
        isActive: true,
        set: vi.fn(),
      };

      vi.spyOn(User, 'findOne').mockReturnValue({
        select: vi.fn().mockResolvedValue(fakeUser),
      } as any);
      vi.spyOn(RefreshToken, 'create').mockResolvedValue({} as any);

      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: 'login@example.com',
          password: 'ValidPassword123',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.accessToken).toBeDefined();
      expect(res.headers['set-cookie']).toBeDefined();
      expect(res.headers['set-cookie'][0]).toContain('refreshToken=');
    });

    it('rejects login with incorrect password (401 Unauthorized)', async () => {
      const hashedPassword = await hashPassword('CorrectPassword123');

      const fakeUser = {
        email: 'wrong@example.com',
        passwordHash: hashedPassword,
        isActive: true,
      };

      vi.spyOn(User, 'findOne').mockReturnValue({
        select: vi.fn().mockResolvedValue(fakeUser),
      } as any);

      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: 'wrong@example.com',
          password: 'IncorrectPassword999',
        });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
    });

    it('rejects login for non-existent user', async () => {
      vi.spyOn(User, 'findOne').mockReturnValue({
        select: vi.fn().mockResolvedValue(null),
      } as any);

      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: 'unknown@example.com',
          password: 'SomePassword123',
        });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
    });
  });

  describe('GET /api/v1/auth/me (Protected Route)', () => {
    it('returns user profile when authenticated with valid Bearer token', async () => {
      const token = signAccessToken({ userId: 'mockIdMe', email: 'me@example.com', role: 'user' });

      vi.spyOn(User, 'findById').mockResolvedValue({
        _id: 'mockIdMe',
        name: 'Me User',
        email: 'me@example.com',
        isActive: true,
      } as any);

      const res = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.user.email).toBe('me@example.com');
    });

    it('rejects access when Authorization header is missing (401)', async () => {
      const res = await request(app).get('/api/v1/auth/me');

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('rejects access when Bearer token is invalid (401)', async () => {
      const res = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', 'Bearer invalid.token.value');

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });
  });

  describe('POST /api/v1/auth/refresh (Token Rotation & Reuse Detection)', () => {
    it('rotates refresh token and returns fresh token pair', async () => {
      const oldToken = signRefreshToken({ userId: 'userIdRotate', email: 'rotate@example.com', role: 'user' });

      const storedTokenMock = {
        userId: 'userIdRotate',
        token: oldToken,
        revoked: false,
        expiresAt: new Date(Date.now() + 100000),
        save: vi.fn().mockResolvedValue(true),
      };

      vi.spyOn(RefreshToken, 'findOne').mockResolvedValue(storedTokenMock as any);
      vi.spyOn(User, 'findById').mockResolvedValue({ _id: 'userIdRotate', email: 'rotate@example.com', isActive: true } as any);
      vi.spyOn(RefreshToken, 'create').mockResolvedValue({} as any);

      const res = await request(app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: oldToken });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.accessToken).toBeDefined();
      expect(storedTokenMock.revoked).toBe(true);
      expect(storedTokenMock.save).toHaveBeenCalled();
    });

    it('detects token reuse and invalidates all user sessions (401)', async () => {
      const reusedToken = signRefreshToken({ userId: 'userIdReuse', email: 'reuse@example.com', role: 'user' });

      const storedTokenMock = {
        userId: 'userIdReuse',
        token: reusedToken,
        revoked: true, // Already revoked token being reused!
      };

      vi.spyOn(RefreshToken, 'findOne').mockResolvedValue(storedTokenMock as any);
      const updateManySpy = vi.spyOn(RefreshToken, 'updateMany').mockResolvedValue({} as any);

      const res = await request(app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: reusedToken });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('TOKEN_REUSED');
      expect(updateManySpy).toHaveBeenCalledWith({ userId: 'userIdReuse' }, { revoked: true });
    });
  });

  describe('POST /api/v1/auth/logout', () => {
    it('revokes the refresh token and clears cookie', async () => {
      const token = 'sample-refresh-token';
      const findOneAndUpdateSpy = vi.spyOn(RefreshToken, 'findOneAndUpdate').mockResolvedValue({} as any);

      const res = await request(app)
        .post('/api/v1/auth/logout')
        .send({ refreshToken: token });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(findOneAndUpdateSpy).toHaveBeenCalledWith({ token }, { revoked: true });
      expect(res.headers['set-cookie']).toBeDefined();
    });
  });
});
