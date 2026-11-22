# BatStateWall — BatStateU Feedback Wall

A full-stack public feedback wall built for **IT 412 Platform Technologies** at **Batangas State University**. Students and visitors can post short feedback messages (up to 280 characters) and view all submissions ordered newest first.

## Tech Stack

- **Backend:** Node.js (18+) with Express
- **Database:** PostgreSQL (Supabase) using `pg` (`node-postgres`) with parameterized queries
- **Configuration:** `dotenv` for local environment variables
- **Frontend:** Plain HTML5, CSS3, and vanilla JavaScript served from `/public`
- **Hosting:** Render (Web Service) + Supabase (PostgreSQL Session Pooler)

## Project Structure

```text
BatStateWall/
├── public/
│   ├── assets/
│   │   ├── spartan-bg.png     # Left backdrop artwork
│   │   ├── campus-bg.png      # Right backdrop artwork
│   │   └── post-success.json  # Lottie checkmark confirmation animation
│   ├── index.html             # Main feedback wall page + Sudoku Arena & Rankings modals
│   ├── terms.html             # Public Terms of Service (/terms)
│   ├── privacy.html           # Public Privacy Policy (/privacy)
│   ├── style.css              # Dark obsidian & crimson glassmorphic 3D styling
│   ├── scene3d.js             # Three.js WebGL 3D background & foreground floating ember dots
│   ├── app.js                 # Frontend API calls, live counter, XSS-safe rendering
│   └── sudoku.js              # Sudoku Arena client controller, Web Audio SFX, and leaderboard UI
├── server.js               # Express server, PostgreSQL pool, and REST API endpoints
├── sudokuEngine.js         # Zero-dependency Sudoku generator, MRV solver, hints, and scoring
├── profanityFilter.js      # English & Tagalog profanity filter for names, posts, and comments
├── schema.sql              # SQL script to create all required tables in Supabase
├── package.json            # Dependencies and "start" script
├── .env.example            # Sample environment variables template
├── .gitignore              # Excludes node_modules/ and .env from Git
├── PAAS_REFLECTION.md      # Part 1: PaaS vs. IaaS Shared Responsibility reflection & diagram
└── README.md               # Project documentation
```

## System Architecture & Cloud Reflection

See [PAAS_REFLECTION.md](./PAAS_REFLECTION.md) for the full **Part 1: Cloud & PaaS Reflection** (PaaS vs. IaaS Shared Responsibility Model justification).

```mermaid
flowchart LR
    Client["Client (Web Browser / Postman)"]
    Render["Render PaaS Web Service (Node.js + Express)"]
    Supabase["Supabase Managed PostgreSQL (Session Pooler + SSL)"]

    Client -->|"HTTPS Requests (GET /, GET /api/items, POST /api/items)"| Render
    Render -->|"HTML, CSS, JS & JSON Responses (200, 201, 400, 404)"| Client
    Render -->|"Parameterized SQL over TLS (pg.Pool + DATABASE_URL)"| Supabase
    Supabase -->|"Query Results (public.items rows)"| Render
```

---

## Local Setup

1. **Install dependencies**

   ```bash
   npm install
   ```

2. **Create your `.env` file**

   Copy `.env.example` to `.env`:

   ```bash
   cp .env.example .env
   ```

   Open `.env` and set `DATABASE_URL` to your **Supabase Session Pooler** connection string (found in Supabase under **Project Settings → Database → Connection string → Session pooler**), plus a random `SESSION_SECRET`:

   ```env
   DATABASE_URL=postgresql://postgres.YOUR_PROJECT_REF:YOUR_PASSWORD@aws-0-YOUR_REGION.pooler.supabase.com:5432/postgres
   PORT=3000
   SESSION_SECRET=replace-with-a-long-random-secret
   # Optional for Google / Gmail login:
   GOOGLE_CLIENT_ID=your-google-client-id.apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=your-google-client-secret
   ```

3. **Create the database tables in Supabase**

   - Open your Supabase project dashboard and go to the **SQL Editor**.
   - Copy the contents of `schema.sql` and run it to create all tables (`users`, `items`, `likes`, `comments`, `reports`, `sudoku_sessions`, `sudoku_user_stats`).

4. **Start the application**

   ```bash
   npm start
   ```

   Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## Setting Up Google (Gmail) Login

