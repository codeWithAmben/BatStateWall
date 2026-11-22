// Load environment variables from a local .env file (ignored on Render where env vars are set in the dashboard)
require('dotenv').config();

const express = require('express');
const path = require('path');
const crypto = require('crypto');
const { Pool } = require('pg');

const app = express();

// Trust Render's reverse proxy so req.secure and x-forwarded-proto detect HTTPS accurately
app.set('trust proxy', 1);

const PORT = process.env.PORT || 3000;
const MAX_MESSAGE_LENGTH = 280;
const PG_MAX_INT = 2147483647; // Maximum value for PostgreSQL 32-bit SERIAL/INTEGER

const SESSION_COOKIE = 'batstatewall_session';
const OAUTH_STATE_COOKIE = 'batstatewall_oauth_state';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 128;
const MAX_NAME_LENGTH = 80;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Derive a deterministic fallback secret for local dev if SESSION_SECRET is unset
const SESSION_SECRET =
  process.env.SESSION_SECRET ||
  crypto
    .createHash('sha256')
    .update(process.env.DATABASE_URL || 'batstatewall-local-dev')
    .digest('hex');

if (!process.env.SESSION_SECRET) {
  console.warn(
    'Warning: SESSION_SECRET is not set. Set SESSION_SECRET in .env and Render for production security.'
  );
}

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const GOOGLE_CALLBACK_URL = process.env.GOOGLE_CALLBACK_URL || '';

function isGoogleConfigured() {
  return Boolean(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET);
}

// Warn on startup if DATABASE_URL is missing so local configuration mistakes are easy to spot
if (!process.env.DATABASE_URL) {
  console.warn('Warning: DATABASE_URL is not set. Database queries will fail until it is configured.');
}

// Create a reusable PostgreSQL connection pool for Supabase (SSL required)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// Log unexpected background errors from idle pool clients
pool.on('error', (err) => {
  console.error('Unexpected PostgreSQL pool error:', err);
});

/**
 * Ensures the users and items tables exist without delaying server startup / port binding.
 */
async function ensureSchema() {
  if (!process.env.DATABASE_URL) {
    return;
  }

  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT,
        google_id TEXT UNIQUE,
        avatar_url TEXT,
        auth_provider TEXT NOT NULL DEFAULT 'local',
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS items (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        message TEXT NOT NULL,
        user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    await pool.query(
      'ALTER TABLE items ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;'
    );
  } catch (err) {
    console.error('Warning: Automatic schema check failed:', err.message);
  }
}

/**
 * Wraps Node's built-in crypto.scrypt in a Promise for clean async/await password hashing.
 */
function scryptAsync(password, salt) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, 64, (err, derivedKey) => {
      if (err) {
        return reject(err);
      }
      return resolve(derivedKey);
    });
  });
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derivedKey = await scryptAsync(password, salt);
  return `${salt}:${derivedKey.toString('hex')}`;
}

async function verifyPassword(password, storedHash) {
  if (typeof storedHash !== 'string' || !storedHash.includes(':')) {
    return false;
  }
  const [salt, expectedHex] = storedHash.split(':');
  if (!salt || !expectedHex) {
    return false;
  }
  const derivedKey = await scryptAsync(password, salt);
  const expectedBuffer = Buffer.from(expectedHex, 'hex');
  if (derivedKey.length !== expectedBuffer.length) {
    return false;
  }
  return crypto.timingSafeEqual(derivedKey, expectedBuffer);
}

/**
 * Parses HTTP Cookie header into a key/value map without external middleware.
 */
function parseCookies(req) {
  const header = req.headers.cookie;
  const cookies = {};
  if (!header) {
    return cookies;
  }

  for (const part of header.split(';')) {
    const eqIndex = part.indexOf('=');
    if (eqIndex === -1) {
      continue;
    }
    const key = part.slice(0, eqIndex).trim();
    const rawValue = part.slice(eqIndex + 1).trim();
    if (!key) {
      continue;
    }
    try {
      cookies[key] = decodeURIComponent(rawValue);
    } catch {
      cookies[key] = rawValue;
    }
  }
  return cookies;
}

