# V2 Campaign Wizard — Browser Testing Guide

Hand this file to a browser-using Claude agent (or do it manually). The goal is to verify all 17 cells launch end-to-end against a real Meta ad account, without API errors.

---

## ⚠️ MANDATORY: test only on `claudetestads01`

**All testing MUST be done on the ad account named `claudetestads01`.** This is the sandbox account provisioned for V2 wizard testing — it has the Pages, Pixels, app linkages, WhatsApp, Lead Ads Terms, etc. already set up so every cell can launch end-to-end.

**Do not run tests on any other ad account.** Other accounts may not have the required infrastructure, will produce false-negative failures, and (worse) will create real PAUSED campaigns that need manual cleanup.

How to select it:
1. Open the **Meta Ads Manager** page in AdsGPT (`/meta-ads`).
2. In the top-right account picker, select **`claudetestads01`** before clicking **Create Campaign**.
3. Verify the wizard header shows `Posting to claudetestads01` in the gradient pill before proceeding.

If `claudetestads01` is not visible in the account picker, stop and report — the testing user's Meta account doesn't have access to it; testing cannot proceed.

---

## 0. Setup (must be true before you start)

| Check | How to verify |
|---|---|
| `VITE_FEATURE_WIZARD_V2=true` in frontend env | The Create-Campaign modal header shows the **V2** pill next to "New Campaign" |
| Logged into AdsGPT | User is on the Meta Ads dashboard at `/meta-ads` |
| Facebook account connected | "Posting to ‹Account name›" appears in the wizard header |
| **Ad account `claudetestads01` selected** in the dashboard's top-right account picker | The dashboard's "Posting to" pill AND the wizard header both show `claudetestads01` |
| Ad account is **Business Manager-managed** | `claudetestads01` is BM-managed by design. Verified by infrastructure showing up in pickers (Pages, Apps, IG). |
| Ad account has at least one **Page** assigned | Required for every cell (Page picker on AdSet step) |
| Ad account has at least one **Pixel** with a Lead event configured | Required for Leads/Website, Leads/Website+Instant Forms, Leads/Website+Calls |
| **Mobile app** linked to ad account in Business Settings → Apps | Required for Traffic/App, Leads/App, App Promotion |
| **Page phone number** set in Page Settings | Required for Traffic/Calls, Traffic/Website+Calls, Leads/Calls |
| **Lead Ads Terms** accepted on the Page (Meta Business Suite → Lead Ads Settings) | Required for all Leads cells that use Instant Forms |
| **WhatsApp Business account** linked to Page | Required for Leads/WhatsApp |
| **Instagram Business account** linked to Page | Required for Leads/Instagram (and recommended for every other cell) |

If any of the **infrastructure** rows are missing for a given cell, that cell is expected to launch successfully only after the user fixes the underlying Meta config. Capture the Meta error and report — don't mark it as a wizard bug.

---

## 1. The 17 cells you're testing

| # | Objective | Conversion location | Extra infrastructure needed beyond Page |
|---|---|---|---|
| 1 | Traffic | Website | — |
| 2 | Traffic | App | Mobile app linked to ad account |
| 3 | Traffic | Message destinations | Messenger enabled on Page |
| 4 | Traffic | Instagram or Facebook | IG Business account on Page |
| 5 | Traffic | Calls | Page phone number |
| 6 | Traffic | Website and calls | Page phone number |
| 7 | Leads | Website and instant forms (Multiple) | Pixel + Lead event + Lead Ads Terms |
| 8 | Leads | Website and calls (Multiple) | Pixel + Page phone |
| 9 | Leads | Instant forms and Messenger (Multiple) | Lead Ads Terms + Messenger |
| 10 | Leads | Website (Single) | Pixel + Lead event |
| 11 | Leads | Instant forms (Single) | Lead Ads Terms |
| 12 | Leads | Messenger (Single) | Messenger enabled |
| 13 | Leads | Instagram (Single) | IG Business account |
| 14 | Leads | WhatsApp (Single) | WhatsApp Business linked to Page |
| 15 | Leads | Calls (Single) | Page phone number |
| 16 | Leads | App (Single) | Mobile app linked to ad account |
| 17 | App Promotion | App | Mobile app linked to ad account |

---

## 2. Sample test data (reuse across cells)

