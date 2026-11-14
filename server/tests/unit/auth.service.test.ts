import { describe, it, expect, vi, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { AuthService } from '../../src/services/auth.service.js';
import { User } from '../../src/models/User.js';
import { RefreshToken } from '../../src/models/RefreshToken.js';
import * as hashUtils from '../../src/utils/hash.js';
import * as jwtUtils from '../../src/utils/jwt.js';
import { ConflictError, UnauthorizedError } from '../../src/utils/errors.js';

describe('AuthService Unit Tests', () => {
  let authService: AuthService;

  const mockUserId = new mongoose.Types.ObjectId().toString();
  const mockUser = {
    _id: new mongoose.Types.ObjectId(mockUserId),
    name: 'Alice Developer',
    email: 'alice@example.com',
    passwordHash: '$argon2id$v=19$m=65536,t=3,p=4$fakeHashString',
    role: 'user',
    isActive: true,
    set: vi.fn(),
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    authService = new AuthService();
  });

  describe('1. Registration Flow', () => {
    it('successfully registers a new user with hashed password and tokens', async () => {
      vi.spyOn(User, 'findOne').mockResolvedValue(null);
      vi.spyOn(hashUtils, 'hashPassword').mockResolvedValue('hashed_argon2_password');
      vi.spyOn(User, 'create').mockResolvedValue({
        ...mockUser,
        passwordHash: 'hashed_argon2_password',
      } as any);
      vi.spyOn(jwtUtils, 'signAccessToken').mockReturnValue('mock-access-token');
      vi.spyOn(jwtUtils, 'signRefreshToken').mockReturnValue('mock-refresh-token');
      vi.spyOn(RefreshToken, 'create').mockResolvedValue({} as any);

      const result = await authService.register({
        name: 'Alice Developer',
        email: 'alice@example.com',
        password: 'ValidSecurePassword123!',
      });

      expect(User.findOne).toHaveBeenCalledWith({ email: 'alice@example.com' });
      expect(hashUtils.hashPassword).toHaveBeenCalledWith('ValidSecurePassword123!');
      expect(User.create).toHaveBeenCalledWith({
        name: 'Alice Developer',
        email: 'alice@example.com',
        passwordHash: 'hashed_argon2_password',
      });
      expect(result.accessToken).toBe('mock-access-token');
      expect(result.refreshToken).toBe('mock-refresh-token');
      expect(result.user.name).toBe('Alice Developer');
    });

    it('rejects registration when email already exists (ConflictError)', async () => {
      vi.spyOn(User, 'findOne').mockResolvedValue(mockUser as any);

      await expect(
        authService.register({
          name: 'Alice Duplicate',
          email: 'alice@example.com',
          password: 'ValidSecurePassword123!',
        })
      ).rejects.toThrow(ConflictError);
    });
  });

  describe('2. Login Flow', () => {
    it('successfully authenticates with valid credentials and strips password hash', async () => {
      const mockQuery = {
        select: vi.fn().mockResolvedValue(mockUser),
      };
      vi.spyOn(User, 'findOne').mockReturnValue(mockQuery as any);
      vi.spyOn(hashUtils, 'verifyPassword').mockResolvedValue(true);
      vi.spyOn(jwtUtils, 'signAccessToken').mockReturnValue('new-access-token');
      vi.spyOn(jwtUtils, 'signRefreshToken').mockReturnValue('new-refresh-token');
      vi.spyOn(RefreshToken, 'create').mockResolvedValue({} as any);

      const result = await authService.login({
        email: 'alice@example.com',
        password: 'ValidSecurePassword123!',
      });

      expect(result.accessToken).toBe('new-access-token');
      expect(result.refreshToken).toBe('new-refresh-token');
      expect(mockUser.set).toHaveBeenCalledWith('passwordHash', undefined);
    });

    it('rejects login when user is not found', async () => {
      const mockQuery = {
        select: vi.fn().mockResolvedValue(null),
      };
      vi.spyOn(User, 'findOne').mockReturnValue(mockQuery as any);

      await expect(
        authService.login({
          email: 'unknown@example.com',
          password: 'Password123!',
        })
      ).rejects.toThrow(UnauthorizedError);
    });

    it('rejects login when password does not match', async () => {
      const mockQuery = {
        select: vi.fn().mockResolvedValue(mockUser),
      };
      vi.spyOn(User, 'findOne').mockReturnValue(mockQuery as any);
      vi.spyOn(hashUtils, 'verifyPassword').mockResolvedValue(false);

      await expect(
        authService.login({
          email: 'alice@example.com',
          password: 'WrongPassword!',
        })
      ).rejects.toThrow(UnauthorizedError);
    });

    it('rejects login when user is deactivated (isActive: false)', async () => {
      const deactivatedUser = { ...mockUser, isActive: false };
      const mockQuery = {
        select: vi.fn().mockResolvedValue(deactivatedUser),
      };
      vi.spyOn(User, 'findOne').mockReturnValue(mockQuery as any);

      await expect(
        authService.login({
          email: 'alice@example.com',
          password: 'Password123!',
        })
      ).rejects.toThrow(UnauthorizedError);
    });
  });

  describe('3. Refresh Token & Session Rotation Flow', () => {
    it('rejects refresh when token is empty or missing', async () => {
      await expect(authService.refreshToken('')).rejects.toThrow(UnauthorizedError);
    });

    it('rejects refresh when token signature is invalid or expired', async () => {
      vi.spyOn(jwtUtils, 'verifyRefreshToken').mockImplementation(() => {
        throw new Error('jwt expired');
      });

      await expect(authService.refreshToken('invalid-jwt-token')).rejects.toThrow(UnauthorizedError);
    });

    it('detects refresh token reuse and revokes all sessions for that user', async () => {
      vi.spyOn(jwtUtils, 'verifyRefreshToken').mockReturnValue({
        userId: mockUserId,
        email: 'alice@example.com',
        role: 'user',
      });

      const revokedTokenDoc = {
        userId: mockUserId,
        token: 'compromised-token',
        revoked: true,
      };
      vi.spyOn(RefreshToken, 'findOne').mockResolvedValue(revokedTokenDoc as any);
      vi.spyOn(RefreshToken, 'updateMany').mockResolvedValue({} as any);

      await expect(authService.refreshToken('compromised-token')).rejects.toThrow(
        /Refresh token was already used or revoked/
      );
      expect(RefreshToken.updateMany).toHaveBeenCalledWith({ userId: mockUserId }, { revoked: true });
    });

    it('rejects refresh when stored token has expired', async () => {
      vi.spyOn(jwtUtils, 'verifyRefreshToken').mockReturnValue({
        userId: mockUserId,
        email: 'alice@example.com',
        role: 'user',
      });

      const expiredTokenDoc = {
        userId: mockUserId,
        token: 'expired-token',
        revoked: false,
        expiresAt: new Date(Date.now() - 3600000), // 1 hour ago
        save: vi.fn().mockResolvedValue(true),
      };
      vi.spyOn(RefreshToken, 'findOne').mockResolvedValue(expiredTokenDoc as any);

      await expect(authService.refreshToken('expired-token')).rejects.toThrow(
        /Refresh token has expired/
      );
      expect(expiredTokenDoc.revoked).toBe(true);
      expect(expiredTokenDoc.save).toHaveBeenCalled();
    });

    it('successfully rotates refresh token and returns new token pair', async () => {
      vi.spyOn(jwtUtils, 'verifyRefreshToken').mockReturnValue({
        userId: mockUserId,
        email: 'alice@example.com',
        role: 'user',
      });

      const activeTokenDoc = {
        userId: mockUserId,
        token: 'valid-refresh-token',
        revoked: false,
        expiresAt: new Date(Date.now() + 86400000), // 1 day in future
        replacedByToken: undefined as string | undefined,
        save: vi.fn().mockResolvedValue(true),
      };
      vi.spyOn(RefreshToken, 'findOne').mockResolvedValue(activeTokenDoc as any);
      vi.spyOn(User, 'findById').mockResolvedValue(mockUser as any);
      vi.spyOn(jwtUtils, 'signAccessToken').mockReturnValue('rotated-access-token');
      vi.spyOn(jwtUtils, 'signRefreshToken').mockReturnValue('rotated-refresh-token');
      vi.spyOn(RefreshToken, 'create').mockResolvedValue({} as any);

      const result = await authService.refreshToken('valid-refresh-token');

      expect(activeTokenDoc.revoked).toBe(true);
      expect(activeTokenDoc.replacedByToken).toBe('rotated-refresh-token');
      expect(activeTokenDoc.save).toHaveBeenCalled();
      expect(result.accessToken).toBe('rotated-access-token');
      expect(result.refreshToken).toBe('rotated-refresh-token');
    });
  });

  describe('4. Logout Flow', () => {
    it('revokes the refresh token upon logout', async () => {
      vi.spyOn(RefreshToken, 'findOneAndUpdate').mockResolvedValue({} as any);

      await authService.logout('token-to-revoke');

      expect(RefreshToken.findOneAndUpdate).toHaveBeenCalledWith(
        { token: 'token-to-revoke' },
        { revoked: true }
      );
    });

    it('handles empty logout token gracefully without error', async () => {
      vi.spyOn(RefreshToken, 'findOneAndUpdate');

      await authService.logout('');

      expect(RefreshToken.findOneAndUpdate).not.toHaveBeenCalled();
    });
  });
});

