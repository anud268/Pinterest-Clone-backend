import crypto from 'crypto';
import mongoose from 'mongoose';
import { badRequest, forbidden, HttpError, notFound } from '../utils/http.js';
import { cleanString, requireObjectId } from '../utils/validation.js';
import { FOLDERS, deleteFile, downloadPrivateBlob, uploadPrivateBlob } from '../services/imagekit.js';
import { Attachment, ConversationMember, DeviceKey, EncryptedMessage } from './models.js';
import * as keys from './keys.service.js';
import * as chat from './chat.service.js';
import { requireDeviceId } from './ids.js';
import { emitToDevice, emitToUser, isOnline } from './socket.js';

const myId = (req) => String(req.user._id);

// Device-scoped requests name the calling device in the X-Device-Id header.
export const withDevice = async (req, res, next) => {
  req.deviceId = requireDeviceId(req.get('x-device-id'));
  next();
};

// For endpoints that need a device whose keys are already registered.
export const registeredDevice = async (req, res, next) => {
  req.deviceId = requireDeviceId(req.get('x-device-id'));
  const device = await DeviceKey.exists({ userId: myId(req), deviceId: req.deviceId, deviceKeys: { $ne: null } });
  // 410 tells the client this device was removed and it must create a new one
  if (!device) throw new HttpError(410, 'This device is not registered for encrypted chat');
  next();
};

// ─── Keys ─────────────────────────────────────────────────────────────────────
export const keysUpload = async (req, res) => {
  res.json(await keys.uploadKeys(myId(req), req.deviceId, req.body ?? {}));
};

export const keysQuery = async (req, res) => {
  res.json(await keys.queryKeys(myId(req), req.body ?? {}));
};

export const keysClaim = async (req, res) => {
  res.json(await keys.claimKeys(myId(req), req.body ?? {}));
};

export const sendToDevice = async (req, res) => {
  const eventType = cleanString(req.params.eventType, 100);
  const txnId = cleanString(req.params.txnId, 100);
  if (!eventType || !txnId) throw badRequest('Invalid to-device request');
  const result = await keys.sendToDevice(myId(req), req.deviceId, eventType, txnId, req.body ?? {}, (userId, deviceId) =>
    emitToDevice(userId, deviceId, 'todevice', {})
  );
  res.json(result);
};

export const sync = async (req, res) => {
  const since = Math.max(0, Number.parseInt(req.body?.since, 10) || 0);
  const ack = (Array.isArray(req.body?.ack) ? req.body.ack : []).filter((id) => mongoose.isValidObjectId(id)).slice(0, 500);
  res.json(await keys.syncDevice(myId(req), req.deviceId, since, ack));
};

// ─── Devices ──────────────────────────────────────────────────────────────────
export const listDevices = async (req, res) => {
  const devices = await keys.listDevices(myId(req));
  res.json({ devices: devices.map((d) => ({ deviceId: d.deviceId, displayName: d.displayName, lastSeenAt: d.lastSeenAt, createdAt: d.createdAt })) });
};

export const renameDevice = async (req, res) => {
  const deviceId = requireDeviceId(req.params.deviceId);
  const displayName = cleanString(req.body?.displayName, 60) || null;
  const updated = await DeviceKey.findOneAndUpdate({ userId: myId(req), deviceId }, { $set: { displayName } }, { new: true });
  if (!updated) throw notFound('Device not found');
  await keys.markDeviceListChanged(myId(req));
  res.json({ device: { deviceId, displayName } });
};

export const removeDevice = async (req, res) => {
  const deviceId = requireDeviceId(req.params.deviceId);
  if (!(await keys.removeDevice(myId(req), deviceId))) throw notFound('Device not found');
  emitToDevice(myId(req), deviceId, 'device:removed', {});
  for (const contact of await keys.contactIds(myId(req))) emitToUser(contact, 'keys:changed', { userId: myId(req) });
  res.json({ message: 'Device signed out of encrypted chat' });
};

// ─── Conversations & messages ─────────────────────────────────────────────────
export const listConversations = async (req, res) => {
  res.json({ conversations: await chat.listConversations(myId(req), { isOnline }) });
};

export const unreadTotal = async (req, res) => {
  const conversations = await chat.listConversations(myId(req), { isOnline });
  res.json({ total: conversations.reduce((sum, c) => sum + c.unread, 0) });
};

export const openConversation = async (req, res) => {
  const otherId = requireObjectId(req.body?.userId, 'user id');
  const conversation = await chat.getOrCreateDirect(req.user, otherId);
  const summary = await chat.conversationSummary(conversation, myId(req), { isOnline });
  for (const id of conversation.memberIds) emitToUser(id, 'keys:changed', { userId: myId(req) });
  res.status(200).json({ conversation: summary });
};

export const getConversation = async (req, res) => {
  const { conversation } = await chat.loadMemberConversation(req.params.id, myId(req));
  res.json({ conversation: await chat.conversationSummary(conversation, myId(req), { isOnline }) });
};

export const listMessages = async (req, res) => {
  const { conversation } = await chat.loadMemberConversation(req.params.id, myId(req));
  const before = Number.parseInt(req.query.before, 10) || undefined;
  const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 30));
  res.json(await chat.listMessages(conversation._id, { before, limit }));
};

