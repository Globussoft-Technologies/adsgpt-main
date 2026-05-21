# AdsGPT — Campaign Creation Full-Parity Plan

> **Status:** v0.1 (2026-05-07) — Plan stage, no engineering started. Scope locked at **Option A: Full Meta Ads Manager parity**.
> **Owner:** TBD · **Last updated:** 2026-05-07
> **Target completion:** 14–20 weeks from kickoff (estimate; refine after Phase 0 audit)
> **Related docs:** [`AUTOPILOT_PRD.md`](./AUTOPILOT_PRD.md), [`AUTOPILOT_STATUS.md`](./AUTOPILOT_STATUS.md)

---

## 1. Why this plan exists

The current Create Campaign Wizard ([`react-frontend/src/components/MetaAds/CreateCampaignWizard.jsx`](../react-frontend/src/components/MetaAds/CreateCampaignWizard.jsx)) is a single rigid 4-step flow that handles roughly **10–15%** of what Meta Ads Manager actually supports. It assumes:

- Objective is one of the 6 ODAX values, but the form fields after Step 1 don't change with it.
- Conversion location is implicitly "Website".
- Creative is image-only (no video, no carousel, no dynamic creative).
- Targeting is "country list OR saved audience"; no detailed targeting search, custom audiences, or lookalikes.
- One optimization goal, one billing event, one CTA list.
- No pixel / conversion event picker, no placements, no attribution settings.

In reality Meta exposes a **branching matrix** — every (objective × conversion location) combination has its own valid set of optimization goals, creative formats, identity requirements, and tracking fields. A single static form cannot model this without lying.

This document plans the rebuild to full parity.

---

## 2. Current vs. target state

### Currently shipped

| Layer | What works |
|---|---|
| Backend | `POST /meta-ads/create-campaign`, `/create-adset`, `/upload-image`, `/create-ad`. Joi validators in [`Validations/meta.validator.js`](../nodejs-backend/Validations/meta.validator.js). `is_adset_budget_sharing_enabled` defaulted server-side for non-CBO. Step-cache idempotency on retry. |
| Frontend | 4-step wizard (Campaign → AdSet → Ad → Review). Page picker, saved audience picker, country picker, advantage-audience toggle, single image upload, 14 CTAs. |
| Data | Six modern objectives accepted (`OUTCOME_AWARENESS`, `OUTCOME_TRAFFIC`, `OUTCOME_ENGAGEMENT`, `OUTCOME_LEADS`, `OUTCOME_APP_PROMOTION`, `OUTCOME_SALES`). |

### Target state — Meta Ads Manager full parity

Every (objective × conversion location × creative format × tracking option) combination Meta's UI exposes. Specifically:

- All **6 objectives**, with the right downstream form for each.
- All **conversion locations** per objective (Website / App / Messenger / Instagram / WhatsApp / Calls / Lead Form / Page / Video / Catalog / etc.).
- All **performance goals** (`optimization_goal`) valid for each (objective × location).
- All **creative formats**: single image, single video, carousel, collection, dynamic creative, asset feed spec (multi-headline / multi-body / multi-image).
- Full **targeting**: detailed targeting (search interests/behaviors/demographics), custom audiences, lookalikes, exclusions, placements (Advantage+ vs manual across FB / IG / Messenger / Audience Network surfaces).
- Full **tracking**: pixel, conversions API, conversion event picker, attribution windows, URL parameters / UTMs.
- **Edit / duplicate** at every level (currently only create).
- **A/B test** setup.

---

## 3. The matrix we're replicating

The branching that drives all the form variance:

| Objective | Conversion locations | Common optimization goals | Identity requirement |
|---|---|---|---|
| **AWARENESS** | (none — single ad type) | Reach, Impressions, Ad Recall Lift, ThruPlay, 2-Sec Continuous Video Views | Page (+ optional IG) |
| **TRAFFIC** | Website, App, Messenger, Instagram, WhatsApp, Calls | Link Clicks, Landing Page Views, Reach, Impressions, Conversations, Calls | Page (+ optional IG) |
| **ENGAGEMENT** | Messaging apps, On your ad, Video views, Post engagement, Conversions, Calls | Conversations, Post Engagement, Page Likes, Event Responses, ThruPlay, Video Views, Conversions | Page (+ optional IG) |
| **LEADS** | Website (Conversions), Instant Form, Messenger, Instagram, Calls, App | Conversions, Leads, Quality Leads, Conversations, Calls, Link Clicks | Page (+ optional IG); Lead Form for Instant Form |
| **APP PROMOTION** | App | App Installs, App Events, Value, Link Clicks | Page + linked App (App Store / Play) |
| **SALES** | Website, App, Messenger, WhatsApp, Calls, Catalog (Advantage+ Shopping) | Conversions, Value, Landing Page Views, Link Clicks, ThruPlay, ROAS Min | Page (+ optional IG); Catalog for Catalog Sales; Pixel for Website |

