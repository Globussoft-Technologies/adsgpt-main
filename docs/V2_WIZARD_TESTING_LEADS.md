# V2 Campaign Wizard — Testing Guide: **Leads objective**

Hand this file to a browser-using Claude agent (or do it manually). The goal is to verify all **10 Leads cells** launch end-to-end against a real Meta ad account, without API errors.

> Companion docs (other objectives — out of scope here):
> - `docs/V2_WIZARD_TESTING_TRAFFIC.md`
> - `docs/V2_WIZARD_TESTING_APP_PROMOTION.md`

---

## ⚠️ MANDATORY: test only on `claudetestads01`

**All testing MUST be done on the ad account named `claudetestads01`.** This is the sandbox account provisioned for V2 wizard testing — it has Pages, Pixels, app linkages, WhatsApp Business, Lead Ads Terms, etc. already set up so every Leads cell can launch end-to-end.

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
| **Ad account `claudetestads01` selected** | Dashboard "Posting to" pill AND wizard header both show `claudetestads01` |
| At least one **Page** assigned to the ad account | Page picker on Ad Set step populates |
| **Lead Ads Terms accepted** on the Page (Meta Business Suite → Lead Ads Settings) | Required for all cells that use Instant Forms |
| **At least one Pixel** on the ad account with a **Lead** event configured | Required for Website, Website-and-Instant-Forms, Website-and-Calls cells |
| **Page phone number** set in Page Settings | Required for Calls + Website-and-Calls cells |
| **Messenger** enabled on the Page | Required for Messenger + Instant-Forms-and-Messenger cells |
| **WhatsApp Business** linked to the Page | Required for WhatsApp cell |
| **Instagram Business account** linked to the Page | Required for Instagram cell |
| **Mobile app** linked to the ad account | Required for App cell |

If an infrastructure row is missing for a given cell, the launch will fail at Meta — capture the error and mark the cell as `BLOCKED (infra)` rather than a wizard bug.

---

## 1. The 10 cells you're testing

| # | Cell | Group | Extra infrastructure beyond Page |
|---|---|---|---|
| 1 | Website and instant forms | Multiple | Pixel + Lead event + Lead Ads Terms |
| 2 | Website and calls | Multiple | Pixel + Page phone |
| 3 | Instant forms and Messenger | Multiple | Lead Ads Terms + Messenger |
| 4 | Website | Single | Pixel + Lead event |
| 5 | Instant forms | Single | Lead Ads Terms |
| 6 | Messenger | Single | Messenger enabled |
| 7 | Instagram | Single | IG Business account |
| 8 | WhatsApp | Single | WhatsApp Business linked to Page |
| 9 | Calls | Single | Page phone number |
| 10 | App | Single | Mobile app linked to ad account |

---

## 2. Sample test data (reuse across cells)

