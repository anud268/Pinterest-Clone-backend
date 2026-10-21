import mongoose from 'mongoose';
import { badRequest } from './http.js';

export const isObjectId = (value) =>
  typeof value === 'string' && mongoose.Types.ObjectId.isValid(value) && /^[a-f\d]{24}$/i.test(value);

// Throws 400 unless `value` is a valid ObjectId string.
export const requireObjectId = (value, name = 'id') => {
  if (!isObjectId(value)) throw badRequest(`Invalid ${name}`);
  return value;
};

// Escape user input before it is used inside a RegExp / $regex.
export const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Trimmed string clipped to `max` characters; non-strings become ''.
export const cleanString = (value, max = 500) =>
  typeof value === 'string' ? value.trim().slice(0, max) : '';

export const isHttpUrl = (value) => {
  try {
    const { protocol } = new URL(value);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
};

// Tags have been stored in several shapes over time: proper arrays,
// JSON-stringified arrays nested inside arrays, and comma-joined strings.
// This flattens any of those into a clean, de-duplicated list.
export const normalizeTags = (input, limit = 20) => {
  const out = [];
  const visit = (value) => {
    if (value == null) return;
    if (Array.isArray(value)) return value.forEach(visit);
    const text = String(value).trim();
    if (!text) return;
    if (text.startsWith('[')) {
      try {
        return visit(JSON.parse(text));
      } catch {
        // fall through and treat it as plain text
      }
    }
    if (text.includes(',')) return text.split(',').forEach(visit);
    out.push(text.slice(0, 50));
  };
  visit(input);
  return [...new Set(out)].slice(0, limit);
};

export const parsePagination = (query, { defaultLimit = 30, maxLimit = 60 } = {}) => {
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  const limit = Math.min(maxLimit, Math.max(1, Number.parseInt(query.limit, 10) || defaultLimit));
  return { page, limit, skip: (page - 1) * limit };
};