Each cell above expands further into:
- **Allowed creative formats** (e.g. App Promotion forbids Carousel; Catalog Sales requires Catalog-bound creative).
- **Allowed CTAs** (`SHOP_NOW` only for Sales; `BOOK_TRAVEL` for Travel-vertical Traffic; `MESSAGE_PAGE` for Messenger destination; `APPLY_NOW` for Leads; etc.).
- **Required vs optional fields** (e.g. Pixel + conversion event are required for SALES + Website + Conversions; Lead Form is required for LEADS + Instant Form).
- **Additional steps** (e.g. SALES + Catalog inserts a "Pick catalog + product set" step; LEADS + Instant Form inserts "Build lead form").

This matrix is the spine of the rebuild.

---

## 4. Architecture decisions (locked at Phase 0)

### 4.1 Config-driven form engine, not per-objective wizard variants

We **do not** fork the wizard into 6 (or 30+) hand-coded variants. We define a single declarative schema that enumerates every (objective × location × goal) combination and the fields they require, then render the wizard from that schema.

**Why:** Meta itself ships a config-driven form (you can tell from how their UI rebuilds when you toggle a top-level field). Forking gives us 6 codebases to maintain in lockstep. A schema gives us one source of truth that both the frontend renderer and the backend validator can consume.

### 4.2 Discriminated-union Joi validators

`createAdSetSchema` becomes a discriminated union by `(objective, conversion_location)`. Each branch has its own required-field set. We never accept "all optional, validate later".

### 4.3 Form state shape

A single nested object representing the campaign tree:

```ts
type WizardState = {
  account: { id; currency; timezone };
  campaign: {
    name; objective; specialAdCategories;
    cbo: boolean; budgetType; budget; bidStrategy;
    abTest?: { … };
  };
  adSets: AdSet[]; // future: support multi-adset; for now array of length 1
  ads: Ad[];       // future: support multi-ad per adset; for now array of length 1
};
```

Multi-adset and multi-ad arrays from day one even if Phase 1 only supports `length === 1` — saves a refactor later.

### 4.4 Server-side step idempotency

Each step (`/create-campaign`, `/create-adset`, `/upload-image`, `/create-ad`) returns its created entity ID. Frontend caches the IDs in wizard state and skips already-completed steps on retry — this pattern is already shipped in [`CreateCampaignWizard.jsx`](../react-frontend/src/components/MetaAds/CreateCampaignWizard.jsx) (`created` state). We extend it as new steps are added (lead form, catalog binding, pixel selection, etc.).

### 4.5 Edit + duplicate from day one of Phase 6

Every Joi validator must support both **create** (with required fields) and **patch** (partial update of an existing entity). We do not write two parallel validator trees.

### 4.6 Backwards compatibility

The current wizard ships as `CreateCampaignWizard.jsx`. The rebuild starts as `CreateCampaignWizardV2.jsx` and runs side-by-side behind a feature flag. We migrate by objective: when an objective ships in V2, V1 stops offering it. V1 is deleted at end of Phase 6.

---

## 5. Phase-by-phase plan

> Effort is rough 1-engineer estimates. Tighten after Phase 0 inventory.

### Phase 0 — Inventory & schema authoring (1.5 wks)

**Goal:** Catalog every form-field combination Meta exposes. No production code yet.

