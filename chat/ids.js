import { badRequest } from '../utils/http.js';

// Matrix-style identifiers expected by the client crypto library:
// users are "@<mongo id>:<server name>", conversations are "!<mongo id>:<server name>".
export const serverName = () => process.env.CHAT_SERVER_NAME || 'pinclone.local';

export const toMatrixUserId = (userId) => `@${userId}:${serverName()}`;
export const toRoomId = (conversationId) => `!${conversationId}:${serverName()}`;

export const fromMatrixUserId = (matrixId) => {
  const match = /^@([a-f\d]{24}):(.+)$/i.exec(String(matrixId));
  if (!match || match[2] !== serverName()) throw badRequest('Invalid user id');
  return match[1].toLowerCase();
};

const DEVICE_ID = /^[A-Za-z0-9_-]{4,64}$/;
export const isDeviceId = (value) => typeof value === 'string' && DEVICE_ID.test(value);
export const requireDeviceId = (value) => {
  if (!isDeviceId(value)) throw badRequest('Invalid device id');
  return value;
};
