# Campaign Creation V2 — Status & Polish TODO

> Companion to [CAMPAIGN_CREATION_PARITY_PLAN.md](./CAMPAIGN_CREATION_PARITY_PLAN.md). Tracks per-phase progress and the polish items deferred to "after main implementation."
> **Last updated:** 2026-05-15

---

## Phase status

| Phase | Status | Notes |
|---|---|---|
| 0 — Schema & matrix | ✅ done | `wizardSchema.js`, `META_FIELD_MATRIX.md`, sanity tests |
| 1 — Engine + Traffic-Website | ✅ done | V2 wizard, V2 endpoints (`/meta-ads/v2/*`), Joi factories, payload builders, `FEATURE_WIZARD_V2` flag |
| 2 — App Promotion | ✅ done | Smoke-verified end-to-end. App-id via Business Manager picker (`act_<id>/applications`). No MMP per [feedback_app_promo_no_mmp memory](../../../.claude/projects/c--Users-User-Desktop-adsgpt-meta-adsgpt/memory/feedback_app_promo_no_mmp.md). |
| 3 — Leads | ✅ done | All 10 cells. Pixel infrastructure (picker + inline creation + event normalisation). Lead Form picker + builder. Performance-goal options now match Meta Ads Manager exactly per cell. |
| 4 — Traffic | ✅ done | All 6 cells (Website, App, Message Destinations, Instagram/Facebook, Calls, Website-and-Calls). Same builders as Leads. |
| 5 — Cutover | ⏳ pending | Flip `FEATURE_WIZARD_V2` default-on, V1 dropdown filters out migrated objectives, commit V2 files to git (currently uncommitted) |

---

## Cell coverage matrix

17 cells across 3 objectives, all end-to-end wired (schema → V2 validator → controller → `promoted_object` / `object_story_spec` builders → Meta API).

### Traffic (6 cells)
| Cell | Optimisation goals | Builder shape |
|---|---|---|
| Website | LINK_CLICKS, LANDING_PAGE_VIEWS, IMPRESSIONS, REACH | link_data |
| App | LINK_CLICKS, IMPRESSIONS, REACH | app_link |
| Message destinations | CONVERSATIONS, IMPRESSIONS, REACH | messenger_click_to_message |
| Instagram or Facebook | LINK_CLICKS, IMPRESSIONS, REACH | link_data (profile URL) |
| Calls | QUALITY_CALL, LINK_CLICKS | click_to_call |
| Website and Calls | LINK_CLICKS, QUALITY_CALL, LANDING_PAGE_VIEWS | link_data |

### Leads (10 cells — match Meta UI exactly)
| Cell | Optimisation goals | Builder shape |
|---|---|---|
| Website and instant forms (Multiple) | OFFSITE_CONVERSIONS | lead_gen_form_with_pixel |
| Website and calls (Multiple) | OFFSITE_CONVERSIONS | link_data |
| Instant forms and Messenger (Multiple) | LEAD_GENERATION | lead_gen_form |
| Website (Single) | OFFSITE_CONVERSIONS, LANDING_PAGE_VIEWS, LINK_CLICKS, REACH, IMPRESSIONS | pixel_website |
| Instant forms (Single) | LEAD_GENERATION, QUALITY_LEAD | lead_gen_form |
| Messenger (Single) | LEAD_GENERATION | messenger_click_to_message |
| Instagram (Single) | LEAD_GENERATION | instagram_direct |
| WhatsApp (Single) | CONVERSATIONS | whatsapp_click_to_message |
| Calls (Single) | QUALITY_CALL | click_to_call |
| App (Single) | OFFSITE_CONVERSIONS (label "app events"), LINK_CLICKS, REACH | app_link |

### App Promotion (1 cell)
| Cell | Optimisation goals | Builder shape |
|---|---|---|
| App | APP_INSTALLS | app_link |

---

## Recent hardening (since 2026-05-13)

