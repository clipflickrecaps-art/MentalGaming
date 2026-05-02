const mongoose = require('mongoose');
const { config } = require('../config/settings');

let isConnected = false;

async function connectDB() {
  if (isConnected) {
    console.log('[DB] Already connected to MongoDB');
    return;
  }

  try {
    await mongoose.connect(config.db.uri, {
      serverSelectionTimeoutMS: 5000,
    });

    isConnected = true;
    console.log('[DB] Connected to MongoDB successfully');

    mongoose.connection.on('disconnected', () => {
      console.warn('[DB] MongoDB disconnected — attempting reconnect...');
      isConnected = false;
      setTimeout(connectDB, 5000);
    });

    mongoose.connection.on('error', (err) => {
      console.error('[DB] MongoDB connection error:', err.message);
    });
  } catch (err) {
    console.error('[DB] Failed to connect to MongoDB:', err.message);
    process.exit(1);
  }
}

async function disconnectDB() {
  if (!isConnected) return;
  await mongoose.disconnect();
  isConnected = false;
  console.log('[DB] Disconnected from MongoDB');
}

module.exports = { connectDB, disconnectDB };