/**
 * Creates an HMAC-SHA256 signed session token containing the user ID and expiration.
 */
function signSessionToken(userId) {
  const payload = Buffer.from(
    JSON.stringify({ uid: userId, exp: Date.now() + SESSION_TTL_MS }),
    'utf8'
  ).toString('base64url');
  const signature = crypto
    .createHmac('sha256', SESSION_SECRET)
    .update(payload)
    .digest('base64url');
  return `${payload}.${signature}`;
}

function verifySessionToken(token) {
  if (typeof token !== 'string') {
    return null;
  }
  const parts = token.split('.');
  if (parts.length !== 2) {
    return null;
  }
  const [payload, providedSig] = parts;
  if (!payload || !providedSig) {
    return null;
  }

  const expectedSig = crypto
    .createHmac('sha256', SESSION_SECRET)
    .update(payload)
    .digest('base64url');

  const providedBuf = Buffer.from(providedSig, 'utf8');
  const expectedBuf = Buffer.from(expectedSig, 'utf8');
  if (providedBuf.length !== expectedBuf.length) {
    return null;
  }
  if (!crypto.timingSafeEqual(providedBuf, expectedBuf)) {
    return null;
  }

  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (typeof parsed.uid !== 'number' || typeof parsed.exp !== 'number') {
      return null;
    }
    if (Date.now() >= parsed.exp) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function isHttpsRequest(req) {
  return Boolean(req.secure || req.get('x-forwarded-proto') === 'https');
}

function setCookie(res, req, name, value, maxAgeSeconds) {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`,
  ];
  if (isHttpsRequest(req)) {
    parts.push('Secure');
  }
  res.append('Set-Cookie', parts.join('; '));
}

function clearCookie(res, req, name) {
  setCookie(res, req, name, '', 0);
}

/**
 * Looks up the currently authenticated user from the signed session cookie.
 */
async function getAuthenticatedUser(req) {
  const cookies = parseCookies(req);
  const session = verifySessionToken(cookies[SESSION_COOKIE]);
  if (!session) {
    return null;
  }

  const result = await pool.query(
    'SELECT id, name, email, avatar_url, auth_provider FROM users WHERE id = $1',
    [session.uid]
  );
  return result.rows[0] || null;
}

/**
 * Express middleware that requires a valid logged-in session before continuing.
 */
async function requireAuth(req, res, next) {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return res.status(401).json({ error: 'Please log in to post feedback.' });
    }
    req.user = user;
    return next();
  } catch (err) {
    console.error('Error verifying session:', err);
    return res.status(500).json({ error: 'Authentication service unavailable.' });
  }
}

function getGoogleRedirectUri(req) {
  if (GOOGLE_CALLBACK_URL) {
    return GOOGLE_CALLBACK_URL;
  }
  const protocol = isHttpsRequest(req) ? 'https' : 'http';
  return `${protocol}://${req.get('host')}/api/auth/google/callback`;
}

function sanitizeAvatarUrl(url) {
  if (typeof url === 'string' && url.startsWith('https://')) {
    return url;
  }
  return null;
}

// Parse incoming JSON request bodies
app.use(express.json());

// Return a clean 400 JSON error if a client sends malformed JSON
app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({ error: 'Invalid JSON payload.' });
  }
  return next(err);
});

// Serve static frontend files (HTML, CSS, JS) from the /public directory
app.use(express.static(path.join(__dirname, 'public')));

// ==================== Authentication Endpoints ====================

// GET /api/auth/config - Reports whether Google OAuth is configured on the server
app.get('/api/auth/config', (req, res) => {
  return res.status(200).json({ googleEnabled: isGoogleConfigured() });
});

