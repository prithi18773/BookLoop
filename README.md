# Campus Book Exchange

A backend for a campus textbook exchange, built with **Node.js, Express, MongoDB (Mongoose), JWT, and bcrypt**.

Instead of a plain "buy/sell" listing board, reserving a book puts you in a **queue** with automatic timeouts —
if the person whose turn it is doesn't confirm pickup within a set window, they're automatically bumped and
the next person in line gets notified. This is handled by a `node-cron` job and a small state machine.

---

## 1. Features

- **Auth**: register/login with bcrypt password hashing, JWT access + refresh tokens (refresh tokens are
  rotated and stored hashed in the DB, not in plaintext).
- **Book listings**: create, browse (filter by subject/status/search), remove your own listing.
- **Reservation queue**: reserve a book; if it's free, you're immediately given a pickup window; if not,
  you join the waitlist.
- **Auto-expiry**: a cron job checks hourly for reservations past their deadline, expires them, and
  promotes the next person in the queue automatically.
- **Ratings**: after a completed exchange, both parties can rate each other (feeds into an average rating
  shown on user profiles).
- **Security basics**: rate limiting on auth routes, centralized error handling, role-based access
  (`student` / `admin`) for admin-only actions like force-removing a listing.

---

## 2. Project structure

```
book-exchange/
├── config/
│   └── db.js                 # MongoDB connection
├── controllers/
│   ├── authController.js     # register, login, refresh, logout, me
│   └── bookController.js     # listings + reservation queue logic
├── middleware/
│   ├── auth.js                # JWT verification + role-based access
│   └── errorHandler.js        # centralized error responses
├── models/
│   ├── User.js
│   └── Book.js                # includes embedded reservation queue schema
├── routes/
│   ├── authRoutes.js
│   └── bookRoutes.js
├── utils/
│   ├── generateTokens.js      # JWT signing helpers
│   └── expiryCron.js          # the cron job that auto-expires reservations
├── .env.example
├── package.json
└── server.js
```

---

## 3. Setup

### Prerequisites
- Node.js 18+ 
- A MongoDB instance — either local (`mongod`) or a free [MongoDB Atlas](https://www.mongodb.com/atlas) cluster

### Steps

```bash
# 1. Install dependencies
npm install

# 2. Copy the env template and fill in your values
cp .env.example .env
# then edit .env: set MONGO_URI, and generate real JWT secrets with:
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"

# 3. Run in development (auto-restarts on file changes)
npm run dev

# or run normally
npm start
```

The server starts on `http://localhost:5000` by default. Check `GET /health` to confirm it's up.

> `npm install` Run the syntax

---

## 4. API reference

All protected routes require `Authorization: Bearer <accessToken>`.

### Auth — `/api/auth`

| Method | Route | Body | Description |
|---|---|---|---|
| POST | `/register` | `{ name, email, password }` | Creates an account, returns access + refresh tokens |
| POST | `/login` | `{ email, password }` | Returns access + refresh tokens |
| POST | `/refresh` | `{ refreshToken }` | Rotates and returns a new token pair |
| POST | `/logout` | `{ refreshToken }` (+ auth header) | Invalidates that refresh token |
| GET | `/me` | — (auth header) | Returns the logged-in user's profile + rating |

### Books — `/api/books`

| Method | Route | Auth? | Description |
|---|---|---|---|
| GET | `/?subject=&status=&search=` | No | List/filter/search books |
| GET | `/:id` | No | Get one book, with populated queue |
| GET | `/:id/queue` | No | See the current waitlist for a book |
| POST | `/` | Yes | Create a listing |
| POST | `/:id/reserve` | Yes | Join the queue (or get notified immediately if free) |
| DELETE | `/:id/reserve` | Yes | Leave the queue (auto-promotes next person if you held the turn) |
| PATCH | `/:id/confirm` | Yes | Confirm pickup — only valid for whoever currently holds the turn |
| POST | `/:id/rate` | Yes | `{ stars: 1-5 }` — rate the other party after a completed exchange |
| DELETE | `/:id` | Yes (owner/admin) | Soft-deletes a listing |

---

## 5. The queue state machine (the "extra" part worth explaining in your report/viva)

Each reservation entry on a book moves through these states:

```
waiting → notified → confirmed
              ↓
           expired  (cron job, if deadline passed)
              ↓
      next "waiting" entry promoted to "notified"

waiting/notified → cancelled  (user leaves voluntarily, same promotion logic applies)
```

- When a user reserves a book and **nobody currently holds the turn**, they go straight to `notified`
  with an `expiresAt` timestamp (`RESERVATION_EXPIRY_HOURS` from now, default 48h).
- If someone else already holds the turn, the new reservation is added as `waiting`.
- A cron job (`utils/expiryCron.js`, schedule set by `CRON_SCHEDULE` in `.env`, default hourly) finds every
  book whose active `notified` entry has passed its `expiresAt`, marks it `expired`, and promotes the next
  `waiting` entry — or sets the book back to `available` if nobody's left in line.
- The exact same "promote next person" logic is reused when a user **voluntarily cancels** their turn
  (`cancelReservation`), so there's one single source of truth for queue advancement
  (`promoteNextInQueue` in `bookController.js`).

This is a good thing to diagram in your report: draw the state machine above, and mention that it's shared
between the manual-cancel path and the automated cron path — that's a deliberate design choice worth
pointing out in a viva.

---

## 6. Example flow (for your demo)

1. `POST /api/auth/register` → get tokens for User A and User B (register twice).
2. User A: `POST /api/books` → creates a listing.
3. User B: `POST /api/books/:id/reserve` → since queue was empty, B is immediately `notified`.
4. User B: `PATCH /api/books/:id/confirm` → book becomes `exchanged`.
5. Either party: `POST /api/books/:id/rate` with `{ "stars": 5 }` → rates the other side.
6. `GET /api/auth/me` as the rated user → see `averageRating` updated.

To demo the **expiry** path: reserve as User B, then temporarily set `RESERVATION_EXPIRY_HOURS=0.001` in
`.env` (a few seconds) and `CRON_SCHEDULE=*/10 * * * * *` (every 10 seconds) before restarting the server —
you'll see the console log the reservation expiring and the queue advancing automatically. Set both back to
normal values afterward.

---

## 7. Things you could add if you have extra time (optional, not required)

- Email notifications (Nodemailer) when a user is promoted to `notified`, instead of just relying on them
  polling `GET /:id/queue`.
- Pagination on `GET /api/books`.
- Image upload for listings via `multer`.
- Simple frontend (React) to demo visually instead of Postman/curl.

None of these are necessary for the core project to be complete — the auth + queue + cron logic above is
the full working backend.
# BookLoop