**Deliverables**
- `docs/META_FIELD_MATRIX.md` — for each (objective × location), the canonical list of required + optional fields, allowed values, and visual order. Source: Meta Ads Manager UI (manual capture) + [Marketing API Reference](https://developers.facebook.com/docs/marketing-apis).
- `nodejs-backend/config/wizardSchema.js` — programmatic encoding of the matrix. Drives both the renderer and the Joi validator factory.
- `wizardSchema.test.js` — sanity tests asserting every objective has at least one valid location, every location has at least one optimization goal, etc.

**Exit criteria**
- Schema covers all 6 objectives × every Meta-supported location × every valid optimization goal.
- Schema covers every CTA Meta supports, mapped to allowed (objective, location) tuples.
- Schema covers every creative format with its constraints (ratios, length, count caps).

### Phase 1 — Form engine + V2 skeleton (2 wks)

**Goal:** Stand up the schema-driven wizard with one objective working end-to-end (Traffic + Website, the existing baseline) so we prove the engine before adding scope.

**Deliverables**
- `CreateCampaignWizardV2.jsx` rendering from `wizardSchema`. Field components in `wizardFields/` (text, number, select, multiselect, currency, date, image, lookup-async, etc.).
- New step **Conversion Location** between Campaign and Ad Set.
- Backend: `meta.validator.js` refactored to a `buildAdSetSchema(objective, location)` factory consuming `wizardSchema`.
- Feature flag (`FEATURE_WIZARD_V2`) — V2 is opt-in for internal testing.
- Traffic + Website objective fully functional in V2, parity with V1.

**Exit criteria**
- Internal QA can launch a Traffic + Website campaign on `claudetestads01` via V2 with no fallback to V1.
- All Joi validation errors come from the schema-derived validator, not hardcoded checks.

### Phase 2 — Objective rollout (sequential)

Each objective is an independent vertical slice; ship and validate before starting the next.

#### 2a — Traffic (all locations) — 1.5 wks
- Add Website / App / Messenger / Instagram / WhatsApp / Calls flows.
- Add `destination_type` handling on the adset (already partially in validator; expose in UI).
- Per-location identity requirements (Messenger needs Page+Messenger setup; WhatsApp needs WABA).

#### 2b — Leads — 2.5 wks
- **Instant Form builder** — biggest sub-feature. Fields: greeting, questions (prefill / custom), privacy URL, completion screen, custom disclaimers. Stored as Lead Form entity on Meta.
- Lead Form picker (use existing Lead Forms on the page).
- Website-Conversion Leads — same pixel/event picker that Sales+Website needs (build once, reuse).
- Calls — phone number on Page; click-to-call CTA.

#### 2c — Sales — 2.5 wks
- Pixel selector (list pixels on the ad account; show health/last-fired).
- Conversion event picker (per-pixel events with last-fired timestamps + CAPI status).
- Attribution settings UI (1d-click / 7d-click / 1d-view / 7d-click+1d-view).
- ROAS Min bid strategy (capped strategy variant).
- **Catalog Sales** — catalog picker, product set picker, dynamic creative wired to catalog products.

#### 2d — Engagement — 1.5 wks
- Messaging engagement (Messenger / IG / WhatsApp Conversations).
- Page Engagement (post likes, page likes, event responses).
- Video Views with ThruPlay vs 2-sec optimization choice.

#### 2e — Awareness — 1 wk
- Reach / Impressions / Ad Recall Lift.
- Frequency cap controls.

#### 2f — App Promotion — 2.5 wks
- App linkage UI — connect App Store / Play app via Meta's App Center.
- MMP (mobile measurement partner) integration warning.
- Deep-link / deferred-deep-link inputs on creative.
- App Events (per-MMP event list).

**Phase 2 total:** 11.5 wks. App Promotion is the riskiest because it needs out-of-band setup (MMP). If users aren't asking for it, defer it to Phase 7 to unblock the rest.

### Phase 3 — Creative parity (3 wks)

**Goal:** Match every creative format and option in Ads Manager.

**Deliverables**
- **Video upload** — separate Meta endpoint, async polling for processing status, thumbnail capture.
- **Carousel** — multi-card editor; per-card image / headline / description / link.
- **Collection** — header media + product set tied to catalog (depends on Sales-Catalog flow).
- **Dynamic Creative** — toggle that turns on `dynamic_creative_optimization_mode`; multiple titles / bodies / images / videos / CTAs accepted, Meta optimizes.
- **Asset Feed Spec** — explicit multi-variant editor (multiple headlines, multiple bodies, etc., with per-variant labels).
- **CTA filtering** — only show CTAs valid for the selected (objective × location) per `wizardSchema`.
- **Creative library** — let users pick existing creatives in the account instead of re-uploading every time.

### Phase 4 — Targeting parity (2.5 wks)

**Deliverables**
- **Detailed targeting search** — autocomplete against Meta's Targeting Search API for interests / behaviors / demographics. Keep recent + suggested tabs.
- **Inclusions / exclusions** — Boolean groups (Must match A AND B; exclude C).
- **Custom audiences** — list audiences on the account; create-from-customer-list (file upload), create-from-website-traffic (Pixel-based), create-from-app-activity, create-from-engagement (page / video / lead form).
- **Lookalike audiences** — pick source audience + similarity % + country.
- **Placements** — Advantage+ Placements (default) vs Manual Placements (FB / IG / Messenger / Audience Network across Feeds, Stories, Reels, In-Stream, Right Column, Search, Marketplace, Apps).
- **Languages** (already partially supported) + **Connection-type targeting**.
- **Locations** — radius targeting on map, ZIP / city / region pickers, "people living in / recently in / traveling in".

### Phase 5 — Tracking & measurement (1.5 wks)

Most of this is consumed by Sales + Leads in Phase 2; this phase just gathers the surface into a coherent spot and adds the long-tail.

**Deliverables**
- Pixel + Conversions API setup wizard (link to existing setup or trigger setup flow).
- URL parameters / UTM templating (per-account default + per-ad override).
- Offline events upload (low priority, defer if tight).
- Limited Data Use settings (CCPA flag).

### Phase 6 — Edit + duplicate + bulk actions (2 wks)

**Deliverables**
- **Edit** at every level. Same wizard fields, but pre-populated and partial-update via Joi `patch` schemas. Some fields are immutable post-launch on Meta (objective, conversion location); render them disabled with explanation.
- **Duplicate** at every level (campaign / adset / ad). Default to PAUSED. Carries everything except IDs and start time.
- **Bulk** status changes from the table (multi-select rows).
- **Compare** — side-by-side diff of two campaigns/adsets/ads (useful for split-test analysis).

### Phase 7 — A/B test, schedule, advanced (1.5 wks)

**Deliverables**
- A/B test creation flow (split-test budget %, success metric, duration). Maps to Meta's Experiments API.
- Day-parting / hour-of-day scheduling.
- Frequency caps for Awareness / Reach.
- Spend caps (campaign-level + lifetime).
- Special ad-category compliance walkthrough (HEC + politics + financial).

### Phase 8 — Cutover + V1 deletion (0.5 wk)

**Deliverables**
- Feature flag flipped on for all users.
- V1 (`CreateCampaignWizard.jsx`) deleted. Routes redirected.
- Migration notes posted to release log.

---

## 6. Effort total

| Phase | Effort (1 eng) |
|---|---|
| 0. Inventory & schema | 1.5 wk |
| 1. Engine + V2 skeleton (Traffic-Website parity) | 2 wk |
| 2. Objective rollout (a–f) | 11.5 wk |
| 3. Creative parity | 3 wk |
| 4. Targeting parity | 2.5 wk |
| 5. Tracking & measurement | 1.5 wk |
| 6. Edit + duplicate + bulk | 2 wk |
| 7. A/B test + schedule + advanced | 1.5 wk |
| 8. Cutover + V1 deletion | 0.5 wk |
| **Total** | **26 wk** (≈ 6 months solo) |

Parallelizable to roughly **4 months with two engineers** if Phase 2 sub-objectives split, or **3 months with three engineers** if Phase 3/4 also fork.

---

## 7. Out of scope

- Reach & Frequency buying type (auction-only for now).
- Reservation buying (Reach & Frequency / TRP / Reserved).
- Branded Content / Partnership Ads.
- Stories Ads creative tools beyond standard image/video.
- Offline conversions ingestion.
- Multi-account bulk creation (one account at a time per wizard run).
- Migration of campaigns created externally (we only manage what we create or what's surfaced via the listing endpoints).

These are real Meta features but each is its own multi-week project; tagging out of scope keeps Phase 2 honest.

---

## 8. Risks & open questions

| Risk | Likelihood | Mitigation |
|---|---|---|
| Meta deprecates a field mid-build | High | Schema-driven approach localizes change. Watch v22 deprecation memo. |
| MMP integration for App Promotion is heavier than 2.5 wks | Medium | Defer App Promotion to last in Phase 2 or push to Phase 7. |
| Meta API rate limits during testing | Medium | Use sandbox accounts + Meta's dev tier where possible. |
| Pixel / CAPI setup UX is a black hole | High | Treat as link-out to Meta's setup flow; don't try to embed. |
| Catalog Sales requires a working catalog upload pipeline | High | Phase 2c assumes catalog already exists on the account; building catalog import is out of scope. |
| Schema gets out of sync between frontend & backend | High | Schema lives once in `wizardSchema.js`; consumed by both. CI test that loads schema in Node + browser confirms parity. |

**Open questions to resolve in Phase 0:**
1. Where does Lead Form CRUD live — inside this wizard, or as a separate "Lead Forms" section reachable from settings?
2. Can we ship Carousel and Dynamic Creative as Phase 3a/3b in parallel with Phase 2c (Sales)? They're prerequisites for catalog ads.
3. Will Autopilot rules need to be aware of new fields (e.g. should a rule be able to mutate `optimization_goal` post-launch)? Coordinate with [Autopilot owner].
4. What fallback do we show if a user lands in V2 with an objective that hasn't shipped yet — error, or auto-redirect to V1? Prefer "this objective is rolling out shortly" message.

---

## 9. Tracking

- Plan revisions tracked in `git log -- docs/CAMPAIGN_CREATION_PARITY_PLAN.md`.
- Per-phase progress: open a tracking issue in GitHub (`Globussoft-Technologies/adsgpt`) titled `Phase X — <name>` with checklist of deliverables.
- Weekly status updates appended to `docs/CAMPAIGN_CREATION_STATUS.md` (create when Phase 0 starts).
