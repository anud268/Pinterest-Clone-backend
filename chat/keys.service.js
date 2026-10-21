// Public-key directory and to-device message relay, in the shapes the Matrix
// crypto library expects (keys/upload, keys/query, keys/claim, sendToDevice, sync).
// The server only handles public keys and Olm ciphertext; it never sees private keys.
import { badRequest, forbidden, conflict } from '../utils/http.js';
import { DeviceKey, DeviceListUpdate, OneTimeKey, ToDeviceMessage, nextSeq, ConversationMember } from './models.js';
import { fromMatrixUserId, isDeviceId, toMatrixUserId } from './ids.js';

const MAX_ONE_TIME_KEYS = 100;
const MAX_TO_DEVICE_BATCH = 200;
const SYNC_LIMIT = 200;

const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// Users this user may exchange keys with: themself plus everyone they share a conversation with.
export const contactIds = async (userId) => {
  const mine = await ConversationMember.find({ userId }, 'conversationId').lean();
  const others = await ConversationMember.find(
    { conversationId: { $in: mine.map((m) => m.conversationId) }, userId: { $ne: userId } },
    'userId'
  ).lean();
  return new Set([userId, ...others.map((m) => m.userId)]);
};

const assertContacts = async (userId, targetIds) => {
  const allowed = await contactIds(userId);
  for (const id of targetIds) if (!allowed.has(id)) throw forbidden('You can only exchange keys with people you chat with');
};

export const markDeviceListChanged = async (userId) => {
  const seq = await nextSeq('sync');
  await DeviceListUpdate.updateOne({ userId }, { $set: { seq } }, { upsert: true });
  return seq;
};

const otkCounts = async (userId, deviceId) => ({
  signed_curve25519: await OneTimeKey.countDocuments({ userId, deviceId, fallback: false }),
});

export const unusedFallbackTypes = async (userId, deviceId) => {
  const unused = await OneTimeKey.exists({ userId, deviceId, fallback: true, used: false });
  return unused ? ['signed_curve25519'] : [];
};

export const uploadKeys = async (userId, deviceId, body) => {
  const matrixUser = toMatrixUserId(userId);

  if (body.device_keys) {
    const keys = body.device_keys;
    if (keys.user_id !== matrixUser || keys.device_id !== deviceId) throw forbidden('Device keys belong to a different user or device');
    if (!keys.keys?.[`ed25519:${deviceId}`] || !keys.keys?.[`curve25519:${deviceId}`]) throw badRequest('Device keys are incomplete');

    const existing = await DeviceKey.findOne({ userId, deviceId });
    const identityChanged =
      existing?.deviceKeys &&
      !sameJson(existing.deviceKeys.keys, keys.keys);
    // A device's identity keys are permanent; a different key set needs a new device id.
    if (identityChanged) throw conflict('This device already has different identity keys');

    if (!existing?.deviceKeys) {
      await DeviceKey.updateOne(
        { userId, deviceId },
        { $set: { deviceKeys: keys, lastSeenAt: new Date() } },
        { upsert: true }
      );
      await markDeviceListChanged(userId);
    }
  }

  const otks = Object.entries(body.one_time_keys ?? {});
  if (otks.length) {
    const current = await OneTimeKey.countDocuments({ userId, deviceId, fallback: false });
    if (current + otks.length > MAX_ONE_TIME_KEYS) throw badRequest('Too many one-time keys');
    await OneTimeKey.bulkWrite(
      otks.map(([keyId, key]) => ({
        updateOne: {
          filter: { userId, deviceId, fallback: false, keyId },
          update: { $setOnInsert: { key } },
          upsert: true,
        },
      })),
      { ordered: false }
    );
  }

  const fallbacks = Object.entries(body.fallback_keys ?? {});
  if (fallbacks.length) {
    // A new fallback key replaces the previous one
    await OneTimeKey.deleteMany({ userId, deviceId, fallback: true });
    await OneTimeKey.insertMany(fallbacks.map(([keyId, key]) => ({ userId, deviceId, keyId, key, fallback: true })));
  }

  return { one_time_key_counts: await otkCounts(userId, deviceId) };
};

export const queryKeys = async (userId, body) => {
  const requested = Object.keys(body.device_keys ?? {});
  const targetIds = requested.map(fromMatrixUserId);
  await assertContacts(userId, targetIds);

  const devices = await DeviceKey.find({ userId: { $in: targetIds }, deviceKeys: { $ne: null } }).lean();
  const deviceKeys = Object.fromEntries(requested.map((m) => [m, {}]));
  for (const d of devices) {
    const keys = { ...d.deviceKeys };
    if (d.displayName) keys.unsigned = { device_display_name: d.displayName };
    deviceKeys[toMatrixUserId(d.userId)][d.deviceId] = keys;
  }
  return { device_keys: deviceKeys, failures: {} };
};

