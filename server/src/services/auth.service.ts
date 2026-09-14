import jwt from 'jsonwebtoken';
import { User, IUser } from '../models/User.js';
import { RefreshToken } from '../models/RefreshToken.js';
import { hashPassword, verifyPassword } from '../utils/hash.js';
import { signAccessToken, signRefreshToken, verifyRefreshToken, TokenPayload } from '../utils/jwt.js';
import { RegisterInput, LoginInput } from '../schemas/auth.schema.js';
import { ConflictError, UnauthorizedError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

export interface AuthResult {
  user: IUser;
  accessToken: string;
  refreshToken: string;
}

export class AuthService {
  /**
   * Registers a new user with Argon2id password hashing and initial tokens
   */
  async register(input: RegisterInput): Promise<AuthResult> {
    const existingUser = await User.findOne({ email: input.email });
    if (existingUser) {
      throw new ConflictError('An account with this email already exists', 'EMAIL_ALREADY_EXISTS');
    }

    const passwordHash = await hashPassword(input.password);

    const user = await User.create({
      name: input.name,
      email: input.email,
      passwordHash,
    });

    const payload: TokenPayload = {
      userId: user._id.toString(),
      email: user.email,
      role: user.role,
    };

    const accessToken = signAccessToken(payload);
    const refreshToken = signRefreshToken(payload);

    await this.storeRefreshToken(user._id.toString(), refreshToken);

    logger.info({ userId: user._id, email: user.email }, 'User registered successfully');

    return { user, accessToken, refreshToken };
  }

  /**
   * Authenticates user credentials and issues tokens
   */
  async login(input: LoginInput): Promise<AuthResult> {
    const user = await User.findOne({ email: input.email }).select('+passwordHash');
    if (!user || !user.isActive) {
      throw new UnauthorizedError('Invalid email or password', 'INVALID_CREDENTIALS');
    }

    const isMatch = await verifyPassword(user.passwordHash, input.password);
    if (!isMatch) {
      throw new UnauthorizedError('Invalid email or password', 'INVALID_CREDENTIALS');
    }

    const payload: TokenPayload = {
      userId: user._id.toString(),
      email: user.email,
      role: user.role,
    };

    const accessToken = signAccessToken(payload);
    const refreshToken = signRefreshToken(payload);

    await this.storeRefreshToken(user._id.toString(), refreshToken);

    logger.info({ userId: user._id }, 'User logged in successfully');

    // Remove passwordHash from returned document
    user.set('passwordHash', undefined);

    return { user, accessToken, refreshToken };
  }

  /**
   * Rotates a refresh token and issues a fresh token pair.
   * Performs reuse detection: if a revoked token is used, invalidates all sessions.
   */
  async refreshToken(token: string): Promise<AuthResult> {
    if (!token) {
      throw new UnauthorizedError('Refresh token is required', 'REFRESH_TOKEN_REQUIRED');
    }

    let payload: TokenPayload;
    try {
      payload = verifyRefreshToken(token);
    } catch {
      throw new UnauthorizedError('Invalid or expired refresh token', 'INVALID_REFRESH_TOKEN');
    }

    const storedToken = await RefreshToken.findOne({ token });

    // REUSE DETECTION: If token was previously revoked
    if (storedToken && storedToken.revoked) {
      logger.warn(
        { userId: storedToken.userId },
        'Refresh token reuse detected! Revoking all sessions for security.'
      );
      // Invalidate all tokens for this user
      await RefreshToken.updateMany({ userId: storedToken.userId }, { revoked: true });
      throw new UnauthorizedError(
        'Refresh token was already used or revoked. All active sessions invalidated.',
        'TOKEN_REUSED'
      );
    }

    if (!storedToken) {
      throw new UnauthorizedError('Refresh token not found', 'INVALID_REFRESH_TOKEN');
    }

    if (storedToken.expiresAt < new Date()) {
      storedToken.revoked = true;
      await storedToken.save();
      throw new UnauthorizedError('Refresh token has expired', 'EXPIRED_REFRESH_TOKEN');
    }

    const user = await User.findById(payload.userId);
    if (!user || !user.isActive) {
      throw new UnauthorizedError('User account not found or inactive', 'USER_INACTIVE');
    }

    // Generate new token pair (ROTATION)
    const newPayload: TokenPayload = {
      userId: user._id.toString(),
      email: user.email,
      role: user.role,
    };

    const newAccessToken = signAccessToken(newPayload);
    const newRefreshToken = signRefreshToken(newPayload);

    // Invalidate current token and link to replacement
    storedToken.revoked = true;
    storedToken.replacedByToken = newRefreshToken;
    await storedToken.save();

    // Store new refresh token
    await this.storeRefreshToken(user._id.toString(), newRefreshToken);

    logger.info({ userId: user._id }, 'Session refreshed with token rotation');

    return { user, accessToken: newAccessToken, refreshToken: newRefreshToken };
  }

  /**
   * Revokes a refresh token on user logout
   */
  async logout(token: string): Promise<void> {
    if (token) {
      await RefreshToken.findOneAndUpdate({ token }, { revoked: true });
    }
  }

  /**
   * Stores a newly signed refresh token in the database
   */
  private async storeRefreshToken(userId: string, token: string): Promise<void> {
    const decoded = jwt.decode(token) as { exp?: number };
    const expiresAt = decoded?.exp ? new Date(decoded.exp * 1000) : new Date(Date.now() + 7 * 24 * 3600 * 1000);

    await RefreshToken.create({
      userId,
      token,
      expiresAt,
    });
  }
}

export const authService = new AuthService();
