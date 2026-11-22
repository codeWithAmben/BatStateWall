// Load environment variables from a local .env file (ignored on Render where env vars are set in the dashboard)
require('dotenv').config();

const express = require('express');
const path = require('path');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;
const MAX_MESSAGE_LENGTH = 280;
const PG_MAX_INT = 2147483647; // Maximum value for PostgreSQL 32-bit SERIAL/INTEGER

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

// GET /api/items - Fetch all feedback items, newest first
app.get('/api/items', async (req, res) => {
  try {
    const query = 'SELECT id, name, message, created_at FROM items ORDER BY created_at DESC, id DESC';
    const result = await pool.query(query);
    return res.status(200).json(result.rows);
  } catch (err) {
    console.error('Error fetching items:', err);
    return res.status(500).json({ error: 'Failed to load messages. Please try again later.' });
  }
});

// POST /api/items - Validate and save a new feedback item
app.post('/api/items', async (req, res) => {
  const { name, message } = req.body || {};

  // Ensure values are strings before trimming so non-string values are safely rejected
  const trimmedName = typeof name === 'string' ? name.trim() : '';
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
    // Parameterized query ($1, $2) protects against SQL injection
    const query =
      'INSERT INTO items (name, message) VALUES ($1, $2) RETURNING id, name, message, created_at';
    const values = [trimmedName, trimmedMessage];
    const result = await pool.query(query, values);

    return res.status(201).json(result.rows[0]);
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
    const query = 'SELECT id, name, message, created_at FROM items WHERE id = $1';
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

// Start listening for incoming HTTP requests
app.listen(PORT, () => {
  console.log(`BatStateWall server running on http://localhost:${PORT}`);
});
