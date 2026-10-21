import { HttpError } from '../utils/http.js';

// Small fixed-window, per-IP limiter for sensitive endpoints (sign in, OTP).
// In-memory, so it is per process; enough for a single-instance deployment.
// `key` picks the bucket (default: client IP; e.g. `(req) => req.user._id` for per-user limits).
export const rateLimit = ({ windowMs, max, message = 'Too many attempts. Please try again later.', key: keyFn }) => {
  const hits = new Map();

  const timer = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of hits) if (entry.resetAt <= now) hits.delete(key);
  }, windowMs);
  timer.unref();

  return (req, res, next) => {
    const now = Date.now();
    const key = keyFn ? String(keyFn(req)) : req.ip;
    let entry = hits.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      hits.set(key, entry);
    }
    entry.count += 1;
    if (entry.count > max) {
      res.set('Retry-After', String(Math.ceil((entry.resetAt - now) / 1000)));
      throw new HttpError(429, message);
    }
    next();
  };
};
