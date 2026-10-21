import mongoose from 'mongoose';
import User from '../schema/userSchema.js';
import { profileImagesServ } from '../services/user.js';
import { badRequest, forbidden, notFound } from '../utils/http.js';
import { Attachment, Conversation, ConversationMember, EncryptedMessage, UserChatSettings } from './models.js';
import { toMatrixUserId, toRoomId } from './ids.js';

const MAX_CIPHERTEXT_LENGTH = 64 * 1024;
const ENCRYPTED_KEYS = new Set(['algorithm', 'ciphertext', 'session_id', 'sender_key', 'device_id']);

export const getSettings = async (userId) =>
  (await UserChatSettings.findOne({ userId }).lean()) ?? { userId, showPresence: true, sendReadReceipts: true };

export const updateSettings = (userId, patch) =>
  UserChatSettings.findOneAndUpdate({ userId }, { $set: patch }, { new: true, upsert: true }).lean();

// Users may chat unless either side blocked the other or the partner is restricted.
// (`userblock` on a user lists the ids of people who blocked them.)
export const assertCanChat = async (me, otherId) => {
  if (me._id.toString() === otherId) throw badRequest("You can't start a chat with yourself");
  const other = await User.findById(otherId, 'fullname adminblock userblock role');
  if (!other || other.adminblock) throw notFound('This person is not available to chat');
  const myId = me._id.toString();
  if (other.userblock.includes(myId) || me.userblock.includes(otherId)) {
    throw forbidden("You can't message this person because one of you has blocked the other");
  }
  return other;
};

const memberKey = (a, b) => [a, b].sort().join(':');

export const getOrCreateDirect = async (me, otherId) => {
  await assertCanChat(me, otherId);
  const myId = me._id.toString();
  const key = memberKey(myId, otherId);
  let conversation = await Conversation.findOne({ memberKey: key });
  if (!conversation) {
    try {
      conversation = await Conversation.create({ memberIds: [myId, otherId].sort(), memberKey: key });
    } catch (error) {
      if (error?.code !== 11000) throw error;
      conversation = await Conversation.findOne({ memberKey: key });
    }
    await ConversationMember.bulkWrite(
      [myId, otherId].map((userId) => ({
        updateOne: { filter: { conversationId: conversation._id, userId }, update: { $setOnInsert: { userId } }, upsert: true },
      }))
    );
  }
  return conversation;
};

// Loads a conversation the user belongs to. Non-members get 404 so ids can't be probed.
export const loadMemberConversation = async (conversationId, userId) => {
  if (!mongoose.isValidObjectId(conversationId)) throw badRequest('Invalid conversation id');
  const member = await ConversationMember.findOne({ conversationId, userId: String(userId) });
  if (!member) throw notFound('Conversation not found');
  const conversation = await Conversation.findById(conversationId);
  if (!conversation) throw notFound('Conversation not found');
  return { conversation, member };
};

export const partnerId = (conversation, userId) => conversation.memberIds.find((id) => id !== String(userId));

export const toEvent = (message) => ({
  _id: String(message._id),
  event_id: `$${message._id}`,
  conversationId: String(message.conversationId),
  room_id: toRoomId(message.conversationId),
  seq: message.seq,
  sender: toMatrixUserId(message.senderId),
  senderId: message.senderId,
  senderDeviceId: message.senderDeviceId,
  clientMessageId: message.clientMessageId,
  origin_server_ts: new Date(message.createdAt).getTime(),
  type: 'm.room.encrypted',
  content: message.deletedAt ? null : message.content,
  attachmentIds: message.deletedAt ? [] : message.attachmentIds,
  deleted: Boolean(message.deletedAt),
});

const publicPeople = async (ids) => {
  const users = await User.find({ _id: { $in: ids } }, 'fullname adminblock').lean();
  const images = await profileImagesServ(ids);
  return new Map(users.map((u) => [String(u._id), { _id: String(u._id), fullname: u.fullname, image: images.get(String(u._id)) || null, matrixId: toMatrixUserId(String(u._id)) }]));
};

const unreadCount = (conversationId, userId, afterSeq) =>
  EncryptedMessage.countDocuments({ conversationId, seq: { $gt: afterSeq }, senderId: { $ne: String(userId) }, deletedAt: null });

export const listConversations = async (userId, { isOnline } = {}) => {
  const memberships = await ConversationMember.find({ userId: String(userId) }).sort({ lastMessageAt: -1, updatedAt: -1 }).limit(100).lean();
  const conversations = await Conversation.find({ _id: { $in: memberships.map((m) => m.conversationId) } }).lean();
  const byId = new Map(conversations.map((c) => [String(c._id), c]));
  const partnerIds = conversations.map((c) => partnerId(c, userId)).filter(Boolean);
  const people = await publicPeople(partnerIds);
  const partnerMembers = await ConversationMember.find({ conversationId: { $in: [...byId.keys()] }, userId: { $in: partnerIds } }).lean();
  const partnerState = new Map(partnerMembers.map((m) => [String(m.conversationId), m]));
  const partnerSettings = new Map((await UserChatSettings.find({ userId: { $in: partnerIds } }).lean()).map((s) => [s.userId, s]));

  const result = [];
  for (const membership of memberships) {
    const conversation = byId.get(String(membership.conversationId));
    if (!conversation) continue;
    const otherId = partnerId(conversation, userId);
    const partner = people.get(otherId);
    if (!partner) continue;
    const last = await EncryptedMessage.findOne({ conversationId: conversation._id }).sort({ seq: -1 }).lean();
    const settings = partnerSettings.get(otherId);
    const receipts = settings?.sendReadReceipts === false ? null : partnerState.get(String(conversation._id));
    result.push({
      _id: String(conversation._id),
      roomId: toRoomId(conversation._id),
      partner: { ...partner, online: settings?.showPresence === false ? null : Boolean(isOnline?.(otherId)) },
      lastMessage: last ? toEvent(last) : null,
      lastMessageAt: conversation.lastMessageAt,
      unread: await unreadCount(conversation._id, userId, membership.lastReadSeq),
      partnerReadSeq: receipts?.lastReadSeq ?? 0,
      partnerDeliveredSeq: receipts?.lastDeliveredSeq ?? 0,
    });
  }
  return result;
};

