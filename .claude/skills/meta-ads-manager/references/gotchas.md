# Gotchas — bugs we keep hitting

These are the recurring issues. **Read this file before any non-trivial change to the Meta Ads Manager surface.** Most of these have produced bug tickets multiple times because they're non-obvious from the code alone.

## Currency strings

`utils/formatBudget.js` returns currency-formatted strings (`"₹100.00"`, `"$5.00"`) via `Intl.NumberFormat`. The backend list endpoints (`getCampaigns`, `getAdSets`, `getAds`) pass budget fields through this formatter before responding.

**Consequence:** `parseFloat("₹100.00")` returns `NaN`. Naive numeric checks on these fields silently fail.

**Fix pattern:**
```js
const numeric = String(v).replace(/[^\d.-]/g, '');
const n = parseFloat(numeric);
return !isNaN(n) && n > 0;
```

The `hasBudget()` helper in [`MetaAdsTableView.jsx`](../../../react-frontend/src/components/MetaAds/MetaAdsTableView.jsx) does this. Reuse it; don't reinvent.

**The buried sibling bug:** `parseBudget()` in the same file ALSO uses naked `parseFloat`. The `BudgetBar` progress component depends on `parseBudget` and has been silently rendering nothing since launch as a result. Fix when you have a reason to touch that component.

## Lifetime vs daily budget

CBO campaigns can use **either** `daily_budget` OR `lifetime_budget`. Adsets under a CBO parent return `daily_budget = 0` regardless. Checks like `hasBudget(c.daily_budget) ? "CBO" : "non-CBO"` will misclassify lifetime-CBO campaigns as non-CBO.

**Pattern:**
```js
const isCBO = hasBudget(c.daily_budget) || hasBudget(c.lifetime_budget);
```

Same applies when displaying budget in tables — fall through `daily → lifetime → "Set on ad set"`. See [`MetaAdsTableView.jsx`](../../../react-frontend/src/components/MetaAds/MetaAdsTableView.jsx) campaigns table for the canonical render.

## bid_type vs bid_strategy

`bid_type` on Ad is a **legacy field**. Modern Meta auctions return `ABSOLUTE_OCPM` for nearly every ad regardless of how the campaign was configured. Showing `bid_type` in a table column is technically correct but uninformative — every row displays the same value.

The user-meaningful "bidding choice" lives in **`bid_strategy`** on the **AdSet** (`LOWEST_COST_WITHOUT_CAP`, `COST_CAP`, etc.). When designing list views or detail panels, prefer `bid_strategy` over `bid_type`.

## `is_adset_budget_sharing_enabled` is required for non-CBO

Meta enforces this flag on campaigns that don't have a campaign-level budget. Omitting it produces:
> "Must specify True or False in is_adset_budget_sharing_enabled field"

[`createCampaign` in `metaAdLauncher.js`](../../../nodejs-backend/controllers/adPosting/metaAdLauncher.js) defaults it to `false` when `dailyBudget` and `lifetimeBudget` are both absent. **Don't strip this default.**

If you ever want to expose the "share 20% of budget for cross-set optimization" behavior to users, plumb a wizard checkbox through and respect its value here. Until then, default false.

## Meta Marketing API v22 deprecations (Sept 2025)

Three field renames hard-cut on 2025-09-09. Legacy names return `"Invalid parameter"` with no fallback:

| Legacy | Current |
|---|---|
| `instagram_actor_id` | `instagram_user_id` |
| `instagram_story_id` | `source_instagram_media_id` |
| `effective_instagram_story_id` | `effective_instagram_media_id` |

**Crucially:** the `facebook-nodejs-business-sdk` ships with `Fields.instagram_actor_id` constants from older codegen. They will fail at request time. Pass the new names as **literal strings** in the params object, don't trust `Fields.*` enums for IG-related fields.

Also: `promoted_object.instagram_user_id` is **only** valid for ads that promote an IG account directly. For normal Traffic/Engagement/Sales, IG identity goes on the creative's `object_story_spec.instagram_user_id`.

## FacebookRequestError shape

