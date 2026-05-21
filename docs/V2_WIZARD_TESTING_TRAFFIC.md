# V2 Campaign Wizard — Testing Guide: **Traffic objective**

Hand this file to a browser-using Claude agent (or do it manually). The goal is to verify all **6 Traffic cells** launch end-to-end against a real Meta ad account, without API errors.

> Companion docs (other objectives — out of scope here):
> - `docs/V2_WIZARD_TESTING_LEADS.md`
> - `docs/V2_WIZARD_TESTING_APP_PROMOTION.md`

---

## ⚠️ MANDATORY: test only on `claudetestads01`

**All testing MUST be done on the ad account named `claudetestads01`.** This is the sandbox account provisioned for V2 wizard testing — it has the Pages, Apps, IG, phone number, etc. already set up so every Traffic cell can launch end-to-end.

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
| **Ad account `claudetestads01` selected** | The dashboard's "Posting to" pill AND the wizard header both show `claudetestads01` |
| At least one **Page** assigned to the ad account | Page picker on Ad Set step populates (required for every cell) |
| **Mobile app** linked to the ad account in Business Settings → Apps | Required for Traffic/App only |
| **Page phone number** set in Page Settings | Required for Traffic/Calls + Traffic/Website-and-Calls |
| **Messenger** enabled on the Page | Required for Traffic/Message destinations |
| **Instagram Business account** linked to the Page | Required for Traffic/Instagram-or-Facebook |

If an infrastructure row is missing for a given cell, the launch will fail at Meta — capture the error and mark the cell as `BLOCKED (infra)` rather than a wizard bug.

---

## 1. The 6 cells you're testing

| # | Cell | Extra infrastructure beyond Page |
|---|---|---|
| 1 | Website | — |
| 2 | App | Mobile app linked to ad account |
| 3 | Message destinations | Messenger enabled on Page |
| 4 | Instagram or Facebook | IG Business account on Page |
| 5 | Calls | Page phone number |
| 6 | Website and calls | Page phone number |

---

## 2. Sample test data (reuse across cells)

