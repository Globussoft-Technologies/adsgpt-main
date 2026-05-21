# Meta Ads — Field Matrix (V2 wizard, MVP scope)

> **Status:** Phase 0 deliverable. Locked at 2026-05-12. Reflects [`nodejs-backend/config/wizardSchema.js`](../nodejs-backend/config/wizardSchema.js).
> **Scope:** Traffic (4 locations), Leads (3 locations), App Promotion (placeholder). Other objectives flow through V1 until they migrate.
> **Source of truth:** the schema file, not this doc. If the two disagree, the schema wins and this doc is wrong — fix it.

---

## How to read this

Each section is one **objective**. Each table row is one **conversion location** within that objective. The cells describe what the V2 wizard renders, what the validator requires, and what Meta API shape the backend builders produce.

- `Optimization goals` — values offered in the AdSet step dropdown. Bold = default.
- `Billing events` — values offered in the AdSet step dropdown. Bold = default.
- `CTAs` — values offered in the Ad step dropdown. Bold = default.
- `Required ad fields` — wizard form field names (not Meta API names) that must be filled before launch.
- `Identity` — what the wizard checks for on the selected Page before allowing launch.
- `Additional steps` — wizard steps inserted between Ad Set and Ad for this cell. `leadForm` = Lead Form picker / builder.
- `promoted_object` — what the backend builder constructs for the AdSet's `promoted_object` field. `null` = omit.
- `object_story_spec` — what the backend builder constructs for the Ad's `creative.object_story_spec`. The string is the shape key consumed by `utils/objectStorySpec.js` (Phase 1).
- `Meta destination_type` — the literal value sent on the AdSet's `destination_type` field. `null` = omit.

---

## OUTCOME_TRAFFIC

Drive people to a destination. Four locations supported in V2.

### Website

| Field | Value |
|---|---|
| Meta `destination_type` | `WEBSITE` |
| Optimization goals | **`LINK_CLICKS`**, `LANDING_PAGE_VIEWS`, `IMPRESSIONS`, `REACH` |
| Billing events | **`IMPRESSIONS`**, `LINK_CLICKS` |
| Required ad fields | `imageHash`, `headline`, `primaryText`, `linkUrl` |
| Optional ad fields | `description`, `urlTags` |
| CTAs | **`LEARN_MORE`**, `SHOP_NOW`, `SIGN_UP`, `SUBSCRIBE`, `CONTACT_US`, `DOWNLOAD`, `BOOK_TRAVEL`, `GET_QUOTE`, `APPLY_NOW`, `GET_OFFER`, `ORDER_NOW`, `WATCH_MORE`, `NO_BUTTON` |
| Identity | Required: Page. Optional: Instagram. |
| Additional steps | None |
| `promoted_object` | `null` |
| `object_story_spec` shape | `link_data` |
| Notes | Default Traffic flow. The widest CTA list in the matrix. |

### Messenger

| Field | Value |
|---|---|
| Meta `destination_type` | `MESSENGER` |
| Optimization goals | **`LINK_CLICKS`**, `IMPRESSIONS`, `REACH` |
| Billing events | **`IMPRESSIONS`** |
| Required ad fields | `imageHash`, `headline`, `primaryText` |
| Optional ad fields | `description` |
| CTAs | **`MESSAGE_PAGE`**, `LEARN_MORE` |
| Identity | Required: Page with Messenger enabled. Optional: Instagram. |
| Additional steps | None |
| `promoted_object` | `null` |
| `object_story_spec` shape | `messenger_click_to_message` |
| Notes | `linkUrl` is omitted — Meta builds the click-to-Messenger URL from the Page identity. Wizard hides the URL input on this cell. |

### WhatsApp