| Field | Value |
|---|---|
| Campaign name | `V2 test — Leads-{cellName} — {timestamp}` |
| Ad set name | `V2 test ad set — Leads-{cellName}` |
| Daily budget | `100` (INR major units; wizard converts to paise) |
| Audience countries | `India` (already pre-filled) |
| Age range | `18` to `65` (pre-filled) |
| Headline | `Get a free quote in 60 seconds` |
| Primary text | `Tell us a bit about you and we'll get in touch with options tailored to you.` |
| Description | `No spam · Reply within 24h` |
| Destination URL (every Leads cell **including App**) | `https://example.com/landing` — Meta requires an external URL on every Leads creative. App-link creatives also need this as a fallback. |
| CTA | Leave on the cell default |
| Media type | Test both: **Image** (default) and **Video** (toggle the SegGroup at the top of the Ad step's Media field) |
| Image | Upload any 1080×1080 JPG, OR paste a public image URL, OR pick from Library |
| Video | Upload any MP4 ≤100 MB, OR pick from Library. Thumbnail (poster image) auto-fills from Meta after upload — you can override on the Thumbnail URL field if you want a specific frame. |
| Status at launch | PAUSED (pre-selected — do not change) |

For Lead-Form cells (Instant forms, Website-and-Instant-Forms, Instant-Forms-and-Messenger):
| Form field | Value |
|---|---|
| Form name | `V2 test form — Leads-{cellName}` |
| Privacy policy URL | `https://example.com/privacy` (must be a real URL the Page is allowed to advertise) |
| Questions | EMAIL + PHONE (defaults) |

For Pixel-using cells (Website, Website-and-Instant-Forms, Website-and-Calls):
| Field | Value |
|---|---|
| Pixel | Pick the test Pixel (or "Create new" and create `V2 test pixel`) |
| Event | Lead (or another Lead-mapped event) |

For App cell:
| Field | Value |
|---|---|
| Mobile app store | Pick the one matching an actually-linked app |
| App | Pick from the dropdown (must show real mobile apps, not Instant Games) |

---

## 3. Per-cell test procedure

For **each** of the 10 cells:

### Steps
1. From the Meta Ads dashboard, click **Create Campaign**.
2. Verify the modal opens with header showing **V2** pill, "Posting to claudetestads01" chip, and a circular X in the top-right corner.
3. **Step 1 — Objective**: Click the **Leads** card.
4. **Step 2 — Destination**: Verify cards are grouped into **Multiple** (top) and **Single** (bottom) sections with separator. Click the card for this cell.
5. **Step 3 — Campaign**: Fill `Campaign name`. Leave CBO off. Leave Special Ad Categories empty. Click **Continue**.
6. **Step 4 — Ad Set**:
   - Fill `Ad set name`.
   - Select a **Facebook Page**. Verify the "Instagram identity" field auto-fills with `@<igusername> · <igname>` (or shows "No IG linked").
   - Verify the **Advertiser (DSA beneficiary)** field auto-fills with the Page name. Leave it.
   - **For App cell only**: pick a Mobile app store, then pick an app. Verify only apps with the chosen store's URL appear (no Instant Games).
   - **For Pixel-using cells (Website, Website-and-Instant-Forms, Website-and-Calls)**: pick a Pixel, then pick an event. If no Pixel exists, switch the segmented toggle to **Create new** and create one named `V2 test pixel`. Verify a "Pixel created" emerald banner appears with a link to install the JS snippet.
   - Verify **Performance goal** dropdown shows the labels listed in section 4 below for this cell.
   - Fill **Daily budget** = 100.
   - Leave Bid strategy on default.
   - Skip Start/End (optional).
   - Audience: leave on Build new + India + 18–65.
   - Optimisation, Placements: leave defaults.
   - Click **Continue**.
7. **Step 5 — Lead Form** (ONLY for cells with `additionalSteps: ["leadForm"]` — Instant forms, Website-and-Instant-Forms, Instant-Forms-and-Messenger):
   - Tab should default to "Use existing form".
   - If a form exists on the Page, pick it.
   - If no forms exist, switch to **Build new form**. Fill `Form name` + `Privacy policy URL` + leave Questions on defaults. Click **Create form**.
   - Verify a "✓ Lead Form id … will be attached" emerald line appears below.
   - Click **Continue**.
   - **Skip this step entirely** for Website, Messenger, Instagram, WhatsApp, Calls, App, Website-and-Calls — they don't use a Lead Form.
8. **Step 6 — Ad**:
   - Fill `Ad name`.
   - Upload an image OR paste an image URL OR pick from Library. Verify the preview thumbnail appears.
   - Fill `Headline`, `Primary text`, `Description`.
   - Fill `Destination URL`. **Required for every Leads cell** (Meta rejects Leads creatives without an external URL, even for App / Messenger / WhatsApp / Instagram destinations — the URL is the bypass-fallback).
   - Verify **Call to action** dropdown shows the right options for this cell (section 5).
   - Click **Continue**.
9. **Step 7 — Review**:
   - Verify the gradient-bordered "Posting to claudetestads01" banner with Meta logo appears.
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
2. **Cell identifier**: `Leads / {Website and instant forms|Website and calls|Instant forms and Messenger|Website|Instant forms|Messenger|Instagram|WhatsApp|Calls|App}`
3. **Step that failed**: one of Campaign / Ad Set / Lead Form / Ad / Review-Launch.
4. **Error banner text** — copy the full title + details.
5. **`fbtrace` id** — the mono-font code on the error banner.
6. **Backend log line** if accessible (Node console: `error: create campaign`, `error: create ad set error`, `error: create ad error`, `error: create lead form error`).

Move on to the next cell after capturing — failures in one cell don't block testing the others.

---

## 4. Expected performance-goal labels per cell

If the dropdown shows different options, that's a bug.

| Cell | Performance-goal options (label in dropdown) |
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

Note: Leads/App relabels `OFFSITE_CONVERSIONS` as "Maximise number of app events" (Meta's wording for in-app destinations).

---

## 5. Expected CTA list per cell

If the CTA dropdown shows options outside this list, flag it. Note: the dropdown shows Meta's friendly labels ("Learn more", "Send message", "Call now"); the table below lists the underlying enum values — match by meaning, not exact string.

| Cell | Allowed CTAs |
|---|---|
| Website and instant forms | SIGN_UP, APPLY_NOW, GET_QUOTE, LEARN_MORE, SUBSCRIBE, GET_OFFER |
| Website and calls | NO_BUTTON, APPLY_NOW, BOOK_NOW, CONTACT_US, DOWNLOAD, GET_OFFER, GET_QUOTE, GET_SHOWTIMES, GET_DETAILS, LEARN_MORE, LISTEN_NOW, ORDER_NOW, PLAY_GAME, REQUEST_TIME, VIEW_MENU, SHOP_NOW, SIGN_UP, SUBSCRIBE, WATCH_MORE (no CALL_NOW — Meta routes calls via the optimiser, not a CTA) |
| Instant forms and Messenger | GET_DETAILS, LEARN_MORE, SUBSCRIBE, BOOK_NOW, SIGN_UP, APPLY_NOW, DOWNLOAD, GET_OFFER, GET_QUOTE (**no MESSAGE_PAGE** — Meta routes Form ⇄ Messenger itself) |
| Website | GET_DETAILS, LEARN_MORE, SUBSCRIBE, BOOK_NOW, SIGN_UP, APPLY_NOW, DOWNLOAD, GET_OFFER, GET_QUOTE |
| Instant forms | SIGN_UP, APPLY_NOW, GET_QUOTE, LEARN_MORE, SUBSCRIBE, GET_OFFER |
| Messenger | CONTACT_US, GET_QUOTE, INQUIRE_NOW, GET_DETAILS, LEARN_MORE, MESSAGE_PAGE, ORDER_NOW, SEND_UPDATES, SHOP_NOW, SIGN_UP, SUBSCRIBE, GET_PROMOTIONS, APPLY_NOW, BOOK_NOW |
| Instagram | GET_OFFER, GET_QUOTE, INSTAGRAM_MESSAGE, GET_DETAILS, LEARN_MORE, SIGN_UP, SUBSCRIBE, APPLY_NOW, BOOK_NOW |
| WhatsApp | WHATSAPP_MESSAGE (only — Meta's dropdown is disabled) |
| Calls | CALL_NOW, LEARN_MORE |
| App | USE_MOBILE_APP, NO_BUTTON, CONTACT_US, GET_OFFER, GET_QUOTE, GET_DETAILS, LEARN_MORE, ORDER_NOW, DOWNLOAD, SHOP_NOW, GET_SHOWTIMES, SIGN_UP, LISTEN_NOW, PLAY_GAME, SUBSCRIBE, REQUEST_TIME, VIEW_MENU, WATCH_MORE, APPLY_NOW, BOOK_NOW (no INSTALL_MOBILE_APP — this cell captures leads via an existing app, not installs) |

---

## 6. UI polish checks (do these once, not per cell)

While testing any cell, verify all of these once:

- [ ] Modal close button (X) is in the top-right **corner** of the modal (not nested inside the step rail).
- [ ] Clicking the X on a wizard with typed-in data prompts a **discard confirmation** overlay ("Discard this campaign?"). "Keep editing" returns to the wizard; "Discard" closes it.
- [ ] Performance-goal dropdown is a **custom dark dropdown** with ✓ on the selected row, rotating chevron, and dark glass panel — NOT the native OS dropdown.
- [ ] Toggle switches use a **brand gradient** (cyan → purple) when ON.
- [ ] Budget type ("Daily / Lifetime") is a **segmented control** with a gradient ring on the active segment, not a dropdown.
- [ ] Start / End date pickers are a **custom dark calendar** + scroll-column time picker — NOT the native browser `datetime-local` widget.
- [ ] On the Audience section, "Build new / Saved audience" is a segmented control. Both segments are equal height; "Saved audience" does not wrap to two lines.
- [ ] Pixel section uses a segmented "Pick existing / Create new" control. After creating, the new pixel auto-selects and a green install-snippet banner appears.
- [ ] Lead Form step uses a segmented "Use existing form / Build new form" control.
- [ ] On the Ad step, "Upload / URL" and "From library" is a segmented control. When "From library" is active, the inline LibraryPicker appears; when "Upload / URL" is active, there's a single "Upload image" white pill (no duplicate "Pick from Library" button).
- [ ] On the Review step, the "Posting to" banner has a gradient border and shows the Meta logo + ad account name + currency.
- [ ] Error banners (if any) are dismissible (X) and show an "Open Meta help ↗" chip + a mono `fbtrace …` id.

---

## 7. Final report

After testing all 10 Leads cells, produce:

```
V2 Wizard test run — Leads objective — {date}
Ad account: claudetestads01 (must match — abort report if it doesn't)
Tester: {browser-claude or human name}

PASS  ✅ Leads / Website and instant forms
PASS  ✅ Leads / Website
…

UI polish: 12/12 ✅
Bug reports filed: 0
Overall: 10/10 cells PASS
```

If a cell fails because of **Meta-side infrastructure** (Page hasn't accepted Lead Ads Terms, Pixel has no Lead event, no WhatsApp Business, etc.) — mark it as `BLOCKED (infra)` and note what needs fixing, not `FAIL`. Only cells that fail despite correct infrastructure are real wizard bugs.

---

## 8. Known limitations (don't report as bugs)

- **`linkUrl` is required on every Leads cell**, even for Instant-Forms / Messenger / WhatsApp / Instagram / App destinations. Meta rejects Leads creatives without an external URL — the URL acts as a bypass-fallback for non-eligible viewers.
- **Attribution window** is hardcoded to "Meta default" for Leads cells. Explicit override is disabled because Meta only accepts (1-day click, 0-day view) for `LEAD_GENERATION` goals and rejects every other combination with subcode 1885501.
- **Pixel events dropdown** shows standard Meta events + recently-fired events from your Events Manager. Custom-named events from your account won't appear until they've fired at least once.
- **Form fields cannot be edited after creation** — Meta API limitation. To change a form, create a new one.
- **`MESSAGE_PAGE` is not in the CTA list for Instant-Forms-and-Messenger** by design. The `lead_gen_form` creative shape doesn't bind a messenger app_destination, so the CTA would route to the form anyway. Meta's per-viewer routing via `destination_type=ON_AD` handles Messenger routing independently.
- **Dashboard does not yet display captured lead submissions** — users still need to download CSVs from Meta Events Manager. Tracked separately for the post-cutover roadmap.
