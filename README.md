# AdsGPT

> **Generative AI for Ads** — a multi-service platform for generating, managing, and analyzing advertisements across every major ad network.

AdsGPT combines LLM-driven ad copy and creative generation, a real-time ad-generation dashboard, and an Elasticsearch-backed ad intelligence layer into a single product. It is organized as a monorepo of four cooperating services, with an **Autopilot** automation layer that continuously audits and acts on connected Meta ad accounts (auto-pause underperformers, auto-resume when conditions clear, scale winners, hook-rename, creative rotation). See [`docs/AUTOPILOT_PRD.md`](./docs/AUTOPILOT_PRD.md) for the full spec and [`docs/AUTOPILOT_STATUS.md`](./docs/AUTOPILOT_STATUS.md) for what's live right now.

> **Source of truth.** This repository **is** the canonical source for the three services it covers — `nodejs-backend/`, `react-frontend/`, and `nodejs-ads-backend/`. Pushes to `main` that touch those directories auto-deploy to the dev server via GitHub Actions; see [`docs/DEPLOY_CICD.md`](./docs/DEPLOY_CICD.md).
>
> **Caveats.** The dev server still hosts several components that are NOT in this monorepo: `adsgpt-ads-viz`, `adsgpt-data-collection`, `adsgpt-video-editor`, the Python AI tree (`advideo`/`advideo-revamped`/`adfactory`/`adcreatives`/`adcopy` under the chatbot user), and a legacy PHP/aMember frontend at `adsgpt-dev.poweradspy.com`. `python-backend/` in this repo is the aspirational counterpart of the chatbot-user Python tree but is not its deploy target. Read [`DEPLOYMENT-CONFLICTS.md`](./DEPLOYMENT-CONFLICTS.md) for the full delta.

---

## Table of contents