| Field | Value |
|---|---|
| Meta `destination_type` | `WHATSAPP` |
| Optimization goals | **`LINK_CLICKS`**, `IMPRESSIONS`, `REACH` |
| Billing events | **`IMPRESSIONS`** |
| Required ad fields | `imageHash`, `headline`, `primaryText` |
| Optional ad fields | `description` |
| CTAs | **`WHATSAPP_MESSAGE`**, `LEARN_MORE` |
| Identity | Required: Page with a connected WhatsApp Business account. Optional: Instagram. |
| Additional steps | None |
| `promoted_object` | `null` |
| `object_story_spec` shape | `whatsapp_click_to_message` |
| Notes | The Page must have a WABA wired up via Meta Business Suite. The wizard surfaces a "Page is not WhatsApp-enabled" hard error if not. |

### Calls (`PHONE_CALL`)

| Field | Value |
|---|---|
| Meta `destination_type` | `PHONE_CALL` |
| Optimization goals | `QUALITY_CALL`, **`LINK_CLICKS`** |
| Billing events | **`IMPRESSIONS`** |
| Required ad fields | `imageHash`, `headline`, `primaryText` |
| Optional ad fields | `description` |
| CTAs | **`CALL_NOW`**, `LEARN_MORE` |
| Identity | Required: Page with a phone number on file. Optional: Instagram. |
| Additional steps | None |
| `promoted_object` | `null` |
| `object_story_spec` shape | `click_to_call` |
| Notes | Phone number is sourced from the Page lookup — the wizard does not collect it separately. `QUALITY_CALL` is only available on beta-enabled accounts; we default to `LINK_CLICKS` for safety. |

---

## OUTCOME_LEADS

Capture leads. Three locations supported in V2 (Website Conversion Leads deferred — needs Pixel + event picker, scheduled later).

### Instant Form (`INSTANT_FORM`)

