import { spawn } from 'node:child_process';
import http from 'node:http';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { MongoMemoryServer } from 'mongodb-memory-server';

const backendDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Stand-in for ImageKit's upload endpoint so tests never upload real files.
export const startImageStub = async () => {
  const server = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ url: `https://ik.imagekit.io/test/${Date.now()}.png`, width: 800, height: 1200 }));
    });
  });
  server.listen(0);
  await once(server, 'listening');
  return { server, url: `http://127.0.0.1:${server.address().port}/upload` };
};

// Boots the real API (index.js) against an in-memory MongoDB.
export const startApi = async ({ port, imageUploadUrl }) => {
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
      IMAGEKIT_PRIVATE_KEY: 'test-key',
      IMAGEKIT_UPLOAD_URL: imageUploadUrl,
      CLIENT_ORIGINS: 'http://localhost:5173',
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
  const request = async (method, url, body, { form } = {}) => {
    const headers = {};
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
    hasCookie: () => Boolean(cookie),
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