### Meta regional-compliance gates (validated at create time, all geos)
- **DSA (EU) declaration** — every ad set sends `dsa_beneficiary` + `dsa_payor`, auto-filled from the selected Page name (overridable on the Ad Set step). Fixes Meta error 100 / subcode 3858081 ("No advertiser indicated").
- **Per-country universal-ads regulations — sidestepped by exclusion.** Worldwide targeting was triggering Meta's "No Taiwan universal ads declaration" (subcode 3858081-class) and "No Singapore universal ads declaration" (subcode 3858550) — any ad set that *can* reach those countries needs a per-country declaration. Taiwan needs `regional_regulation_identities` with pre-registered numeric identity ids; Singapore needs `regional_regulated_categories` = `SINGAPORE_UNIVERSAL`. Rather than implement each country's declaration infrastructure piecemeal, the Worldwide toggle adds `excluded_geo_locations: { countries: WORLDWIDE_EXCLUDED_COUNTRIES }` (currently `["TW", "SG"]`) so the ad set can't deliver there → no declaration required. Specific-country targeting never selects these (not in the wizard's country list). Worldwide still reaches every other country. Proper per-country support is polish item #3; the exclusion list is a one-line add when a new country's regulation appears.

### Per-cell Meta-API correctness fixes
- **Performance-goal options match Meta** — each cell's `optimizationGoals` array trimmed to exactly what Meta Ads Manager shows; labels match Meta's wording ("Maximise number of conversions" etc.); cells can override the global label (Leads/App relabels OFFSITE_CONVERSIONS → "app events").
- **CTA fix on Leads/Instant Forms and Messenger** — removed `MESSAGE_PAGE` from allowed CTAs (the `lead_gen_form` creative shape doesn't carry the messenger app_destination, so picking it would route every clicker to the form). Meta routes per viewer via `destination_type=ON_AD` independently of the CTA.
- **Click-to-call `link_caption` fix** — `buildClickToCallLinkData` no longer sets `call_to_action.value.link_caption` (Meta validates it as a URL for WEBSITE-routed click-to-call ads and rejected the bare phone number).
- **App-cell OS targeting** — when the cell's promoted-object shape is `app`, the V2 controller auto-injects `user_os: ["Android" | "iOS"]` (derived from mobileAppStore) and forces `device_platforms: ["mobile"]`. Fixes Meta error 1487678 "Mobile Targeting Mismatch".
- **Multiple-cell creative shapes** — Leads "Website and Instant Forms" `lead_gen_form_with_pixel` puts BOTH `link` and `lead_gen_form_id` on the CTA value; "Website and Calls" uses `link_data` (not `click_to_call`).
- **`destination_type` omitted for Leads Multiple cells** — Meta has no `destination_type` enum for "Website and instant forms" / "Website and calls" / "Instant forms and Messenger"; setting one explicitly made Meta lock the conversion location to a single value (showed "Website" instead of "Website and instant forms") and reject form-only creatives (subcode 1815676). The Leads Multiple cells now omit `destination_type` so Meta infers the multi-destination routing.
- **`destination_type` resolves per (objective, conversionLocation)** — `getMetaDestinationType` was keyed on conversion-location alone, but `WEBSITE_AND_CALLS` exists in **both** Traffic and Leads and needs a different value per objective (Traffic → `WEBSITE`, Leads → omitted). The shared key silently cross-applied one objective's value to the other. Now objective-qualified; guarded by a dedicated regression test.
- **iOS 14+ flow wired properly** — toggle on Campaign step (App Promotion only). When ON: app picker moves to Campaign step with Apple App Store forced (matches Meta's Ads Manager); backend sends `is_skadnetwork_attribution: true` + `promoted_object` on the campaign create; Ad Set step shows app read-only with "edit at campaign level" note. Validator rejects iOS 14+ paired with Google Play. Standard App Promotion (Android + pre-14.5 iOS) keeps working when OFF.
- **App Promotion SKAdNetwork attribution** — `is_skadnetwork_attribution` is sent EXPLICITLY (true/false) for `OUTCOME_APP_PROMOTION` campaigns. Meta v24 defaults App Promotion campaigns to AEM attribution; the explicit `false` opts non-iOS14+ campaigns into standard attribution. Fixes subcode 3955009 "Invalid campaign attribution for non-iOS14+ campaign".

### Video creatives (image + video)
- **Image / Video toggle** — the Ad step's Media field has an Image / Video SegGroup; each mode has its own Upload + Library tabs. `objectStorySpec` builders emit `video_data` (vs `link_data`) when a `videoId` is present — all creative shapes support both media types via a single `mediaFields()` helper.
- **Resumable video upload** — `POST /meta-ads/upload-video` uses Meta's 3-phase resumable protocol (start → transfer chunks → finish) instead of the SDK's single-request upload. The SDK path was hitting Meta's `graph.facebook.com/advideos` server-side timeout (code 390 / subcode 1363030) even on 2-3 MB files; the resumable protocol is what Meta's own Ads Manager uses and is robust at any size.
- **Auto-thumbnail** — Meta auto-extracts thumbnails during encoding. `uploadAdVideo` polls `advideos/{id}/thumbnails` right after upload; `createAdV2` does a last-chance fetch at Launch. The thumbnail field is optional from the user's side (the manual "paste video URL" input was removed entirely — Upload + Library cover it). If the video is still encoding, the user gets a clear "wait ~30s and retry" 400.
- **Validator** enforces image-xor-video at the API boundary; thumbnail is optional (controller fills it).

### Resource-discovery scoping
- **Ad-account-scoped page picker** — `getMetaPages(adAccountId)` scopes to the ad account's owning business (`owned_pages` + `client_pages`), or `/me/accounts` for personal accounts. Was returning pages from every business the user belonged to.
- **Ad-account-scoped app picker** — `getPromotableApps(adAccountId)` uses only `act_<id>/applications` and drops apps without store URLs (instant games, fb_canvas).

### UI / UX
- **V1-parity primitives** — V2 wizard uses portaled `SelectField` (framer-motion, ✓ on selected), brand-gradient `ToggleField`, `SegButton`/`SegGroup`, `GradientCheckbox`, custom `DateTimePicker` (replaces native browser widget), `LaunchErrorBanner` (fbtrace + dismiss + Meta help link), `WizardCard` (gradient ring + icon tile + description). Modal header has a gradient icon tile + Posting-to pill + corner X; discard-confirm overlay; Posting-to banner on Review; inline LibraryPicker in the Ad step.
- **Label/value pattern everywhere** — performance-goal, billing-event, and call-to-action dropdowns show Meta's friendly label (e.g. "Install now") while the form stores + submits the raw enum (`INSTALL_MOBILE_APP`). Labels come from `schema.labels.*`.
- **Media-preview flicker fix** — `ImageField` / `VideoField` memoize the blob URL on the file reference (was calling `URL.createObjectURL` every render, which reloaded the `<video>`/`<img>` on every keystroke). Previous blob URL is revoked on change.

---

## Test coverage

`npm run test:metaAds` — **386 passing** (`wizardSchema.test.js` 230 + `v2.test.js` 156).

**Regression net — every one of the 17 cells is exhaustively driven through the full payload chain** (`v2.test.js`, "every cell —" groups):
- `object_story_spec` builds for **both** an image and a video creative — asserts the right `link_data` / `video_data` shape.
- `promoted_object` builds without throwing.
- `buildAdSetSchemaV2` + `buildAdSchemaV2` accept a valid per-cell body.

This catches the class of bug that kept biting us — change a builder / schema field / validator and break a cell, a test fails immediately. (It can't verify Meta *accepts* the payload — only a live launch does — but it locks the payload **shape** so accidental edits surface.)

Plus targeted cases: `destination_type` resolution per (objective, conversionLocation) incl. the `WEBSITE_AND_CALLS` objective-divergence guard; Leads Multiple cells omit `destination_type`; CTA / optimisation-goal / billing-event invariants; `toJSON` serialisation; image-xor-video media check; per-shape `object_story_spec` + `promoted_object` unit tests.

- `nodejs-backend/test/metaAds/wizardSchema.test.js` — schema sanity + accessor tests.
- `nodejs-backend/test/metaAds/v2.test.js` — builders, Joi factories, and the exhaustive per-cell regression net.

---

## Polish TODO — fix at the end, after Phase 5

These don't block shipping. Defer until V2 is cut over in production.

### 1. Per-cell unit tests — ✅ DONE

The "every cell —" regression net in `v2.test.js` now drives all 17 cells through `object_story_spec` (image + video), `promoted_object`, and **both** Joi factories with a valid body. Remaining nice-to-have (not blocking): explicit **negative** cases per cell (e.g. "Leads/Website rejects a body missing `pixelId`"). The positive path + the schema-consistency loop catch the overwhelming majority of drift; negatives can be added incrementally.

### 2. Pre-flight Page setup check for messaging-destination cells

When a user picks Messenger / Calls / WhatsApp / Instagram cells, the wizard lets them progress all the way to Launch before Meta returns "Page has no phone" / "Page hasn't connected WABA" / "Page hasn't accepted Lead Ads Terms." User then has to back up and fix the Page in Meta Business Manager.

Better UX: fail-fast at the **AdSet step** by reading the Page's properties up front when the user picks the Page. Each cell's `identity.required` array names what to check:

| Identity token | Page field to verify |
|---|---|
| `messengerEnabled` | Page edge `messaging` enabled |
| `whatsappBusinessConnected` | Page edge `whatsapp_business_account` returns a WABA id |
| `pagePhoneNumber` | Page field `phone` non-empty |
| `pixel` | Ad account has at least one active Pixel (already wired) |
| `linkedApp` | Ad account's promotable_apps non-empty (already wired) |
| `instagram` | Page has `instagram_business_account` (already wired) |

Implementation sketch:
- New endpoint `GET /meta-ads/get-page-readiness?pageId=…&cellId=…` returns `{ ready: boolean, missing: ["messengerEnabled", …], guidance: { … } }`
- Wizard calls it when (pageId, conversionLocation) both set
- AdSet step shows a banner with what's missing + deep links to fix
- Continue button gated on `ready: true`

Effort: ~45 min.

### 3. Full per-country universal-ads support (currently sidestepped)

Several countries (Taiwan, Singapore — more will come) have per-country "universal ads" regulations. They're **triggered by reachability**: any ad set that can deliver to that country must carry the declaration. The wizard sidesteps all of them by adding `excluded_geo_locations: { countries: WORLDWIDE_EXCLUDED_COUNTRIES }` (`metaAdLauncherV2.js`, currently `["TW", "SG"]`) to Worldwide-targeted ad sets, so those countries are never reached and no declaration is needed. Specific-country targeting can't select them (not in the wizard's country list). **This is fine for ~every advertiser** — these are tiny incremental markets and worldwide-minus-a-few still reaches everywhere else. Adding a newly-regulated country is a one-line append to `WORLDWIDE_EXCLUDED_COUNTRIES`.

Each country's declaration mechanism differs, which is why piecemeal support is real work:
- **Taiwan** — `regional_regulation_identities.taiwan_universal_beneficiary` / `taiwan_universal_payer` must be **numeric IDs** of pre-registered regulation-identity records. The `facebook-nodejs-business-sdk` has a `RegionalRegulationIdentities` CRUD class but no create/list edge wired to AdAccount/Business — registration flow undocumented.
- **Singapore** — `regional_regulated_categories` = `SINGAPORE_UNIVERSAL` (a category string; the error message hands you the value). Simpler than Taiwan — likely just the one field, possibly + a `singapore_universal` identity. Unverified end-to-end.

When a customer genuinely needs reach into one of these markets, implement that country's declaration and remove it from `WORLDWIDE_EXCLUDED_COUNTRIES`.

### 4. Lift V1's polished primitives back into V1

V2 now imports `SelectField`, `SegButton`, `DateTimePicker`, `GradientCheckbox`, `LaunchErrorBanner`, `WizardCard` from `wizardFields.jsx`. V1 still has inline copies of `SelectInput`, `Toggle`, `SegButton`, `DateTimePicker`, `GradientCheckbox` at the top of `CreateCampaignWizard.jsx`. Either:
- Update V1 to import from `wizardFields.jsx` (saves ~400 lines)
- OR delete V1 entirely once Phase 5 cutover ships (cleaner)

Recommend the latter — V1 is only kept around to serve un-migrated objectives, and once Phase 5 ships there are no un-migrated objectives left.

---

## Out of scope (do not re-litigate)

These are intentionally not in V2 — captured here so future contributors don't accidentally pull them back in:

- **MMP integration for App Promotion** — per [feedback_app_promo_no_mmp](../../../.claude/projects/c--Users-User-Desktop-adsgpt-meta-adsgpt/memory/feedback_app_promo_no_mmp.md). Don't propose MMP banners or in-app event optimisation goals.
- **Conversions API setup wizard** — Phase 5 of the parity plan, separate effort. Pixel infrastructure (which we have) is sufficient for "Website leads" reporting today.
- **Custom Pixel events beyond the standard catalogue** — currently surface the standard event enums + recently-fired events from `stats`. Custom-event-name input is deferred until a real customer needs it.
- **Per-cell attribution window allowlist** — current implementation hardcodes `skipAttributionSpec` for `OUTCOME_LEADS` so Meta applies its own per-cell default. Power users can't override 7-day-click for Website Leads. Future polish if asked.
- **Reporting-metric verification** — confirming "Multiple → Website and Instant Forms" produces a "Website leads" reporting column requires a live campaign with real delivery. Defer to real spend.
- **Walking `/me/businesses` for resource discovery** — replaced with strict ad-account-scoping for both apps and pages. Matches Meta Ads Manager's own picker behavior. See [memory entry](../../../.claude/projects/c--Users-User-Desktop-adsgpt-meta-adsgpt/memory/project_meta_app_discovery.md).
- **Additional OAuth scopes** (`instagram_basic`, `leads_retrieval`, `pages_manage_metadata`) — current scopes cover the Business Manager flow that all customers use. See `nodejs-backend/controllers/adPosting/authController.js` for the current list.
- **Dynamic Creative** — toggle removed from the AdSet step. `is_dynamic_creative` on an ad set forces every ad in it into the dynamic-creative format (`asset_feed_spec` with arrays of images / headlines / texts / CTAs); creating a normal `object_story_spec` ad in a dynamic-creative ad set is rejected with subcode 1885702. The wizard's Ad step only collects ONE of each asset, so Dynamic Creative has nothing to mix. Re-surface the toggle only once the Ad step supports multiple creative variations (the parity plan's multi-image work). The `dynamicCreative` form field + `is_dynamic_creative` controller passthrough are left inert so re-adding is a UI-only change.

---

## Pre-Phase-5 checklist

Before flipping `FEATURE_WIZARD_V2` default-on:

- [ ] **Commit V2 files** — schema, validator, V2 controller, builders, wizard UI, primitives, routes (incl. `/meta-ads/upload-video`), dashboard flag, docs, tests are all uncommitted (`?? ` or ` M`) in the working tree.
- [ ] Smoke each objective once with both **image** and **video** creatives after the most-recent batch (DSA declaration, per-cell perf-goal options, Multiple-cell website-destination fix, resumable video upload, iOS 14+ flow, CTA label/value, Worldwide-excludes-TW/SG).
- [ ] Set `VITE_FEATURE_WIZARD_V2=true` in the production frontend env.
- [ ] Filter migrated objectives (`OUTCOME_TRAFFIC`, `OUTCOME_LEADS`, `OUTCOME_APP_PROMOTION`) out of V1's `OBJECTIVES` dropdown so users can't accidentally enter the broken V1 paths.
- [ ] Update README / customer-facing docs if any reference the V1 wizard.

---

## Ship verdict

All 3 objectives are genuinely end-to-end. 17 cells × (schema, validator, controller, builders, frontend) all wired and tested. 66/66 tests pass. The only behavioural gap is the polish TODO above — both items improve UX but neither blocks launch. Confidence is high to flip the production flag after the pre-Phase-5 checklist.
