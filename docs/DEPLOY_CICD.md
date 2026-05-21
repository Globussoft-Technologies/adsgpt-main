# GitHub Actions CI/CD — setup & operations

> **Status:** v1.2 · **Owner:** Sumit Ghosh · **Last updated:** 2026-04-27 (smoke step now tolerates empty `accounts: []` after token-policy v2)
>
> Replaces the manual-SCP deploy that existed pre-`main`-migration. Every push to `main` that touches a service's directory now triggers an automated build → test → rsync → pm2 restart → health-check → **autopilot smoke test** → rollback-on-failure flow. Manual `workflow_dispatch` (with optional dry-run) is available for ad-hoc deploys.

---

## Workflows at a glance

| File | Trigger | What it does |
|---|---|---|
| [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) | PR + push to main | `nodejs-backend` autopilot tests; `react-frontend` lint. No deploy. |
| [`.github/workflows/deploy-nodejs-backend.yml`](../.github/workflows/deploy-nodejs-backend.yml) | push to `main` touching `nodejs-backend/**` | Test → rsync → `npm install` (if package.json changed) → pm2 restart `gateway` (port 7000) → health check → **autopilot smoke test (live `/run-cycle?dryRun=true`, 11s wall, mints JWT server-side via `--jwt-from-mint`)** → rollback on failure |
| [`.github/workflows/deploy-nodejs-ads-backend.yml`](../.github/workflows/deploy-nodejs-ads-backend.yml) | push to `main` touching `nodejs-ads-backend/**` | Rsync to `/home/.../microservices/AdsScrollServer/` → pm2 restart `ads-scroller` (port 9090) |
| [`.github/workflows/deploy-react-frontend.yml`](../.github/workflows/deploy-react-frontend.yml) | push to `main` touching `react-frontend/**` | Rsync source → `npm install` + `npm run build` on server (uses server's `.env` for `VITE_*` vars) → pm2 restart `frontend` (port 6000) |

### About the autopilot smoke step (nodejs-backend deploys)

Added 2026-04-26 (updated 2026-04-27 for token-policy v2). After the existing health check, the deploy SSHes to the server, runs `node scripts/smoke-autopilot.js --jwt-from-mint`, and asserts:
- HTTP 200 + `status: true` + `dryRun: true` from `/run-cycle?dryRun=true&force=true`
- Each non-skipped per-account block carries `audit`, `pause`, `resume` keys
- `durationMs < 60_000`
- `/autopilot/audit/run` and `/autopilot/llm-audit` are mounted (responds with 400 for missing `adAccountId`, not 404)

**Empty `accounts: []` is now a valid response** (not a failure). After the 2026-04-27 token-policy swap, the orchestrator silently skips any `autopilotConfig` entry without an `ownerUserId` — that's intentional (no Meta call without a resolvable per-user FB token). Until `AUTOPILOT_OWNER_USER_ID` is set on the server, smoke logs a warning and exits 0; once set, accounts iterate normally.

**Failure cascades into the existing "Rollback on failure" step.** No new GitHub secrets are needed — the script mints a 10-minute JWT server-side from the deployed `.env` `JWT_SECRET_KEY`. The smoke output is visible in the deploy job log under "Autopilot smoke test (live /run-cycle dry-run)". Costs ~11s per deploy.

### What's intentionally NOT auto-deployed

- **`python-backend/`** — the server's chatbot-user tree has diverged from the monorepo (per [DEPLOYMENT-CONFLICTS.md](../DEPLOYMENT-CONFLICTS.md) §2–5), and touching it blindly would break running services (`advideo-revamped`, multiple model endpoints, adfactory APIs). Python services are still hand-deployed until convergence.
- **PowerAdSpy (PAS) services** — live under other `pas-*` home dirs on the same server. Off-limits; workflows bind strictly to `/home/pas-adsgpt-dev-ftp/...`.
- **Any PR build.** Deploys are only triggered on `main`. PRs run tests only.

---

## First-time setup (one-time, before the first automated deploy)

### 1. Add repository secrets

Go to **Settings → Secrets and variables → Actions → New repository secret** and add:

| Secret name | Value | Notes |
|---|---|---|
| `DEPLOY_HOST` | `155.248.244.18` | Dev server IP |
| `DEPLOY_USER` | `adsgpt-development-test` | Login user (has NOPASSWD sudo) |
| `DEPLOY_SSH_PRIVATE_KEY` | *contents of `adsgpt-development-test.pem`* | Multi-line; paste as-is including `-----BEGIN … -----END …` lines |
| `DEPLOY_KNOWN_HOSTS` | *(optional)* output of: `ssh-keyscan 155.248.244.18` | Recommended for security — without it, workflows keyscan live (trust-on-first-use). |

#### How to get each value

**`DEPLOY_SSH_PRIVATE_KEY`** — contents of the PEM file:

```bash
cat adsgpt-development-test.pem
```

Copy the entire output into the secret value, preserving line breaks.

**`DEPLOY_KNOWN_HOSTS`** — pinned host key:

```bash
ssh-keyscan -H 155.248.244.18
```

Copy the output into the secret value. This prevents a MITM on first connect.

### 2. Verify the server-side prerequisites

The workflows assume:

- ✅ `adsgpt-development-test` can SSH in with the PEM
- ✅ `adsgpt-development-test` has `NOPASSWD: ALL` sudo (already confirmed during server probe)
- ✅ `pas-adsgpt-dev-ftp` runs PM2 with the `gateway`, `ads-scroller`, `frontend` processes already registered (confirmed)
- ✅ `pas-adsgpt-dev-ftp` has nvm + Node 20.20.0 at `~/.nvm/versions/node/v20.20.0/` (confirmed)
- ✅ rsync is installed (it ships with Ubuntu)

No server changes required for setup.

### 3. Validate with a dry-run

Once secrets are set:

1. Go to **Actions → Deploy nodejs-backend → Run workflow**
2. Select branch `main`, check the **dry_run** box, click Run.
3. Workflow should:
   - Test on ubuntu-runner → pass
   - SSH in → verify path
   - Backup → succeed
   - Rsync → print a file-change list but not write anything (`--dry-run`)
   - Skip npm install, pm2 restart, health check
4. Repeat for `Deploy nodejs-ads-backend` and `Deploy react-frontend`.

Dry-run output tells you what a real deploy *would* change without risking the running services.

---

## How a normal deploy flows

1. Dev pushes a branch, opens PR against `main`. CI workflow runs — tests must pass.
2. PR approved and merged to `main`.
3. For each service whose files changed in the merge, the corresponding `deploy-*.yml` workflow triggers.
4. Tests run again on CI → pass.
5. SSH to server, tar backup of current service dir to `/tmp/<service>-backup-<ts>.tar.gz`.
6. Rsync repo source to server (excluding `node_modules`, `.env`, `logs`, `uploads`, `dist` for frontend). Files are written as `pas-adsgpt-dev-ftp`.
7. If `package.json` or `package-lock.json` changed in the push, run `npm install --production` on server.
8. For `react-frontend`, also run `npm run build` on server.
9. `pm2 restart <process> --update-env && pm2 save` as `pas-adsgpt-dev-ftp`.
10. Wait 10s. Verify TCP port is listening. Hit an HTTP endpoint with curl — expects any non-zero response code.
11. Tail last 40 lines of pm2 logs for visibility.
12. On any failure: untar backup, pm2 restart.

---

## Safety properties

| Concern | How it's addressed |
|---|---|
| Accidental `rm` of server-only files (logs, uploads, user content) | No `--delete` flag on rsync. Repo-side deletions are **not** propagated. Remove files on server manually if needed. |
| `.env` overwrite | `.env` and `.env.*` are in the rsync exclude list. Server's `.env` is preserved. |
| node_modules churn | `node_modules/` excluded; server's own install is authoritative. |
| Concurrent deploys | `concurrency:` group per service — deploys queue, never overlap. |
| Runaway install | `--production --no-audit --no-fund` on npm install. |
| Wrong file ownership | `rsync --rsync-path='sudo -u pas-adsgpt-dev-ftp rsync'` → files owned by the service user, not root. |
| SSH key leak | Private key is a GitHub secret (never logged). Workflow cleans up `~/.ssh/deploy_key` in the final step. |
| PAS-service collision | Each workflow's `REMOTE_PATH` is hardcoded to an AdsGPT-only path. Nothing else is touched. |
| Bad deploy crashes a service | Automatic rollback from the pre-deploy tar backup, then pm2 restart. |
| Rollback doesn't fix it | Manual recovery: SSH in, inspect `pm2 logs <process>`, restore from `/tmp/<service>-backup-<ts>.tar.gz` manually. |

---

## Manual ops

### Trigger a deploy without pushing

**Actions → Deploy nodejs-backend → Run workflow**. Select `main`, uncheck dry-run, click Run. Same flow as a push.

### Dry-run a deploy

Same UI, check the **dry_run** box. Runs tests + rsync-dry-run + skips pm2 restart + skips health check. Safe for any branch.

### Deploy a hotfix branch (not recommended)

Deploys are only triggered on `main`. For an emergency hotfix:

1. Push the fix to `main` directly (or merge a fix PR).
2. Watch Actions → the deploy workflow fires automatically.

Alternative: manually edit the workflow's `on.push.branches` list — not recommended; keeps `main` as the single source of truth.

### Rollback after a problem only noticed later (past the automatic rollback window)

```bash
ssh -i adsgpt-development-test.pem adsgpt-development-test@155.248.244.18
ls /tmp/nodejs-backend-backup-*.tar.gz   # find the backup you want
BACKUP=/tmp/nodejs-backend-backup-YYYYMMDDTHHMMSSZ.tar.gz
sudo -u pas-adsgpt-dev-ftp tar -xzf "$BACKUP" -C /home/pas-adsgpt-dev-ftp/adsgpt-back-end/ads-gpt-nodejs-backend
sudo -u pas-adsgpt-dev-ftp -H bash -lc 'source ~/.nvm/nvm.sh && pm2 restart gateway --update-env'
```

Backups accumulate in `/tmp` and survive until server reboot. Add a cron if this becomes a problem.

### Force an npm install without a package.json change

The deploy workflow only installs when `package.json`/`package-lock.json` changed in the push. To force an install:

```bash
ssh -i adsgpt-development-test.pem adsgpt-development-test@155.248.244.18
sudo -u pas-adsgpt-dev-ftp -H bash -lc '\
  source ~/.nvm/nvm.sh && \
  cd /home/pas-adsgpt-dev-ftp/adsgpt-back-end/ads-gpt-nodejs-backend && \
  npm install --production && pm2 restart gateway'
```

### Deploy a secrets/env change

Env files are **never** deployed by the workflow. Edit `.env` on the server directly, then manually `pm2 restart` the process.

---

## Known gaps (follow-up work)

1. **No `python-backend` workflow.** Diverged from monorepo; needs a convergence plan before automation.
2. **No Slack / email notifications** on deploy success/failure. Add via GitHub Actions `slack-github-action@v1` once a webhook URL is ready.
3. **React frontend builds on the server** — wastes server CPU for ~30s per deploy. Moving to "build on runner + ship artifact" requires 21 `VITE_*` secrets in GitHub. Defer until either (a) the dev server gets busy, or (b) we want GitHub to be the source of truth for VITE vars too.
4. **No staging environment.** Deploys go straight to the single dev server. No pre-prod gate. Fine for dev; will need rework before any production rollout.
5. **No build caching across workflows.** Each deploy re-installs dev deps. The `actions/setup-node@v4` cache helps but won't share across services.
6. **Backup cleanup.** `/tmp/<service>-backup-*.tar.gz` accumulates. Manually cleanup occasionally, or add a cron on the server.

---

## Troubleshooting

**Workflow fails at "Sanity-check SSH + server state"**

- Secret `DEPLOY_SSH_PRIVATE_KEY` probably mangled. Re-paste the PEM as a multi-line secret (no `\n` escaping — just paste the raw file).
- Or the server IP changed. Update `DEPLOY_HOST`.
- Or the `REMOTE_PATH` was renamed on the server. Update the workflow's `env.REMOTE_PATH`.

**Workflow fails at "Rsync source" with `Permission denied`**

- Login user lost sudo rights. Run `sudo -l` over SSH to confirm. Re-grant NOPASSWD ALL if needed.

**Health check fails — `port not listening`**

- pm2 process failed to start. SSH in and `pm2 logs <process>` to see the startup error.
- The automatic rollback should have fired. Check backup tar file and restore if needed.
- Most common cause: a new dependency was needed but `package-lock.json` wasn't updated, so `npm install` didn't run.

**Deploy succeeded but old code is served**

- `pm2 restart` might not have picked up the new code if pm2 is in cluster mode with stale workers. Try `pm2 reload <process>` (zero-downtime reload).
- Check server file mtimes to confirm rsync actually wrote new files.

---

## Escalation

If something is broken on prod-ish domains and the workflow isn't fixing it:

- **SSH manually**: `ssh -i adsgpt-development-test.pem adsgpt-development-test@155.248.244.18`
- **Roll back** via the backup tar under `/tmp/`
- **Post-mortem** the workflow run: repo → Actions → failing run → re-run with dry-run to isolate the step that broke
- **File an issue** with the Actions run URL + the step that failed

---

*End of CI/CD v1. Expect this doc to grow alongside Autopilot phases and whenever the server topology changes.*