The SDK throws `FacebookRequestError` where the response body is **flattened directly onto `error.response`**, NOT under `.response.error`. Most error formatters from older docs are wrong.

```js
// What you actually have:
error.response.message          // generic — usually "Invalid parameter"
error.response.code             // numeric Meta error code
error.response.error_subcode
error.response.error_user_title // ← human-readable, surface this
error.response.error_user_msg   // ← human-readable, surface this
error.response.error_data       // sometimes JSON-string of blame_field_specs
error.response.fbtrace_id
```

Use `formatMetaError(error)` and `logMetaError(prefix, error)` from [`metaAdLauncher.js`](../../../nodejs-backend/controllers/adPosting/metaAdLauncher.js). When debugging an unexplained "Invalid parameter", `error.response.error_user_msg` almost always has the real reason.

**Diagnostic shortcut:** `JSON.stringify(error, Object.getOwnPropertyNames(error))` grabs non-enumerable props (response, status, headers) that a plain stringify drops. Use this once when probing a new SDK error path.

## Numeric formatting in audit messages

[`config/auditRulesConfig.js`](../../../nodejs-backend/config/auditRulesConfig.js) message functions interpolate metrics into strings. **Always `.toFixed(2)`** on percentages and floats. We've fixed `4.848967%`-style displays multiple times. Naked `${d.ctr}` is the bug.

## Audit window is fixed

The rule-based audit (`/meta-ads/audit`) always runs over the **last 14 days**, regardless of the global date filter. The thresholds in `auditRulesConfig.js` are calibrated to that window. The Audit tab displays a fixed note saying so.

If a tester reports "Audit ignores the date filter" — that's intentional. Don't change it without recalibrating every rule's thresholds.

## Tailwind text tokens

The project's Tailwind v4 config defines `text-10`, `text-13`, `text-15`, `text-18` only. **Not** `text-11`, `text-12`, `text-14`, `text-16`, etc. — those classes land in the DOM but match no CSS rule, so the element falls through to the inherited size (typically 16px).

Symptom: an element you expected to be ~11px renders at 14–16px next to neighbors styled `text-xs` (12px). No compile error, no runtime warning.

**Pattern:** use `text-10` / `text-xs` (12px) / `text-13` / `text-sm` (14px) / `text-15` / `text-base` (16px) / `text-18` / `text-lg` (18px), or arbitrary values like `text-[11px]` for in-between.

## Disconnect endpoint lives at /ad-posting

`DELETE /ad-posting/users/:userId` is the disconnect endpoint, **not** `/meta-ads/disconnect`. It exists on the legacy mount because that's where the FB OAuth lifecycle was originally built. After delete, the handler calls `invalidateAllUserMetaCache(userId)` exported as a named export from `metaAdLauncher.js`.

## Wizard step retry edge case

The wizard's `created` step cache makes step-by-step retries idempotent — if step 4 fails, retry only re-runs step 4. **But** if the user clicks "Back" between attempts and edits a field on an earlier step, the cached IDs still point at entities created with the old form values. Documented limitation; user must close + reopen + delete the orphan via the new delete-campaign flow to truly reset.

When you add a new step to the wizard, extend the `created` cache with the new entity's ID so retries skip it too.

## AnimatePresence + table refresh flicker

`MetaAdsTableView.jsx` campaign table renders rows even during a refresh-loading state if you don't gate the row map with `!loading`. The result is the spinner row + stale rows rendering simultaneously, producing a "ghost overlay" effect. Pattern:

```jsx
{loading && <SpinnerRow />}
{!loading && sorted.length === 0 && <EmptyRow />}
{!loading && sorted.map(...)}  // ← !loading guard required
```

Same gotcha can hit any new table view; copy the pattern.

## Status enums on accounts use 1/`ACTIVE`

`STATUS_MAP` in `metaAdsUtils.js` maps both the integer `1` and the string `"ACTIVE"` to the same green badge — Meta returns numeric status for ad accounts (`account_status: 1` = active) and string status for campaigns/adsets/ads. Don't normalize at fetch time; the map handles both shapes.