// GET /api/auth/me - Returns the currently logged-in user or { user: null }
app.get('/api/auth/me', async (req, res) => {
  const cookies = parseCookies(req);
  const session = verifySessionToken(cookies[SESSION_COOKIE]);
  if (!session) {
    return res.status(200).json({ user: null });
  }

  try {
    const result = await pool.query(
      'SELECT id, name, email, avatar_url, auth_provider FROM users WHERE id = $1',
      [session.uid]
    );
    if (result.rows.length === 0) {
      clearCookie(res, req, SESSION_COOKIE);
      return res.status(200).json({ user: null });
    }
    return res.status(200).json({ user: result.rows[0] });
  } catch (err) {
    console.error('Error fetching current user:', err);
    return res.status(500).json({ error: 'Failed to load user session.' });
  }
});

// POST /api/auth/register - Create a new account with name, email, and password
app.post('/api/auth/register', async (req, res) => {
  const { name, email, password } = req.body || {};

  const trimmedName = typeof name === 'string' ? name.trim() : '';
  const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
  const rawPassword = typeof password === 'string' ? password : '';

  if (!trimmedName && !normalizedEmail && !rawPassword) {
    return res.status(400).json({ error: 'Name, email, and password are required.' });
  }
  if (trimmedName.length < 2 || trimmedName.length > MAX_NAME_LENGTH) {
    return res.status(400).json({ error: 'Name must be between 2 and 80 characters.' });
  }
  if (!EMAIL_REGEX.test(normalizedEmail)) {
    return res.status(400).json({ error: 'Please enter a valid email address.' });
  }
  if (rawPassword.length < MIN_PASSWORD_LENGTH || rawPassword.length > MAX_PASSWORD_LENGTH) {
    return res.status(400).json({ error: 'Password must be between 8 and 128 characters.' });
  }

  try {
    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [normalizedEmail]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'An account with this email already exists.' });
    }

    const passwordHash = await hashPassword(rawPassword);
    const result = await pool.query(
      `INSERT INTO users (name, email, password_hash, auth_provider)
       VALUES ($1, $2, $3, 'local')
       RETURNING id, name, email, avatar_url, auth_provider`,
      [trimmedName, normalizedEmail, passwordHash]
    );

    const user = result.rows[0];
    setCookie(res, req, SESSION_COOKIE, signSessionToken(user.id), Math.floor(SESSION_TTL_MS / 1000));
    return res.status(201).json({ user });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'An account with this email already exists.' });
    }
    console.error('Error registering user:', err);
    return res.status(500).json({ error: 'Failed to create account. Please try again later.' });
  }
});

// POST /api/auth/login - Authenticate with email and password
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body || {};

  const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
  const rawPassword = typeof password === 'string' ? password : '';

  if (!normalizedEmail || !rawPassword) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  try {
    const result = await pool.query(
      'SELECT id, name, email, password_hash, avatar_url, auth_provider FROM users WHERE email = $1',
      [normalizedEmail]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const userRow = result.rows[0];
    if (!userRow.password_hash) {
      return res.status(401).json({
        error: 'This account uses Google sign-in. Please continue with Google.',
      });
    }

    const passwordMatches = await verifyPassword(rawPassword, userRow.password_hash);
    if (!passwordMatches) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const user = {
      id: userRow.id,
      name: userRow.name,
      email: userRow.email,
      avatar_url: userRow.avatar_url,
      auth_provider: userRow.auth_provider,
    };

    setCookie(res, req, SESSION_COOKIE, signSessionToken(user.id), Math.floor(SESSION_TTL_MS / 1000));
    return res.status(200).json({ user });
  } catch (err) {
    console.error('Error logging in:', err);
    return res.status(500).json({ error: 'Failed to log in. Please try again later.' });
  }
});

// POST /api/auth/logout - Clear the current session cookie
app.post('/api/auth/logout', (req, res) => {
  clearCookie(res, req, SESSION_COOKIE);
  return res.status(200).json({ message: 'Logged out successfully.' });
});

