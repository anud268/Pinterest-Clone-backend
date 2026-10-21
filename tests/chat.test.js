// End-to-end encrypted chat: runs the real client crypto engine (the same file the
// browser uses) for several users/devices against the real API and an in-memory MongoDB.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { io as connectSocket } from 'socket.io-client';
import * as sdk from '@matrix-org/matrix-sdk-crypto-wasm';
import CryptoEngine, { randomDeviceId } from '../../Pinterest-Clone-frontend/src/chat/cryptoEngine.js';
import { createClient, startApi, startImageStub } from './helpers.js';

const PORT = 3612;
let api;
let stub;
let mainDb;
let chatDb;
const engines = [];
const traffic = []; // every request body any crypto engine sent to the server

const users = {
  alice: { email: 'alice.chat@example.com', fullname: 'Alice Chat', password: 'secret123' },
  bob: { email: 'bob.chat@example.com', fullname: 'Bob Chat', password: 'secret456' },
  carol: { email: 'carol.chat@example.com', fullname: 'Carol Chat', password: 'secret789' },
};
const SECRET_TEXT = 'Meet at the blue door at 7pm 🔐';

const signUp = async (values) => {
  const client = createClient(api.baseUrl);
  assert.equal((await client.post('/signup', { values })).status, 201);
  const verify = await client.post('/verifyotp', { email: values.email, otp: api.otpFor(values.email) });
  assert.equal(verify.status, 200);
  client.id = verify.data.user._id;
  return client;
};

const memoryKv = () => {
  const map = new Map();
  return { get: async (k) => map.get(k), set: async (k, v) => map.set(k, v) };
};

const engineFor = async (client, deviceId = randomDeviceId()) => {
  const http = async (method, path, body, headers) => {
    traffic.push({ path, body: JSON.stringify(body ?? {}) });
    const res = await client.request(method, path, body, { headers });
    if (res.status >= 400) {
      const error = new Error(`${method} ${path} -> ${res.status} ${res.data?.message}`);
      error.status = res.status;
      throw error;
    }
    return res.data;
  };
  const engine = await CryptoEngine.create({ sdk, http, kv: memoryKv(), userId: client.id, deviceId });
  engines.push(engine);
  return engine;
};

const send = async (client, engine, conversation, content, extra = {}) => {
  const encrypted = await engine.encrypt(conversation.roomId, [client.id, conversation.partner._id], content);
  return client.request(
    'POST',
    `/chat/conversations/${conversation._id}/messages`,
    { clientMessageId: crypto.randomUUID().replaceAll('-', ''), content: encrypted, ...extra },
    { headers: { 'X-Device-Id': engine.deviceId } }
  );
};

const dumpDatabase = async (db) => {
  const out = [];
  for (const { name } of await db.db.listCollections().toArray()) out.push(JSON.stringify(await db.db.collection(name).find().toArray()));
  return out.join('\n');
};

const socketFor = (client, deviceId) =>
  new Promise((resolve, reject) => {
    const socket = connectSocket(api.baseUrl, {
      extraHeaders: client ? { Cookie: client.cookie() } : {},
      auth: { deviceId },
      transports: ['websocket'],
      reconnection: false,
    });
    socket.once('connect', () => resolve(socket));
    socket.once('connect_error', (err) => reject(err));
  });