export const conversationSummary = async (conversation, userId, opts) =>
  (await listConversations(userId, opts)).find((c) => c._id === String(conversation._id));

export const listMessages = async (conversationId, { before, limit = 30 }) => {
  const filter = { conversationId };
  if (before) filter.seq = { $lt: before };
  const docs = await EncryptedMessage.find(filter).sort({ seq: -1 }).limit(Math.min(limit, 100) + 1).lean();
  const hasMore = docs.length > limit;
  return { messages: docs.slice(0, limit).reverse().map(toEvent), hasMore };
};

// Only a Megolm ciphertext envelope is accepted, so plaintext can never be stored by mistake.
export const validateEncryptedContent = (content) => {
  if (!content || typeof content !== 'object' || Array.isArray(content)) throw badRequest('Encrypted content is required');
  for (const key of Object.keys(content)) if (!ENCRYPTED_KEYS.has(key)) throw badRequest(`Unexpected field "${key}" in encrypted content`);
  if (content.algorithm !== 'm.megolm.v1.aes-sha2') throw badRequest('Unsupported encryption algorithm');
  if (typeof content.ciphertext !== 'string' || !content.ciphertext || content.ciphertext.length > MAX_CIPHERTEXT_LENGTH) {
    throw badRequest('Invalid ciphertext');
  }
  if (typeof content.session_id !== 'string' || !content.session_id) throw badRequest('Invalid session id');
  return content;
};

export const sendMessage = async ({ conversation, userId, deviceId, clientMessageId, content, attachmentIds = [] }) => {
  const senderId = String(userId);
  const existing = await EncryptedMessage.findOne({ senderId, clientMessageId });
  if (existing) {
    if (String(existing.conversationId) !== String(conversation._id)) throw badRequest('Duplicate message id');
    return { message: existing, created: false };
  }

  if (attachmentIds.length) {
    const owned = await Attachment.countDocuments({
      _id: { $in: attachmentIds },
      conversationId: conversation._id,
      uploaderId: senderId,
      messageId: null,
    });
    if (owned !== attachmentIds.length) throw badRequest('Attachments must be uploaded to this conversation first');
  }

  const updated = await Conversation.findByIdAndUpdate(conversation._id, { $inc: { lastSeq: 1 }, $set: { lastMessageAt: new Date() } }, { new: true });
  let message;
  try {
    message = await EncryptedMessage.create({
      conversationId: conversation._id,
      seq: updated.lastSeq,
      senderId,
      senderDeviceId: deviceId,
      clientMessageId,
      content,
      attachmentIds,
    });
  } catch (error) {
    // Two identical retries raced: return the stored one
    if (error?.code === 11000) return { message: await EncryptedMessage.findOne({ senderId, clientMessageId }), created: false };
    throw error;
  }
  if (attachmentIds.length) await Attachment.updateMany({ _id: { $in: attachmentIds } }, { $set: { messageId: message._id } });
  await ConversationMember.updateMany({ conversationId: conversation._id }, { $set: { lastMessageAt: updated.lastMessageAt } });
  // The sender has obviously read their own message
  await ConversationMember.updateOne(
    { conversationId: conversation._id, userId: senderId },
    { $max: { lastReadSeq: message.seq, lastDeliveredSeq: message.seq } }
  );
  return { message, created: true };
};

export const updateReceipt = async (conversation, userId, { readSeq, deliveredSeq }) => {
  const update = {};
  const cap = (n) => Math.min(Math.max(0, Number(n) || 0), conversation.lastSeq);
  if (readSeq !== undefined) update.lastReadSeq = cap(readSeq);
  if (deliveredSeq !== undefined || readSeq !== undefined) update.lastDeliveredSeq = cap(deliveredSeq ?? readSeq);
  await ConversationMember.updateOne({ conversationId: conversation._id, userId: String(userId) }, { $max: update });
  return ConversationMember.findOne({ conversationId: conversation._id, userId: String(userId) }).lean();
};

export const deleteMessage = async (conversation, userId, messageId) => {
  if (!mongoose.isValidObjectId(messageId)) throw badRequest('Invalid message id');
  const message = await EncryptedMessage.findOne({ _id: messageId, conversationId: conversation._id });
  if (!message) throw notFound('Message not found');
  if (message.senderId !== String(userId)) throw forbidden('You can only delete your own messages');
  // The ciphertext is removed from the server; recipients replace it with "message deleted"
  message.content = null;
  message.deletedAt = new Date();
  const attachmentIds = message.attachmentIds;
  message.attachmentIds = [];
  await message.save();
  return { message, attachmentIds };
};
