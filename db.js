const mongoose = require('mongoose');
// Registers the shared account store on this connection (lib/authDb.js).
require('./lib/authDb');

/**
 * One connection to the Atlas cluster. The default database is Clientline's
 * own; the account store is reached through lib/authDb.js on the same pool.
 */
async function connect() {
  // Same rule as lib/authDb.js: Vercel's default 'production' counts as prod.
  const env = ['prod', 'production'].includes(process.env.NODE_ENV) ? 'prod' : 'dev';
  const uri = env === 'prod' ? process.env.MONGODB_URI_PROD : process.env.MONGODB_URI_DEV;
  if (!uri) throw new Error(`MONGODB_URI_${env.toUpperCase()} is not set`);

  // Fail fast instead of queuing operations while the database is unreachable.
  mongoose.set('bufferCommands', false);

  await mongoose.connect(uri, {
    maxPoolSize: 5,              // small pool for serverless: each instance has its own
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45000,
  });
  console.log(`✅  Connected to MongoDB (${env}: ${mongoose.connection.name}, accounts in ${require('./lib/authDb').name})`);
}

module.exports = { connect };