| Field | Value |
|---|---|
| Meta `destination_type` | `ON_AD` (Meta's literal value for "form on the ad itself") |
| Optimization goals | **`LEAD_GENERATION`**, `QUALITY_LEAD` |
| Billing events | **`IMPRESSIONS`** |
| Required ad fields | `imageHash`, `headline`, `primaryText`, `leadFormId` |
| Optional ad fields | `description` |
| CTAs | **`SIGN_UP`**, `APPLY_NOW`, `GET_QUOTE`, `LEARN_MORE`, `SUBSCRIBE`, `GET_OFFER` |
| Identity | Required: Page. Optional: Instagram. |
| Additional steps | **`leadForm`** — picker for existing Lead Forms on the Page, or builder for a new one. Sets `form.leadFormId` before the Ad step. |
| `promoted_object` | `null` (lead form is bound on the creative, not promoted_object) |
| `object_story_spec` shape | `lead_gen_form` |
| Notes | The largest sub-feature in Phase 3. Form builder is MVP-scoped: greeting screen, prefill questions (name/email/phone), optional short-answer custom questions, privacy policy URL, completion screen with link. No custom disclaimers, no conditional logic. |

### Messenger

| Field | Value |
|---|---|
| Meta `destination_type` | `MESSENGER` |
| Optimization goals | **`LEAD_GENERATION`**, `LINK_CLICKS` |
| Billing events | **`IMPRESSIONS`** |
| Required ad fields | `imageHash`, `headline`, `primaryText` |
| Optional ad fields | `description` |
| CTAs | **`MESSAGE_PAGE`**, `SIGN_UP`, `APPLY_NOW`, `LEARN_MORE` |
| Identity | Required: Page with Messenger enabled. Optional: Instagram. |
| Additional steps | None |
| `promoted_object` | `null` |
| `object_story_spec` shape | `messenger_click_to_message` |
| Notes | Shares the click-to-message shape with Traffic/Messenger; only the optimization goal + CTA defaults differ. |

### Calls (`PHONE_CALL`)

| Field | Value |
|---|---|
| Meta `destination_type` | `PHONE_CALL` |
| Optimization goals | **`QUALITY_CALL`**, `LINK_CLICKS` |
| Billing events | **`IMPRESSIONS`** |
| Required ad fields | `imageHash`, `headline`, `primaryText` |
| Optional ad fields | `description` |
| CTAs | **`CALL_NOW`**, `LEARN_MORE` |
| Identity | Required: Page with a phone number on file. Optional: Instagram. |
| Additional steps | None |
| `promoted_object` | `null` |
| `object_story_spec` shape | `click_to_call` |
| Notes | Defaults to `QUALITY_CALL` (unlike Traffic/Calls which defaults to `LINK_CLICKS`) — for the Leads objective, a "low-intent click" is a worse signal than a missed-call attribution. |

---

## OUTCOME_APP_PROMOTION

Drive app installs to a single store per campaign.

### App (`APP`)

| Field | Value |
|---|---|
| Meta `destination_type` | `APP` |
| Optimization goals | **`APP_INSTALLS`** |
| Billing events | **`IMPRESSIONS`** |
| AdSet additional fields | `mobileAppStore` (`APPLE_APP_STORE` \| `GOOGLE_PLAY`), `applicationId`, `objectStoreUrl` |
| Required ad fields | `imageHash`, `headline`, `primaryText` (+ `objectStoreUrl` resent from AdSet step) |
| Optional ad fields | `description`, `deferredDeepLink`, `customProductPage` |
| CTAs | **`INSTALL_MOBILE_APP`**, `USE_APP`, `DOWNLOAD`, `LEARN_MORE`, `SHOP_NOW`, `BOOK_TRAVEL` |
| Identity | Required: Page **+ linkedApp** (resolved against the ad account's promotable_apps edge). Optional: Instagram, Threads. |
| Additional steps | None (mobileAppStore + applicationId render inline on the AdSet step before optimisation goal). |
| `promoted_object` shape | `app` → `{ application_id, object_store_url }` |
| `object_story_spec` shape | `app_link` |

#### Why APP_INSTALLS is the only goal

The other two App Promotion goals Meta exposes — `OFFSITE_CONVERSIONS` (in-app events like purchase) and `VALUE` (revenue maximisation) — both require a Mobile Measurement Partner (AppsFlyer, Adjust, etc.) forwarding post-install events back to Meta. This stack does not integrate an MMP, so exposing those goals would let users pick settings Meta will accept but never optimise against. `APP_INSTALLS` uses Meta's own install tracking (less accurate on iOS post-ATT but functional) and works without MMP.

To re-enable when an MMP is integrated: append `"OFFSITE_CONVERSIONS"` and `"VALUE"` to `cell.adSet.optimizationGoals` in `wizardSchema.js`.

#### iOS 14+ delivery — deferred

iOS 14+ campaigns are a separate Meta campaign type (`is_skadnetwork_attribution: true`) required to deliver to iOS 14.5+ users. Out of scope for now — campaigns deliver to Android + pre-14.5 iOS only. Phase 5 (tracking & measurement) revisits this.

#### Mobile App Store ↔ Object Store URL mapping

The `mobileAppStore` enum on the AdSet selects which store; the frontend's app picker (powered by `GET /meta-ads/get-promotable-apps`) auto-resolves the `objectStoreUrl` from the chosen app's metadata so the user never types a URL.

| `mobileAppStore` | `objectStoreUrl` source |
|---|---|
| `APPLE_APP_STORE` | `getPromotableApps().apps[i].appleAppStoreUrl` (normalised from Meta's `object_store_urls.itunes` / `.ios_app_store` / `.apple_app_store`). |
| `GOOGLE_PLAY` | `getPromotableApps().apps[i].googlePlayUrl` (normalised from Meta's `object_store_urls.google_play` / `.android`). |

#### Out-of-scope ad-level features

Visible in the Ads Manager screenshots, intentionally deferred to later phases:
- **Instant Experience** — full-screen mobile takeover after click. Different creative format; deferred to Phase 3 (creative parity).
- **Playable source** — interactive demo creative. Same phase.
- **Advantage+ catalogue ads** for app installs — requires catalogue binding; deferred to Phase 2c (Sales/Catalogue) of the original parity plan.
- **Multi-advertiser ads** — co-promotion with related apps. Niche feature; deferred until customer demand surfaces.
- **Custom product page ID** — accepted as `customProductPage` optional field but no validation against App Store Connect; iOS-only; advanced advertisers configure this themselves.
- **A/B test** — campaign-level split test. Phase 7.
- **Languages** (auto-translate) — Phase 3.

---

## Shape keys glossary

These are the keys the schema uses to point at Meta payload builders (`utils/promotedObject.js`, `utils/objectStorySpec.js` — both Phase 1 deliverables).

### `promoted_object` shapes

| Key | Builder output | Used by |
|---|---|---|
| `null` | (field omitted) | All Traffic + Leads cells in this round. |
| `app` | `{ application_id, object_store_url }` | App Promotion cells (Phase 2). |

### `object_story_spec` shapes

| Key | Builder output (sketch) | Used by |
|---|---|---|
| `link_data` | `{ page_id, instagram_user_id?, link_data: { image_hash, link, message, name, description, call_to_action, url_tags? } }` | Traffic/Website. |
| `messenger_click_to_message` | `{ page_id, instagram_user_id?, template_data: { ... messenger destination ... } }` (exact shape to be confirmed against Meta's [click-to-Messenger doc](https://developers.facebook.com/docs/marketing-api/reference/ad-creative#click-to-messenger)) | Traffic/Messenger, Leads/Messenger. |
| `whatsapp_click_to_message` | `{ page_id, instagram_user_id?, template_data: { ... whatsapp destination ... } }` | Traffic/WhatsApp. |
| `click_to_call` | `{ page_id, instagram_user_id?, link_data: { ... phone-number-as-link ... call_to_action.type=CALL_NOW } }` | Traffic/Calls, Leads/Calls. |
| `lead_gen_form` | `{ page_id, instagram_user_id?, link_data: { lead_gen_form_id, image_hash, message, name, description, call_to_action } }` | Leads/Instant Form. |
| `app_link` (Phase 2) | `{ page_id, link_data: { app_link, deep_link?, image_hash, message, name, call_to_action } }` | App Promotion. |

The exact Meta API shapes for `messenger_click_to_message`, `whatsapp_click_to_message`, and `click_to_call` are confirmed against the Meta Marketing API reference at Phase 1 implementation time — the schema only commits to the *key*, not the exact builder output. If Meta changes the shape, the builder is the only file to update.

---

## Identity requirement glossary

| Token | Meaning | Checked how |
|---|---|---|
| `page` | A Facebook Page is selected. | Frontend: `pageId` populated. Backend: page accessible via the user's FB token. |
| `instagram` | An Instagram Business account is selected. | Optional everywhere — Meta falls back to a shadow IG account derived from the Page. |
| `messengerEnabled` | The Page has Messenger turned on. | Page edge `messaging` returns enabled. Wizard surfaces a hard error if not. |
| `whatsappBusinessConnected` | The Page has a connected WhatsApp Business account. | Page edge `whatsapp_business_account` returns a WABA id. |
| `pagePhoneNumber` | The Page has a phone number on file. | Page edge `phone` returns non-empty. |

These checks happen in the **Conversion Location** step (added in Phase 1). If the selected Page fails the check for the picked location, the wizard surfaces a step-level error and disables Next until either the Page or location changes.

---

## What's intentionally not in this matrix

These are Meta features the V2 MVP does not surface. They're tracked in [`CAMPAIGN_CREATION_PARITY_PLAN.md`](./CAMPAIGN_CREATION_PARITY_PLAN.md):

- Video, carousel, collection, dynamic creative (Phase 3).
- Detailed targeting search, custom audiences, lookalikes (Phase 4).
- Pixel + Conversions API + attribution windows (Phase 5; required to enable Website Conversion Leads + Sales).
- Edit / duplicate / bulk (Phase 6).
- A/B test, day-parting, frequency caps (Phase 7).
- Catalog sales, advantage+ shopping campaigns.

These remain in V1 (or unreachable) until the relevant phase lands.