| Field | Value |
|---|---|
| Campaign name | `Test — {cellName} — {timestamp}` |
| Ad set name | `Test ad set — {cellName}` |
| Daily budget | `100` (INR major units; wizard converts to paise) |
| Audience countries | `India` (already pre-filled) |
| Age range | `18` to `65` (pre-filled) |
| Headline | `Try our product today` |
| Primary text | `We're a fast-growing brand helping users do X. Click below to learn more.` |
| Description | `Limited-time offer` |
| Destination URL (when required) | `https://example.com/landing` (use a real URL the ad account is allowed to advertise) |
| CTA | Leave on the cell default |
| Image | Upload any 1080×1080 JPG, OR paste a public image URL, OR pick from Library |
| Status at launch | PAUSED (already pre-selected — do not change) |

For Lead Form cells:
| Form field | Value |
|---|---|
| Form name | `Test form — {cellName}` |
| Privacy policy URL | a real URL on the same domain as the destination URL |
| Questions | EMAIL + PHONE (defaults) |

For App cells:
| Field | Value |
|---|---|
| Mobile app store | Pick the one matching an actually-linked app |
| App | Pick from the dropdown (must show real mobile apps, not Instant Games) |

---

## 3. Per-cell test procedure

For **each** of the 17 cells:

### Steps
1. From the Meta Ads dashboard, click **Create Campaign**.
2. Verify the modal opens with header showing **V2** pill, "Posting to ‹account›" chip, and a circular X in the top-right corner.
3. **Step 1 — Objective**: Click the objective card for this cell.
4. **Step 2 — Destination**: Click the conversion-location card. Cards are grouped as **Multiple** (top) and **Single** (bottom) for Leads.
5. **Step 3 — Campaign**: Fill `Campaign name`. Leave CBO off. Leave Special Ad Categories empty. Click **Continue**.
6. **Step 4 — Ad Set**:
   - Fill `Ad set name`.
   - Select a **Facebook Page**. Verify the "Instagram identity" field below auto-fills with `@<igusername> · <igname>` (or shows "No IG linked" if the page has no IG).
   - Verify the **Advertiser (DSA beneficiary)** field auto-fills with the Page name. Leave it.
   - **For App cells (Traffic/App, Leads/App, AppPromo/App)**: pick a Mobile app store, then pick an app from the dropdown. Verify only apps with the chosen store's URL appear.
   - **For Pixel-using cells (Leads/Website, Leads/Website+Instant Forms, Leads/Website+Calls)**: pick a Pixel, then pick an event. If no Pixel exists, switch to "Create new" and create one named `Test pixel`.
   - Verify **Performance goal** dropdown shows the labels listed in section 4 below for this cell.
   - Fill **Daily budget** = 100.
   - Leave Bid strategy on default.
   - Skip Start/End (optional).
   - Audience: leave on Build new + India + 18–65.
   - Optimisation, Placements: leave defaults.
   - Click **Continue**.
7. **Step 5 — Lead Form** (only for cells with `additionalSteps: ["leadForm"]` — INSTANT_FORM, WEBSITE_AND_INSTANT_FORMS, INSTANT_FORMS_AND_MESSENGER):
   - Tab should default to "Use existing form".
   - If a form exists on the Page, pick it.
   - If none exists, switch to **Build new form**, fill Form name + Privacy URL + leave Questions on defaults, click **Create form**.
   - Verify a "✓ Lead Form id … will be attached" line appears.
   - Click **Continue**.
8. **Step 6 — Ad**:
   - Fill `Ad name`.
   - Upload an image OR paste an image URL OR pick from Library. Verify the preview thumbnail appears.
   - Fill `Headline`, `Primary text`, `Description`.
   - **For cells that require linkUrl** (every cell except App Promotion): fill `Destination URL`.
   - Verify **Call to action** dropdown shows the right options for this cell (section 4).
   - **For Leads/App, Traffic/App, App Promotion**: confirm `linkUrl` is **not** required (App cells use objectStoreUrl from AdSet step).
   - Click **Continue**.
9. **Step 7 — Review**:
   - Verify the gradient-bordered "Posting to ‹account›" banner with Meta logo appears.
   - Verify each Section card (Objective, Campaign, Ad Set, Ad) shows the values entered.
   - Click **Launch (PAUSED)**.
