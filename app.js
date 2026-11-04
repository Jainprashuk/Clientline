const express = require('express');
const compression = require('compression');
const mongoose = require('mongoose');
const path = require('path');
const db = require('./db');
const { resolveSession } = require('./lib/session');
const authRoutes = require('./routes/auth');

const app = express();
app.set('trust proxy', true);
// Inngest's responses are signed; compressing them breaks the check.
app.use(compression({ filter: (req, res) => !req.path.startsWith('/api/inngest') && compression.filter(req, res) }));
app.use(express.json({ limit: '1mb' }));

// ── Database ────────────────────────────────────────────────────────────────
// One connection attempt shared by every request of a cold start; reset on
// failure so the next request retries.
let _dbConnecting = null;
const ensureDb = async () => {
  if (mongoose.connection.readyState === 1) return;
  if (!_dbConnecting) {
    _dbConnecting = db.connect().catch((err) => { _dbConnecting = null; throw err; });
  }
  await _dbConnecting;
};

// ── Auth ────────────────────────────────────────────────────────────────────
// Exactly the endpoints that cannot require a session, because they are how one
// is obtained. An exact set, never a prefix, so a new route under /api/auth
// cannot become public by accident.
const PUBLIC_AUTH_PATHS = new Set([
  '/api/auth/request-code',
  '/api/auth/request-access',
  '/api/auth/verify-code',
  '/api/auth/logout',
  '/api/auth/session',
]);

const requireAuth = async (req, res, next) => {
  if (req.path === '/login' || PUBLIC_AUTH_PATHS.has(req.path)) return next();
  // The login page's stylesheet.
  if (req.path.startsWith('/css/')) return next();
  // The SPA shell is public: it asks /api/auth/session itself and sends a
  // signed-out visitor to /login. All data stays behind /api below.
  if (req.path === '/app' || req.path.startsWith('/app/')) return next();

  try {
    await ensureDb();
    const session = await resolveSession(req);
    if (session) {
      req.session = session;
      req.userId = session.userId;
      return next();
    }
  } catch (err) {
    return res.status(503).json({ error: `Database not available: ${err.message}` });
  }

  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Unauthorized' });
  res.redirect('/login');
};

// The auth routes reach the database before requireAuth has had a reason to.
app.use('/api/auth', async (_req, res, next) => {
  try { await ensureDb(); next(); } catch (err) { res.status(503).json({ error: `Database not available: ${err.message}` }); }
});
// The unsubscribe link in outreach emails: public by design — the signed token is
// the proof (routes/unsubscribe.js). Mounted ahead of requireAuth, exact prefix.
app.use('/u', async (_req, res, next) => {
  try { await ensureDb(); next(); } catch (err) { res.status(503).send('Please try again in a minute.'); }
}, express.urlencoded({ extended: false }), require('./routes/unsubscribe'));
// Background work (lib/outreach/inngest.js). Inngest signs its calls with
// INNGEST_SIGNING_KEY; the SDK checks that, so it sits ahead of requireAuth.
{
  const { serve } = require('inngest/express');
  const { inngest } = require('./inngest');
  const { outreachSendRun, outreachMailboxHourly, outreachMailboxCheck } = require('./lib/outreach/inngest');
  app.use('/api/inngest', serve({ client: inngest, functions: [outreachSendRun, outreachMailboxHourly, outreachMailboxCheck] }));
}
app.use(requireAuth);
app.use('/api/auth', authRoutes);
app.use('/api/connections', require('./routes/connections'));
app.use('/api/profile', require('./routes/profile'));
app.use('/api/leads', require('./routes/leads'));
app.use('/api/sources', require('./routes/sources'));
app.use('/api/outreach', require('./routes/outreach'));
app.use('/api/inbox', require('./routes/inbox'));

// ── Pages ───────────────────────────────────────────────────────────────────
app.get('/login', (_req, res) => res.sendFile(path.join(__dirname, 'login.html')));
app.get('/logout', (_req, res) => res.redirect('/login'));
app.get('/', (_req, res) => res.redirect('/app/'));
app.use('/css', express.static(path.join(__dirname, 'css')));

// React SPA (Vite build).
app.use('/app', express.static(path.join(__dirname, 'client/dist')));
app.get('/app/*', (req, res, next) => {
  // Only client-side routes fall back to index.html; a missing asset 404s
  // rather than coming back as HTML with the wrong MIME type.
  if (/\.\w+$/.test(req.path)) return next();
  res.sendFile(path.join(__dirname, 'client/dist/index.html'));
});

app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

module.exports = app;
module.exports.ensureDb = ensureDb;
