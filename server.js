// Load environment variables from a local .env file (ignored on Render where env vars are set in the dashboard)
require('dotenv').config();

const express = require('express');
const path = require('path');
const crypto = require('crypto');
const { Pool } = require('pg');
const { containsProfanity } = require('./profanityFilter');
const {
  generatePuzzle,
  pickSmartHint,
  calculateScore,
  getTodayManilaDate,
  getYesterdayManilaDate,
  isValidDifficulty,
  isBoardString,
} = require('./sudokuEngine');

const app = express();

// Trust Render's reverse proxy so req.secure and x-forwarded-proto detect HTTPS accurately
app.set('trust proxy', 1);

const PORT = process.env.PORT || 3000;
const MAX_MESSAGE_LENGTH = 280;
const MAX_REPORT_REASON_LENGTH = 200;
const PG_MAX_INT = 2147483647; // Maximum value for PostgreSQL 32-bit SERIAL/INTEGER

const SESSION_COOKIE = 'batstatewall_session';
const OAUTH_STATE_COOKIE = 'batstatewall_oauth_state';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const MAX_NAME_LENGTH = 80;

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
 * Ensures all required tables and indexes exist without delaying server startup / port binding.
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
        auth_provider TEXT NOT NULL DEFAULT 'google',
        terms_accepted_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS terms_accepted_at TIMESTAMPTZ;');

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

    await pool.query(`
      CREATE TABLE IF NOT EXISTS likes (
        post_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        PRIMARY KEY (post_id, user_id)
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS comments (
        id SERIAL PRIMARY KEY,
        post_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        body TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS reports (
        id SERIAL PRIMARY KEY,
        post_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
        user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        reason TEXT NOT NULL DEFAULT 'Reported by user',
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    await pool.query('CREATE INDEX IF NOT EXISTS idx_likes_post_id ON likes(post_id);');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_comments_post_id ON comments(post_id);');

    await pool.query(`
      CREATE TABLE IF NOT EXISTS sudoku_sessions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        difficulty TEXT NOT NULL CHECK (difficulty IN ('easy', 'medium', 'hard')),
        mode TEXT NOT NULL DEFAULT 'classic' CHECK (mode IN ('classic', 'daily')),
        daily_date DATE,
        puzzle CHAR(81) NOT NULL,
        solution CHAR(81) NOT NULL,
        current_board CHAR(81) NOT NULL,
        notes_json TEXT NOT NULL DEFAULT '{}',
        mistakes INTEGER NOT NULL DEFAULT 0,
        hints_used INTEGER NOT NULL DEFAULT 0,
        score INTEGER NOT NULL DEFAULT 0,
        duration_seconds INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'completed', 'failed', 'abandoned')),
        started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        completed_at TIMESTAMPTZ
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS sudoku_user_stats (
        user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        total_points INTEGER NOT NULL DEFAULT 0,
        games_won INTEGER NOT NULL DEFAULT 0,
        games_played INTEGER NOT NULL DEFAULT 0,
        best_easy_sec INTEGER,
        best_medium_sec INTEGER,
        best_hard_sec INTEGER,
        current_streak INTEGER NOT NULL DEFAULT 0,
        best_streak INTEGER NOT NULL DEFAULT 0,
        last_win_date DATE,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    await pool.query('CREATE INDEX IF NOT EXISTS idx_sudoku_sessions_user_status ON sudoku_sessions(user_id, status);');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_sudoku_sessions_daily ON sudoku_sessions(user_id, mode, daily_date);');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_sudoku_sessions_daily_rank ON sudoku_sessions(mode, daily_date, status, score DESC);');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_sudoku_stats_points ON sudoku_user_stats(total_points DESC);');
  } catch (err) {
    console.error('Warning: Automatic schema check failed:', err.message);
  }
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
 * Extracts verified user ID from the session cookie without hitting the database.
 */
function getOptionalUserId(req) {
  const cookies = parseCookies(req);
  const session = verifySessionToken(cookies[SESSION_COOKIE]);
  return session ? session.uid : null;
}

/**
 * Looks up the currently authenticated user from the signed session cookie.
 */
async function getAuthenticatedUser(req) {
  const userId = getOptionalUserId(req);
  if (!userId) {
    return null;
  }

  const result = await pool.query(
    'SELECT id, name, email, avatar_url, auth_provider, terms_accepted_at FROM users WHERE id = $1',
    [userId]
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
      return res.status(401).json({ error: 'Please log in to continue.' });
    }
    req.user = user;
    return next();
  } catch (err) {
    console.error('Error verifying session:', err);
    return res.status(500).json({ error: 'Authentication service unavailable.' });
  }
}

/**
 * Validates route :id parameters strictly as positive 32-bit PostgreSQL integers.
 */