10. **Verify launch success**:
    - Wizard closes.
    - Toast shows "Campaign launched (PAUSED). Activate it from the Campaigns tab."
    - Tab switches to **Campaigns**; the new campaign appears in the list.

### Pass criteria
- Every step transitions without a red error banner.
- Step 10 completes with the success toast.
- The campaign appears in the Campaigns tab with status PAUSED.

### Failure capture
If any step fails, capture:
1. **Screenshot** of the wizard with the error banner visible.
2. **Cell identifier**: "Objective: ‹Objective› → Destination: ‹Cell›"
3. **Step that failed**: one of Campaign / Ad Set / Lead Form / Ad / Review-Launch.
4. **Error banner text** — copy the full title + details.
5. **`fbtrace` id** — the mono-font code on the error banner.
6. **Backend log line** if accessible (look for `error: create campaign`, `error: create ad set error`, `error: create ad error` lines on the Node console).

Move on to the next cell after capturing — failures in one cell don't block testing the others.

---

## 4. Expected performance-goal labels per cell

This is the spec the wizard should match. If the dropdown shows different options, that's a bug.

### Traffic
| Cell | Performance-goal options (label shown in dropdown) |
|---|---|
| Website | Maximise number of link clicks · Maximise number of landing page views · Maximise number of impressions · Maximise daily unique reach |
| App | Maximise number of link clicks · Maximise number of impressions · Maximise daily unique reach |
| Message destinations | Maximise number of conversations · Maximise number of impressions · Maximise daily unique reach |
| Instagram or Facebook | Maximise number of link clicks · Maximise number of impressions · Maximise daily unique reach |
| Calls | Maximise number of calls · Maximise number of link clicks |
| Website and calls | Maximise number of link clicks · Maximise number of calls · Maximise number of landing page views |

### Leads
| Cell | Performance-goal options |
|---|---|
| Website and instant forms (Multiple) | Maximise number of conversions (only) |
| Website and calls (Multiple) | Maximise number of conversions (only) |
| Instant forms and Messenger (Multiple) | Maximise number of leads (only) |
| Website (Single) | Maximise number of conversions · landing page views · link clicks · daily unique reach · impressions |
| Instant forms (Single) | Maximise number of leads · Maximise number of conversion leads |
| Messenger (Single) | Maximise number of leads (only) |
| Instagram (Single) | Maximise number of leads (only) |
| WhatsApp (Single) | Maximise number of conversations (only) |
| Calls (Single) | Maximise number of calls (only) |
| App (Single) | **Maximise number of app events** · link clicks · daily unique reach |

### App Promotion
| Cell | Performance-goal options |
|---|---|
| App | Maximise number of app installs (only) |

---

## 5. Expected CTA list per cell

If the CTA dropdown shows options outside this list, flag it.

| Cell | Allowed CTAs |
|---|---|
| Traffic/Website | LEARN_MORE, SHOP_NOW, SIGN_UP, SUBSCRIBE, CONTACT_US, DOWNLOAD, BOOK_TRAVEL, GET_QUOTE, APPLY_NOW, GET_OFFER, ORDER_NOW, WATCH_MORE, NO_BUTTON |
| Traffic/App | INSTALL_MOBILE_APP, USE_APP, DOWNLOAD, LEARN_MORE, SHOP_NOW |
| Traffic/Message destinations | MESSAGE_PAGE, WHATSAPP_MESSAGE, INSTAGRAM_MESSAGE, LEARN_MORE |
| Traffic/Instagram or Facebook | VIEW_INSTAGRAM_PROFILE, LIKE_PAGE, LEARN_MORE |
| Traffic/Calls | CALL_NOW, LEARN_MORE |
| Traffic/Website and calls | LEARN_MORE, CALL_NOW, GET_QUOTE, CONTACT_US |
| Leads/Website and instant forms | SIGN_UP, APPLY_NOW, GET_QUOTE, LEARN_MORE, SUBSCRIBE, GET_OFFER |
| Leads/Website and calls | CALL_NOW, LEARN_MORE, GET_QUOTE |
| Leads/Instant forms and Messenger | SIGN_UP, APPLY_NOW, GET_QUOTE, LEARN_MORE, SUBSCRIBE (**no MESSAGE_PAGE** — was removed) |
| Leads/Website | SIGN_UP, APPLY_NOW, GET_QUOTE, LEARN_MORE, SUBSCRIBE, GET_OFFER, CONTACT_US |
| Leads/Instant forms | SIGN_UP, APPLY_NOW, GET_QUOTE, LEARN_MORE, SUBSCRIBE, GET_OFFER |
| Leads/Messenger | MESSAGE_PAGE, SIGN_UP, APPLY_NOW, LEARN_MORE |
| Leads/Instagram | INSTAGRAM_MESSAGE, VIEW_INSTAGRAM_PROFILE, LEARN_MORE |
| Leads/WhatsApp | WHATSAPP_MESSAGE, LEARN_MORE |
| Leads/Calls | CALL_NOW, LEARN_MORE |
| Leads/App | SIGN_UP, APPLY_NOW, DOWNLOAD, INSTALL_MOBILE_APP, LEARN_MORE |
| App Promotion/App | INSTALL_MOBILE_APP, USE_APP, DOWNLOAD, LEARN_MORE, SHOP_NOW, BOOK_TRAVEL |

