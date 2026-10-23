import jwt from 'jsonwebtoken';
import User from '../schema/userSchema.js';
import { forbidden, unauthorized } from '../utils/http.js';

export const TOKEN_COOKIE = 'token';
export const TOKEN_MAX_AGE_MS = 24 * 60 * 60 * 1000;

const isProduction = () => process.env.NODE_ENV === 'production';

const cookieOptions = () => ({
  httpOnly: true,
  secure: isProduction(),
  // Frontend and API are on different sites in production, so the cookie must be cross-site
  sameSite: isProduction() ? 'none' : 'lax',
  path: '/',
});

export const setAuthCookie = (res, user) => {
  const token = jwt.sign({ userId: String(user._id) }, process.env.SECRET_KEY, {
    expiresIn: Math.floor(TOKEN_MAX_AGE_MS / 1000),
  });
  res.cookie(TOKEN_COOKIE, token, { ...cookieOptions(), maxAge: TOKEN_MAX_AGE_MS });
};

export const clearAuthCookie = (res) => {
  res.clearCookie(TOKEN_COOKIE, cookieOptions());
};

// Resolves the signed-in user from the JWT cookie and attaches it as req.user.
export const requireAuth = async (req, res, next) => {
  const token = req.cookies?.[TOKEN_COOKIE];
  if (!token) throw unauthorized();

  let payload;
  try {
    payload = jwt.verify(token, process.env.SECRET_KEY);
  } catch {
    clearAuthCookie(res);
    throw unauthorized('Your session has expired. Please sign in again.');
  }

  const user = await User.findById(payload.userId);
  if (!user) {
    clearAuthCookie(res);
    throw unauthorized();
  }
  req.user = user;
  next();
};

// For actions that create or change content: admin-blocked accounts are read-only.
export const requireActive = (req, res, next) => {
  if (req.user?.adminblock) throw forbidden('Your account has been restricted by an administrator.');
  next();
};

export const requireAdmin = (req, res, next) => {
  if (req.user?.role !== 'admin') throw forbidden('Administrator access required');
  next();
};
