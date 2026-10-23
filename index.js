// Load environment variables first, before anything else
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import multer from 'multer';
import mongoose from 'mongoose';
import router from './route/user.js';
import dbConnect from './db.js';
import { HttpError } from './utils/http.js';
import { closeChatDb, connectChatDb } from './chat/db.js';
import chatRouter from './chat/routes.js';
import { closeChatSocket, initChatSocket } from './chat/socket.js';

const PORT = process.env.PORT || 3500;
const CLIENT_ORIGINS = (process.env.CLIENT_ORIGINS || 'http://localhost:5173,http://localhost:5174')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

// On Vercel the app runs as a serverless function: no app.listen, no process.exit
const IS_SERVERLESS = Boolean(process.env.VERCEL);

const missing = ['MONGODB', 'SECRET_KEY'].filter((key) => !process.env[key]);
if (missing.length) {
  console.error(`[Server] FATAL: Missing required environment variables: ${missing.join(', ')}. See .env.example.`);
  if (!IS_SERVERLESS) process.exit(1);
}
for (const key of ['IMAGEKIT_PRIVATE_KEY', 'EMAIL', 'EMAIL_PASS']) {
  if (!process.env[key]) console.warn(`[Server] Warning: ${key} is not set; related features will not work.`);
}

const app = express();
app.disable('x-powered-by');

// ─── Middleware ────────────────────────────────────────────────────────────────
app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'X-Frame-Options': 'DENY',
    'Cross-Origin-Resource-Policy': 'same-site',
  });
  next();
});
app.use(cookieParser());
app.use(
  cors({
    origin: CLIENT_ORIGINS,
    credentials: true,
  })
);

// Serverless: connect once per warm instance, on the first request
let dbReady;
const connectDatabases = () => {
  dbReady ??= (async () => {
    await dbConnect();
    await connectChatDb();
  })().catch((err) => {
    dbReady = undefined;
    throw err;
  });
  return dbReady;
};

if (IS_SERVERLESS) {
  app.use(async (req, res, next) => {
    if (missing.length) {
      return res.status(500).json({ message: `Server is missing environment variables: ${missing.join(', ')}` });
    }
    try {
      await connectDatabases();
      next();
    } catch (err) {
      console.error('[Server] Could not connect to MongoDB:', err.message);
      res.status(503).json({ message: 'Could not connect to the database' });
    }
  });
}

// ─── Routes ───────────────────────────────────────────────────────────────────
// Chat key batches (Olm-encrypted room keys for several devices) can exceed 100kb
app.use('/chat', express.json({ limit: '1mb' }), chatRouter);
app.use(express.json({ limit: '100kb' }));
app.use('/', router);

app.use((req, res) => {
  res.status(404).json({ message: 'Not found' });
});

// ─── Error handling ───────────────────────────────────────────────────────────
// Express 5 forwards errors thrown in async handlers here, so controllers just throw.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err instanceof HttpError) return res.status(err.status).json({ message: err.message });

  if (err instanceof multer.MulterError) {
    const message = err.code === 'LIMIT_FILE_SIZE' ? 'That file is too large' : 'Invalid upload';
    return res.status(err.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ message });
  }
  if (err instanceof mongoose.Error.CastError) return res.status(400).json({ message: `Invalid ${err.path}` });
  if (err instanceof mongoose.Error.ValidationError) {
    return res.status(400).json({ message: Object.values(err.errors)[0]?.message || 'Invalid data' });
  }
  if (err?.code === 11000) return res.status(409).json({ message: 'That already exists' });
  if (err?.type === 'entity.parse.failed') return res.status(400).json({ message: 'Malformed JSON body' });
  if (err?.type === 'entity.too.large') return res.status(413).json({ message: 'Request body is too large' });

  console.error(`[Server] ${req.method} ${req.originalUrl} failed:`, err);
  res.status(500).json({ message: 'Something went wrong on our side. Please try again.' });
});

// ─── Startup ──────────────────────────────────────────────────────────────────
const startServer = async () => {
  try {
    // Connect to MongoDB FIRST. If this throws, we abort — the server never starts.
    await dbConnect();
    // Chat data lives in its own database (see chat/db.js)
    await connectChatDb();

    // Only start listening after the database is confirmed connected.
    const server = app.listen(PORT, () => {
      console.log(`[Server] Running on port ${PORT} (allowed origins: ${CLIENT_ORIGINS.join(', ')})`);
    });
    initChatSocket(server, { origins: CLIENT_ORIGINS });

    // ─── Graceful Shutdown ─────────────────────────────────────────────────────
    // On SIGINT (Ctrl+C) or SIGTERM (process manager / Docker stop):
    //   1. Stop accepting new HTTP requests
    //   2. Close the MongoDB connection cleanly
    //   3. Exit
    const shutdown = async (signal) => {
      console.log(`\n[Server] ${signal} received. Shutting down gracefully...`);

      await closeChatSocket();
      server.close(async () => {
        console.log('[Server] HTTP server closed. No new requests accepted.');
        try {
          await mongoose.connection.close();
          await closeChatDb();
          console.log('[DB] Connections closed.');
        } catch (err) {
          console.error('[DB] Error closing connection:', err.message);
        }
        process.exit(0);
      });

      // Force-exit after 15 seconds if graceful shutdown stalls
      setTimeout(() => {
        console.error('[Server] Graceful shutdown timed out. Forcing exit.');
        process.exit(1);
      }, 15000).unref();
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
  } catch (err) {
    // Initial DB connection failed — log clearly and abort startup.
    console.error('[Server] FATAL: Could not connect to MongoDB Atlas.');
    console.error('[Server] Reason:', err.message);
    console.error(
      '[Server] Check: (1) MONGODB in .env  (2) Atlas Network Access IP allowlist  ' +
      '(3) Atlas cluster is active and not paused.'
    );
    process.exit(1);
  }
};

if (!IS_SERVERLESS) startServer();

export default app;
