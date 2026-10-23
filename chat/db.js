import mongoose from 'mongoose';

// The chat system uses its own MongoDB database, separate from the main app data.
// By default it lives on the same cluster as MONGODB but in a different database
// (CHAT_DB_NAME); set CHAT_MONGODB_URI to put it on a different cluster entirely.
let connection = null;

export const chatDbConfig = () => ({
  uri: process.env.CHAT_MONGODB_URI || process.env.MONGODB,
  dbName: process.env.CHAT_DB_NAME || 'pinclone_chat',
});

// Created unopened so models can be registered at import time without the env being
// set (a throw there crashes the whole serverless function); connectChatDb opens it.
export const getChatConnection = () => {
  if (!connection) {
    connection = mongoose.createConnection();
    connection.on('connected', () => console.log(`[ChatDB] Connected → ${connection.host}/${connection.name}`));
    connection.on('disconnected', () => console.warn('[ChatDB] Disconnected. The driver will reconnect automatically.'));
    connection.on('reconnected', () => console.log('[ChatDB] Reconnected.'));
    connection.on('error', (err) => console.error('[ChatDB] Connection error:', err.message));
  }
  return connection;
};

export const connectChatDb = async () => {
  const conn = getChatConnection();
  if (conn.readyState === mongoose.ConnectionStates.disconnected) {
    const { uri, dbName } = chatDbConfig();
    if (!uri) throw new Error('[ChatDB] CHAT_MONGODB_URI (or MONGODB) is not set');
    await conn.openUri(uri, {
      dbName,
      serverSelectionTimeoutMS: 10000,
      connectTimeoutMS: 10000,
      maxPoolSize: 10,
    });
  } else {
    await conn.asPromise();
  }
  if (conn.name === mongoose.connection.name && conn.host === mongoose.connection.host) {
    throw new Error('[ChatDB] The chat database must differ from the main database. Set CHAT_DB_NAME.');
  }
  return conn;
};

export const closeChatDb = async () => {
  if (connection) await connection.close();
};
