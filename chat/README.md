# Encrypted chat

One-to-one messaging with end-to-end encryption (E2EE): text, photos, videos and
voice messages. The server stores and relays ciphertext. It never receives
plaintext, private keys or attachment keys.

> **Status:** implemented and tested (see [Tests](#tests)). **Not independently
> audited.** Read [Limitations](#limitations-and-threat-model) before relying on it.

## Architecture

```
Browser (each tab/browser profile = one "device")                Backend (Express + Socket.IO)
┌────────────────────────────────────────────┐   HTTPS   ┌─────────────────────────────┐
│ React UI  ── chatStore.js (state, outbox)  │ ───────▶  │ /chat/* REST (routes.js)    │
│            └ cryptoEngine.js               │           │  keys.service  chat.service │
│               └ matrix-sdk-crypto (wasm)   │ ◀───────  │ Socket.IO notifications     │
│                  Olm + Megolm, keys in     │   WSS     └──────────┬──────────────────┘
│                  encrypted IndexedDB       │                      │
└────────────────────────────────────────────┘          chat DB (MongoDB, separate)
                                                        ImageKit private files (ciphertext)
```

| Piece | File |
|---|---|
| Chat DB connection (separate database) | `chat/db.js` |
| Schemas and indexes | `chat/models.js` |
| Public-key directory, to-device relay, sync | `chat/keys.service.js` |
| Conversations, messages, receipts, settings | `chat/chat.service.js` |
| REST controllers and routes | `chat/chat.controller.js`, `chat/routes.js` |
| Socket.IO (auth, typing, presence, pushes) | `chat/socket.js` |
| Client crypto engine (shared with tests) | `frontend/src/chat/cryptoEngine.js` |
| Client state, outbox, media | `frontend/src/chat/chatStore.js` |
| UI | `frontend/src/Components/Chat/*` |

## Encryption protocol

The client uses **[matrix-sdk-crypto-wasm](https://github.com/matrix-org/matrix-sdk-crypto-wasm)**
(Apache-2.0), the WebAssembly build of the Rust crypto stack used by Element. Its
cryptography comes from **vodozemac**, which was independently audited (Least Authority, 2022).
No primitive or protocol is implemented in this codebase.

- **Device identity:** each device has a long-term Ed25519 signing key and Curve25519 identity
  key, generated on the device. Only the signed public `device_keys` are uploaded.
- **Olm (1:1 device channels):** a Double Ratchet session (X3DH-style setup, using one-time
  keys claimed from the server) between each pair of devices. It is used only to deliver room keys.
- **Megolm (conversation messages):** the sender's device creates an outbound session per
  conversation and shares its key with every recipient device (and the sender's own other
  devices) over Olm. Messages are encrypted with AES-256-CBC + HMAC-SHA-256 and signed
  with Ed25519. Sessions rotate after 100 messages or one week (library defaults), and
  immediately when a device is blocked.
- **Attachments:** Matrix encrypted-attachment format. Each file gets a fresh random AES-256-CTR
  key and IV, and a SHA-256 hash of the ciphertext. Key, IV and hash travel only inside the
  Megolm-encrypted message. The server and ImageKit see an opaque `*.bin` blob under a
  random name.

Identifiers follow Matrix shapes: users are `@<mongoId>:<CHAT_SERVER_NAME>`, conversations
are `!<conversationId>:<CHAT_SERVER_NAME>`. The backend implements only the subset of
endpoints the crypto library needs: `keys/upload`, `keys/query`, `keys/claim`,
`sendToDevice` and a sync.

### Key lifecycle

1. **First open of Messages:** the wasm loads; a random device id and a random 32-byte
   store key are created and kept in IndexedDB (`pinclone-chat`). The OlmMachine creates
   identity keys in an **IndexedDB store encrypted with that store key**
   (`pinclone-crypto-<user>-<device>`). Public keys and one-time keys are uploaded.
2. **Sending:** the engine refreshes the recipients' device lists, claims one-time keys for
   devices without an Olm session, shares the Megolm key, encrypts, then `POST`s the
   ciphertext. Retries reuse the same `clientMessageId` and ciphertext, so sends are idempotent.
3. **Receiving:** a `todevice` socket ping triggers `POST /chat/sync`. Room keys are processed
   and **acknowledged by id only after processing**, so a crash or a concurrent write can't drop a key.
4. **New device:** gets keys for messages sent **after** it was set up. Earlier history is
   shown as "can't be read here" (no server-side key backup yet; see below).
5. **Removing a device** (Settings → Chat & privacy): its public keys, one-time keys and
   queued messages are deleted on the server, and contacts are told to refresh. If it's the
   current browser, its local store is wiped. A removed device gets `410` and sets itself up again.
6. **Identity keys are immutable:** the server rejects a different key set for an existing
   device id (`409`), so keys can't be silently swapped under the same device.

### Trust model and verification

- Without verification, the model is **trust on first use**. The server can't read messages,
  but a malicious server could add a fake device to a user. It would show up in the UI as a
  new, **unverified** device.
- **Manual verification:** the chat header's shield opens *Encryption & devices*, which shows
  every device of the other person with its Ed25519 fingerprint, plus your own. Compare them
  out of band (in person or on a call), then press **Fingerprints match**. Trust is stored locally.
- New or unverified devices trigger a banner in the conversation. Users can **block** a
  device; it stops receiving new room keys (the session is rotated).
- Matrix cross-signing and interactive SAS (emoji) verification are not wired up yet, so
  verification is per device, not per user.

## What the server can see (metadata)

| Visible to the server | Not visible |
|---|---|
| Who talks to whom; when; message count and order | Message text |
| Ciphertext size (roughly the message/file size) | File names, MIME types, dimensions, duration |
| Sender device id; which devices exist; public keys | Attachment keys, private keys |
| Read/delivered positions (receipts can be disabled) | Captions, emoji, voice audio, photos, videos |
| Typing and online events (presence can be hidden) | |

Image EXIF data (including GPS) is removed by re-encoding JPEG/PNG/WebP through a canvas before
encryption. **Video and audio metadata is not stripped**, but it is encrypted.

## Limitations and threat model

- **Browser E2EE trusts the code it runs.** Anyone who can run JavaScript in this origin
  (XSS, a malicious browser extension, a compromised build or hosting) can read messages as
  they are decrypted. Mitigations: React escaping (no `dangerouslySetInnerHTML`), a
  restrictive **Content-Security-Policy** in production builds (`vite.config.js`), and no
  third-party scripts. Code integrity still depends on your hosting and supply chain.
- **Device theft / local access:** the IndexedDB crypto store is encrypted, but its key sits
  in the same browser profile, so someone with access to an unlocked profile can read the
  keys. Use OS account security; sign out lost devices remotely.
- **No key backup or history transfer:** a new device can't read older messages, and losing
  every device loses history. A passphrase-protected key backup (`backupRoomKeys`, supported
  by the library) is the recommended next step; it is intentionally not faked here.
- **Forward secrecy:** Olm channels ratchet. Megolm gives forward secrecy only per session
  rotation (100 messages or one week): someone who compromises a device can decrypt messages
  of the current sessions that device holds.
- **Attachment integrity:** the SHA-256 covers the ciphertext, and its key is authenticated by
  the Megolm message. A wrong key yields garbage rather than an error, but it can never yield
  a different valid file.
- **Delete for everyone** removes the ciphertext from the server; it can't erase copies a
  recipient already decrypted or saved.
- **Media size:** up to 25 MB per file, encrypted in memory (no chunked or resumable upload yet).
- **Voice calls (WebRTC):** not implemented; planned as a separate phase.
- **ImageKit:** attachments are uploaded as private raw files and downloaded only through
  `GET /chat/attachments/:id` after a membership check, using a 2-minute signed URL. Tests use
  a stub that checks the same HMAC signature; run one live upload to confirm your ImageKit
  plan allows private raw files.

## Database

Separate database (`CHAT_DB_NAME`, default `pinclone_chat`); startup fails if it equals the main
database. Users are referenced only by their main-database id.

| Collection | Purpose | Key indexes |
|---|---|---|
| `conversations` | Direct conversation per user pair, message counter | `memberKey` unique |
| `conversation_members` | Membership + read/delivered watermarks (receipts) | `{conversationId,userId}` unique, `{userId,lastMessageAt}` |
| `encrypted_messages` | Megolm ciphertext envelopes (strict schema, no extra fields) | `{conversationId,seq}` unique, `{senderId,clientMessageId}` unique |
| `attachments` | Opaque storage id, path and size of encrypted blobs | `conversationId` |
| `user_chat_settings` | Presence / read-receipt preferences | `userId` unique |
| `device_keys` | Signed public device keys, display name, last seen | `{userId,deviceId}` unique |
| `one_time_keys` | Public one-time and fallback keys (claimed once) | `{userId,deviceId,fallback,keyId}` unique |
| `to_device_messages` | Olm-encrypted room keys awaiting a device (**30-day TTL**) | `{recipientId,recipientDeviceId,seq}`, idempotency index |
| `device_list_updates` | Latest key-change sequence per user | `userId` unique, `seq` |
| `counters` | Sequence numbers | |

## API

All routes need the login cookie. Routes marked *device* need `X-Device-Id`.

| Method & path | Notes |
|---|---|
| `GET /chat/config` | `{ serverName }` |
| `POST /chat/keys/upload` *device* | Matrix `keys/upload` body; only for your own user/device |
| `POST /chat/keys/query` | Only for yourself and people you share a conversation with |
| `POST /chat/keys/claim` | Same restriction; each one-time key is handed out once |
| `PUT /chat/sendToDevice/:type/:txnId` *device* | Olm-encrypted payloads to contacts' devices; idempotent per txn |
| `POST /chat/sync` *device* | `{ since, ack }` → to-device events (+ids), device-list changes, key counts |
| `GET/PATCH/DELETE /chat/devices[/:id]` | List, rename and remove your devices |
| `GET /chat/conversations`, `GET /chat/unread` | List with unread counts and the partner's receipts |
| `POST /chat/conversations` `{ userId }` | Open (or create) a direct conversation |
| `GET /chat/conversations/:id/messages?before&limit` | Ciphertext history, ordered by `seq` |
| `POST /chat/conversations/:id/messages` *device* | `{ clientMessageId, content, attachmentIds }`; content must be a Megolm envelope |
| `DELETE /chat/conversations/:id/messages/:mid` | Sender only; ciphertext and blobs are deleted |
| `POST /chat/conversations/:id/receipts` | `{ readSeq?, deliveredSeq? }` (capped at the latest message) |
| `POST /chat/attachments` (multipart `file`, `conversationId`) | Encrypted bytes only, at most 25 MB |
| `GET /chat/attachments/:id` | Members only; streams ciphertext (`no-store`) |
| `GET/PATCH /chat/settings` | `{ showPresence, sendReadReceipts }` |

Non-members get `404` for conversations and attachments (ids can't be probed). Limits per user:
120 messages, 30 uploads and 120 key requests per minute. Typing is limited to 30 events per 10 s per socket.

### Socket.IO events

The connection is authenticated with the same JWT cookie; `auth.deviceId` joins a per-device room.
Every client event is checked for conversation membership.

| Direction | Event | Payload (never contains plaintext) |
|---|---|---|
| server → client | `message:new`, `message:deleted` | `{ conversationId, message }` (ciphertext event) |
| server → client | `receipt` | `{ conversationId, userId, readSeq?, deliveredSeq }` |
| server → client | `todevice` | `{}`: run a sync |
| server → client | `keys:changed`, `device:removed` | `{ userId? }`: run a sync |
| server → client | `typing`, `presence` | `{ conversationId, userId, typing }` / `{ userId, online }` |
| client → server | `typing` | `{ conversationId, typing }` |
| client → server | `presence:query` (ack) | Returns `{ userId: online \| null }` for your contacts |

## Configuration

```
CHAT_MONGODB_URI=          # optional; defaults to MONGODB (same cluster, different database)
CHAT_DB_NAME=pinclone_chat
CHAT_SERVER_NAME=pinclone.local   # set once; changing it invalidates existing devices
IMAGEKIT_PRIVATE_KEY=...
IMAGEKIT_URL_ENDPOINT=https://ik.imagekit.io/<id>
```

## Deployment checklist

- Serve the frontend and API over **HTTPS/WSS** only, and set `NODE_ENV=production` (secure cookies).
- Keep the production CSP; serve `.wasm` as `application/wasm` (Vite emits it as an asset).
- Put a reverse proxy in front that allows WebSocket upgrades on `/socket.io`.
- The socket server and in-memory rate limits are per process. For several instances, add the
  Socket.IO Redis adapter and a shared rate-limit store.
- Plan the key-backup feature before depending on chat history across devices.

## Tests

`npm test` in the backend runs `tests/chat.test.js`. It drives the **real client crypto
engine** for several users and devices against the real API and an in-memory MongoDB, and checks:
- Decryption between users, and that neither database dump nor any HTTP request ever
  contains the plaintext.
- That key uploads contain only public material.
- Stranger and IDOR protection for keys, messages, attachments and sockets.
- Tampered ciphertext, replay into another conversation, idempotent retries, pagination and receipts.
- New, blocked and removed devices.
- Encrypted attachment round-trip and corruption.
- Socket authentication and per-event authorization.
