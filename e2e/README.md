# E2E suite

Playwright end-to-end tests for `react-frontend` and the `nodejs-backend` API.
Runs nightly via `.github/workflows/e2e.yml` and on demand via
**Actions → Nightly E2E → Run workflow**.

## How the suite works

1. **Real login through aMember.** `setup-frontend` opens the aMember login
   URL, fills the test user's username + password, submits, and follows the
   cross-domain redirect into the app on `adsgpt-staging`. The resulting
   session (cookies + storage) is saved to `.auth/frontend.json` and reused
   by every other spec — so we don't log in 20 times per run.
2. **Authenticated page tour with API monitoring.** Each route is visited
   once. For each, we assert the authenticated shell rendered and that **no
   backend API call returned 5xx** during the visit.
3. **Unauthenticated guard check.** A fresh browser context confirms the app
   does not render the authenticated shell for an unauthenticated user.
4. **Backend liveness probes** (`api` project, no browser): the gateway is
   reachable and returns non-5xx for HEAD / junk-path probes.

| Project | What it does |
|---|---|
| `setup-frontend` | Real aMember login → save session state |
| `frontend` | 10-route page tour + auth-gate check, with per-page API call monitoring |
| `api` | Direct HTTP liveness probes against the gateway |

## Required GitHub secrets

Set under **Settings → Secrets and variables → Actions**:

| Secret | Purpose |
|---|---|
| `E2E_FRONTEND_URL` | App host (e.g. `https://adsgpt-staging.poweradspy.com`) |
| `E2E_API_URL` | Backend gateway URL (e.g. `https://adsgpt-dev-api.poweradspy.com`) |
| `E2E_LOGIN_URL` | aMember login form URL (e.g. `https://adsgpt-dev.poweradspy.com/amember/login`) |
| `E2E_LOGIN_USERNAME` | Test user's aMember login (username or email) |
| `E2E_LOGIN_PASSWORD` | Test user's aMember password |
| `E2E_SLACK_WEBHOOK` | *(Optional)* Slack incoming-webhook URL for failure notifications |

If any required secret is missing, the suite fails fast with a clear message
— it will not silently fall back to localhost.

> **Use a dedicated test account.** Don't run the suite as a real customer —
> nightly clicks and 5xx assertions will generate real backend load on that
> account.

## API call monitoring

`fixtures/api-monitor.js` defines an `apiCalls` fixture that:

- Listens to every `response` + `requestfailed` event during the test.
- Filters to requests targeting `E2E_API_URL`'s host.
- Records `{ method, url, status, ms, from }` for each call.
- After the test ends, attaches the full call log to the HTML report as
  `api-calls.json`.
- Fails the test if any call returned **status ≥ 500** or never returned a
  response (DNS / refused / aborted).

In a spec you can also inspect live:
```js
import { test, expect } from '../../fixtures/api-monitor.js'
test('something', async ({ page, apiCalls }) => {
  await page.goto('/somewhere')
  expect(apiCalls.errors()).toEqual([])      // explicit no-5xx assertion
  console.log(apiCalls.summary())            // {total, 2xx, 3xx, 4xx, 5xx, fail}
})
```

## Running locally

```bash
cd e2e
npm install
npx playwright install --with-deps chromium

# Source the same secrets as the workflow uses
export E2E_FRONTEND_URL=https://adsgpt-staging.poweradspy.com
export E2E_API_URL=https://adsgpt-dev-api.poweradspy.com
export E2E_LOGIN_URL=https://adsgpt-dev.poweradspy.com/amember/login
export E2E_LOGIN_USERNAME=<test-user-login>
export E2E_LOGIN_PASSWORD=<test-user-password>

npm test                   # everything
npm run test:frontend      # frontend project only
npm run test:api           # api project only
npm run report             # open the HTML report after a run
```

## After a failed run

- The workflow uploads two artifacts (retained 14 days):
  - `playwright-report-<run_id>` — the full HTML report (open `index.html`).
    Each test's `api-calls.json` is attached as an artifact within the report.
  - `playwright-traces-<run_id>` — Playwright traces, screenshots, videos.
- Open a trace with `npx playwright show-trace path/to/trace.zip` — full
  time-travel debugging including DOM snapshots and network.

## Expanding the suite

- Add files under `tests/frontend/` or `tests/api/` — they automatically
  inherit the right project + storage state.
- To use the API monitor, import from `../../fixtures/api-monitor.js`
  instead of `@playwright/test`.
- For new auth modes (e.g. a second user role), add another setup file under
  `tests/setup/` and a new project entry in `playwright.config.js`.
- The current frontend specs assert "the page mounts + API healthy." To
  deepen them, add feature-specific selectors (click a button, fill a form,
  assert a chart). Prefer `data-testid` attributes over text/role selectors
  for stability.