| Field | Value |
|---|---|
| Campaign name | `V2 test — Traffic-{cellName} — {timestamp}` |
| Ad set name | `V2 test ad set — Traffic-{cellName}` |
| Daily budget | `100` (INR major units; wizard converts to paise) |
| Audience countries | `India` (already pre-filled) |
| Age range | `18` to `65` (pre-filled) |
| Headline | `Try our product today` |
| Primary text | `We're a fast-growing brand helping users do X. Click below to learn more.` |
| Description | `Limited-time offer` |
| Destination URL (for Website, IG-or-Facebook, Calls, Website-and-Calls) | `https://example.com/landing` (any real URL the ad account is allowed to advertise) |
| Destination URL (for Message destinations) | same — Meta requires a bypass URL even when routing to Messenger |
| CTA | Leave on the cell default |
| Media type | Test both: **Image** (default) and **Video** (toggle the SegGroup at the top of the Ad step's Media field) |
| Image | Upload any 1080×1080 JPG, OR paste a public image URL, OR pick from Library |
| Video | Upload any MP4 ≤100 MB, OR pick from Library. Thumbnail (poster image) auto-fills from Meta after upload — you can override on the Thumbnail URL field if you want a specific frame. |
| Status at launch | PAUSED (pre-selected — do not change) |

For Traffic/App:
| Field | Value |
|---|---|
| Mobile app store | Pick the one matching an actually-linked app |
| App | Pick from the dropdown (must show real mobile apps, not Instant Games) |

---

## 3. Per-cell test procedure

For **each** of the 6 cells:

### Steps
1. From the Meta Ads dashboard, click **Create Campaign**.
2. Verify the modal opens with header showing **V2** pill, "Posting to claudetestads01" chip, and a circular X in the top-right corner.
3. **Step 1 — Objective**: Click the **Traffic** card.
4. **Step 2 — Destination**: Click the card for this cell (Website / App / Message destinations / Instagram or Facebook / Calls / Website and calls).
5. **Step 3 — Campaign**: Fill `Campaign name`. Leave CBO off. Leave Special Ad Categories empty. Click **Continue**.
6. **Step 4 — Ad Set**:
   - Fill `Ad set name`.
   - Select a **Facebook Page**. Verify the "Instagram identity" field auto-fills with `@<igusername> · <igname>` (or shows "No IG linked").
   - Verify the **Advertiser (DSA beneficiary)** field auto-fills with the Page name. Leave it.
   - **For Traffic/App only**: pick a Mobile app store, then pick an app. Verify only apps with the chosen store's URL appear (no Instant Games).
   - Verify **Performance goal** dropdown shows the labels listed in section 4 below for this cell.
   - Fill **Daily budget** = 100.
   - Leave Bid strategy on default.
   - Skip Start/End (optional).
   - Audience: leave on Build new + India + 18–65.
   - Optimisation, Placements: leave defaults.
   - Click **Continue**.
7. **Step 5 — Ad** (Traffic has **no Lead Form step** — go straight from Ad Set to Ad):
   - Fill `Ad name`.
   - Upload an image OR paste an image URL OR pick from Library. Verify the preview thumbnail appears.
   - Fill `Headline`, `Primary text`, `Description`.
   - Fill `Destination URL`. (Required for every Traffic cell.)
   - Verify **Call to action** dropdown shows the right options for this cell (section 5).
   - **For Traffic/App only**: confirm `linkUrl` is **not** required (App cells use objectStoreUrl from Ad Set step).
   - Click **Continue**.
8. **Step 6 — Review**:
   - Verify the gradient-bordered "Posting to claudetestads01" banner with Meta logo appears.
   - Verify each Section card (Objective, Campaign, Ad Set, Ad) shows the values entered.
   - Click **Launch (PAUSED)**.
9. **Verify launch success**:
   - Wizard closes.
   - Toast shows "Campaign launched (PAUSED). Activate it from the Campaigns tab."
   - Tab switches to **Campaigns**; the new campaign appears in the list.

### Pass criteria
- Every step transitions without a red error banner.
- Step 9 completes with the success toast.
- The campaign appears in the Campaigns tab with status PAUSED.

### Failure capture
If any step fails, capture:
1. **Screenshot** of the wizard with the error banner visible.
2. **Cell identifier**: `Traffic / {Website|App|Message destinations|Instagram or Facebook|Calls|Website and calls}`
3. **Step that failed**: one of Campaign / Ad Set / Ad / Review-Launch.
4. **Error banner text** — copy the full title + details.
5. **`fbtrace` id** — the mono-font code on the error banner.
6. **Backend log line** if accessible (Node console: `error: create campaign`, `error: create ad set error`, `error: create ad error`).

Move on to the next cell after capturing — failures in one cell don't block testing the others.

---

## 4. Expected performance-goal labels per cell

If the dropdown shows different options, that's a bug.

| Cell | Performance-goal options (label in dropdown) |
|---|---|
| Website | Maximise number of link clicks · Maximise number of landing page views · Maximise number of impressions · Maximise daily unique reach |
| App | Maximise number of link clicks · Maximise number of impressions · Maximise daily unique reach |
| Message destinations | Maximise number of conversations · Maximise number of impressions · Maximise daily unique reach |
| Instagram or Facebook | Maximise number of link clicks · Maximise number of impressions · Maximise daily unique reach |
| Calls | Maximise number of calls · Maximise number of link clicks |
| Website and calls | Maximise number of link clicks · Maximise number of calls · Maximise number of landing page views |

---

## 5. Expected CTA list per cell

If the CTA dropdown shows options outside this list, flag it. Note: the dropdown shows Meta's friendly labels ("Learn more", "Install now", "Call now"); the table below lists the underlying enum values — match by meaning, not exact string.

| Cell | Allowed CTAs |
|---|---|
| Website | LEARN_MORE, SHOP_NOW, SIGN_UP, SUBSCRIBE, CONTACT_US, DOWNLOAD, BOOK_TRAVEL, GET_QUOTE, APPLY_NOW, GET_OFFER, ORDER_NOW, WATCH_MORE, NO_BUTTON |
| App | INSTALL_MOBILE_APP, USE_APP, DOWNLOAD, LEARN_MORE, SHOP_NOW |
| Message destinations | MESSAGE_PAGE, WHATSAPP_MESSAGE, INSTAGRAM_MESSAGE, LEARN_MORE |
| Instagram or Facebook | VIEW_INSTAGRAM_PROFILE, LIKE_PAGE, LEARN_MORE |
| Calls | CALL_NOW, LEARN_MORE |
| Website and calls | LEARN_MORE, CALL_NOW, GET_QUOTE, CONTACT_US |

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
- [ ] On the Ad step, "Upload / URL" and "From library" is a segmented control. When "From library" is active, the inline LibraryPicker appears; when "Upload / URL" is active, there's a single "Upload image" white pill (no duplicate "Pick from Library" button).
- [ ] On the Review step, the "Posting to" banner has a gradient border and shows the Meta logo + ad account name + currency.
- [ ] Error banners (if any) are dismissible (X) and show an "Open Meta help ↗" chip + a mono `fbtrace …` id.
- [ ] Step rail at the top of the modal: active step has gradient pill, completed steps have green check, pending steps are dimmed.

---

## 7. Final report

After testing all 6 Traffic cells, produce:

```
V2 Wizard test run — Traffic objective — {date}
Ad account: claudetestads01 (must match — abort report if it doesn't)
Tester: {browser-claude or human name}

PASS  ✅ Traffic / Website
PASS  ✅ Traffic / App
…

UI polish: 11/11 ✅
Bug reports filed: 0
Overall: 6/6 cells PASS
```

If a cell fails because of **Meta-side infrastructure** (Page hasn't accepted Lead Ads Terms, no app linked, no phone number, etc.) — mark it as `BLOCKED (infra)` and note what needs fixing, not `FAIL`. Only cells that fail despite correct infrastructure are real wizard bugs.

---

## 8. Known limitations (don't report as bugs)

- Message destinations always requires a bypass `linkUrl` even though the primary intent is messaging — Meta enforces this on every creative.
- Traffic/App optimisation against in-app events requires an MMP (AppsFlyer, Adjust); not supported in V2 by design. Only LINK_CLICKS / IMPRESSIONS / REACH goals are available.
- Instagram/Facebook profile-visit destinations use the Page link under the hood (Meta accepts `destination_type=WEBSITE` for profile CTAs).
