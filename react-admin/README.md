# AdsGPT Admin

Read-only admin panel for AdsGPT. Shows generation activity, real USD cost,
and per-user credit balances.

## Setup

```bash
cd react-admin
npm install
cp .env.example .env   # adjust VITE_SOCKET_URL if backend runs elsewhere
npm run dev
```

The dev server runs on `http://localhost:5174`.

## Backend env vars

Add to the nodejs-backend `.env`:

```
ADMIN_USERNAME=admin
ADMIN_PASSWORD=your-strong-password
```

If unset, the panel falls back to `UI_USERNAME` / `UI_PASSWORD` (the same
credentials the legacy `/admin-panel/login` page uses).

`JWT_SECRET_KEY` must be the same on both apps (already used by the rest of
the backend).

## Routes

Backend (mounted at `/adsgpt/admin`):

- `POST /login` — returns a 12h admin JWT
- `GET /me` — sanity check the token
- `GET /overview?from&to` — KPIs, daily cost series, cost by type/model
- `GET /users?from&to&search&sort&page&limit` — paginated users with cost
- `GET /users/:userId?from&to&type&model&page&limit` — user detail + media

Frontend pages: `/login`, `/`, `/users`, `/users/:userId`.