export const claimKeys = async (userId, body) => {
  const requests = Object.entries(body.one_time_keys ?? {});
  const targetIds = requests.map(([m]) => fromMatrixUserId(m));
  await assertContacts(userId, targetIds);

  const result = {};
  for (const [matrixUser, devices] of requests) {
    const targetId = fromMatrixUserId(matrixUser);
    for (const deviceId of Object.keys(devices)) {
      if (!isDeviceId(deviceId)) continue;
      // Each one-time key is handed out exactly once
      let claimed = await OneTimeKey.findOneAndDelete({ userId: targetId, deviceId, fallback: false });
      if (!claimed) {
        claimed = await OneTimeKey.findOneAndUpdate({ userId: targetId, deviceId, fallback: true }, { $set: { used: true } }, { new: true });
      }
      if (claimed) ((result[matrixUser] ??= {})[deviceId] = { [claimed.keyId]: claimed.key });
    }
  }
  return { one_time_keys: result, failures: {} };
};

export const sendToDevice = async (userId, deviceId, eventType, txnId, body, notify) => {
  const entries = Object.entries(body.messages ?? {});
  const targetIds = entries.map(([m]) => fromMatrixUserId(m));
  await assertContacts(userId, targetIds);

  const docs = [];
  for (const [matrixUser, devices] of entries) {
    const recipientId = fromMatrixUserId(matrixUser);
    let deviceIds = Object.keys(devices);
    if (deviceIds.includes('*')) {
      deviceIds = (await DeviceKey.find({ userId: recipientId }, 'deviceId').lean()).map((d) => d.deviceId);
    }
    for (const recipientDeviceId of deviceIds) {
      if (!isDeviceId(recipientDeviceId)) continue;
      const content = devices[recipientDeviceId] ?? devices['*'];
      docs.push({ recipientId, recipientDeviceId, senderId: userId, senderDeviceId: deviceId, txnId, type: eventType, content });
    }
  }
  if (docs.length > MAX_TO_DEVICE_BATCH) throw badRequest('Too many to-device messages in one request');

  for (const doc of docs) {
    doc.seq = await nextSeq('sync');
    try {
      await ToDeviceMessage.create(doc);
    } catch (error) {
      // Retried request with the same transaction id: already stored
      if (error?.code !== 11000) throw error;
    }
  }
  const recipients = new Set(docs.map((d) => `${d.recipientId}:${d.recipientDeviceId}`));
  for (const key of recipients) {
    const [recipientId, recipientDeviceId] = key.split(':');
    notify?.(recipientId, recipientDeviceId);
  }
  return {};
};

// Everything a device needs: pending to-device events, device list changes of its
// contacts since `since`, and its key counts. To-device events are deleted only when
// the client acknowledges them by id, so a concurrent insert can never be skipped.
export const syncDevice = async (userId, deviceId, since, ackIds = []) => {
  if (ackIds.length) {
    await ToDeviceMessage.deleteMany({ _id: { $in: ackIds }, recipientId: userId, recipientDeviceId: deviceId });
  }

  const events = await ToDeviceMessage.find({ recipientId: userId, recipientDeviceId: deviceId })
    .sort({ seq: 1 })
    .limit(SYNC_LIMIT)
    .lean();

  const contacts = [...(await contactIds(userId))];
  const changes = await DeviceListUpdate.find({ userId: { $in: contacts }, seq: { $gt: since } }).lean();

  await DeviceKey.updateOne({ userId, deviceId }, { $set: { lastSeenAt: new Date() } });

  return {
    next_batch: Math.max(since, ...changes.map((c) => c.seq)),
    has_more: events.length === SYNC_LIMIT,
    to_device_ids: events.map((e) => String(e._id)),
    to_device: events.map((e) => ({ type: e.type, sender: toMatrixUserId(e.senderId), content: e.content })),
    device_lists: { changed: changes.map((c) => toMatrixUserId(c.userId)), left: [] },
    device_one_time_keys_count: await otkCounts(userId, deviceId),
    device_unused_fallback_key_types: await unusedFallbackTypes(userId, deviceId),
  };
};

export const listDevices = (userId) =>
  DeviceKey.find({ userId }, 'deviceId displayName lastSeenAt createdAt').sort({ lastSeenAt: -1 }).lean();

export const removeDevice = async (userId, deviceId) => {
  const removed = await DeviceKey.deleteOne({ userId, deviceId });
  await OneTimeKey.deleteMany({ userId, deviceId });
  await ToDeviceMessage.deleteMany({ recipientId: userId, recipientDeviceId: deviceId });
  if (removed.deletedCount) await markDeviceListChanged(userId);
  return removed.deletedCount > 0;
};
