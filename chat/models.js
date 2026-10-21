import mongoose from 'mongoose';
import { getChatConnection } from './db.js';

const { Schema } = mongoose;
const conn = getChatConnection();

// Users are referenced by their main-database ObjectId (as a string) only.
// No names, emails or credentials are copied into the chat database.

// Monotonic sequence numbers (message order within a conversation, sync tokens)
const counterSchema = new Schema({ _id: String, seq: { type: Number, default: 0 } }, { versionKey: false });
export const Counter = conn.model('Counter', counterSchema, 'counters');

export const nextSeq = async (name) =>
  (await Counter.findOneAndUpdate({ _id: name }, { $inc: { seq: 1 } }, { new: true, upsert: true })).seq;

const conversationSchema = new Schema(
  {
    type: { type: String, enum: ['direct'], default: 'direct' },
    memberIds: { type: [String], required: true },
    // "<smallerId>:<largerId>" so a pair of users has exactly one direct conversation
    memberKey: { type: String, required: true },
    lastSeq: { type: Number, default: 0 },
    lastMessageAt: { type: Date, default: null },
  },
  { timestamps: true, versionKey: false }
);
conversationSchema.index({ memberKey: 1 }, { unique: true });
export const Conversation = conn.model('Conversation', conversationSchema, 'conversations');

// Per-member state; the read/delivered watermarks double as message receipts.
const memberSchema = new Schema(
  {
    conversationId: { type: Schema.Types.ObjectId, required: true },
    userId: { type: String, required: true },
    lastReadSeq: { type: Number, default: 0 },
    lastDeliveredSeq: { type: Number, default: 0 },
    lastMessageAt: { type: Date, default: null },
  },
  { timestamps: true, versionKey: false }
);
memberSchema.index({ conversationId: 1, userId: 1 }, { unique: true });
memberSchema.index({ userId: 1, lastMessageAt: -1 });
export const ConversationMember = conn.model('ConversationMember', memberSchema, 'conversation_members');

// Megolm-encrypted room events. The server only ever sees ciphertext.
const encryptedContentSchema = new Schema(
  {
    algorithm: { type: String, required: true },
    ciphertext: { type: String, required: true },
    session_id: { type: String, required: true },
    sender_key: String,
    device_id: String,
  },
  { _id: false, strict: 'throw' }
);
const messageSchema = new Schema(
  {
    conversationId: { type: Schema.Types.ObjectId, required: true },
    seq: { type: Number, required: true },
    senderId: { type: String, required: true },
    senderDeviceId: { type: String, required: true },
    clientMessageId: { type: String, required: true },
    content: { type: encryptedContentSchema, default: null },
    attachmentIds: { type: [String], default: [] },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true, versionKey: false }
);
messageSchema.index({ conversationId: 1, seq: -1 }, { unique: true });
messageSchema.index({ senderId: 1, clientMessageId: 1 }, { unique: true });
export const EncryptedMessage = conn.model('EncryptedMessage', messageSchema, 'encrypted_messages');

// Encrypted media stored in object storage. Only opaque identifiers live here;
// the decryption key travels inside the encrypted message.
const attachmentSchema = new Schema(
  {
    _id: { type: String },
    conversationId: { type: Schema.Types.ObjectId, required: true },
    uploaderId: { type: String, required: true },
    storageFileId: { type: String, required: true },
    storagePath: { type: String, required: true },
    size: { type: Number, required: true },
    messageId: { type: Schema.Types.ObjectId, default: null },
  },
  { timestamps: true, versionKey: false }
);
attachmentSchema.index({ conversationId: 1 });
export const Attachment = conn.model('Attachment', attachmentSchema, 'attachments');

const settingsSchema = new Schema(
  {
    userId: { type: String, required: true },
    showPresence: { type: Boolean, default: true },
    sendReadReceipts: { type: Boolean, default: true },
  },
  { timestamps: true, versionKey: false }
);
settingsSchema.index({ userId: 1 }, { unique: true });
export const UserChatSettings = conn.model('UserChatSettings', settingsSchema, 'user_chat_settings');

// ─── Device key directory (public keys only) ─────────────────────────────────
const deviceSchema = new Schema(
  {
    userId: { type: String, required: true },
    deviceId: { type: String, required: true },
    // Signed Matrix device_keys object: public curve25519 + ed25519 keys
    deviceKeys: { type: Schema.Types.Mixed, default: null },
    displayName: { type: String, default: null },
    lastSeenAt: { type: Date, default: Date.now },
  },
  { timestamps: true, versionKey: false }
);
deviceSchema.index({ userId: 1, deviceId: 1 }, { unique: true });
export const DeviceKey = conn.model('DeviceKey', deviceSchema, 'device_keys');

const oneTimeKeySchema = new Schema(
  {
    userId: { type: String, required: true },
    deviceId: { type: String, required: true },
    keyId: { type: String, required: true },
    key: { type: Schema.Types.Mixed, required: true },
    fallback: { type: Boolean, default: false },
    used: { type: Boolean, default: false },
  },
  { timestamps: true, versionKey: false }
);
oneTimeKeySchema.index({ userId: 1, deviceId: 1, fallback: 1, keyId: 1 }, { unique: true });
export const OneTimeKey = conn.model('OneTimeKey', oneTimeKeySchema, 'one_time_keys');

export const TO_DEVICE_TTL_SECONDS = 30 * 24 * 60 * 60;

// Olm-encrypted to-device messages (room keys) waiting for a recipient device.
const toDeviceSchema = new Schema(
  {
    recipientId: { type: String, required: true },
    recipientDeviceId: { type: String, required: true },
    seq: { type: Number, required: true },
    senderId: { type: String, required: true },
    senderDeviceId: { type: String, required: true },
    txnId: { type: String, required: true },
    type: { type: String, required: true },
    content: { type: Schema.Types.Mixed, required: true },
  },
  { timestamps: true, versionKey: false }
);
toDeviceSchema.index({ recipientId: 1, recipientDeviceId: 1, seq: 1 });
toDeviceSchema.index({ senderId: 1, senderDeviceId: 1, txnId: 1, recipientId: 1, recipientDeviceId: 1 }, { unique: true });
// Undelivered key messages are temporary; expire them after 30 days
toDeviceSchema.index({ createdAt: 1 }, { expireAfterSeconds: TO_DEVICE_TTL_SECONDS });
export const ToDeviceMessage = conn.model('ToDeviceMessage', toDeviceSchema, 'to_device_messages');

// Latest device-list change per user, used to tell partners to re-query keys
const deviceListSchema = new Schema({ userId: { type: String, required: true }, seq: { type: Number, required: true } }, { versionKey: false });
deviceListSchema.index({ userId: 1 }, { unique: true });
deviceListSchema.index({ seq: 1 });
export const DeviceListUpdate = conn.model('DeviceListUpdate', deviceListSchema, 'device_list_updates');