// GET /api/auth/google - Start Google (Gmail) OAuth 2.0 login flow
app.get('/api/auth/google', (req, res) => {
  if (!isGoogleConfigured()) {
    if (req.accepts('html', 'json') === 'json') {
      return res.status(503).json({ error: 'Google login is not configured on this server.' });
    }
    return res.redirect('/?auth_error=google_not_configured');
  }

  const state = crypto.randomBytes(16).toString('hex');
  setCookie(res, req, OAUTH_STATE_COOKIE, state, 600);

  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authUrl.searchParams.set('client_id', GOOGLE_CLIENT_ID);
  authUrl.searchParams.set('redirect_uri', getGoogleRedirectUri(req));
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', 'openid email profile');
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('prompt', 'select_account');

  return res.redirect(authUrl.toString());
});

// GET /api/auth/google/callback - Handle Google OAuth 2.0 callback
app.get('/api/auth/google/callback', async (req, res) => {
  if (!isGoogleConfigured()) {
    return res.redirect('/?auth_error=google_not_configured');
  }

  const cookies = parseCookies(req);
  const expectedState = cookies[OAUTH_STATE_COOKIE];
  clearCookie(res, req, OAUTH_STATE_COOKIE);

  if (req.query.error) {
    return res.redirect('/?auth_error=google_cancelled');
  }

  const code = typeof req.query.code === 'string' ? req.query.code : '';
  const state = typeof req.query.state === 'string' ? req.query.state : '';
  if (!code || !state || !expectedState || state !== expectedState) {
    return res.redirect('/?auth_error=google_failed');
  }

  try {
    // Exchange authorization code for an access token
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: getGoogleRedirectUri(req),
        grant_type: 'authorization_code',
      }),
    });

    if (!tokenRes.ok) {
      console.error('Google token exchange failed:', await tokenRes.text());
      return res.redirect('/?auth_error=google_failed');
    }

    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) {
      return res.redirect('/?auth_error=google_failed');
    }

    // Fetch the authenticated Google / Gmail user profile
    const profileRes = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });

    if (!profileRes.ok) {
      console.error('Google userinfo fetch failed:', await profileRes.text());
      return res.redirect('/?auth_error=google_failed');
    }

    const profile = await profileRes.json();
    if (!profile.sub || !profile.email || profile.email_verified === false) {
      return res.redirect('/?auth_error=google_failed');
    }

    const email = profile.email.trim().toLowerCase();
    const displayName =
      typeof profile.name === 'string' && profile.name.trim()
        ? profile.name.trim().slice(0, MAX_NAME_LENGTH)
        : email.split('@')[0].slice(0, MAX_NAME_LENGTH);
    const avatarUrl = sanitizeAvatarUrl(profile.picture);

    // Find an existing user by google_id or matching email, otherwise create one
    const existing = await pool.query(
      'SELECT id, name, email, google_id, avatar_url, auth_provider FROM users WHERE google_id = $1 OR email = $2',
      [profile.sub, email]
    );

    let user;
    if (existing.rows.length > 0) {
      const updated = await pool.query(
        `UPDATE users
         SET google_id = COALESCE(google_id, $1),
             avatar_url = COALESCE($2, avatar_url)
         WHERE id = $3
         RETURNING id, name, email, avatar_url, auth_provider`,
        [profile.sub, avatarUrl, existing.rows[0].id]
      );
      user = updated.rows[0];
    } else {
      const inserted = await pool.query(
        `INSERT INTO users (name, email, google_id, avatar_url, auth_provider)
         VALUES ($1, $2, $3, $4, 'google')
         RETURNING id, name, email, avatar_url, auth_provider`,
        [displayName, email, profile.sub, avatarUrl]
      );
      user = inserted.rows[0];
    }

    setCookie(res, req, SESSION_COOKIE, signSessionToken(user.id), Math.floor(SESSION_TTL_MS / 1000));
    return res.redirect('/?auth=google_success');
  } catch (err) {
    console.error('Google OAuth callback error:', err);
    return res.redirect('/?auth_error=google_failed');
  }
});

