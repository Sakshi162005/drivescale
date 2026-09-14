import { Request, Response, CookieOptions } from 'express';
import { authService } from '../services/auth.service.js';
import { sendSuccess } from '../utils/response.js';
import { env } from '../config/env.js';
import { AuthenticatedRequest } from '../middleware/auth.middleware.js';
import { asyncHandler } from '../utils/async.js';

const REFRESH_COOKIE_NAME = 'refreshToken';

const getCookieOptions = (): CookieOptions => ({
  httpOnly: true,
  secure: env.NODE_ENV === 'production',
  sameSite: 'lax',
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  path: '/api/v1/auth',
});

export const register = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const result = await authService.register(req.body);

  res.cookie(REFRESH_COOKIE_NAME, result.refreshToken, getCookieOptions());

  sendSuccess(
    res,
    {
      user: result.user,
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
    },
    201
  );
});

export const login = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const result = await authService.login(req.body);

  res.cookie(REFRESH_COOKIE_NAME, result.refreshToken, getCookieOptions());

  sendSuccess(
    res,
    {
      user: result.user,
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
    },
    200
  );
});

export const refresh = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  // Read token from cookie, fallback to request body
  const token = req.cookies?.[REFRESH_COOKIE_NAME] || req.body?.refreshToken;

  const result = await authService.refreshToken(token);

  res.cookie(REFRESH_COOKIE_NAME, result.refreshToken, getCookieOptions());

  sendSuccess(
    res,
    {
      user: result.user,
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
    },
    200
  );
});

export const logout = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const token = req.cookies?.[REFRESH_COOKIE_NAME] || req.body?.refreshToken;

  if (token) {
    await authService.logout(token);
  }

  res.clearCookie(REFRESH_COOKIE_NAME, {
    path: '/api/v1/auth',
  });

  sendSuccess(res, { message: 'Logged out successfully' }, 200);
});

export const getMe = asyncHandler(async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  sendSuccess(res, { user: req.user }, 200);
});
