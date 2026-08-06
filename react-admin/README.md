# AdsGPT Admin

Admin panel for AdsGPT. Shows generation activity, real USD cost, and
per-user credit balances; also manages partner API keys and per-plan
ad-account/campaign limits.

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
- `GET /meta-launch-trace/:traceId` — reproduce a failed Meta Ads launch by its LX- reference code
- `POST /partner-api-keys`, `GET /partner-api-keys`, `PATCH /partner-api-keys/:id/revoke`
- `GET /token-usage/overview`, `GET /token-usage/users/:userId`
- `GET /plans`, `PATCH /plans/:planId` — per-plan ad-account/campaign caps for Meta Ads Manager (see `nodejs-backend/utils/planLimits.js` + the `meta-ads-manager` skill)

Frontend pages: `/login`, `/`, `/users`, `/users/:userId`, `/calculator`, `/partner-api-keys`, `/plans`.