1. Go to [Google Cloud Console](https://console.cloud.google.com/) and create or select a project.
2. Open **APIs & Services → OAuth consent screen**, choose **External**, fill in the app name (`BatStateWall`), support email, Privacy Policy URL (`https://YOUR-RENDER-APP.onrender.com/privacy`), and Terms of Service URL (`https://YOUR-RENDER-APP.onrender.com/terms`), and save.
3. Open **APIs & Services → Credentials → Create Credentials → OAuth client ID** (`Web application`).
4. Add your **Authorized redirect URIs**:
   - Local development: `http://localhost:3000/api/auth/google/callback`
   - Render production: `https://YOUR-RENDER-APP.onrender.com/api/auth/google/callback`
5. Copy the **Client ID** and **Client Secret** into `.env` (locally) and into Render's **Environment Variables** as `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.

---

## Deploying to Render

1. **Push the project to GitHub**
   - Make sure `.env` and `node_modules/` are **not** committed (`.gitignore` already excludes them).
2. **Create a Web Service on Render**
   - Log in to [Render](https://render.com/), click **New + → Web Service**, and connect your GitHub repository.
3. **Configure the service settings**
   - **Environment / Runtime:** `Node`
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
4. **Add Environment Variables**
   - Under **Environment Variables**, add:
     - `DATABASE_URL` — Your Supabase Session Pooler connection string
     - `SESSION_SECRET` — A long random secret string for signing session cookies
     - `GOOGLE_CLIENT_ID` & `GOOGLE_CLIENT_SECRET` *(optional, required for Gmail login)*
5. **Deploy**
   - Click **Create Web Service**. Once the build finishes, Render will expose your live BatStateWall URL.

---

## API Documentation

Base URL (local): `http://localhost:3000`

### Authentication Endpoints (Google OAuth Only)

| Method & Route | Description | Status Codes |
|---|---|---|
| `GET /api/auth/config` | Returns `{ googleEnabled }` so the UI knows if Google OAuth is configured | `200` |
| `GET /api/auth/me` | Returns `{ user }` for the signed-in cookie, or `{ user: null }` | `200`, `500` |
| `GET /api/auth/google` | Redirects to Google OAuth 2.0 (Gmail) consent screen (creates account automatically on first sign-in) | `302`, `503` (JSON if unconfigured) |
| `GET /api/auth/google/callback` | Handles Google OAuth callback, creates/links user, sets HTTP-only `batstatewall_session` cookie, redirects to `/` | `302` |
| `POST /api/auth/logout` | Clears the session cookie | `200` |

### 1. Get All Feedback Items

- **Endpoint:** `GET /api/items`
- **Description:** Returns feedback items ordered newest first by default (`?sort=latest|popular`, `?filter=all|mine`, `?q=<search>`, optional `?limit=&offset=`), including social counts (`like_count`, `comment_count`, `liked_by_me`, `is_owner`).
- **Response (`200 OK`):**

```json
[
  {
    "id": 2,
    "name": "Maria Santos",
    "message": "Proud Red Spartan! Excited for our IT 412 demo.",
    "user_id": 1,
    "avatar_url": null,
    "auth_provider": "local",
    "like_count": 3,
    "comment_count": 1,
    "liked_by_me": false,
    "is_owner": false,
    "created_at": "2026-11-22T02:55:00.123Z"
  }
]
```

- **Error Response (`500 Internal Server Error`):**

```json
{
  "error": "Failed to load messages. Please try again later."
}
```

---

### 2. Create a Feedback Item *(Requires Login)*

- **Endpoint:** `POST /api/items`
- **Headers:** `Content-Type: application/json` (plus active session cookie from `/api/auth/register` or `/api/auth/login`)
- **Request Body:** (`name` is optional when logged in and defaults to your profile name; explicit empty string returns `400`)

```json
{
  "name": "Juan Dela Cruz",
  "message": "Go Red Spartans!"
}
```

- **Response (`201 Created`):**

```json
{
  "id": 3,
  "name": "Juan Dela Cruz",
  "message": "Go Red Spartans!",
  "user_id": 1,
  "avatar_url": null,
  "auth_provider": "local",
  "like_count": 0,
  "comment_count": 0,
  "liked_by_me": false,
  "is_owner": true,
  "created_at": "2026-11-22T03:00:00.000Z"
}
```

- **Unauthorized Response (`401 Unauthorized`):**

```json
{
  "error": "Please log in to continue."
}
```

- **Validation Error Responses (`400 Bad Request`):**

```json
{
  "error": "Name is required."
}
```

```json
{
  "error": "Message is required."
}
```

```json
{
  "error": "Message must be 280 characters or fewer."
}
```

```json
{
  "error": "Please keep your post respectful. Profanity is not allowed."
}
```

*(English and Tagalog profanity filtering is enforced on display names, posts, and comments.)*

- **Database Error Response (`500 Internal Server Error`):**

```json
{
  "error": "Failed to save your message. Please try again later."
}
```

---

### 3. Get a Single Feedback Item by ID

- **Endpoint:** `GET /api/items/:id`
- **Response (`200 OK`):**

```json
{
  "id": 1,
  "name": "Juan Dela Cruz",
  "message": "Great campus Wi-Fi improvement this semester.",
  "user_id": 1,
  "avatar_url": null,
  "auth_provider": "local",
  "like_count": 1,
  "comment_count": 0,
  "liked_by_me": false,
  "is_owner": true,
  "created_at": "2026-11-22T02:50:10.456Z"
}
```

- **Invalid ID Error (`400 Bad Request`):**

```json
{
  "error": "Invalid ID. ID must be a number."
}
```

- **Not Found Error (`404 Not Found`):**

```json
{
  "error": "Item not found."
}
```

- **Database Error Response (`500 Internal Server Error`):**

```json
{
  "error": "Failed to load the requested message."
}
```

---

### 4. Social Feed & Stats Endpoints

| Method & Route | Auth | Description | Status Codes |
|---|---|---|---|
| `GET /api/stats` | Public | Returns `{ totalPosts, totalMembers, postsToday, latestPostId }` | `200`, `500` |
| `DELETE /api/items/:id` | Owner | Deletes a post owned by the signed-in user | `200`, `400`, `401`, `403`, `404`, `500` |
| `POST /api/items/:id/like` | Required | Toggles a like and returns `{ post_id, liked, like_count }` | `200`, `400`, `401`, `404`, `500` |
| `GET /api/items/:id/comments` | Public | Returns comments for a post ordered oldest first | `200`, `400`, `404`, `500` |
| `POST /api/items/:id/comments` | Required | Adds a comment (`{ body }`, max 280 chars) to a post | `201`, `400`, `401`, `404`, `500` |
| `POST /api/items/:id/report` | Required | Submits a report (`{ reason }`) for a post | `201`, `400`, `401`, `404`, `500` |

### 5. BatStateU Sudoku Arena & Rankings Endpoints

| Method & Route | Auth | Description | Status Codes |
|---|---|---|---|
| `GET /api/sudoku/active` | Required | Returns latest `in_progress` board, Daily Challenge status, and personal stats | `200`, `401`, `500` |
| `POST /api/sudoku/start` | Required | Starts or resumes a unique-solution `classic` (`easy\|medium\|hard`) or `daily` puzzle (`409` if Daily already solved today) | `200`, `201`, `400`, `401`, `409`, `500` |
| `POST /api/sudoku/:id/move` | Owner | Validates a cell move server-side, updates notes/timer, and tracks mistakes (max 3) | `200`, `400`, `401`, `403`, `404`, `409`, `500` |
| `POST /api/sudoku/:id/hint` | Owner | Reveals the most constrained smart hint cell (max 3 per game) | `200`, `400`, `401`, `403`, `404`, `409`, `500` |
| `POST /api/sudoku/:id/complete` | Owner | Verifies completed board inside a transaction, calculates score & streak, and updates leaderboard stats | `200`, `400`, `401`, `403`, `404`, `409`, `500` |
| `POST /api/sudoku/:id/abandon` | Owner | Marks an in-progress Sudoku session as `abandoned` | `200`, `400`, `401`, `403`, `404`, `500` |
| `GET /api/sudoku/rankings` | Public | Returns leaderboard (`?scope=overall\|daily\|easy\|medium\|hard&limit=5..50`) and caller's rank (`myRank`) | `200`, `500` |

---

## Testing with Postman

Sign in with Google once in your browser, copy the `batstatewall_session` cookie value from DevTools (**Application → Cookies**), and include it as a `Cookie: batstatewall_session=<value>` header in Postman for protected write requests:

| # | Test Case | Method & URL | Body (JSON) | Expected Status | Expected Result |
|---|-----------|--------------|-------------|-----------------|-----------------|
| 1 | Reject unauthenticated post | `POST /api/items` *(without cookie)* | `{"name": "Juan", "message": "Hello"}` | `401 Unauthorized` | Returns `{"error": "Please log in to continue."}` |
| 2 | Check auth status | `GET /api/auth/me` | *(none)* | `200 OK` | Returns `{ user }` when signed in or `{ user: null }` when logged out |
| 3 | Create valid feedback post | `POST /api/items` *(with session cookie)* | `{"name": "  Juan Dela Cruz  ", "message": "  Go Red Spartans!  "}` | `201 Created` | Returns created item with trimmed `name` and `message`, generated `id`, and social counts |
| 4 | Fetch all feedback posts | `GET /api/items` | *(none)* | `200 OK` | Returns JSON array of items ordered newest first |
| 5 | Fetch existing post by ID | `GET /api/items/1` | *(none)* | `200 OK` | Returns the matching item object for `id: 1` |
| 6 | Toggle like on post | `POST /api/items/1/like` *(with session cookie)* | *(none)* | `200 OK` | Returns `{ post_id, liked, like_count }` |
| 7 | Add comment to post | `POST /api/items/1/comments` *(with session cookie)* | `{"body": "Great feedback!"}` | `201 Created` | Returns created comment object |
| 8 | Reject missing/empty name | `POST /api/items` *(with session cookie)* | `{"name": "   ", "message": "Hello BatStateU"}` | `400 Bad Request` | Returns `{"error": "Name is required."}` |
| 9 | Reject missing/empty message | `POST /api/items` *(with session cookie)* | `{"name": "Juan", "message": ""}` | `400 Bad Request` | Returns `{"error": "Message is required."}` |
| 10 | Reject message over 280 characters | `POST /api/items` *(with session cookie)* | `{"name": "Juan", "message": "<281+ character string>"}` | `400 Bad Request` | Returns `{"error": "Message must be 280 characters or fewer."}` |
| 11 | Reject non-numeric item ID | `GET /api/items/abc` | *(none)* | `400 Bad Request` | Returns `{"error": "Invalid ID. ID must be a number."}` |
| 12 | Handle non-existent item ID | `GET /api/items/999999` | *(none)* | `404 Not Found` | Returns `{"error": "Item not found."}` |