// ==================== Feedback Items Endpoints ====================

// GET /api/items - Fetch all feedback items, newest first
app.get('/api/items', async (req, res) => {
  try {
    const query = `
      SELECT i.id, i.name, i.message, i.user_id, i.created_at,
             u.avatar_url, u.auth_provider
      FROM items i
      LEFT JOIN users u ON i.user_id = u.id
      ORDER BY i.created_at DESC, i.id DESC
    `;
    const result = await pool.query(query);
    return res.status(200).json(result.rows);
  } catch (err) {
    console.error('Error fetching items:', err);
    return res.status(500).json({ error: 'Failed to load messages. Please try again later.' });
  }
});

// POST /api/items - Validate and save a new feedback item (requires login)
app.post('/api/items', requireAuth, async (req, res) => {
  const { name, message } = req.body || {};

  // Default to the signed-in user's name only when name is omitted, keeping empty-string 400 validation
  const trimmedName =
    name === undefined ? req.user.name : typeof name === 'string' ? name.trim() : '';
  const trimmedMessage = typeof message === 'string' ? message.trim() : '';

  if (!trimmedName && !trimmedMessage) {
    return res.status(400).json({ error: 'Name and message are required.' });
  }
  if (!trimmedName) {
    return res.status(400).json({ error: 'Name is required.' });
  }
  if (!trimmedMessage) {
    return res.status(400).json({ error: 'Message is required.' });
  }
  if (trimmedMessage.length > MAX_MESSAGE_LENGTH) {
    return res.status(400).json({ error: 'Message must be 280 characters or fewer.' });
  }

  try {
    // Parameterized query ($1, $2, $3) protects against SQL injection
    const query = `
      INSERT INTO items (name, message, user_id)
      VALUES ($1, $2, $3)
      RETURNING id, name, message, user_id, created_at
    `;
    const values = [trimmedName, trimmedMessage, req.user.id];
    const result = await pool.query(query, values);

    return res.status(201).json({
      ...result.rows[0],
      avatar_url: req.user.avatar_url,
      auth_provider: req.user.auth_provider,
    });
  } catch (err) {
    console.error('Error creating item:', err);
    return res.status(500).json({ error: 'Failed to save your message. Please try again later.' });
  }
});

// GET /api/items/:id - Fetch a single feedback item by numeric ID
app.get('/api/items/:id', async (req, res) => {
  const rawId = req.params.id;

  // Check strictly for digits so strings like "12abc" are rejected with 400
  if (!/^\d+$/.test(rawId)) {
    return res.status(400).json({ error: 'Invalid ID. ID must be a number.' });
  }

  const id = Number(rawId);
  if (!Number.isSafeInteger(id) || id < 1) {
    return res.status(400).json({ error: 'Invalid ID. ID must be a positive number.' });
  }

  // Values above PostgreSQL's 32-bit INTEGER max cannot exist in a SERIAL column
  if (id > PG_MAX_INT) {
    return res.status(404).json({ error: 'Item not found.' });
  }

  try {
    const query = `
      SELECT i.id, i.name, i.message, i.user_id, i.created_at,
             u.avatar_url, u.auth_provider
      FROM items i
      LEFT JOIN users u ON i.user_id = u.id
      WHERE i.id = $1
    `;
    const result = await pool.query(query, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Item not found.' });
    }

    return res.status(200).json(result.rows[0]);
  } catch (err) {
    console.error('Error fetching item:', err);
    return res.status(500).json({ error: 'Failed to load the requested message.' });
  }
});

// Bind to 0.0.0.0 so Render's port scanner and local requests can both reach the server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`BatStateWall server running on http://localhost:${PORT}`);
  ensureSchema();
});