const nextEvent = (socket, name, timeout = 4000) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no ${name} event`)), timeout);
    socket.once(name, (data) => {
      clearTimeout(timer);
      resolve(data);
    });
  });

let alice, bob, carol, aliceEngine, bobEngine, carolEngine, conversation;

before(async () => {
  await sdk.initAsync();
  stub = await startImageStub();
  api = await startApi({ port: PORT, imageUploadUrl: stub.url, env: { IMAGEKIT_URL_ENDPOINT: stub.endpoint, IMAGEKIT_API_URL: stub.apiUrl } });
  mainDb = await mongoose.createConnection(api.mongoUri).asPromise();
  chatDb = await mongoose.createConnection(api.mongoUri.replace('pinclone_test', 'pinclone_chat_test')).asPromise();
  alice = await signUp(users.alice);
  bob = await signUp(users.bob);
  carol = await signUp(users.carol);
});

after(async () => {
  engines.forEach((e) => e.close());
  await mainDb?.close();
  await chatDb?.close();
  await api?.stop();
  stub?.server.close();
});

describe('chat database isolation', () => {
  test('chat data is stored in its own database', async () => {
    const res = await alice.post('/chat/conversations', { userId: bob.id });
    assert.equal(res.status, 200);
    conversation = res.data.conversation;
    assert.equal(conversation.partner.fullname, users.bob.fullname);
    const mainCollections = (await mainDb.db.listCollections().toArray()).map((c) => c.name);
    const chatCollections = (await chatDb.db.listCollections().toArray()).map((c) => c.name);
    assert.ok(chatCollections.includes('conversations'));
    assert.ok(!mainCollections.includes('conversations'));
    assert.ok(!chatCollections.includes('users'), 'no user credentials are copied into the chat database');
  });

  test('opening the same conversation twice returns the same one', async () => {
    const again = await bob.post('/chat/conversations', { userId: alice.id });
    assert.equal(again.data.conversation._id, conversation._id);
    assert.equal((await alice.post('/chat/conversations', { userId: alice.id })).status, 400);
  });
});

describe('device keys', () => {
  test('devices register public keys only', async () => {
    aliceEngine = await engineFor(alice, 'ALICEDEVICE1');
    bobEngine = await engineFor(bob, 'BOBDEVICE01');
    carolEngine = await engineFor(carol, 'CAROLDEVICE');
    const stored = await chatDb.db.collection('device_keys').findOne({ deviceId: 'ALICEDEVICE1' });
    assert.deepEqual(Object.keys(stored.deviceKeys).sort(), ['algorithms', 'device_id', 'keys', 'signatures', 'user_id']);
    assert.equal(stored.deviceKeys.keys['ed25519:ALICEDEVICE1'], aliceEngine.fingerprint);
    assert.ok((await chatDb.db.collection('one_time_keys').countDocuments({ deviceId: 'ALICEDEVICE1' })) > 0);
  });

  test("a device's identity keys cannot be replaced", async () => {
    const stored = await chatDb.db.collection('device_keys').findOne({ deviceId: 'ALICEDEVICE1' });
    const forged = structuredClone(stored.deviceKeys);
    forged.keys['ed25519:ALICEDEVICE1'] = 'A'.repeat(43);
    const res = await alice.request('POST', '/chat/keys/upload', { device_keys: forged }, { headers: { 'X-Device-Id': 'ALICEDEVICE1' } });
    assert.equal(res.status, 409);
  });

  test('keys cannot be uploaded for another user', async () => {
    const stored = await chatDb.db.collection('device_keys').findOne({ deviceId: 'ALICEDEVICE1' });
    const res = await carol.request('POST', '/chat/keys/upload', { device_keys: stored.deviceKeys }, { headers: { 'X-Device-Id': 'ALICEDEVICE1' } });
    assert.equal(res.status, 403);
  });

  test('strangers cannot query or claim keys or send to-device messages', async () => {
    const matrixAlice = `@${alice.id}:pinclone.local`;
    const headers = { 'X-Device-Id': 'CAROLDEVICE' };
    assert.equal((await carol.request('POST', '/chat/keys/query', { device_keys: { [matrixAlice]: [] } }, { headers })).status, 403);
    assert.equal((await carol.request('POST', '/chat/keys/claim', { one_time_keys: { [matrixAlice]: { ALICEDEVICE1: 'signed_curve25519' } } }, { headers })).status, 403);
    const spam = { messages: { [matrixAlice]: { ALICEDEVICE1: { hello: 'x' } } } };
    assert.equal((await carol.request('PUT', '/chat/sendToDevice/m.room.encrypted/txn1', spam, { headers })).status, 403);
  });
});

describe('encrypted messaging', () => {
  let first;

  test('Alice sends an encrypted message that Bob can decrypt', async () => {
    const res = await send(alice, aliceEngine, conversation, { msgtype: 'm.text', body: SECRET_TEXT });
    assert.equal(res.status, 201, JSON.stringify(res.data));
    first = res.data.message;
    assert.equal(first.content.algorithm, 'm.megolm.v1.aes-sha2');
    assert.equal(first.senderId, alice.id);

    await bobEngine.sync();
    const history = await bob.get(`/chat/conversations/${conversation._id}/messages`);
    const decrypted = await bobEngine.decrypt(history.data.messages.at(-1));
    assert.equal(decrypted.content.body, SECRET_TEXT);
    assert.equal(decrypted.senderDeviceId, 'ALICEDEVICE1');
    assert.equal(decrypted.verified, false);
    assert.equal(decrypted.tampered, false);
  });

  test('neither database nor any request contains the plaintext', async () => {
    assert.ok(!(await dumpDatabase(chatDb)).includes('blue door'));
    assert.ok(!(await dumpDatabase(mainDb)).includes('blue door'));
    assert.ok(!traffic.some((t) => t.body.includes('blue door')), 'plaintext was sent to the server');
  });

  test('key uploads only contain public key material', () => {
    const uploads = traffic.filter((t) => t.path === '/chat/keys/upload').map((t) => JSON.parse(t.body));
    assert.ok(uploads.length > 0);
    for (const body of uploads) {
      for (const key of Object.keys(body)) assert.ok(['device_keys', 'one_time_keys', 'fallback_keys'].includes(key), key);
      for (const otk of Object.values(body.one_time_keys ?? {})) assert.deepEqual(Object.keys(otk).sort(), ['key', 'signatures']);
    }
  });

  test('verifying the sender device is reflected in decryption results', async () => {
    const devices = await bobEngine.devicesOf(alice.id);
    assert.equal(devices.length, 1);
    assert.equal(devices[0].fingerprint, aliceEngine.fingerprint, 'Bob sees the same fingerprint Alice has');
    await bobEngine.setDeviceTrust(alice.id, 'ALICEDEVICE1', 'verified');
    const history = await bob.get(`/chat/conversations/${conversation._id}/messages`);
    assert.equal((await bobEngine.decrypt(history.data.messages.at(-1))).verified, true);
  });

  test('a non-member cannot read, send to or decrypt the conversation', async () => {
    assert.equal((await carol.get(`/chat/conversations/${conversation._id}/messages`)).status, 404);
    assert.equal((await carol.get(`/chat/conversations/${conversation._id}`)).status, 404);
    const sendAttempt = await carol.request(
      'POST',
      `/chat/conversations/${conversation._id}/messages`,
      { clientMessageId: 'carolmessage01', content: first.content },
      { headers: { 'X-Device-Id': 'CAROLDEVICE' } }
    );
    assert.equal(sendAttempt.status, 404);
    // Even with the raw ciphertext (e.g. from a database dump), Carol has no key
    await assert.rejects(carolEngine.decrypt(first), (err) => err.code === 'missing_key');
  });

  test('plaintext and unknown fields are rejected by the server', async () => {
    const headers = { 'X-Device-Id': 'ALICEDEVICE1' };
    const url = `/chat/conversations/${conversation._id}/messages`;
    const leaky = { ...first.content, body: 'plaintext!' };
    assert.equal((await alice.request('POST', url, { clientMessageId: 'leaky0000001', content: leaky }, { headers })).status, 400);
    const wrongAlgo = { ...first.content, algorithm: 'none' };
    assert.equal((await alice.request('POST', url, { clientMessageId: 'leaky0000002', content: wrongAlgo }, { headers })).status, 400);
    const spoofedDevice = { ...first.content, device_id: 'BOBDEVICE01' };
    assert.equal((await alice.request('POST', url, { clientMessageId: 'leaky0000003', content: spoofedDevice }, { headers })).status, 403);
  });

  test('resending the same client message id is idempotent', async () => {
    const encrypted = await aliceEngine.encrypt(conversation.roomId, [alice.id, bob.id], { msgtype: 'm.text', body: 'once' });
    const body = { clientMessageId: 'dedupe-message-1', content: encrypted };
    const headers = { 'X-Device-Id': 'ALICEDEVICE1' };
    const a = await alice.request('POST', `/chat/conversations/${conversation._id}/messages`, body, { headers });
    const b = await alice.request('POST', `/chat/conversations/${conversation._id}/messages`, body, { headers });
    assert.equal(a.status, 201);
    assert.equal(b.status, 200);
    assert.equal(a.data.message._id, b.data.message._id);
    assert.equal(await chatDb.db.collection('encrypted_messages').countDocuments({ clientMessageId: 'dedupe-message-1' }), 1);
  });

  test('tampered ciphertext fails to decrypt', async () => {
    const history = await bob.get(`/chat/conversations/${conversation._id}/messages`);
    const event = structuredClone(history.data.messages.at(-1));
    event.content.ciphertext = event.content.ciphertext.slice(0, -8) + 'AAAAAAAA';
    await assert.rejects(bobEngine.decrypt(event), (err) => err.code === 'failed');
  });

  test('a message replayed into another conversation is rejected', async () => {
    const other = (await alice.post('/chat/conversations', { userId: carol.id })).data.conversation;
    const history = await bob.get(`/chat/conversations/${conversation._id}/messages`);
    const event = { ...history.data.messages.at(-1), room_id: other.roomId };
    await assert.rejects(bobEngine.decrypt(event));
  });

  test('history is paginated in order', async () => {
    for (let i = 0; i < 4; i++) await send(alice, aliceEngine, conversation, { msgtype: 'm.text', body: `page ${i}` });
    const page1 = await bob.get(`/chat/conversations/${conversation._id}/messages?limit=3`);
    assert.equal(page1.data.messages.length, 3);
    assert.equal(page1.data.hasMore, true);
    const seqs = page1.data.messages.map((m) => m.seq);
    assert.deepEqual(seqs, [...seqs].sort((x, y) => x - y));
    const page2 = await bob.get(`/chat/conversations/${conversation._id}/messages?limit=3&before=${seqs[0]}`);
    assert.ok(page2.data.messages.every((m) => m.seq < seqs[0]));
  });
});

describe('receipts and unread counts', () => {
  test('delivery and read receipts update unread counts', async () => {
    const before = (await bob.get('/chat/conversations')).data.conversations.find((c) => c._id === conversation._id);
    assert.ok(before.unread > 0);
    const lastSeq = before.lastMessage.seq;
    await bob.post(`/chat/conversations/${conversation._id}/receipts`, { deliveredSeq: lastSeq });
    let forAlice = (await alice.get('/chat/conversations')).data.conversations.find((c) => c._id === conversation._id);
    assert.equal(forAlice.partnerDeliveredSeq, lastSeq);
    assert.equal(forAlice.partnerReadSeq, 0);
    await bob.post(`/chat/conversations/${conversation._id}/receipts`, { readSeq: lastSeq + 999 });
    forAlice = (await alice.get('/chat/conversations')).data.conversations.find((c) => c._id === conversation._id);
    assert.equal(forAlice.partnerReadSeq, lastSeq, 'read position is capped at the last message');
    assert.equal((await bob.get('/chat/unread')).data.total, 0);
  });

  test('read receipts can be turned off', async () => {
    await bob.request('PATCH', '/chat/settings', { sendReadReceipts: false });
    const summary = (await alice.get('/chat/conversations')).data.conversations.find((c) => c._id === conversation._id);
    assert.equal(summary.partnerReadSeq, 0);
    await bob.request('PATCH', '/chat/settings', { sendReadReceipts: true });
  });
});

describe('multiple devices', () => {
  let bobSecond;

  test("a new device can't read older messages but receives new ones", async () => {
    bobSecond = await engineFor(bob, 'BOBDEVICE02');
    const old = (await bob.get(`/chat/conversations/${conversation._id}/messages?limit=1`)).data.messages[0];
    await bobSecond.sync();
    await assert.rejects(bobSecond.decrypt(old), (err) => err.code === 'missing_key');

    // Alice learns about Bob's new device on sync, then shares the room key with it too
    await aliceEngine.sync();
    const res = await send(alice, aliceEngine, conversation, { msgtype: 'm.text', body: 'hello both devices' });
    await bobEngine.sync();
    await bobSecond.sync();
    assert.equal((await bobEngine.decrypt(res.data.message)).content.body, 'hello both devices');
    assert.equal((await bobSecond.decrypt(res.data.message)).content.body, 'hello both devices');
  });

  test("Alice sees Bob's devices; the new one is unverified", async () => {
    const devices = await aliceEngine.devicesOf(bob.id);
    assert.deepEqual(devices.map((d) => d.deviceId).sort(), ['BOBDEVICE01', 'BOBDEVICE02']);
    assert.ok(devices.every((d) => !d.verified));
  });

  test('a blocked device stops receiving new room keys', async () => {
    await aliceEngine.setDeviceTrust(bob.id, 'BOBDEVICE02', 'blocked');
    const res = await send(alice, aliceEngine, conversation, { msgtype: 'm.text', body: 'not for device two' });
    await bobEngine.sync();
    await bobSecond.sync();
    assert.equal((await bobEngine.decrypt(res.data.message)).content.body, 'not for device two');
    await assert.rejects(bobSecond.decrypt(res.data.message));
    await aliceEngine.setDeviceTrust(bob.id, 'BOBDEVICE02', 'unset');
  });

  test('a removed device is told to re-register', async () => {
    assert.equal((await bob.request('DELETE', '/chat/devices/BOBDEVICE02')).status, 200);
    await assert.rejects(bobSecond.sync(), (err) => err.status === 410);
    const devices = (await bob.get('/chat/devices')).data.devices.map((d) => d.deviceId);
    assert.deepEqual(devices, ['BOBDEVICE01']);
  });
});

describe('encrypted attachments', () => {
  const original = crypto.randomBytes(150_000);
  let attachmentId;
  let fileInfo;

  test('only ciphertext is uploaded and the recipient can decrypt it', async () => {
    const { data, info } = aliceEngine.encryptAttachment(new Uint8Array(original));
    assert.notDeepEqual(Buffer.from(data).subarray(0, 64), original.subarray(0, 64));
    const form = new FormData();
    form.append('conversationId', conversation._id);
    form.append('file', new Blob([data], { type: 'application/octet-stream' }), 'blob');
    const upload = await alice.post('/chat/attachments', undefined, { form });
    assert.equal(upload.status, 201, JSON.stringify(upload.data));
    attachmentId = upload.data.attachmentId;
    fileInfo = info;

    // The stored object is the ciphertext, not the original bytes
    const stored = [...stub.files.values()].at(-1);
    assert.equal(Buffer.compare(stored, Buffer.from(data)), 0);
    assert.equal(stored.indexOf(original.subarray(0, 32)), -1);

    const res = await send(alice, aliceEngine, conversation, { msgtype: 'm.file', body: 'secret.bin', file: { attachmentId, ...info } }, { attachmentIds: [attachmentId] });
    assert.equal(res.status, 201);

    await bobEngine.sync();
    const decryptedEvent = await bobEngine.decrypt(res.data.message);
    const download = await bob.raw(`/chat/attachments/${decryptedEvent.content.file.attachmentId}`);
    assert.equal(download.status, 200);
    const plain = bobEngine.decryptAttachment(new Uint8Array(await download.arrayBuffer()), decryptedEvent.content.file);
    assert.equal(Buffer.compare(Buffer.from(plain), original), 0);
    assert.ok(!(await dumpDatabase(chatDb)).includes(info.key.k), 'attachment key never reaches the database');
  });

  test('non-members cannot download attachments', async () => {
    assert.equal((await carol.raw(`/chat/attachments/${attachmentId}`)).status, 404);
  });

  test('a corrupted attachment is detected; a wrong key never yields the original', async () => {
    const download = await bob.raw(`/chat/attachments/${attachmentId}`);
    const bytes = new Uint8Array(await download.arrayBuffer());
    bytes[100] ^= 0xff;
    assert.throws(() => bobEngine.decryptAttachment(bytes, fileInfo), /modified/);
    // The SHA-256 in the (authenticated) message covers the ciphertext, so a wrong key isn't
    // reported as an error; it just can't recover the plaintext.
    const otherKey = aliceEngine.encryptAttachment(new Uint8Array(10)).info;
    const clean = new Uint8Array(await (await bob.raw(`/chat/attachments/${attachmentId}`)).arrayBuffer());
    const garbage = bobEngine.decryptAttachment(clean, { ...fileInfo, key: otherKey.key });
    assert.notEqual(Buffer.compare(Buffer.from(garbage), original), 0);
  });

  test('attachments must belong to the conversation and uploader', async () => {
    const carolConversation = (await carol.post('/chat/conversations', { userId: alice.id })).data.conversation;
    const encrypted = await carolEngine.encrypt(carolConversation.roomId, [carol.id, alice.id], { msgtype: 'm.text', body: 'steal' });
    const res = await carol.request(
      'POST',
      `/chat/conversations/${carolConversation._id}/messages`,
      { clientMessageId: 'stealattach1', content: encrypted, attachmentIds: [attachmentId] },
      { headers: { 'X-Device-Id': 'CAROLDEVICE' } }
    );
    assert.equal(res.status, 400);
  });
});

describe('real-time socket', () => {
  test('sockets require the auth cookie', async () => {
    await assert.rejects(socketFor(null), /unauthorized/);
  });

  test('new messages, receipts and to-device notifications are pushed', async () => {
    const bobSocket = await socketFor(bob, 'BOBDEVICE01');
    const aliceSocket = await socketFor(alice, 'ALICEDEVICE1');
    const incoming = nextEvent(bobSocket, 'message:new');
    const res = await send(alice, aliceEngine, conversation, { msgtype: 'm.text', body: 'live!' });
    const pushed = await incoming;
    assert.equal(pushed.message._id, res.data.message._id);
    assert.equal(JSON.stringify(pushed).includes('live!'), false);
    assert.equal((await bobEngine.decrypt(pushed.message)).content.body, 'live!');

    const receipt = nextEvent(aliceSocket, 'receipt');
    await bob.post(`/chat/conversations/${conversation._id}/receipts`, { readSeq: pushed.message.seq });
    assert.equal((await receipt).readSeq, pushed.message.seq);

    const typing = nextEvent(bobSocket, 'typing');
    aliceSocket.emit('typing', { conversationId: conversation._id, typing: true });
    assert.deepEqual(await typing, { conversationId: conversation._id, userId: alice.id, typing: true });

    bobSocket.close();
    aliceSocket.close();
  });

  test('typing events are only forwarded to conversation members', async () => {
    const carolSocket = await socketFor(carol, 'CAROLDEVICE');
    const bobSocket = await socketFor(bob, 'BOBDEVICE01');
    let leaked = false;
    bobSocket.on('typing', () => (leaked = true));
    carolSocket.emit('typing', { conversationId: conversation._id, typing: true });
    await new Promise((r) => setTimeout(r, 500));
    assert.equal(leaked, false);
    carolSocket.close();
    bobSocket.close();
  });
});

describe('deleting and blocking', () => {
  test('only the sender can delete a message, and its ciphertext is removed', async () => {
    const res = await send(alice, aliceEngine, conversation, { msgtype: 'm.text', body: 'delete me' });
    const id = res.data.message._id;
    assert.equal((await bob.request('DELETE', `/chat/conversations/${conversation._id}/messages/${id}`)).status, 403);
    const del = await alice.request('DELETE', `/chat/conversations/${conversation._id}/messages/${id}`);
    assert.equal(del.status, 200);
    const stored = await chatDb.db.collection('encrypted_messages').findOne({ _id: new mongoose.Types.ObjectId(id) });
    assert.equal(stored.content, null);
  });

  test('blocked users cannot message each other', async () => {
    await bob.post('/userblock', { id: alice.id });
    const res = await send(alice, aliceEngine, conversation, { msgtype: 'm.text', body: 'blocked?' });
    assert.equal(res.status, 403);
    await bob.post('/userblock', { id: alice.id });
  });
});