- [Architecture](#architecture)
- [Monorepo layout](#monorepo-layout)
- [Services](#services)
  - [react-frontend](#react-frontend)
  - [nodejs-backend](#nodejs-backend)
  - [nodejs-ads-backend](#nodejs-ads-backend)
  - [python-backend](#python-backend)
- [Autopilot](#autopilot)
- [Dev deployment](#dev-deployment)
- [Getting started](#getting-started)
- [Environment variables](#environment-variables)
- [Tech stack at a glance](#tech-stack-at-a-glance)
- [Contributing](#contributing)

---

## Architecture

```
                            ┌──────────────────────────┐
                            │      react-frontend      │
                            │   (Vite + React 19 SPA)  │
                            └────────────┬─────────────┘
                                         │
                     HTTPS + Socket.IO   │
                                         ▼
   ┌─────────────────────────────────────────────────────────────┐
   │                        nodejs-backend                        │
   │   Express + Socket.IO gateway · JWT · Mongo · Redis pub/sub  │
   │   Orchestrates ad copy, creative, video, campaigns, posting  │
   └───────────┬────────────────────┬──────────────────────┬──────┘
               │                    │                      │
               │ HTTP               │ Redis pub/sub        │ HTTP
               ▼                    ▼                      ▼
  ┌──────────────────────┐ ┌────────────────────┐ ┌──────────────────────┐
  │  nodejs-ads-backend  │ │   python-backend   │ │  External integrations│
  │  Express · ES 8.x    │ │  FastAPI + workers │ │  Gemini · AWS S3      │
  │  Ad search + vectors │ │  Copy / Creative / │ │  Facebook Business    │
  │  for 9 ad networks   │ │  AdFactory gateway │ │  Canva · aMember      │
  └──────────────────────┘ └────────────────────┘ └──────────────────────┘
```

Communication patterns:

- **Browser ↔ nodejs-backend**: HTTPS for REST, Socket.IO for streaming AI output and long-running jobs.
- **nodejs-backend ↔ python-backend**: HTTP for synchronous calls, Redis pub/sub for async AI workers (ad copy, creatives, video scenes).
- **nodejs-backend ↔ nodejs-ads-backend**: HTTP. The ads backend is a read-path service over Elasticsearch for competitive ad search and vector similarity.
- **Frontend ↔ ads APIs**: Direct calls to per-platform analytics endpoints using keys injected via Vite env vars.

---

## Monorepo layout

```
adsgpt/
├── react-frontend/        User-facing SPA (dashboard, studio, insights)
├── nodejs-backend/        Main API + Socket.IO gateway
├── nodejs-ads-backend/    Elasticsearch-backed ad search service
└── python-backend/        FastAPI + Redis-worker AI services (LLM)
```

---

## Services

### react-frontend

User-facing dashboard for creating, previewing, and analyzing ads across Meta, Google, Instagram, LinkedIn, Pinterest, Reddit, and TikTok.

**Stack**

- Vite 7 · React 19 · JSX (no TypeScript)
- Tailwind CSS 4 + Radix UI (shadcn patterns)
- Redux Toolkit, react-router-dom v7
- axios (with global 403 → logout interceptor), Socket.IO client
- Formik + Yup, ApexCharts / Recharts, Filerobot image editor, face-api.js, Three.js / Konva

**Key screens**

| Route | Purpose |
|---|---|
| `/adstudio` | Primary ad creation/editing workspace |
| `/adfactory` | Multi-step guided ad generator |
| `/adinsights` | "Addie" chat assistant for analytics |
| `/brandiq` | Brand intelligence and competitor research |
| `/ads-manager` | Manage ads across platforms |
| `/meta-ads` | Meta/Facebook-specific interface |
| `/profile`, `/onboarding` | Account and setup flows |

**Scripts**

```bash
npm run dev       # Vite dev server
npm run build     # Production build
npm run preview   # Preview built bundle
npm run lint      # ESLint
npm run format    # Prettier
```

---

### nodejs-backend

The main API gateway. An Express + Socket.IO service that orchestrates everything the frontend does — ad copy chat, creative and video generation, drafts and history, campaigns, Meta ad posting, billing/credits, and admin.

**Stack**

- Express + Socket.IO · JWT auth · Joi validation · Winston + daily-rotate logs
- MongoDB (Mongoose 8) · Redis (ioredis)
- Google Gemini SDK (multi-key round-robin)
- AWS S3 SDK, Facebook Business SDK, Canva, aMember, Stripe-style credit model
- Puppeteer (+ stealth), FFmpeg, Sharp, Archiver, EJS

**API surface** (mounted under `/adsgpt`)

```
/adcopy · /adCreative · /adVideo · /chat · /draft · /AdCopydraft · /AdCreativedraft
/history · /gallery · /campaign · /ad-posting · /video · /avatar
/meta-ads · /brand · /amember · /admin-panel · /canva · /usage
```

**Entry point:** `index.js` · reads `PORT` from env.

**Scripts**

```bash
npm run dev        # nodemon with swagger regen
npm start          # node index.js
npm run swagger    # regenerate swagger docs
```

**Key MongoDB collections:** userDetails, adCreative, adVideo, Chats, Draft, adFactory, facebookUsers, postedAds, usage, generatedMedia, brandNames.

---

### nodejs-ads-backend

A read-oriented service that fetches, searches, and serves ad creatives from Elasticsearch, including **vector similarity search** on embeddings (paraphrase-MiniLM, 384 dims). Powers competitive ad discovery and the in-chat "show me ads like this" flow.

**Stack**

- Express 4 · Elasticsearch 8.14 · ioredis (pub/sub) · JWT
- Sharp (image optimization), Winston, Joi, Swagger-autogen

**Routes** (all behind JWT, mounted under `/ads`)

| Method + path | Purpose |
|---|---|
| `POST /ads/onscroll` | Infinite-scroll ad fetch |
| `POST /ads/get-ads` | Primary retrieval with NER payload |
| `POST /ads/vector-search` | Semantic similarity search |
| `POST /ads/explore-ads` | Competitor/platform exploration |
| `GET  /explorer` | Swagger UI (basic-auth) |

**Data shape:** Ad documents with `id, network, postOwner, mediaUrl, newsfeedDescription, adUrl, category, adTitle, adType, adText, popularityIndex, embeddings, lastSeen`.

Ingests/serves ads from **9 networks**: Facebook, Instagram, Google Display, Google Trends, YouTube, LinkedIn, Reddit, Pinterest, GDN.

---

### python-backend

The AI brain. A mix of **FastAPI microservices** and **Redis-listening workers** that generate ad copy, creative images, and drive multi-step campaign workflows. Uses Google Gemini (2.5 Flash Lite) via LangChain, with platform-specific prompts for each supported ad network.

**Stack**

- Python 3.13 · FastAPI · Pydantic 2 · LangChain + langchain-google-genai
- Redis pub/sub for async work queues
- BeautifulSoup / Selenium / LXML for website autofill + image extraction
- torch + transformers + Pillow for the image generation path
- SQLAlchemy 2, python-dotenv, uvicorn (20 workers in prod)

**Layout (by entry point)**

| Path | Role | Port |
|---|---|---|
| `adcopy/app.py` | Redis worker — ad copy generation | — |
| `adcreatives/server/app.py` | Redis worker — creative generation | — |
| `adfactory/gateway_api/main.py` | FastAPI gateway | 8000 |
| `adcreatives/apis/model2/` | Image generation API (Dockerized) | 8000 |

**Gateway endpoints** (`/adfactory`)

- `POST /adfactory/startCampaign` — dispatch a campaign to the worker pool
- `POST /adfactory/autofill` — scrape a URL and extract brand info via LLM
- `POST /adfactory/getImages` — extract images from a URL
- `POST /adfactory/health` — health check

**Supported ad platforms in prompt templates:** Google Search, Google Performance Max, Google Display, Google Video, Meta (FB/IG), Twitter, LinkedIn, Reddit, Pinterest.

**Run**

```bash
# Workers
python app.py                                  # blocking Redis listener

# Gateway
uvicorn main:app --host 0.0.0.0 --port 8000 --workers 20
```

---

## Autopilot

Continuous Meta-ads operations layer baked into `nodejs-backend`. Connect a Meta account once, set thresholds, and Autopilot runs the account: every hour it audits **37 rules**, pauses critical underperformers, resumes ads whose conditions cleared, scales winning campaigns under per-entity, per-7d, **and per-account budget caps**, renames ads from creative hooks, and (Phase 9, gated off pending a populated rotation queue) rotates fatigued ads to fresh creatives.

Autopilot also exposes a **second audit lane** — an LLM-driven (Gemini 2.5 Pro) on-demand audit with per-finding apply/dismiss/undo. Both lanes share one frontend (`/autopilot`), one safety gate (`liveActionsAllowed`), one action log (`autopilotActionLog`), and one token resolver (`getAccessTokenForAccount`) so every audit-driven write goes through the same dry-run protections.

**Tagline:** _Set budget. Set objective. Walk away._

**What's live (as of 2026-04-27 evening):**

| Phase | Status |
|---|---|
| 1 — Extract audit core + per-account rule overrides | ✓ live |
| 2 — Auto-pause + Mongo action log | ✓ live |
| 3 — Hourly scheduler with Redis lock + within-run audit cache (3× → 1× Meta API per account per cycle) | ✓ live (gated off via `AUTOPILOT_ENABLED`; per-user FB token via `ownerUserId`) |
| 4 — React dashboard, **five tabs** (Overview, AI Audit, Action log, Rotation queue, Settings), per-user persisted settings, summary endpoints + Overview cards, **live FB ad-account picker**, **per-account drill-down with rule + entity + metrics** | ✓ live |
| 5 — Auto-resume + 3-strike flap cooldown + Meta `updated_time`-based manual-pause guard | ✓ live |
| 6 — Scale winners (AUD-32/33/34) + AUD-35 per-7d cap + AUD-37 per-account-cycle cap + AUD-34 ad-level retargeting to parent adset | ✓ live (gated off via `AUTOPILOT_SCALE_ENABLED`) |
| 7a — Hook rename from `creative.body` | ✓ live |
| 7b — Whisper video transcription | ⏳ not started (needs Python worker) |
| 8 — Alerts: Slack with Meta Ads Manager deep-links, Redis-backed throttling, email via nodemailer | ✓ live (silent unless webhook URL set) |
| 9 — Creative rotation: `adRotationDraft` model, `rotationService`, AUD-36 fatigue rule, UI tab | ✓ live (gated off + queue empty) |
| 10 — Review path (`POST /autopilot/approve-generated/:draftId`); generation core | partial — review path live, generation core deferred until test ad account |
| **AI Audit (LLM)** — Gemini 2.5 Pro on-demand audit with apply/dismiss/undo, 60-min undo window, 24h finding TTL, 11-action fix catalog. Mounted at `/meta-ads/autopilot/llm-audit/*`. Apply on non-opted-in account returns 423 + writes `dryRun: true` row to `autopilotActionLog` (source: `llm-audit`). | ✓ live |

**Token policy (v2, since 2026-04-27).** System-user token retired. Both cron and on-demand audits resolve the FB token from `FacebookUsers` via `getAccessTokenForAccount({adAccountId, callerUserId})` — caller's own OAuth token preferred, falls back to per-account `ownerUserId` for the cron path. `/autopilot` ships a **persistent Connect Facebook button** that re-runs OAuth so a user can grant access to additional accounts (the OAuth callback now busts per-user Meta caches so newly granted accounts appear immediately).

**Safety, in three layers:**
1. `AUTOPILOT_ENABLED=false` env (master switch, default off).
2. Per-account `liveActionsAllowed: false` in [`nodejs-backend/config/autopilotConfig.js`](./nodejs-backend/config/autopilotConfig.js) — default for all four production accounts. `effectiveDryRun()` forces dry-run inside every action service (cron + LLM apply) even when env is on. Unknown accounts (anything the user picked from their personal FB ad-account list) also force dry-run.
3. Per-request `dryRun=true` default on every HTTP endpoint. Action log records both real and would-have-been actions, with rule, entity, metrics snapshot, and outcome surfaced via the Activity Summary drill-down.

**Verification.** **188 unit tests** locally (~196 server-side once joi/mongoose deps load) cover rule evaluation, action services, settings precedence, alert helpers, summary aggregations, rotation queue logic, and per-user token resolution. Run with `npm run test:autopilot` from `nodejs-backend/`.

A live smoke test (`npm run smoke:autopilot`) hits `/run-cycle?dryRun=true` and asserts response shape, `dryRun: true` contract, and 60s budget — also probes the on-demand `/audit/run` and `/llm-audit` routes for mount status. **Wired into the CI deploy workflow** — runs server-side via `--jwt-from-mint` after every deploy; failure triggers automatic rollback.

The PRD ([`docs/AUTOPILOT_PRD.md`](./docs/AUTOPILOT_PRD.md)) is the long-lived spec; [`docs/AUTOPILOT_STATUS.md`](./docs/AUTOPILOT_STATUS.md) is the catch-up doc updated each session and is the **first thing a fresh contributor should read**.

---

## Dev deployment

The product currently runs on a single Oracle Cloud dev server (`poweradspy-development-vnic`). Services are split across two Linux users:

- **`pas-adsgpt-dev-ftp`** — Node.js services and static frontends. Managed by PM2 with a systemd auto-start unit (`pm2-pas-adsgpt-dev-ftp.service`), so they come back after a reboot.
- **`pas-adsgpt-dev-chatbot-ftp`** — Python AI services (pyenv 3.13.11). **Does not auto-start after reboot** — someone has to log in as this user and run `pm2 resurrect` (or start each service manually).

**Deploy pipeline.** Pushes to `main` touching `nodejs-backend/`, `react-frontend/`, or `nodejs-ads-backend/` trigger GitHub Actions workflows that rsync → `npm install` (if lockfile changed) → `pm2 restart` → health-check → rollback on failure. The Python tree and the other non-monorepo services are still hand-deployed. See [`docs/DEPLOY_CICD.md`](./docs/DEPLOY_CICD.md).

Everything listed below is a **dev domain** — there is no separate staging or production audit in this repo yet. All HTTPS terminations use Let's Encrypt / Certbot. State verified 2026-04-24 by read-only SSH probe.

| Domain | Port | Process | User | Path under `/home/<user>/` |
|---|---|---|---|---|
| [`adsgpt-dev-api.poweradspy.com`](https://adsgpt-dev-api.poweradspy.com) | 7000 | PM2 `gateway` (Node backend) | `pas-adsgpt-dev-ftp` | `adsgpt-back-end/ads-gpt-nodejs-backend` |
| [`adsgpt-dev-ads-api.poweradspy.com`](https://adsgpt-dev-ads-api.poweradspy.com) | 9090 | PM2 `ads-scroller` | `pas-adsgpt-dev-ftp` | `microservices/AdsScrollServer` |
| [`adsgpt-dev-visual-api.poweradspy.com`](https://adsgpt-dev-visual-api.poweradspy.com) | 9000 | PM2 `ads-viz` | `pas-adsgpt-dev-ftp` | `microservices/adsgpt-ads-viz` |
| [`adsgpt-dev-collection-api.poweradspy.com`](https://adsgpt-dev-collection-api.poweradspy.com) | 9001 | PM2 `data-collection` | `pas-adsgpt-dev-ftp` | `adsgpt-data-collection/server-data-collection` |
| [`adsgpt-dev.poweradspy.com`](https://adsgpt-dev.poweradspy.com) | PHP-FPM | Legacy PHP/aMember frontend *(not in this repo)* | `pas-adsgpt-dev-ftp` | `adsgpt-front-end/adsgpt-front-end` |
| [`adsgpt-staging.poweradspy.com`](https://adsgpt-staging.poweradspy.com) | 6000 | PM2 `frontend` (React static bundle, served from `dist/`) | `pas-adsgpt-dev-ftp` | `new-adsgpt-front-end/adsgpt-front-end` |
| [`video-editor-dev.poweradspy.com`](https://video-editor-dev.poweradspy.com) | 4173 | PM2 `video-editor` (static SPA) | `pas-adsgpt-dev-ftp` | `adsgpt-video-editor/dist` |
| [`ad-creative-dev.adsgpt.io`](https://ad-creative-dev.adsgpt.io) | 3000 | Python `adcreatives/server/app.py` | `pas-adsgpt-dev-chatbot-ftp` | `adsgpt/adcreatives/server` |
| [`ad-video-dev.adsgpt.io`](https://ad-video-dev.adsgpt.io) | 7001 | Python `advideo-revamped/app/main.py` | `pas-adsgpt-dev-chatbot-ftp` | `adsgpt/advideo-revamped/app` |
| [`ad-factory-staging.adsgpt.io`](https://ad-factory-staging.adsgpt.io) | 8000 | Python `adfactory/gateway_api` (uvicorn) | `pas-adsgpt-dev-chatbot-ftp` | `adsgpt/adfactory/gateway_api` |

See [`DEPLOYMENT-CONFLICTS.md`](./DEPLOYMENT-CONFLICTS.md) for the server-vs-monorepo delta, pre-migration residue that's safe to ignore, env var counts, and outstanding convergence work.

---

## Getting started

Prerequisites: Node.js 18+, Python 3.13, MongoDB, Redis, Elasticsearch 8.x, and valid Gemini + AWS credentials.

Clone:

```bash
git clone https://github.com/Globussoft-Technologies/adsgpt.git
cd adsgpt
```

Each service runs independently. Create a `.env` file in each service directory (see [Environment variables](#environment-variables) below) and then:

```bash
# Frontend
cd react-frontend && npm install && npm run dev

# Main backend
cd ../nodejs-backend && npm install && npm run dev

# Ads search backend
cd ../nodejs-ads-backend && npm install && npm start

# Python AI services (pick one per terminal)
cd ../python-backend
pip install -r requirements.txt
python adcopy/app.py
python adcreatives/server/app.py
uvicorn adfactory.gateway_api.main:app --port 8000
```

A `docker-compose.yml` is available for the image-generation service under `python-backend/adcreatives/apis/model2/`.

---

## Environment variables

The top-level `.gitignore` excludes all `.env*` files. Each service has its own set.

### react-frontend

```
VITE_ADS_URL                      # ads search backend base URL
VITE_SOCKET_URL                   # Socket.IO server URL (nodejs-backend)
VITE_AMEMBER_URL                  # membership portal
VITE_NAS_BASE_URL                 # NAS media CDN
VITE_S3_BASE_URL                  # S3 media CDN
VITE_EXPIRED_URL                  # expired-session redirect
VITE_FACEBOOK_ANALYTICS_API       # + matching _SECRET_KEY / _USER_ID
VITE_GOOGLE_ANALYTICS_API         # (same pattern)
VITE_INSTAGRAM_ANALYTICS_API
VITE_LINKEDIN_ANALYTICS_API
VITE_PINTEREST_ANALYTICS_API
VITE_REDDIT_ANALYTICS_API
```

### nodejs-backend

```
# Core
PORT  NODE_ENV  MODE  SWAGGER_HOST  SOCKET_URL  UI_USERNAME  UI_PASSWORD

# Data
MONGO_CONNECTION_STRING
HOST  RD_PORT  RD_USERNAME  redisPass

# Auth
JWT_SECRET_KEY  ACCESS_TOKEN_SECRET  TOKEN_EXPIRY_TIME  UPLOAD_IMAGE_SECRET_KEY

# AI
GEMINI_API_KEYS                  # comma-separated, round-robin

# AWS
AWS_REGION  AWS_ACCESS_KEY_ID  AWS_SECRET_ACCESS_KEY
AWS_S3_BUCKET_NAME  AWS_IMAGE_VIEW_URL

# Python worker endpoints
AD_FACTORY_PYTHON_API  AI_ADS_PYTHON_API  AVATAR_PYTHON_API
UGC_PYTHON_API  BROLL_PYTHON_API  CLONE_PYTHON_API
AI_ADS_GENERATE_SCENE_PYTHON_API  AI_ADS_REGENERATE_SCENE_PYTHON_API
AVATAR_SCRIPT_PYTHON_API  PYTHON_SCRAPER_BRANDIQ

# Third-party OAuth / APIs
CANVA_BASE_URL  CLIENT_ID  CLIENT_SECRET  REDIRECT_URI
NAS_UPLOAD_URL  NEW_NAS_UPLOAD_URL
CREATIVE_REQUEST_API  RESULT_UPDATE_SECRET

# Feature flags + credits
ENABLE_CREATIVE  ENABLE_VIDEO  ACCESS_ADCREATIVE_ALL
ADSGPT_AD_COPY_CREDIT_DEDUCTION
ADSGPT_SORA_PRO_VIDEO_CREDIT_DEDUCTION
ADSGPT_SEEDANCE_FAST_VIDEO_CREDIT_DEDUCTION
```

### nodejs-ads-backend

```
# Elasticsearch cluster
elasticNode1  elasticNode2  elasticNode3
ELASTIC_USERNAME  ELASTIC_PASSWORD  INDEX_NAME

# Redis pub/sub
PUB_SUB_HOST  PUB_SUB_PORT  PUB_SUB_USERNAME  PUB_SUB_PASSWORD
ADS_DATA                         # channel name

# External ad-platform ingestion (PAS)
FB_PAS_URL  INST_PAS_URL  GT_PAS_URL  YT_PAS_URL
LINKEDIN_PAS_URL  REDDIT_PAS_URL  GDN_PAS_URL  PINT_PAS_URL

# Media + routing
MEDIA_URL  MEDIA_UR_NEW_NAS  PAS_REDIRECT_URL
GATEWAY_URL  EMBEDDING_URL  DEV_URL

# Auth / server
JWT_SECRET_KEY  USER_NAME  PASSWORD
CORS_ORIGIN  PORT  ENV  SWAGGER_HOST
```

### python-backend

```
# LLM
GEMINI_API_KEY  GEMINI_API  GOOGLE_API_KEY

# Redis
REDIS_HOST  REDIS_PORT  REDIS_DB  REDIS_PASSWORD

# Gateway
API_DOCS_USERNAME  API_DOCS_PASSWORD
MODE                            # "dev" | "prod" -> loads .env.dev or .env.prod
ALLOWED_ORIGINS                 # CORS

# Image-gen API (adcreatives/apis/model2)
PROJECT_NAME  VERSION  API_V1_STR
HOST  PORT  MAX_IMAGE_SIZE  MAX_VARIATIONS
OUTPUT_DIR  RATE_LIMIT_PER_MINUTE
```

---

## Tech stack at a glance

| Layer | Technology |
|---|---|
| Frontend | Vite, React 19, Redux Toolkit, Tailwind CSS 4, Radix UI |
| Realtime | Socket.IO, Redis pub/sub |
| API gateway | Node.js, Express, JWT |
| Databases | MongoDB, Elasticsearch 8, Redis |
| AI / LLM | Google Gemini 2.5 Flash Lite, LangChain |
| Media | AWS S3, Sharp, FFmpeg, Puppeteer, Filerobot |
| Integrations | Facebook Business SDK, Canva, aMember, Meta / Google / LinkedIn / Pinterest / Reddit / Instagram analytics |
| Observability | Winston + daily-rotate-file, Swagger/OpenAPI per service |

---

## Contributing

1. Create a feature branch off `main`: `git checkout -b feat/<short-name>`.
2. Keep changes scoped to a single service when possible.
3. Follow the existing lint/format setup — the frontend enforces Prettier + ESLint via Husky pre-commit hooks.
4. Open a pull request against `main`. The repository history uses merge commits from review-approved PRs (see PRs #81–#84 for examples).

---

_Maintained by Globussoft Technologies._
