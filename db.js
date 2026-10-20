import mongoose from 'mongoose';

/**
 * Connect to MongoDB Atlas.
 *
 * - Throws on initial connection failure so server.js can abort startup.
 * - Does NOT call mongoose.connect() again on 'disconnected' — Mongoose v6+
 *   handles reconnection automatically via the driver.
 * - Event listeners provide visibility into connection state changes.
 */
const dbConnect = async () => {
  const uri = process.env.MONGODB;

  // Validate that the URI is present before attempting connection
  if (!uri) {
    throw new Error(
      '[DB] MONGODB environment variable is not set. ' +
      'Check your .env file and ensure it contains a valid MONGODB_URI.'
    );
  }

  // Register connection event listeners BEFORE calling mongoose.connect()
  const conn = mongoose.connection;

  conn.on('connected', () => {
    console.log(`[DB] MongoDB Atlas connected → ${conn.host}/${conn.name}`);
  });

  conn.on('disconnected', () => {
    console.warn('[DB] MongoDB disconnected. Mongoose will attempt to reconnect automatically.');
  });

  conn.on('reconnected', () => {
    console.log('[DB] MongoDB reconnected successfully.');
  });

  conn.on('error', (err) => {
    // Log connection-level errors. Do NOT call mongoose.connect() here —
    // that would create an infinite reconnect loop.
    console.error('[DB] MongoDB connection error:', err.message);
  });

  // Attempt the initial connection.
  // Options chosen for MongoDB Atlas (SRV / cloud):
  //   serverSelectionTimeoutMS — how long the driver spends looking for a
  //     suitable server before throwing. 10 s is a reasonable limit for Atlas.
  //   connectTimeoutMS        — TCP connect timeout per attempt.
  //   socketTimeoutMS         — idle socket timeout (0 = no timeout).
  //   maxPoolSize             — maximum concurrent connections in the pool.
  //   retryWrites             — already present in your connection string; kept here for clarity.
  await mongoose.connect(uri, {
    serverSelectionTimeoutMS: 10000,
    connectTimeoutMS: 10000,
    socketTimeoutMS: 0,
    maxPoolSize: 10,
  });
  // The 'connected' event above will log success.
  // If mongoose.connect() throws, the error propagates to index.js.
};

export default dbConnect;