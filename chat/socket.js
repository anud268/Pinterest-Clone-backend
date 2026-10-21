import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import User from '../schema/userSchema.js';
import { TOKEN_COOKIE } from '../middleware/auth.js';
import { ConversationMember } from './models.js';
import { contactIds } from './keys.service.js';
import { getSettings, partnerId, loadMemberConversation } from './chat.service.js';
import { isDeviceId } from './ids.js';

let io = null;
const online = new Map(); // userId -> number of connected sockets

export const isOnline = (userId) => (online.get(String(userId)) ?? 0) > 0;
export const emitToUser = (userId, event, data) => io?.to(`user:${userId}`).emit(event, data);
export const emitToDevice = (userId, deviceId, event, data) => io?.to(`device:${userId}:${deviceId}`).emit(event, data);

const readCookie = (header, name) => {
  for (const part of String(header ?? '').split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return null;
};

// Notify the user's contacts that their online status changed (unless they hide presence)
const broadcastPresence = async (userId, isNowOnline) => {
  const settings = await getSettings(userId);
  if (settings.showPresence === false) return;
  for (const contact of await contactIds(userId)) {
    if (contact !== userId) emitToUser(contact, 'presence', { userId, online: isNowOnline });
  }
};

// Small per-socket token bucket for client events
const limiter = (max, windowMs) => {
  let count = 0;
  let resetAt = Date.now() + windowMs;
  return () => {
    const now = Date.now();
    if (now > resetAt) {
      count = 0;
      resetAt = now + windowMs;
    }
    count += 1;
    return count <= max;
  };
};

export const initChatSocket = (httpServer, { origins }) => {
  io = new Server(httpServer, {
    path: '/socket.io',
    cors: { origin: origins, credentials: true },
    maxHttpBufferSize: 16 * 1024,
    serveClient: false,
  });

  // Same JWT cookie as the REST API; the user id is never taken from the client
  io.use(async (socket, next) => {
    try {
      const token = readCookie(socket.handshake.headers.cookie, TOKEN_COOKIE);
      if (!token) return next(new Error('unauthorized'));
      const payload = jwt.verify(token, process.env.SECRET_KEY);
      const user = await User.findById(payload.userId, 'adminblock');
      if (!user) return next(new Error('unauthorized'));
      socket.data.userId = String(user._id);
      const deviceId = socket.handshake.auth?.deviceId;
      socket.data.deviceId = isDeviceId(deviceId) ? deviceId : null;
      next();
    } catch {
      next(new Error('unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    const { userId, deviceId } = socket.data;
    socket.join(`user:${userId}`);
    if (deviceId) socket.join(`device:${userId}:${deviceId}`);

    const count = (online.get(userId) ?? 0) + 1;
    online.set(userId, count);
    if (count === 1) broadcastPresence(userId, true).catch(() => {});

    const allowTyping = limiter(30, 10_000);
    const memberOf = new Map(); // conversationId -> partner id (cached membership checks)

    const partnerFor = async (conversationId) => {
      if (typeof conversationId !== 'string') return null;
      if (memberOf.has(conversationId)) return memberOf.get(conversationId);
      try {
        const { conversation } = await loadMemberConversation(conversationId, userId);
        const partner = partnerId(conversation, userId);
        memberOf.set(conversationId, partner);
        return partner;
      } catch {
        return null;
      }
    };

    socket.on('typing', async (payload) => {
      if (!allowTyping() || typeof payload !== 'object' || payload === null) return;
      const partner = await partnerFor(payload.conversationId);
      if (partner) emitToUser(partner, 'typing', { conversationId: payload.conversationId, userId, typing: Boolean(payload.typing) });
    });

    // Lets a client ask for the current presence of its chat partners
    socket.on('presence:query', async (ack) => {
      if (typeof ack !== 'function') return;
      const memberships = await ConversationMember.find({ userId }, 'conversationId').lean();
      const partners = await ConversationMember.find(
        { conversationId: { $in: memberships.map((m) => m.conversationId) }, userId: { $ne: userId } },
        'userId'
      ).lean();
      const result = {};
      for (const { userId: id } of partners) {
        const settings = await getSettings(id);
        result[id] = settings.showPresence === false ? null : isOnline(id);
      }
      ack(result);
    });

    socket.on('disconnect', () => {
      const remaining = (online.get(userId) ?? 1) - 1;
      if (remaining <= 0) {
        online.delete(userId);
        broadcastPresence(userId, false).catch(() => {});
      } else online.set(userId, remaining);
    });
  });

  return io;
};

export const closeChatSocket = () => new Promise((resolve) => (io ? io.close(() => resolve()) : resolve()));
