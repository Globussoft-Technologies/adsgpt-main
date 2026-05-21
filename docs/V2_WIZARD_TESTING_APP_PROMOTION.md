# V2 Campaign Wizard — Testing Guide: **App Promotion objective**

Hand this file to a browser-using Claude agent (or do it manually). The goal is to verify the **App Promotion cell** launches end-to-end against a real Meta ad account, without API errors.

> Companion docs (other objectives — out of scope here):
> - `docs/V2_WIZARD_TESTING_TRAFFIC.md`
> - `docs/V2_WIZARD_TESTING_LEADS.md`

---

## ⚠️ MANDATORY: test only on `claudetestads01`

**All testing MUST be done on the ad account named `claudetestads01`.** This is the sandbox account provisioned for V2 wizard testing — it has the Pages, mobile apps, etc. already set up so App Promotion can launch end-to-end.

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
| **Mobile app** linked to the ad account in Business Settings → Apps | App picker on Ad Set step shows real mobile apps with store URLs |
| App has at least one **store URL** set | Google Play and/or Apple App Store URL configured in the Meta app dashboard |

If the app picker is empty after selecting a store, the ad account has no apps assigned in Business Settings — mark as `BLOCKED (infra)` and stop.

---

## 1. The 1 cell you're testing

| # | Cell | Extra infrastructure beyond Page |
|---|---|---|
| 1 | App | Mobile app linked to ad account with at least one store URL |

App Promotion has a single conversion location ("App"). Both stores (Apple App Store and Google Play) flow through the same cell — the user picks the store on the Ad Set step. **Test both stores** if the ad account has apps on both, otherwise test whichever is available.

---

## 2. Sample test data