export const sendMessage = async (req, res) => {
  const { conversation } = await chat.loadMemberConversation(req.params.id, myId(req));
  const partner = chat.partnerId(conversation, myId(req));
  await chat.assertCanChat(req.user, partner);

  const clientMessageId = cleanString(req.body?.clientMessageId, 64);
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(clientMessageId)) throw badRequest('Invalid client message id');
  const content = chat.validateEncryptedContent(req.body?.content);
  if (content.device_id && content.device_id !== req.deviceId) throw forbidden('Message was encrypted by a different device');
  const attachmentIds = (Array.isArray(req.body?.attachmentIds) ? req.body.attachmentIds : [])
    .filter((id) => typeof id === 'string' && /^[a-f\d]{32}$/.test(id))
    .slice(0, 10);

  const { message, created } = await chat.sendMessage({
    conversation,
    userId: myId(req),
    deviceId: req.deviceId,
    clientMessageId,
    content,
    attachmentIds,
  });
  const event = chat.toEvent(message);
  if (created) for (const id of conversation.memberIds) emitToUser(id, 'message:new', { conversationId: event.conversationId, message: event });
  res.status(created ? 201 : 200).json({ message: event });
};

export const deleteMessage = async (req, res) => {
  const { conversation } = await chat.loadMemberConversation(req.params.id, myId(req));
  const { message, attachmentIds } = await chat.deleteMessage(conversation, myId(req), req.params.messageId);
  const attachments = await Attachment.find({ _id: { $in: attachmentIds } }).lean();
  await Attachment.deleteMany({ _id: { $in: attachmentIds } });
  attachments.forEach((a) => deleteFile(a.storageFileId));
  const event = chat.toEvent(message);
  for (const id of conversation.memberIds) emitToUser(id, 'message:deleted', { conversationId: event.conversationId, message: event });
  res.json({ message: event });
};

export const updateReceipts = async (req, res) => {
  const { conversation } = await chat.loadMemberConversation(req.params.id, myId(req));
  const member = await chat.updateReceipt(conversation, myId(req), {
    readSeq: req.body?.readSeq,
    deliveredSeq: req.body?.deliveredSeq,
  });
  const settings = await chat.getSettings(myId(req));
  const partner = chat.partnerId(conversation, myId(req));
  emitToUser(myId(req), 'receipt', { conversationId: String(conversation._id), userId: myId(req), readSeq: member.lastReadSeq, deliveredSeq: member.lastDeliveredSeq });
  if (settings.sendReadReceipts !== false) {
    emitToUser(partner, 'receipt', { conversationId: String(conversation._id), userId: myId(req), readSeq: member.lastReadSeq, deliveredSeq: member.lastDeliveredSeq });
  } else {
    // Delivery is still reported so the sender knows the message arrived
    emitToUser(partner, 'receipt', { conversationId: String(conversation._id), userId: myId(req), deliveredSeq: member.lastDeliveredSeq });
  }
  res.json({ readSeq: member.lastReadSeq, deliveredSeq: member.lastDeliveredSeq });
};

// ─── Encrypted attachments ────────────────────────────────────────────────────
export const uploadAttachment = async (req, res) => {
  if (!req.file?.buffer?.length) throw badRequest('No file received');
  const { conversation } = await chat.loadMemberConversation(req.body?.conversationId, myId(req));
  await chat.assertCanChat(req.user, chat.partnerId(conversation, myId(req)));

  const { fileId, filePath } = await uploadPrivateBlob(req.file.buffer, FOLDERS.chat);
  const attachment = await Attachment.create({
    _id: crypto.randomBytes(16).toString('hex'),
    conversationId: conversation._id,
    uploaderId: myId(req),
    storageFileId: fileId,
    storagePath: filePath,
    size: req.file.buffer.length,
  });
  res.status(201).json({ attachmentId: attachment._id, size: attachment.size });
};

export const downloadAttachment = async (req, res) => {
  const id = String(req.params.id);
  if (!/^[a-f\d]{32}$/.test(id)) throw badRequest('Invalid attachment id');
  const attachment = await Attachment.findById(id).lean();
  if (!attachment) throw notFound('Attachment not found');
  // Membership check: only people in the conversation can fetch the (encrypted) bytes
  const member = await ConversationMember.exists({ conversationId: attachment.conversationId, userId: myId(req) });
  if (!member) throw notFound('Attachment not found');
  if (attachment.messageId && !(await EncryptedMessage.exists({ _id: attachment.messageId, deletedAt: null }))) {
    throw notFound('Attachment not found');
  }

  const bytes = await downloadPrivateBlob(attachment.storagePath);
  res.set({
    'Content-Type': 'application/octet-stream',
    'Content-Length': String(bytes.length),
    'Cache-Control': 'private, no-store',
    'Content-Disposition': 'attachment',
  });
  res.send(bytes);
};

// ─── Settings ─────────────────────────────────────────────────────────────────
export const getSettings = async (req, res) => {
  const settings = await chat.getSettings(myId(req));
  res.json({ settings: { showPresence: settings.showPresence !== false, sendReadReceipts: settings.sendReadReceipts !== false } });
};

export const updateSettings = async (req, res) => {
  const patch = {};
  for (const key of ['showPresence', 'sendReadReceipts']) if (typeof req.body?.[key] === 'boolean') patch[key] = req.body[key];
  const settings = await chat.updateSettings(myId(req), patch);
  res.json({ settings: { showPresence: settings.showPresence !== false, sendReadReceipts: settings.sendReadReceipts !== false } });
};
