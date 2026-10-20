import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import cookieParser from 'cookie-parser';
import router from './route/user.js';
import dbConnect from './db.js';

// Load environment variables first, before anything else
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3500;

// ─── Middleware ────────────────────────────────────────────────────────────────
app.use(express.json());
app.use(cookieParser());
app.use(
  cors({
    origin: 'http://localhost:5173',
    credentials: true,
  })
);

// ─── Routes ───────────────────────────────────────────────────────────────────
app.use('/', router);

// ─── Startup ──────────────────────────────────────────────────────────────────
const startServer = async () => {
  try {
    // Connect to MongoDB FIRST. If this throws, we abort — the server never starts.
    await dbConnect();

    // Only start listening after the database is confirmed connected.
    const server = app.listen(PORT, () => {
      console.log(`[Server] Running on port ${PORT}`);
    });

    // ─── Graceful Shutdown ─────────────────────────────────────────────────────
    // On SIGINT (Ctrl+C) or SIGTERM (process manager / Docker stop):
    //   1. Stop accepting new HTTP requests
    //   2. Close the MongoDB connection cleanly
    //   3. Exit
    const shutdown = async (signal) => {
      console.log(`\n[Server] ${signal} received. Shutting down gracefully...`);

      server.close(async () => {
        console.log('[Server] HTTP server closed. No new requests accepted.');
        try {
          await import('mongoose').then(({ default: mongoose }) =>
            mongoose.connection.close()
          );
          console.log('[DB] Connection closed.');
        } catch (err) {
          console.error('[DB] Error closing connection:', err.message);
        }
        process.exit(0);
      });

      // Force-exit after 15 seconds if graceful shutdown stalls
      setTimeout(() => {
        console.error('[Server] Graceful shutdown timed out. Forcing exit.');
        process.exit(1);
      }, 15000);
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

startServer();