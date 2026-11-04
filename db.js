const mongoose = require('mongoose');
const { prod, mongoUri } = require('./lib/config');
// Registers the shared account store on this connection (lib/authDb.js).
require('./lib/authDb');

/**
 * One connection to the Atlas cluster. The default database is Clientline's
 * own; the account store is reached through lib/authDb.js on the same pool.
 */
async function connect() {
  const env = prod ? 'prod' : 'dev';
  if (!mongoUri) throw new Error('MONGODB_URI is not set');

  // Fail fast instead of queuing operations while the database is unreachable.
  mongoose.set('bufferCommands', false);

  await mongoose.connect(mongoUri, {
    maxPoolSize: 5,              // small pool for serverless: each instance has its own
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45000,
  });
  console.log(`✅  Connected to MongoDB (${env}: ${mongoose.connection.name}, accounts in ${require('./lib/authDb').name})`);
}

module.exports = { connect };