| Field | Value |
|---|---|
| Campaign name | `V2 test — AppPromo — {timestamp}` |
| Ad set name | `V2 test ad set — AppPromo-{store}` |
| iOS 14+ toggle on Campaign step | Test once with toggle **OFF** (Android app) AND once with toggle **ON** (Apple app, picked at campaign level). See section 8 for the iOS 14+ flow. |
| Mobile app store | First run: `Google Play`. Second run: `Apple App Store` (if app exists) |
| App | Pick from the dropdown — must show real mobile apps, no Instant Games |
| Daily budget | `100` (INR major units; wizard converts to paise) |
| Audience countries | `India` (pre-filled) |
| Age range | `18` to `65` (pre-filled) |
| Headline | `Get the app that does X` |
| Primary text | `Join millions of users using our app every day. Install now to get started.` |
| Description | `Free · No ads in core features` |
| Destination URL | **Not required** — App Promotion uses `objectStoreUrl` from the Ad Set step |
| CTA | Leave on default (`INSTALL_MOBILE_APP`) |
| Deferred deep link (optional) | Skip on first run; test once with `myapp://welcome` if the app supports deep links |
| Custom product page ID (iOS only, optional) | Skip |
| Media type | Test both: **Image** (default) and **Video** (toggle the SegGroup at the top of the Ad step's Media field) |
| Image | Upload any 1080×1080 JPG, OR paste a public image URL, OR pick from Library |
| Video | Upload any MP4 ≤100 MB, OR pick from Library. Thumbnail (poster image) auto-fills from Meta after upload — you can override on the Thumbnail URL field if you want a specific frame. |
| Status at launch | PAUSED (pre-selected — do not change) |

---

## 3. Test procedure

For each store the ad account has an app on, run the procedure once.

### Steps
1. From the Meta Ads dashboard, click **Create Campaign**.
2. Verify the modal opens with header showing **V2** pill, "Posting to claudetestads01" chip, and a circular X in the top-right corner.
3. **Step 1 — Objective**: Click the **App Promotion** card.
4. **Step 2 — Destination**: Click the **App** card. (It's the only option for this objective.)
5. **Step 3 — Campaign**:
   - Fill `Campaign name`.
   - Leave CBO off.
   - Leave Special Ad Categories empty.
   - **Verify the iOS 14+ campaign toggle is present** (App Promotion-only). For the standard-attribution path leave it **OFF**.
   - Click **Continue**.
6. **Step 4 — Ad Set**:
   - Fill `Ad set name`.
   - Select a **Facebook Page**. Verify the "Instagram identity" field auto-fills with `@<igusername> · <igname>` (or shows "No IG linked").
   - Verify the **Advertiser (DSA beneficiary)** field auto-fills with the Page name. Leave it.
   - **Mobile app store**: pick Google Play (or Apple App Store for the second run).
   - **App**: open the picker. **Verify**:
     - Only real mobile apps appear (no Instant Games / fb_canvas / web-only apps).
     - When Google Play is selected, only apps with a `googlePlay` URL appear.
     - When Apple App Store is selected, only apps with an `itunes` / Apple URL appear.
     - The dropdown's hint text reads `{N} app{s} available` where N matches the count.
   - Pick an app. Verify a small `→ https://play.google.com/...` (or `https://itunes.apple.com/...`) hint appears below the picker.
   - Verify **Performance goal** dropdown shows **only** "Maximise number of app installs" (section 4).
   - Fill **Daily budget** = 100.
   - Leave Bid strategy on default.
   - Skip Start/End.
   - Audience: leave on Build new + India + 18–65.
   - Optimisation, Placements: leave defaults.
   - Click **Continue**.
7. **Step 5 — Ad** (App Promotion has **no Lead Form step**):
   - Fill `Ad name`.
   - Upload an image OR paste an image URL OR pick from Library. Verify the preview thumbnail appears.
   - Fill `Headline`, `Primary text`, `Description`.
   - **Verify `Destination URL` field is NOT visible** — App Promotion uses `objectStoreUrl` from the Ad Set step. (If it IS visible and required, that's a bug.)
   - Verify **Call to action** dropdown shows the options listed in section 5 (default: `INSTALL_MOBILE_APP`).
   - Skip the optional `Deferred deep link` and `Custom product page ID` fields on the first run.
   - Click **Continue**.
8. **Step 6 — Review**:
   - Verify the gradient-bordered "Posting to claudetestads01" banner with Meta logo appears.
   - Verify Section cards (Objective, Campaign, Ad Set, Ad) show the values entered.
   - **Verify Ad Set section includes "App store" and "App ID" rows** (these are App-Promo-specific Review fields).
   - Click **Launch (PAUSED)**.
9. **Verify launch success**:
   - Wizard closes.
   - Toast shows "Campaign launched (PAUSED). Activate it from the Campaigns tab."
   - Tab switches to **Campaigns**; the new campaign appears in the list with objective `OUTCOME_APP_PROMOTION`.

### Pass criteria
- Every step transitions without a red error banner.
- Step 9 completes with the success toast.
- The campaign appears in the Campaigns tab with status PAUSED.
- Running once per store the ad account has apps on, both passes.

### Failure capture
If any step fails, capture:
1. **Screenshot** of the wizard with the error banner visible.
2. **Cell identifier**: `App Promotion / App ({Google Play | Apple App Store})`
3. **Step that failed**: one of Campaign / Ad Set / Ad / Review-Launch.
4. **Error banner text** — copy the full title + details.
5. **`fbtrace` id** — the mono-font code on the error banner.
6. **Backend log line** if accessible (Node console: `error: create campaign`, `error: create ad set error`, `error: create ad error`, `getPromotableApps:` lines).

---

## 4. Expected performance-goal labels

If the dropdown shows different options, that's a bug.

| Cell | Performance-goal options (label in dropdown) |
|---|---|
| App | **Maximise number of app installs** (only — no other options) |

The `OFFSITE_CONVERSIONS` and `VALUE` goals (in-app event optimisation + value maximisation) are intentionally hidden — they require an MMP (AppsFlyer, Adjust) which is not integrated. See Known Limitations.

---

## 5. Expected CTA list

If the CTA dropdown shows options outside this list, flag it. Note: the dropdown shows Meta's friendly labels ("Install now", "Use app", "Learn more"); the table below lists the underlying enum values — match by meaning, not exact string.

| Cell | Allowed CTAs |
|---|---|
| App | GET_DETAILS, LEARN_MORE, ORDER_NOW, DOWNLOAD, SHOP_NOW, SIGN_UP, LISTEN_NOW, PLAY_GAME, SUBSCRIBE, WATCH_MORE, INSTALL_MOBILE_APP (default), USE_APP, BOOK_NOW. ("Explore more" is offered by Meta but its SDK enum is unconfirmed — omitted for now.) |

---

## 6. UI polish checks (do these once)

While testing the cell, verify all of these:

- [ ] Modal close button (X) is in the top-right **corner** of the modal (not nested inside the step rail).
- [ ] Clicking the X on a wizard with typed-in data prompts a **discard confirmation** overlay ("Discard this campaign?"). "Keep editing" returns to the wizard; "Discard" closes it.
- [ ] Performance-goal dropdown is a **custom dark dropdown** with ✓ on the selected row, rotating chevron, and dark glass panel — NOT the native OS dropdown.
- [ ] Toggle switches (including the **iOS 14+ campaign** toggle on the Campaign step) use a **brand gradient** (cyan → purple) when ON.
- [ ] Budget type ("Daily / Lifetime") is a **segmented control** with a gradient ring on the active segment, not a dropdown.
- [ ] Start / End date pickers are a **custom dark calendar** + scroll-column time picker — NOT the native browser `datetime-local` widget.
- [ ] On the Audience section, "Build new / Saved audience" is a segmented control. Both segments are equal height.
- [ ] Mobile-app-store picker is a custom dropdown showing Apple App Store / Google Play.
- [ ] App picker shows ONLY mobile apps (no Instant Games). Switching store filters the list correctly.
- [ ] After picking an app, the store URL appears as a small hint below the picker (`→ https://play.google.com/...` etc.).
- [ ] On the Ad step, "Upload / URL" and "From library" is a segmented control. When "From library" is active, the inline LibraryPicker appears; when "Upload / URL" is active, there's a single "Upload image" white pill (no duplicate "Pick from Library" button).
- [ ] On the Review step, the "Posting to" banner has a gradient border and shows the Meta logo + ad account name + currency.
- [ ] Error banners (if any) are dismissible (X) and show an "Open Meta help ↗" chip + a mono `fbtrace …` id.
- [ ] Step rail at the top: active step has gradient pill, completed steps have green check, pending steps are dimmed.

---

## 7. Final report

After testing both stores (or whichever store the ad account has apps on), produce:

```
V2 Wizard test run — App Promotion objective — {date}
Ad account: claudetestads01 (must match — abort report if it doesn't)
Tester: {browser-claude or human name}

PASS  ✅ App Promotion / App (Google Play)
PASS  ✅ App Promotion / App (Apple App Store)

UI polish: 14/14 ✅
Bug reports filed: 0
Overall: 2/2 store paths PASS
```

If both stores are tested and pass, the cell is fully verified. If only one store has an app available, note that the other is `BLOCKED (infra: no app linked on this store)`.

---

## 8. iOS 14+ flow (test once with an Apple App Store app)

Run the standard procedure (section 3) with these differences when the **iOS 14+ campaign** toggle is ON:

1. **Step 3 — Campaign**:
   - Toggle **iOS 14+ campaign** ON.
   - A new **App promotion** section appears with an app picker. Mobile app store is implicitly Apple App Store (no picker — the dropdown is hidden).
   - Verify only apps with an Apple App Store URL appear in the picker.
   - Pick an iOS app. Verify the store URL hint appears below the picker.
   - Click **Continue**.
2. **Step 4 — Ad Set**: The **App promotion** section now shows read-only `Apple App Store` and the picked app's id, with the note *"To edit these settings, go to the iOS 14+ campaign toggle on the Campaign step."* Verify the picker is no longer editable here.
3. Continue through Ad + Review + Launch normally.

### iOS 14+ pass criteria
- Campaign launches without error.
- Campaigns tab shows the new campaign with objective `OUTCOME_APP_PROMOTION`.
- After delivery starts (some hours later), the **Results** column reads "Mobile App Installation**s**" (SKAdNetwork-attributed), NOT "Mobile App Install" (standard) — this distinguishes a true iOS 14+ campaign from a standard-attribution one.

### iOS 14+ negative tests (optional)
- Try toggling iOS 14+ ON without picking an app on the Campaign step → Continue button should stay disabled.
- Try directly calling `/v2/create-campaign` with `iosOptimised: true` + `mobileAppStore: "GOOGLE_PLAY"` → backend should reject with "iOS 14+ campaigns must use APPLE_APP_STORE — SKAdNetwork is Apple-only".

---

## 9. Known limitations (don't report as bugs)

- **`linkUrl` / Destination URL is intentionally absent** on the Ad step. App Promotion ads use `objectStoreUrl` (from the Ad Set step) instead. If you see a `linkUrl` field appear, that's a bug — flag it.
- **Only APP_INSTALLS optimisation goal** is exposed. The other two App Promotion goals (`OFFSITE_CONVERSIONS` for in-app events, `VALUE` for revenue maximisation) require a Mobile Measurement Partner (AppsFlyer, Adjust, etc.) forwarding post-install events to Meta. AdsGPT doesn't have an MMP integration; Meta would accept those settings but never receive the events, so campaigns would run with no optimisation signal. APP_INSTALLS uses Meta's own install tracking (less accurate on iOS post-ATT but functional).
- **iOS 14+ flow** — when the toggle is ON, the app picker moves from the Ad Set step to the Campaign step (Apple App Store only). The backend sends `is_skadnetwork_attribution: true` AND `promoted_object: { application_id, object_store_url }` on the campaign create call. The Ad Set step then shows the app as read-only with the note "To edit these settings, go to the iOS 14+ campaign toggle on the Campaign step." Validator rejects iOS 14+ paired with Google Play at the API boundary.
- **One ad set per iOS 14+ campaign** is Meta's hard limit (we don't try to enforce it in V2 — Meta returns a clear error if a second ad set is added).
- **App picker shows only apps assigned to the selected ad account** via `act_<id>/applications`. If an expected app is missing, the fix is to assign it in **Business Settings → Ad Accounts → Apps**, not to widen the API scope.
- **Deferred deep link** is an optional creative-level field — when set, it opens a specific in-app surface after install. Most testers can skip this; it's only relevant for apps with deep-link routing configured.
- **Custom Product Page ID** is Apple App Store Connect's CPP feature for iOS landing-page variants. Skip unless explicitly testing CPP-aware delivery.
