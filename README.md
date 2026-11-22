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
│   │   ├── spartan-bg.png  # Left backdrop artwork
│   │   └── campus-bg.png   # Right backdrop artwork
│   ├── index.html          # Main feedback wall page
│   ├── style.css           # Dark obsidian & BatStateU crimson glassmorphic styling
│   └── app.js              # Frontend API calls, live counter, XSS-safe rendering
├── server.js               # Express server, PostgreSQL pool, and REST API endpoints
├── schema.sql              # SQL script to create the "items" table in Supabase
├── package.json            # Dependencies and "start" script
├── .env.example            # Sample environment variables template
├── .gitignore              # Excludes node_modules/ and .env from Git
└── README.md               # Project documentation
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

   Open `.env` and set `DATABASE_URL` to your **Supabase Session Pooler** connection string (found in Supabase under **Project Settings → Database → Connection string → Session pooler**).

   ```env
   DATABASE_URL=postgresql://postgres.YOUR_PROJECT_REF:YOUR_PASSWORD@aws-0-YOUR_REGION.pooler.supabase.com:5432/postgres
   PORT=3000
   ```

3. **Create the database table in Supabase**

   - Open your Supabase project dashboard and go to the **SQL Editor**.
   - Copy the contents of `schema.sql` and run it to create the `items` table.

4. **Start the application**

   ```bash
   npm start
   ```

   Open [http://localhost:3000](http://localhost:3000) in your browser.

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
     - **Key:** `DATABASE_URL`
     - **Value:** Your Supabase Session Pooler connection string
5. **Deploy**
   - Click **Create Web Service**. Once the build finishes, Render will expose your live BatStateWall URL.

---

## API Documentation

Base URL (local): `http://localhost:3000`

### 1. Get All Feedback Items

- **Endpoint:** `GET /api/items`
- **Description:** Returns all feedback items ordered newest first (`created_at DESC`).
- **Response (`200 OK`):**

```json
[
  {
    "id": 2,
    "name": "Maria Santos",
    "message": "Proud Red Spartan! Excited for our IT 412 demo.",
    "created_at": "2026-11-22T02:55:00.123Z"
  },
  {
    "id": 1,
    "name": "Juan Dela Cruz",
    "message": "Great campus Wi-Fi improvement this semester.",
    "created_at": "2026-11-22T02:50:10.456Z"
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

### 2. Create a Feedback Item

- **Endpoint:** `POST /api/items`
- **Headers:** `Content-Type: application/json`
- **Request Body:**

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
  "created_at": "2026-11-22T03:00:00.000Z"
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

## Testing with Postman

Use the test cases below in Postman to verify every API status code (`200`, `201`, `400`, `404`):

| # | Test Case | Method & URL | Body (JSON) | Expected Status | Expected Result |
|---|-----------|--------------|-------------|-----------------|-----------------|
| 1 | Create valid feedback post | `POST /api/items` | `{"name": "  Juan Dela Cruz  ", "message": "  Go Red Spartans!  "}` | `201 Created` | Returns created item with trimmed `name` and `message`, generated `id`, and `created_at` |
| 2 | Fetch all feedback posts | `GET /api/items` | *(none)* | `200 OK` | Returns JSON array of items ordered newest first |
| 3 | Fetch existing post by ID | `GET /api/items/1` | *(none)* | `200 OK` | Returns the matching item object for `id: 1` |
| 4 | Reject missing/empty name | `POST /api/items` | `{"name": "   ", "message": "Hello BatStateU"}` | `400 Bad Request` | Returns `{"error": "Name is required."}` |
| 5 | Reject missing/empty message | `POST /api/items` | `{"name": "Juan", "message": ""}` | `400 Bad Request` | Returns `{"error": "Message is required."}` |
| 6 | Reject message over 280 characters | `POST /api/items` | `{"name": "Juan", "message": "<281+ character string>"}` | `400 Bad Request` | Returns `{"error": "Message must be 280 characters or fewer."}` |
| 7 | Reject non-numeric item ID | `GET /api/items/abc` | *(none)* | `400 Bad Request` | Returns `{"error": "Invalid ID. ID must be a number."}` |
| 8 | Handle non-existent item ID | `GET /api/items/999999` | *(none)* | `404 Not Found` | Returns `{"error": "Item not found."}` |