function parseItemId(rawId) {
  if (!/^\d+$/.test(rawId)) {
    return { status: 400, error: 'Invalid ID. ID must be a number.' };
  }
  const id = Number(rawId);
  if (!Number.isSafeInteger(id) || id < 1) {
    return { status: 400, error: 'Invalid ID. ID must be a positive number.' };
  }
  if (id > PG_MAX_INT) {
    return { status: 404, error: 'Item not found.' };
  }
  return { id };
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

// Clean legal document routes (also usable as Google OAuth Consent Screen URLs)
app.get('/terms', (req, res) => {
  return res.sendFile(path.join(__dirname, 'public', 'terms.html'));
});

app.get('/privacy', (req, res) => {
  return res.sendFile(path.join(__dirname, 'public', 'privacy.html'));
});

// ==================== Authentication Endpoints ====================

// GET /api/auth/config - Reports whether Google OAuth is configured on the server
app.get('/api/auth/config', (req, res) => {
  return res.status(200).json({ googleEnabled: isGoogleConfigured() });
});

// GET /api/auth/me - Returns the currently logged-in user or { user: null }
app.get('/api/auth/me', async (req, res) => {
  const userId = getOptionalUserId(req);
  if (!userId) {
    return res.status(200).json({ user: null });
  }

  try {
    const result = await pool.query(
      'SELECT id, name, email, avatar_url, auth_provider, terms_accepted_at FROM users WHERE id = $1',
      [userId]
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

// POST /api/auth/logout - Clear the current session cookie
app.post('/api/auth/logout', (req, res) => {
  clearCookie(res, req, SESSION_COOKIE);
  return res.status(200).json({ message: 'Logged out successfully.' });
});

// GET /api/auth/google - Start Google (Gmail) OAuth 2.0 login flow after explicit Terms/Privacy consent
app.get('/api/auth/google', (req, res) => {
  if (!isGoogleConfigured()) {
    if (req.accepts('html', 'json') === 'json') {
      return res.status(503).json({ error: 'Google login is not configured on this server.' });
    }
    return res.redirect('/?auth_error=google_not_configured');
  }

  if (req.query.consent !== '1') {
    if (req.accepts('html', 'json') === 'json') {
      return res.status(400).json({
        error: 'You must agree to the Terms of Service and Privacy Policy before continuing.',
      });
    }
    return res.redirect('/?auth_error=terms_required');
  }

  const state = crypto.randomBytes(16).toString('hex');
  setCookie(res, req, OAUTH_STATE_COOKIE, `${state}:consent`, 600);

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
  const rawExpected = typeof cookies[OAUTH_STATE_COOKIE] === 'string' ? cookies[OAUTH_STATE_COOKIE] : '';
  const [expectedState, consentFlag] = rawExpected.split(':');
  clearCookie(res, req, OAUTH_STATE_COOKIE);

  if (req.query.error) {
    return res.redirect('/?auth_error=google_cancelled');
  }

  const code = typeof req.query.code === 'string' ? req.query.code : '';
  const state = typeof req.query.state === 'string' ? req.query.state : '';
  if (!code || !state || !expectedState || state !== expectedState) {
    return res.redirect('/?auth_error=google_failed');
  }
  if (consentFlag !== 'consent') {
    return res.redirect('/?auth_error=terms_required');
  }

  try {
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

    const existing = await pool.query(
      'SELECT id, name, email, google_id, avatar_url, auth_provider FROM users WHERE google_id = $1 OR email = $2',
      [profile.sub, email]
    );

    let user;
    if (existing.rows.length > 0) {
      const updated = await pool.query(
        `UPDATE users
         SET google_id = COALESCE(google_id, $1),
             avatar_url = COALESCE($2, avatar_url),
             terms_accepted_at = COALESCE(terms_accepted_at, NOW())
         WHERE id = $3
         RETURNING id, name, email, avatar_url, auth_provider, terms_accepted_at`,
        [profile.sub, avatarUrl, existing.rows[0].id]
      );
      user = updated.rows[0];
    } else {
      const inserted = await pool.query(
        `INSERT INTO users (name, email, google_id, avatar_url, auth_provider, terms_accepted_at)
         VALUES ($1, $2, $3, $4, 'google', NOW())
         RETURNING id, name, email, avatar_url, auth_provider, terms_accepted_at`,
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

// ==================== Community Stats Endpoint ====================

// GET /api/stats - Returns community metrics for the sidebar and live-feed check
app.get('/api/stats', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        (SELECT COUNT(*)::int FROM items) AS total_posts,
        (SELECT COUNT(*)::int FROM users) AS total_members,
        (SELECT COUNT(*)::int FROM items WHERE created_at >= CURRENT_DATE) AS posts_today,
        (SELECT COALESCE(MAX(id), 0)::int FROM items) AS latest_post_id
    `);
    const row = result.rows[0];
    return res.status(200).json({
      totalPosts: row.total_posts,
      totalMembers: row.total_members,
      postsToday: row.posts_today,
      latestPostId: row.latest_post_id,
    });
  } catch (err) {
    console.error('Error fetching stats:', err);
    return res.status(500).json({ error: 'Failed to load community stats.' });
  }
});

// ==================== Feedback Items & Social Endpoints ====================

// GET /api/items - Fetch feedback items with social counts, sorting, search, filter, and optional pagination
app.get('/api/items', async (req, res) => {
  const viewerId = getOptionalUserId(req);
  const sort = req.query.sort === 'popular' ? 'popular' : 'latest';
  const filter = req.query.filter === 'mine' ? 'mine' : 'all';
  const searchText = typeof req.query.q === 'string' ? req.query.q.trim() : '';

  if (filter === 'mine' && !viewerId) {
    return res.status(200).json([]);
  }

  const params = [viewerId];
  const whereClauses = [];

  if (filter === 'mine') {
    params.push(viewerId);
    whereClauses.push(`i.user_id = $${params.length}`);
  }

  if (searchText) {
    params.push(`%${searchText}%`);
    whereClauses.push(`(i.name ILIKE $${params.length} OR i.message ILIKE $${params.length})`);
  }

  const whereSql = whereClauses.length ? `WHERE ${whereClauses.join(' AND ')}` : '';
  const orderSql =
    sort === 'popular'
      ? 'ORDER BY like_count DESC, i.created_at DESC, i.id DESC'
      : 'ORDER BY i.created_at DESC, i.id DESC';

  let limitSql = '';
  if (req.query.limit !== undefined) {
    const rawLimit = Number(req.query.limit);
    const limit = Number.isFinite(rawLimit) ? Math.min(50, Math.max(1, Math.trunc(rawLimit))) : 10;
    const rawOffset = Number(req.query.offset);
    const offset = Number.isFinite(rawOffset) && rawOffset >= 0 ? Math.trunc(rawOffset) : 0;
    params.push(limit, offset);
    limitSql = `LIMIT $${params.length - 1} OFFSET $${params.length}`;
  }

  try {
    const query = `
      WITH sudoku_ranks AS (
        SELECT user_id,
               RANK() OVER (ORDER BY total_points DESC, games_won DESC, best_streak DESC, user_id ASC)::int AS sudoku_rank
        FROM sudoku_user_stats
        WHERE games_won > 0
      )
      SELECT i.id, i.name, i.message, i.user_id, i.created_at,
             u.avatar_url, u.auth_provider,
             sr.sudoku_rank,
             COALESCE(lc.like_count, 0)::int AS like_count,
             COALESCE(cc.comment_count, 0)::int AS comment_count,
             CASE WHEN $1::int IS NOT NULL AND ul.user_id IS NOT NULL THEN true ELSE false END AS liked_by_me,
             CASE WHEN $1::int IS NOT NULL AND i.user_id = $1::int THEN true ELSE false END AS is_owner
      FROM items i
      LEFT JOIN users u ON i.user_id = u.id
      LEFT JOIN sudoku_ranks sr ON sr.user_id = i.user_id
      LEFT JOIN (SELECT post_id, COUNT(*)::int AS like_count FROM likes GROUP BY post_id) lc ON lc.post_id = i.id
      LEFT JOIN (SELECT post_id, COUNT(*)::int AS comment_count FROM comments GROUP BY post_id) cc ON cc.post_id = i.id
      LEFT JOIN likes ul ON ul.post_id = i.id AND ul.user_id = $1::int
      ${whereSql}
      ${orderSql}
      ${limitSql}
    `;
    const result = await pool.query(query, params);
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
  if (containsProfanity(trimmedName)) {
    return res.status(400).json({ error: 'Please use a respectful name without profanity.' });
  }
  if (containsProfanity(trimmedMessage)) {
    return res.status(400).json({ error: 'Please keep your post respectful. Profanity is not allowed.' });
  }

  try {
    const query = `
      INSERT INTO items (name, message, user_id)
      VALUES ($1, $2, $3)
      RETURNING id, name, message, user_id, created_at
    `;
    const values = [trimmedName, trimmedMessage, req.user.id];
    const result = await pool.query(query, values);

    const rankRes = await pool.query(
      `WITH sudoku_ranks AS (
         SELECT user_id,
                RANK() OVER (ORDER BY total_points DESC, games_won DESC, best_streak DESC, user_id ASC)::int AS sudoku_rank
         FROM sudoku_user_stats
         WHERE games_won > 0
       )
       SELECT sudoku_rank FROM sudoku_ranks WHERE user_id = $1`,
      [req.user.id]
    );
    const sudokuRank = rankRes.rows[0]?.sudoku_rank || null;

    return res.status(201).json({
      ...result.rows[0],
      avatar_url: req.user.avatar_url,
      auth_provider: req.user.auth_provider,
      sudoku_rank: sudokuRank,
      like_count: 0,
      comment_count: 0,
      liked_by_me: false,
      is_owner: true,
    });
  } catch (err) {
    console.error('Error creating item:', err);
    return res.status(500).json({ error: 'Failed to save your message. Please try again later.' });
  }
});

// GET /api/items/:id - Fetch a single feedback item by numeric ID
app.get('/api/items/:id', async (req, res) => {
  const parsed = parseItemId(req.params.id);
  if (parsed.error) {
    return res.status(parsed.status).json({ error: parsed.error });
  }

  const viewerId = getOptionalUserId(req);

  try {
    const query = `
      WITH sudoku_ranks AS (
        SELECT user_id,
               RANK() OVER (ORDER BY total_points DESC, games_won DESC, best_streak DESC, user_id ASC)::int AS sudoku_rank
        FROM sudoku_user_stats
        WHERE games_won > 0
      )
      SELECT i.id, i.name, i.message, i.user_id, i.created_at,
             u.avatar_url, u.auth_provider,
             sr.sudoku_rank,
             COALESCE(lc.like_count, 0)::int AS like_count,
             COALESCE(cc.comment_count, 0)::int AS comment_count,
             CASE WHEN $2::int IS NOT NULL AND ul.user_id IS NOT NULL THEN true ELSE false END AS liked_by_me,
             CASE WHEN $2::int IS NOT NULL AND i.user_id = $2::int THEN true ELSE false END AS is_owner
      FROM items i
      LEFT JOIN users u ON i.user_id = u.id
      LEFT JOIN sudoku_ranks sr ON sr.user_id = i.user_id
      LEFT JOIN (SELECT post_id, COUNT(*)::int AS like_count FROM likes GROUP BY post_id) lc ON lc.post_id = i.id
      LEFT JOIN (SELECT post_id, COUNT(*)::int AS comment_count FROM comments GROUP BY post_id) cc ON cc.post_id = i.id
      LEFT JOIN likes ul ON ul.post_id = i.id AND ul.user_id = $2::int
      WHERE i.id = $1
    `;
    const result = await pool.query(query, [parsed.id, viewerId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Item not found.' });
    }

    return res.status(200).json(result.rows[0]);
  } catch (err) {
    console.error('Error fetching item:', err);
    return res.status(500).json({ error: 'Failed to load the requested message.' });
  }
});

// DELETE /api/items/:id - Delete a post owned by the authenticated user
app.delete('/api/items/:id', requireAuth, async (req, res) => {
  const parsed = parseItemId(req.params.id);
  if (parsed.error) {
    return res.status(parsed.status).json({ error: parsed.error });
  }

  try {
    const existing = await pool.query('SELECT id, user_id FROM items WHERE id = $1', [parsed.id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Item not found.' });
    }
    if (existing.rows[0].user_id !== req.user.id) {
      return res.status(403).json({ error: 'You can only delete your own posts.' });
    }

    await pool.query('DELETE FROM items WHERE id = $1', [parsed.id]);
    return res.status(200).json({ deletedId: parsed.id });
  } catch (err) {
    console.error('Error deleting item:', err);
    return res.status(500).json({ error: 'Failed to delete post.' });
  }
});

// POST /api/items/:id/like - Toggle a like on a post for the authenticated user
app.post('/api/items/:id/like', requireAuth, async (req, res) => {
  const parsed = parseItemId(req.params.id);
  if (parsed.error) {
    return res.status(parsed.status).json({ error: parsed.error });
  }

  try {
    const exists = await pool.query('SELECT id FROM items WHERE id = $1', [parsed.id]);
    if (exists.rows.length === 0) {
      return res.status(404).json({ error: 'Item not found.' });
    }

    const existingLike = await pool.query(
      'SELECT 1 FROM likes WHERE post_id = $1 AND user_id = $2',
      [parsed.id, req.user.id]
    );

    let liked = false;
    if (existingLike.rows.length > 0) {
      await pool.query('DELETE FROM likes WHERE post_id = $1 AND user_id = $2', [
        parsed.id,
        req.user.id,
      ]);
      liked = false;
    } else {
      await pool.query(
        'INSERT INTO likes (post_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [parsed.id, req.user.id]
      );
      liked = true;
    }

    const countResult = await pool.query(
      'SELECT COUNT(*)::int AS like_count FROM likes WHERE post_id = $1',
      [parsed.id]
    );

    return res.status(200).json({
      post_id: parsed.id,
      liked,
      like_count: countResult.rows[0].like_count,
    });
  } catch (err) {
    console.error('Error toggling like:', err);
    return res.status(500).json({ error: 'Failed to update like.' });
  }
});

// GET /api/items/:id/comments - Fetch comments for a post ordered oldest first
app.get('/api/items/:id/comments', async (req, res) => {
  const parsed = parseItemId(req.params.id);
  if (parsed.error) {
    return res.status(parsed.status).json({ error: parsed.error });
  }

  const viewerId = getOptionalUserId(req);

  try {
    const exists = await pool.query('SELECT id FROM items WHERE id = $1', [parsed.id]);
    if (exists.rows.length === 0) {
      return res.status(404).json({ error: 'Item not found.' });
    }

    const result = await pool.query(
      `SELECT c.id, c.post_id, c.user_id, c.body, c.created_at,
              u.name AS author_name, u.avatar_url, u.auth_provider,
              CASE WHEN $2::int IS NOT NULL AND c.user_id = $2::int THEN true ELSE false END AS is_owner
       FROM comments c
       JOIN users u ON c.user_id = u.id
       WHERE c.post_id = $1
       ORDER BY c.created_at ASC, c.id ASC`,
      [parsed.id, viewerId]
    );

    return res.status(200).json(result.rows);
  } catch (err) {
    console.error('Error fetching comments:', err);
    return res.status(500).json({ error: 'Failed to load comments.' });
  }
});

// POST /api/items/:id/comments - Add a comment to a post (requires login)
app.post('/api/items/:id/comments', requireAuth, async (req, res) => {
  const parsed = parseItemId(req.params.id);
  if (parsed.error) {
    return res.status(parsed.status).json({ error: parsed.error });
  }

  const rawBody = req.body ? req.body.body : '';
  const trimmedBody = typeof rawBody === 'string' ? rawBody.trim() : '';

  if (!trimmedBody) {
    return res.status(400).json({ error: 'Comment cannot be empty.' });
  }
  if (trimmedBody.length > MAX_MESSAGE_LENGTH) {
    return res.status(400).json({ error: 'Comment must be 280 characters or fewer.' });
  }
  if (containsProfanity(trimmedBody)) {
    return res.status(400).json({ error: 'Please keep your comment respectful. Profanity is not allowed.' });
  }

  try {
    const exists = await pool.query('SELECT id FROM items WHERE id = $1', [parsed.id]);
    if (exists.rows.length === 0) {
      return res.status(404).json({ error: 'Item not found.' });
    }

    const result = await pool.query(
      `INSERT INTO comments (post_id, user_id, body)
       VALUES ($1, $2, $3)
       RETURNING id, post_id, user_id, body, created_at`,
      [parsed.id, req.user.id, trimmedBody]
    );

    return res.status(201).json({
      ...result.rows[0],
      author_name: req.user.name,
      avatar_url: req.user.avatar_url,
      auth_provider: req.user.auth_provider,
      is_owner: true,
    });
  } catch (err) {
    console.error('Error creating comment:', err);
    return res.status(500).json({ error: 'Failed to post comment.' });
  }
});

// POST /api/items/:id/report - Submit a report for a post (requires login)
app.post('/api/items/:id/report', requireAuth, async (req, res) => {
  const parsed = parseItemId(req.params.id);
  if (parsed.error) {
    return res.status(parsed.status).json({ error: parsed.error });
  }

  const rawReason = req.body ? req.body.reason : '';
  const trimmedReason =
    typeof rawReason === 'string' && rawReason.trim()
      ? rawReason.trim().slice(0, MAX_REPORT_REASON_LENGTH)
      : 'Reported by user';

  try {
    const exists = await pool.query('SELECT id FROM items WHERE id = $1', [parsed.id]);
    if (exists.rows.length === 0) {
      return res.status(404).json({ error: 'Item not found.' });
    }

    await pool.query('INSERT INTO reports (post_id, user_id, reason) VALUES ($1, $2, $3)', [
      parsed.id,
      req.user.id,
      trimmedReason,
    ]);

    return res.status(201).json({ message: 'Report submitted. Thank you.' });
  } catch (err) {
    console.error('Error reporting item:', err);
    return res.status(500).json({ error: 'Failed to submit report.' });
  }
});

// ==================== BatStateU Sudoku Arena & Rankings Endpoints ====================

const SUDOKU_MAX_MISTAKES = 3;
const SUDOKU_MAX_HINTS = 3;
const MAX_NOTES_JSON_LENGTH = 8192;

function safeJsonParse(rawText, fallback) {
  try {
    return JSON.parse(rawText);
  } catch {
    return fallback;
  }
}

function sanitizeNotesJson(notes) {
  if (notes === undefined) {
    return { omit: true };
  }
  if (!notes || typeof notes !== 'object' || Array.isArray(notes)) {
    return { error: 'Invalid notes format.' };
  }
  const clean = {};
  for (const [key, list] of Object.entries(notes)) {
    if (!/^(?:[0-9]|[1-7][0-9]|80)$/.test(key) || !Array.isArray(list)) {
      continue;
    }
    const digits = Array.from(
      new Set(list.map((d) => Number(d)).filter((d) => Number.isInteger(d) && d >= 1 && d <= 9))
    ).sort((a, b) => a - b);
    if (digits.length > 0) {
      clean[key] = digits;
    }
  }
  const json = JSON.stringify(clean);
  if (json.length > MAX_NOTES_JSON_LENGTH) {
    return { error: 'Notes payload exceeds size limit.' };
  }
  return { json };
}

function serializeSudokuSession(row) {
  const puzzle = String(row.puzzle || '').trim();
  const currentBoard = String(row.current_board || '').trim();
  const solution = String(row.solution || '').trim();
  const wrongCells = [];

  if (solution.length === 81 && currentBoard.length === 81) {
    for (let i = 0; i < 81; i += 1) {
      if (currentBoard[i] !== '0' && currentBoard[i] !== solution[i]) {
        wrongCells.push(i);
      }
    }
  }

  // Never include `solution` in API responses
  return {
    id: row.id,
    difficulty: row.difficulty,
    mode: row.mode,
    dailyDate: row.daily_date_str || null,
    puzzle,
    currentBoard,
    notes: safeJsonParse(row.notes_json, {}),
    wrongCells,
    mistakes: row.mistakes,
    maxMistakes: SUDOKU_MAX_MISTAKES,
    hintsUsed: row.hints_used,
    maxHints: SUDOKU_MAX_HINTS,
    durationSeconds: row.duration_seconds,
    score: row.score,
    status: row.status,
    startedAt: row.started_at,
  };
}

// GET /api/sudoku/active - Return user's latest in-progress board, daily completion state, and personal stats
app.get('/api/sudoku/active', requireAuth, async (req, res) => {
  const dailyDate = getTodayManilaDate();

  try {
    const activeRes = await pool.query(
      `SELECT id, user_id, difficulty, mode, TO_CHAR(daily_date, 'YYYY-MM-DD') AS daily_date_str,
              puzzle, solution, current_board, notes_json, mistakes, hints_used, score,
              duration_seconds, status, started_at
       FROM sudoku_sessions
       WHERE user_id = $1 AND status = 'in_progress'
       ORDER BY id DESC
       LIMIT 1`,
      [req.user.id]
    );

    const dailyDoneRes = await pool.query(
      `SELECT 1 FROM sudoku_sessions
       WHERE user_id = $1 AND mode = 'daily' AND daily_date = $2::date AND status = 'completed'
       LIMIT 1`,
      [req.user.id, dailyDate]
    );

    const statsRes = await pool.query(
      `SELECT total_points, games_won, games_played, current_streak, best_streak,
              best_easy_sec, best_medium_sec, best_hard_sec
       FROM sudoku_user_stats
       WHERE user_id = $1`,
      [req.user.id]
    );

    return res.status(200).json({
      session: activeRes.rows[0] ? serializeSudokuSession(activeRes.rows[0]) : null,
      dailyDate,
      dailyCompletedToday: dailyDoneRes.rows.length > 0,
      stats: statsRes.rows[0] || {
        total_points: 0,
        games_won: 0,
        games_played: 0,
        current_streak: 0,
        best_streak: 0,
        best_easy_sec: null,
        best_medium_sec: null,
        best_hard_sec: null,
      },
    });
  } catch (err) {
    console.error('Error fetching active sudoku session:', err);
    return res.status(500).json({ error: 'Failed to load Sudoku session.' });
  }
});

// POST /api/sudoku/start - Resume or generate a guaranteed unique-solution Sudoku puzzle
app.post('/api/sudoku/start', requireAuth, async (req, res) => {
  const rawMode = req.body?.mode;
  if (rawMode !== undefined && rawMode !== 'classic' && rawMode !== 'daily') {
    return res.status(400).json({ error: 'Invalid mode. Must be classic or daily.' });
  }
  const mode = rawMode === 'daily' ? 'daily' : 'classic';
  const forceNew = Boolean(req.body?.forceNew);
  const rawDifficulty = req.body?.difficulty || 'easy';

  if (mode !== 'daily' && !isValidDifficulty(rawDifficulty)) {
    return res.status(400).json({ error: 'Invalid difficulty. Must be easy, medium, or hard.' });
  }
  const difficulty = mode === 'daily' ? 'medium' : rawDifficulty;
  const dailyDate = mode === 'daily' ? getTodayManilaDate() : null;

  try {
    if (mode === 'daily') {
      const completedDaily = await pool.query(
        `SELECT id FROM sudoku_sessions
         WHERE user_id = $1 AND mode = 'daily' AND daily_date = $2::date AND status = 'completed'
         LIMIT 1`,
        [req.user.id, dailyDate]
      );
      if (completedDaily.rows.length > 0) {
        return res.status(409).json({
          error: "You already completed today's Daily Spartan Challenge! Come back tomorrow.",
        });
      }

      const activeDaily = await pool.query(
        `SELECT id, user_id, difficulty, mode, TO_CHAR(daily_date, 'YYYY-MM-DD') AS daily_date_str,
                puzzle, solution, current_board, notes_json, mistakes, hints_used, score,
                duration_seconds, status, started_at
         FROM sudoku_sessions
         WHERE user_id = $1 AND mode = 'daily' AND daily_date = $2::date AND status = 'in_progress'
         ORDER BY id DESC
         LIMIT 1`,
        [req.user.id, dailyDate]
      );
      if (activeDaily.rows.length > 0) {
        return res.status(200).json({
          session: serializeSudokuSession(activeDaily.rows[0]),
          resumed: true,
        });
      }
    } else if (!forceNew) {
      const activeClassic = await pool.query(
        `SELECT id, user_id, difficulty, mode, TO_CHAR(daily_date, 'YYYY-MM-DD') AS daily_date_str,
                puzzle, solution, current_board, notes_json, mistakes, hints_used, score,
                duration_seconds, status, started_at
         FROM sudoku_sessions
         WHERE user_id = $1 AND mode = 'classic' AND difficulty = $2 AND status = 'in_progress'
         ORDER BY id DESC
         LIMIT 1`,
        [req.user.id, difficulty]
      );
      if (activeClassic.rows.length > 0) {
        return res.status(200).json({
          session: serializeSudokuSession(activeClassic.rows[0]),
          resumed: true,
        });
      }
    }

    if (mode === 'classic') {
      await pool.query(
        `UPDATE sudoku_sessions
         SET status = 'abandoned', completed_at = NOW()
         WHERE user_id = $1 AND mode = 'classic' AND status = 'in_progress'`,
        [req.user.id]
      );
    }

    const seed = mode === 'daily' ? `batstatewall-daily-${dailyDate}` : null;
    const generated = generatePuzzle(difficulty, seed);

    const inserted = await pool.query(
      `INSERT INTO sudoku_sessions (
         user_id, difficulty, mode, daily_date, puzzle, solution, current_board
       )
       VALUES ($1, $2, $3, $4::date, $5, $6, $5)
       RETURNING id, user_id, difficulty, mode, TO_CHAR(daily_date, 'YYYY-MM-DD') AS daily_date_str,
                 puzzle, solution, current_board, notes_json, mistakes, hints_used, score,
                 duration_seconds, status, started_at`,
      [req.user.id, difficulty, mode, dailyDate, generated.puzzle, generated.solution]
    );

    await pool.query(
      `INSERT INTO sudoku_user_stats (user_id, games_played, updated_at)
       VALUES ($1, 1, NOW())
       ON CONFLICT (user_id) DO UPDATE
       SET games_played = sudoku_user_stats.games_played + 1, updated_at = NOW()`,
      [req.user.id]
    );

    return res.status(201).json({
      session: serializeSudokuSession(inserted.rows[0]),
      resumed: false,
    });
  } catch (err) {
    console.error('Error starting sudoku session:', err);
    return res.status(500).json({ error: 'Failed to start Sudoku game.' });
  }
});

// POST /api/sudoku/:id/move - Validate a move server-side and track mistakes
app.post('/api/sudoku/:id/move', requireAuth, async (req, res) => {
  const parsed = parseItemId(req.params.id);
  if (parsed.error) {
    return res.status(parsed.status).json({ error: parsed.error });
  }

  const index = Number(req.body?.index);
  const value = Number(req.body?.value);
  if (!Number.isInteger(index) || index < 0 || index > 80) {
    return res.status(400).json({ error: 'Invalid cell index.' });
  }
  if (!Number.isInteger(value) || value < 0 || value > 9) {
    return res.status(400).json({ error: 'Invalid digit value.' });
  }

  const notesCheck = sanitizeNotesJson(req.body?.notes);
  if (notesCheck.error) {
    return res.status(400).json({ error: notesCheck.error });
  }

  const rawDuration = Number(req.body?.durationSeconds);
  const reportedDuration = Number.isFinite(rawDuration)
    ? Math.min(86400, Math.max(0, Math.trunc(rawDuration)))
    : 0;

  try {
    const existing = await pool.query(
      `SELECT id, user_id, puzzle, solution, current_board, notes_json, mistakes, status
       FROM sudoku_sessions WHERE id = $1`,
      [parsed.id]
    );
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Sudoku session not found.' });
    }

    const row = existing.rows[0];
    if (row.user_id !== req.user.id) {
      return res.status(403).json({ error: 'You do not own this Sudoku session.' });
    }
    if (row.status !== 'in_progress') {
      return res.status(409).json({ error: 'This Sudoku session is already finished.' });
    }

    const puzzle = row.puzzle.trim();
    const solution = row.solution.trim();
    const boardArr = row.current_board.trim().split('');

    if (puzzle[index] !== '0') {
      return res.status(400).json({ error: 'Given clues cannot be changed.' });
    }

    const nextDigitChar = String(value);
    let correct = true;
    let nextMistakes = row.mistakes;
    let nextStatus = row.status;

    if (value === 0) {
      boardArr[index] = '0';
      correct = true;
    } else if (nextDigitChar === solution[index]) {
      boardArr[index] = nextDigitChar;
      correct = true;
    } else {
      correct = false;
      if (boardArr[index] !== nextDigitChar) {
        nextMistakes += 1;
      }
      boardArr[index] = nextDigitChar;
      if (nextMistakes >= SUDOKU_MAX_MISTAKES) {
        nextStatus = 'failed';
      }
    }

    const nextBoard = boardArr.join('');
    const nextNotesJson = notesCheck.omit ? row.notes_json : notesCheck.json;

    await pool.query(
      `UPDATE sudoku_sessions
       SET current_board = $1,
           notes_json = $2,
           mistakes = $3,
           duration_seconds = GREATEST(duration_seconds, $4),
           status = $5,
           completed_at = CASE WHEN $5 = 'failed' THEN NOW() ELSE completed_at END
       WHERE id = $6`,
      [nextBoard, nextNotesJson, nextMistakes, reportedDuration, nextStatus, parsed.id]
    );

    return res.status(200).json({
      correct,
      mistakes: nextMistakes,
      maxMistakes: SUDOKU_MAX_MISTAKES,
      status: nextStatus,
      currentBoard: nextBoard,
      isSolved: nextStatus === 'in_progress' && nextBoard === solution,
    });
  } catch (err) {
    console.error('Error recording sudoku move:', err);
    return res.status(500).json({ error: 'Failed to save Sudoku move.' });
  }
});

// POST /api/sudoku/:id/hint - Reveal the most constrained logical cell (max 3 per game)
app.post('/api/sudoku/:id/hint', requireAuth, async (req, res) => {
  const parsed = parseItemId(req.params.id);
  if (parsed.error) {
    return res.status(parsed.status).json({ error: parsed.error });
  }

  const rawDuration = Number(req.body?.durationSeconds);
  const reportedDuration = Number.isFinite(rawDuration)
    ? Math.min(86400, Math.max(0, Math.trunc(rawDuration)))
    : 0;

  try {
    const existing = await pool.query(
      `SELECT id, user_id, solution, current_board, hints_used, status
       FROM sudoku_sessions WHERE id = $1`,
      [parsed.id]
    );
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Sudoku session not found.' });
    }

    const row = existing.rows[0];
    if (row.user_id !== req.user.id) {
      return res.status(403).json({ error: 'You do not own this Sudoku session.' });
    }
    if (row.status !== 'in_progress') {
      return res.status(409).json({ error: 'This Sudoku session is already finished.' });
    }
    if (row.hints_used >= SUDOKU_MAX_HINTS) {
      return res.status(400).json({ error: 'No hints remaining for this puzzle.' });
    }

    const currentBoard = row.current_board.trim();
    const solution = row.solution.trim();
    const hint = pickSmartHint(currentBoard, solution);
    if (!hint) {
      return res.status(400).json({ error: 'Puzzle is already solved.' });
    }

    const boardArr = currentBoard.split('');
    boardArr[hint.index] = String(hint.value);
    const nextBoard = boardArr.join('');
    const nextHintsUsed = row.hints_used + 1;

    await pool.query(
      `UPDATE sudoku_sessions
       SET current_board = $1,
           hints_used = $2,
           duration_seconds = GREATEST(duration_seconds, $3)
       WHERE id = $4`,
      [nextBoard, nextHintsUsed, reportedDuration, parsed.id]
    );

    return res.status(200).json({
      index: hint.index,
      value: hint.value,
      hintsUsed: nextHintsUsed,
      maxHints: SUDOKU_MAX_HINTS,
      currentBoard: nextBoard,
      isSolved: nextBoard === solution,
    });
  } catch (err) {
    console.error('Error revealing sudoku hint:', err);
    return res.status(500).json({ error: 'Failed to generate hint.' });
  }
});

// POST /api/sudoku/:id/complete - Verify final board inside a transaction, compute score & update rankings
app.post('/api/sudoku/:id/complete', requireAuth, async (req, res) => {
  const parsed = parseItemId(req.params.id);
  if (parsed.error) {
    return res.status(parsed.status).json({ error: parsed.error });
  }

  const submittedBoard = req.body?.board;
  if (submittedBoard !== undefined && !isBoardString(submittedBoard)) {
    return res.status(400).json({ error: 'Invalid board string.' });
  }

  const rawDuration = Number(req.body?.durationSeconds);
  const reportedDuration = Number.isFinite(rawDuration)
    ? Math.min(86400, Math.max(1, Math.trunc(rawDuration)))
    : 1;

  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');

    const sessionRes = await client.query(
      `SELECT id, user_id, difficulty, mode, TO_CHAR(daily_date, 'YYYY-MM-DD') AS daily_date_str,
              solution, current_board, mistakes, hints_used, duration_seconds, status, started_at
       FROM sudoku_sessions
       WHERE id = $1
       FOR UPDATE`,
      [parsed.id]
    );

    if (sessionRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Sudoku session not found.' });
    }

    const session = sessionRes.rows[0];
    if (session.user_id !== req.user.id) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'You do not own this Sudoku session.' });
    }
    if (session.status !== 'in_progress') {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'This Sudoku session has already ended.' });
    }

    const finalBoard = (submittedBoard || session.current_board).trim();
    const solution = session.solution.trim();
    if (finalBoard !== solution) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Puzzle solution is incomplete or contains errors.' });
    }

    const elapsedWallSec = Math.max(
      1,
      Math.floor((Date.now() - new Date(session.started_at).getTime()) / 1000)
    );
    const finalDuration = Math.max(
      1,
      session.duration_seconds,
      Math.min(reportedDuration, elapsedWallSec + 5)
    );

    const statsRes = await client.query(
      `SELECT current_streak, best_streak, TO_CHAR(last_win_date, 'YYYY-MM-DD') AS last_win_date_str
       FROM sudoku_user_stats
       WHERE user_id = $1
       FOR UPDATE`,
      [req.user.id]
    );

    const existingStats = statsRes.rows[0] || null;
    const todayManila = getTodayManilaDate();
    const yesterdayManila = getYesterdayManilaDate(todayManila);
    const lastWin = existingStats ? existingStats.last_win_date_str : null;

    let nextStreak = 1;
    if (lastWin === todayManila) {
      nextStreak = Math.max(1, existingStats.current_streak);
    } else if (lastWin === yesterdayManila) {
      nextStreak = Math.max(0, existingStats.current_streak) + 1;
    }
    const nextBestStreak = Math.max(existingStats ? existingStats.best_streak : 0, nextStreak);

    const breakdown = calculateScore({
      difficulty: session.difficulty,
      durationSeconds: finalDuration,
      mistakes: session.mistakes,
      hintsUsed: session.hints_used,
      streakDays: nextStreak,
    });

    await client.query(
      `UPDATE sudoku_sessions
       SET status = 'completed',
           current_board = $1,
           score = $2,
           duration_seconds = $3,
           completed_at = NOW()
       WHERE id = $4`,
      [finalBoard, breakdown.total, finalDuration, parsed.id]
    );

    const easySec = session.difficulty === 'easy' ? finalDuration : null;
    const mediumSec = session.difficulty === 'medium' ? finalDuration : null;
    const hardSec = session.difficulty === 'hard' ? finalDuration : null;

    await client.query(
      `INSERT INTO sudoku_user_stats (
         user_id, total_points, games_won, games_played,
         best_easy_sec, best_medium_sec, best_hard_sec,
         current_streak, best_streak, last_win_date, updated_at
       )
       VALUES ($1, $2, 1, 1, $3, $4, $5, $6, $7, $8::date, NOW())
       ON CONFLICT (user_id) DO UPDATE SET
         total_points = sudoku_user_stats.total_points + EXCLUDED.total_points,
         games_won = sudoku_user_stats.games_won + 1,
         best_easy_sec = CASE
           WHEN EXCLUDED.best_easy_sec IS NULL THEN sudoku_user_stats.best_easy_sec
           ELSE LEAST(COALESCE(sudoku_user_stats.best_easy_sec, EXCLUDED.best_easy_sec), EXCLUDED.best_easy_sec)
         END,
         best_medium_sec = CASE
           WHEN EXCLUDED.best_medium_sec IS NULL THEN sudoku_user_stats.best_medium_sec
           ELSE LEAST(COALESCE(sudoku_user_stats.best_medium_sec, EXCLUDED.best_medium_sec), EXCLUDED.best_medium_sec)
         END,
         best_hard_sec = CASE
           WHEN EXCLUDED.best_hard_sec IS NULL THEN sudoku_user_stats.best_hard_sec
           ELSE LEAST(COALESCE(sudoku_user_stats.best_hard_sec, EXCLUDED.best_hard_sec), EXCLUDED.best_hard_sec)
         END,
         current_streak = EXCLUDED.current_streak,
         best_streak = GREATEST(sudoku_user_stats.best_streak, EXCLUDED.best_streak),
         last_win_date = EXCLUDED.last_win_date,
         updated_at = NOW()`,
      [req.user.id, breakdown.total, easySec, mediumSec, hardSec, nextStreak, nextBestStreak, todayManila]
    );

    const rankRes = await client.query(
      `WITH ranked AS (
         SELECT user_id,
                RANK() OVER (ORDER BY total_points DESC, games_won DESC, best_streak DESC, user_id ASC)::int AS rank
         FROM sudoku_user_stats
         WHERE games_won > 0
       )
       SELECT rank FROM ranked WHERE user_id = $1`,
      [req.user.id]
    );

    await client.query('COMMIT');

    return res.status(200).json({
      score: breakdown.total,
      breakdown,
      durationSeconds: finalDuration,
      rank: rankRes.rows[0]?.rank || 1,
      streak: nextStreak,
      bestStreak: nextBestStreak,
      difficulty: session.difficulty,
      mode: session.mode,
      mistakes: session.mistakes,
      hintsUsed: session.hints_used,
    });
  } catch (err) {
    if (client) {
      await client.query('ROLLBACK').catch(() => {});
    }
    console.error('Error completing sudoku session:', err);
    return res.status(500).json({ error: 'Failed to record Sudoku completion.' });
  } finally {
    if (client) {
      client.release();
    }
  }
});

// POST /api/sudoku/:id/abandon - Mark an active session as abandoned
app.post('/api/sudoku/:id/abandon', requireAuth, async (req, res) => {
  const parsed = parseItemId(req.params.id);
  if (parsed.error) {
    return res.status(parsed.status).json({ error: parsed.error });
  }

  try {
    const existing = await pool.query('SELECT id, user_id, status FROM sudoku_sessions WHERE id = $1', [
      parsed.id,
    ]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Sudoku session not found.' });
    }
    if (existing.rows[0].user_id !== req.user.id) {
      return res.status(403).json({ error: 'You do not own this Sudoku session.' });
    }
    if (existing.rows[0].status === 'in_progress') {
      await pool.query(
        "UPDATE sudoku_sessions SET status = 'abandoned', completed_at = NOW() WHERE id = $1",
        [parsed.id]
      );
    }
    return res.status(200).json({ abandonedId: parsed.id });
  } catch (err) {
    console.error('Error abandoning sudoku session:', err);
    return res.status(500).json({ error: 'Failed to abandon Sudoku session.' });
  }
});

// GET /api/sudoku/rankings - Public community Sudoku leaderboard (Overall, Daily, or Difficulty Best Time)
app.get('/api/sudoku/rankings', async (req, res) => {
  const validScopes = new Set(['overall', 'daily', 'easy', 'medium', 'hard']);
  const scope = validScopes.has(req.query.scope) ? req.query.scope : 'overall';
  const rawLimit = Number(req.query.limit);
  const limit = Number.isFinite(rawLimit) ? Math.min(50, Math.max(1, Math.trunc(rawLimit))) : 5;
  const viewerId = getOptionalUserId(req);
  const dailyDate = getTodayManilaDate();

  let cteSql = '';
  let cteParams = [];

  switch (scope) {
    case 'daily':
      cteSql = `
        WITH best_daily AS (
          SELECT DISTINCT ON (ss.user_id)
            ss.user_id,
            ss.score,
            ss.duration_seconds,
            ss.completed_at
          FROM sudoku_sessions ss
          WHERE ss.mode = 'daily'
            AND ss.daily_date = $1::date
            AND ss.status = 'completed'
          ORDER BY ss.user_id, ss.score DESC, ss.duration_seconds ASC, ss.completed_at ASC
        ),
        ranked AS (
          SELECT
            RANK() OVER (ORDER BY bd.score DESC, bd.duration_seconds ASC, bd.completed_at ASC, u.id ASC)::int AS rank,
            u.id AS user_id,
            u.name,
            u.avatar_url,
            u.auth_provider,
            COALESCE(s.total_points, bd.score)::int AS total_points,
            COALESCE(s.games_won, 1)::int AS games_won,
            COALESCE(s.current_streak, 1)::int AS current_streak,
            COALESCE(s.best_streak, 1)::int AS best_streak,
            bd.duration_seconds AS best_time_sec,
            bd.score,
            bd.duration_seconds
          FROM best_daily bd
          JOIN users u ON u.id = bd.user_id
          LEFT JOIN sudoku_user_stats s ON s.user_id = bd.user_id
        )
      `;
      cteParams = [dailyDate];
      break;

    case 'easy':
      cteSql = `
        WITH ranked AS (
          SELECT
            RANK() OVER (ORDER BY s.best_easy_sec ASC, s.total_points DESC, u.id ASC)::int AS rank,
            u.id AS user_id,
            u.name,
            u.avatar_url,
            u.auth_provider,
            s.total_points,
            s.games_won,
            s.current_streak,
            s.best_streak,
            s.best_easy_sec AS best_time_sec,
            s.total_points AS score,
            s.best_easy_sec AS duration_seconds
          FROM sudoku_user_stats s
          JOIN users u ON u.id = s.user_id
          WHERE s.best_easy_sec IS NOT NULL
        )
      `;
      break;

    case 'medium':
      cteSql = `
        WITH ranked AS (
          SELECT
            RANK() OVER (ORDER BY s.best_medium_sec ASC, s.total_points DESC, u.id ASC)::int AS rank,
            u.id AS user_id,
            u.name,
            u.avatar_url,
            u.auth_provider,
            s.total_points,
            s.games_won,
            s.current_streak,
            s.best_streak,
            s.best_medium_sec AS best_time_sec,
            s.total_points AS score,
            s.best_medium_sec AS duration_seconds
          FROM sudoku_user_stats s
          JOIN users u ON u.id = s.user_id
          WHERE s.best_medium_sec IS NOT NULL
        )
      `;
      break;

    case 'hard':
      cteSql = `
        WITH ranked AS (
          SELECT
            RANK() OVER (ORDER BY s.best_hard_sec ASC, s.total_points DESC, u.id ASC)::int AS rank,
            u.id AS user_id,
            u.name,
            u.avatar_url,
            u.auth_provider,
            s.total_points,
            s.games_won,
            s.current_streak,
            s.best_streak,
            s.best_hard_sec AS best_time_sec,
            s.total_points AS score,
            s.best_hard_sec AS duration_seconds
          FROM sudoku_user_stats s
          JOIN users u ON u.id = s.user_id
          WHERE s.best_hard_sec IS NOT NULL
        )
      `;
      break;

    default:
      cteSql = `
        WITH ranked AS (
          SELECT
            RANK() OVER (ORDER BY s.total_points DESC, s.games_won DESC, s.best_streak DESC, u.id ASC)::int AS rank,
            u.id AS user_id,
            u.name,
            u.avatar_url,
            u.auth_provider,
            s.total_points,
            s.games_won,
            s.current_streak,
            s.best_streak,
            NULL::int AS best_time_sec,
            s.total_points AS score,
            NULL::int AS duration_seconds
          FROM sudoku_user_stats s
          JOIN users u ON u.id = s.user_id
          WHERE s.games_won > 0
        )
      `;
      break;
  }

  try {
    const limitIdx = cteParams.length + 1;
    const listRes = await pool.query(
      `${cteSql} SELECT * FROM ranked ORDER BY rank ASC, user_id ASC LIMIT $${limitIdx}`,
      [...cteParams, limit]
    );

    let myRank = null;
    if (viewerId) {
      const myIdx = cteParams.length + 1;
      const myRes = await pool.query(
        `${cteSql} SELECT * FROM ranked WHERE user_id = $${myIdx}`,
        [...cteParams, viewerId]
      );
      myRank = myRes.rows[0] || null;
    }

    return res.status(200).json({
      scope,
      dailyDate,
      leaderboard: listRes.rows,
      myRank,
    });
  } catch (err) {
    console.error('Error fetching sudoku rankings:', err);
    return res.status(500).json({ error: 'Failed to load Sudoku rankings.' });
  }
});

// Bind to 0.0.0.0 so Render's port scanner and local requests can both reach the server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`BatStateWall server running on http://localhost:${PORT}`);
  ensureSchema();
});
