# E2E suite

Playwright end-to-end tests for `react-frontend` and the `nodejs-backend` API.
Runs nightly via `.github/workflows/e2e.yml` and on demand via
**Actions → Nightly E2E → Run workflow**.

## What's covered

| Project | What it does | How auth works |
|---|---|---|
| `setup-frontend` | Hits `/dev-auth#t=<JWT>`, saves storage state | Pre-minted `E2E_FRONTEND_JWT` |
| `frontend` | Smoke tour across `/adstudio`, `/brandiq`, etc. | Reuses `setup-frontend` state |
| `api` | Backend liveness via Playwright `request` fixture | None — public probes + 4xx assertions |

## Required GitHub secrets

Set these under **Settings → Secrets and variables → Actions**:

| Secret | Purpose |
|---|---|
| `E2E_FRONTEND_URL` | Public URL of the deployed react-frontend |
| `E2E_API_URL` | nodejs-backend gateway URL (e.g. `https://adsgpt-dev-api.poweradspy.com`) |
| `E2E_FRONTEND_JWT` | Long-lived test-user JWT for `/dev-auth` (mint with nodejs-backend's system-token script against a dedicated test user) |
| `E2E_SLACK_WEBHOOK` | *(Optional)* Slack incoming-webhook URL for failure notifications |

If any of the first three are missing, the suite fails at config-load with a
clear message — it will not silently fall back to localhost.

> **Use a dedicated test account.** Don't run the suite as a real customer.
> The frontend JWT should belong to a sandboxed test user.

## Running locally

```bash
cd e2e
npm install
npx playwright install --with-deps chromium

# Source the same secrets as the workflow uses
export E2E_FRONTEND_URL=...
export E2E_API_URL=...
export E2E_FRONTEND_JWT=...

npm test                   # everything
npm run test:frontend      # frontend project only
npm run test:api           # api project only
npm run report             # open the HTML report after a run
```

## After a failed run

- The workflow uploads two artifacts (retained 14 days):
  - `playwright-report-<run_id>` — the full HTML report (open `index.html`)
  - `playwright-traces-<run_id>` — Playwright traces, screenshots, videos
- Open a trace with `npx playwright show-trace path/to/trace.zip` — full
  time-travel debugging including DOM snapshots and network.

## Expanding the suite

- Add files under `tests/frontend/` or `tests/api/` — they automatically
  inherit the right project + storage state.
- For new auth modes (e.g. a second user role), add another setup file under
  `tests/setup/` and a new project entry in `playwright.config.js`.
- The current frontend specs assert "the page mounts." To deepen them, add
  feature-specific selectors (e.g. assert a chart, click a CTA, fill a form).
  Prefer `data-testid` attributes over text/role selectors for stability.
