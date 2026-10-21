import express from 'express';
import multer from 'multer';
import { requireActive, requireAuth } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rateLimit.js';
import * as c from './chat.controller.js';
import { serverName } from './ids.js';

export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

// Encrypted attachments are opaque bytes, so there is no MIME-type check here;
// the size limit allows for the small encryption overhead.
const encryptedUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_ATTACHMENT_BYTES + 1024, files: 1, fields: 4 },
});

const byUser = (req) => req.user._id;
const messageLimit = rateLimit({ windowMs: 60_000, max: 120, key: byUser, message: "You're sending messages too quickly. Please slow down." });
const uploadLimit = rateLimit({ windowMs: 60_000, max: 30, key: byUser, message: 'Too many uploads. Please wait a moment.' });
const keyLimit = rateLimit({ windowMs: 60_000, max: 120, key: byUser, message: 'Too many key requests. Please wait a moment.' });

const router = express.Router();
router.use(requireAuth);

// Identifier domain the client must use for Matrix-style user/room ids
router.get('/config', (req, res) => res.json({ serverName: serverName() }));

// Matrix-compatible key directory used by the client crypto library
router.post('/keys/upload', keyLimit, c.withDevice, c.keysUpload);
router.post('/keys/query', keyLimit, c.keysQuery);
router.post('/keys/claim', keyLimit, c.keysClaim);
router.put('/sendToDevice/:eventType/:txnId', keyLimit, c.registeredDevice, c.sendToDevice);
router.post('/sync', c.registeredDevice, c.sync);

router.get('/devices', c.listDevices);
router.patch('/devices/:deviceId', c.renameDevice);
router.delete('/devices/:deviceId', c.removeDevice);

router.get('/conversations', c.listConversations);
router.get('/unread', c.unreadTotal);
router.post('/conversations', requireActive, c.openConversation);
router.get('/conversations/:id', c.getConversation);
router.get('/conversations/:id/messages', c.listMessages);
router.post('/conversations/:id/messages', requireActive, messageLimit, c.registeredDevice, c.sendMessage);
router.delete('/conversations/:id/messages/:messageId', c.deleteMessage);
router.post('/conversations/:id/receipts', c.updateReceipts);

router.post('/attachments', requireActive, uploadLimit, encryptedUpload.single('file'), c.uploadAttachment);
router.get('/attachments/:id', c.downloadAttachment);

router.get('/settings', c.getSettings);
router.patch('/settings', c.updateSettings);

export default router;