---

## 6. UI polish checks (do these once, not per cell)

While testing any cell, verify all of these once:

- [ ] Modal close button (X) is in the top-right **corner** of the modal (not nested inside the step rail).
- [ ] Clicking the X on a wizard with typed-in data prompts a **discard confirmation** overlay ("Discard this campaign?"). "Keep editing" returns to the wizard; "Discard" closes it.
- [ ] Performance-goal dropdown is a **custom dark dropdown** with ✓ on the selected row, rotating chevron, and dark glass panel — NOT the native OS dropdown.
- [ ] Toggle switches use a **brand gradient** (cyan → purple) when ON.
- [ ] Budget type ("Daily / Lifetime") is a **segmented control** with a gradient ring on the active segment, not a dropdown.
- [ ] Start / End date pickers are a **custom dark calendar** + scroll-column time picker — NOT the native browser `datetime-local` widget.
- [ ] On the Audience section, "Build new / Saved audience" is a segmented control. Both segments are equal height; "Saved audience" does not wrap to two lines and the active segment is not distorted.
- [ ] On the Ad step, "Upload / URL" and "From library" is a segmented control. When "From library" is active, the inline LibraryPicker appears; when "Upload / URL" is active, there's a single "Upload image" white pill (no duplicate "Pick from Library" button).
- [ ] On the Review step, the "Posting to" banner has a gradient border and shows the Meta logo + ad account name + currency.
- [ ] Error banners (if any) are dismissible (X) and show an "Open Meta help ↗" chip + a mono `fbtrace …` id.
- [ ] Step rail at the top of the modal: active step has gradient pill, completed steps have green check, pending steps are dimmed.

---

## 7. Final report

After testing all 17 cells, produce a one-page summary:

```
V2 Wizard test run — {date}
Ad account: claudetestads01 (must match — abort report if it doesn't)
Tester: {browser-claude or human name}

PASS  ✅ Traffic / Website
PASS  ✅ Traffic / App
FAIL  ❌ Traffic / Message destinations — Step 6 Ad: "Image is invalid" {fbtrace}
…

UI polish: 11/11 ✅
Bug reports filed: 1 (see #section above)
Overall: 16/17 cells PASS, 1 FAIL needs investigation
```

If a cell fails because of **Meta-side infrastructure** (Page hasn't accepted Lead Ads Terms, Pixel has no Lead event, app not linked, etc.) — mark it as `BLOCKED (infra)` and note what needs fixing, not `FAIL`. Only cells that fail despite correct infrastructure are real wizard bugs.

---

## 8. Known limitations (don't report as bugs)

- Lead form metadata (description / questions) cannot be edited after creation — Meta API limitation.
- Pixel events only show "standard" Meta events + recently-fired events. Custom-named events from your Events Manager won't appear in the dropdown.
- Attribution window defaults to "Meta default" for Leads cells — explicit override is intentionally disabled because Meta only accepts (1, 0) for LEAD_GENERATION goals.
- iOS 14+ checkbox on App Promotion is **deferred** — Meta requires a separate campaign type (SKAdNetwork). Campaigns currently deliver to Android + pre-14.5 iOS only.
- Dashboard does not yet display captured lead submissions — users still need to download CSVs from Meta Events Manager. Tracked separately.
