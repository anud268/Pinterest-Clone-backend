import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import http from 'node:http';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { MongoMemoryServer } from 'mongodb-memory-server';

const backendDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const STUB_PRIVATE_KEY = 'test-key';

// Pulls the "file" part out of a multipart/form-data body.
const multipartFile = (body, contentType) => {
  const boundary = /boundary=(?:"([^"]+)"|([^;]+))/.exec(contentType ?? '');
  if (!boundary) return null;
  const delimiter = Buffer.from(`--${boundary[1] ?? boundary[2]}`);
  let start = body.indexOf(delimiter);
  while (start !== -1) {
    const next = body.indexOf(delimiter, start + delimiter.length);
    if (next === -1) break;
    const part = body.subarray(start + delimiter.length + 2, next - 2);
    const headerEnd = part.indexOf('\r\n\r\n');
    if (part.subarray(0, headerEnd).toString().includes('name="file"')) return Buffer.from(part.subarray(headerEnd + 4));
    start = next;
  }
  return null;
};

// Stand-in for ImageKit (upload API + signed private-file delivery) so tests never touch the real service.
export const startImageStub = async () => {
  const files = new Map();
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const url = new URL(req.url, 'http://stub');
      if (req.method === 'POST' && url.pathname === '/upload') {
        const bytes = multipartFile(Buffer.concat(chunks), req.headers['content-type']);
        const id = `file${files.size + 1}`;
        const filePath = `/stub/${id}.bin`;
        files.set(filePath, bytes);
        res.setHeader('Content-Type', 'application/json');
        return res.end(JSON.stringify({ url: `https://ik.imagekit.io/test${filePath}`, fileId: id, filePath, width: 800, height: 1200 }));
      }
      if (req.method === 'GET' && url.pathname.startsWith('/ik/')) {
        // Check the HMAC-SHA1 URL signature exactly like ImageKit does for private files
        const filePath = url.pathname.slice('/ik'.length);
        const expiry = url.searchParams.get('ik-t');
        const expected = crypto.createHmac('sha1', STUB_PRIVATE_KEY).update(filePath.slice(1) + expiry).digest('hex');
        if (url.searchParams.get('ik-s') !== expected || Number(expiry) < Date.now() / 1000) {
          res.statusCode = 401;
          return res.end('bad signature');
        }
        if (!files.has(filePath)) {
          res.statusCode = 404;
          return res.end();
        }
        return res.end(files.get(filePath));
      }
      if (req.method === 'DELETE') {
        res.statusCode = 204;
        return res.end();
      }
      res.statusCode = 404;
      res.end();
    });
  });
  server.listen(0);
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  return { server, files, url: `${base}/upload`, endpoint: `${base}/ik`, apiUrl: base };
};

// Boots the real API (index.js) against an in-memory MongoDB.
export const startApi = async ({ port, imageUploadUrl, env = {} }) => {
  const mongo = await MongoMemoryServer.create();
  const mongoUri = mongo.getUri('pinclone_test');
  const logs = [];

  const child = spawn(process.execPath, ['index.js'], {
    cwd: backendDir,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      PORT: String(port),
      MONGODB: mongoUri,
      SECRET_KEY: 'test-secret',
      EMAIL: '',
      EMAIL_PASS: '',
      IMAGEKIT_PRIVATE_KEY: STUB_PRIVATE_KEY,
      IMAGEKIT_UPLOAD_URL: imageUploadUrl,
      CLIENT_ORIGINS: 'http://localhost:5173',
      CHAT_DB_NAME: 'pinclone_chat_test',
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (chunk) => logs.push(chunk.toString()));
  child.stderr.on('data', (chunk) => logs.push(chunk.toString()));

  const deadline = Date.now() + 20000;
  while (!logs.join('').includes('[Server] Running')) {
    if (child.exitCode !== null || Date.now() > deadline) {
      throw new Error(`API failed to start:\n${logs.join('')}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    mongoUri,
    // Latest OTP printed by the dev mailer for this address
    otpFor: (email) => {
      const matches = [...logs.join('').matchAll(new RegExp(`OTP for ${email.replace(/[.+]/g, '\\$&')}: (\\d{6})`, 'g'))];
      return matches.at(-1)?.[1];
    },
    logs,
    stop: async () => {
      child.kill();
      await mongo.stop();
    },
  };
};

// Minimal fetch wrapper that keeps one cookie jar per simulated browser.
export const createClient = (baseUrl) => {
  let cookie = '';
  const request = async (method, url, body, { form, headers: extra = {} } = {}) => {
    const headers = { ...extra };
    if (cookie) headers.Cookie = cookie;
    let payload;
    if (form) payload = form;
    else if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    const res = await fetch(baseUrl + url, { method, headers, body: payload });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) {
      const [pair] = setCookie.split(';');
      cookie = pair.endsWith('=') ? '' : pair;
    }
    const text = await res.text();
    let data;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    return { status: res.status, data, headers: res.headers };
  };
  return {
    get: (url) => request('GET', url),
    post: (url, body, opts) => request('POST', url, body, opts),
    request,
    raw: async (url) => fetch(baseUrl + url, { headers: cookie ? { Cookie: cookie } : {} }),
    hasCookie: () => Boolean(cookie),
    cookie: () => cookie,
  };
};

export const pngFile = () => {
  // 1x1 transparent PNG
  const bytes = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
    'base64'
  );
  return new Blob([bytes], { type: 'image/png' });
};
