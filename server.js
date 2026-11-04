require('dotenv').config();
const express = require('express');
const { missing } = require('./lib/config');

// A missing setting would make the requires in app.js throw, and Vercel would
// show only FUNCTION_INVOCATION_FAILED. Say which ones instead — names only,
// never values.
let app;
if (missing.length) {
  console.error(`⚠️  Missing settings: ${missing.join(', ')}`);
  app = express();
  app.use((_req, res) => res.status(500).type('text/plain')
    .send(`Clientline is not configured. Missing environment variables: ${missing.join(', ')}`));
} else {
  app = require('./app');
}

module.exports = app;

// Vercel imports the app; locally it listens.
if (require.main === module) {
  const PORT = Number(process.env.PORT) || 3001;
  const ready = app.ensureDb ? app.ensureDb() : Promise.resolve();
  ready
    .catch((err) => console.error(`⚠️  ${err.message}`))
    .finally(() => app.listen(PORT, () => console.log(`Clientline on http://localhost:${PORT}`)));
}
