# Cache strategy

Redis-backed caching with **two TTL tiers + an inline audit TTL**, and explicit invalidation tiers for status mutations vs full disconnect. Get this wrong and users see ghost data for hours.

## TTL tiers

Defined at the top of [`controllers/adPosting/metaAdLauncher.js`](../../../nodejs-backend/controllers/adPosting/metaAdLauncher.js):

```js
const REDIS_TTL    = 7200; // 2 hr — stable lists
const VOLATILE_TTL = 300;  // 5 min — period metrics that drift in real time
```

Plus the audit endpoint uses an **inline** `1800` (30 min) — the audit is heavy and intentionally cached longer than analytics.

### When to use which

| Tier | Used for | Why |
|---|---|---|
| `REDIS_TTL` (2 hr) | Ad accounts list, campaigns list, adsets list, ads list (campaign-keyed and adset-keyed) | These change only on user mutation. Long TTL is fine because we bust on writes. |
| `VOLATILE_TTL` (5 min) | `metaAnalytics`, `metaDashboard`, `metaInsights` | Period spend / impressions / clicks drift in real time as Meta delivers ads. Long TTL produces visibly inconsistent numbers across date presets cached at different moments (e.g. "today" appearing greater than "last_7d" because last_7d is hours stale). |
| Inline `1800` (30 min) | `metaAudit` | Audit is expensive (loops 37 rules over every entity). 5 min would make Audit tab refreshes painfully slow; 2 hr would let stale findings linger past relevance. |

**Decision rule:** if the cached value contains a metric that changes minute-to-minute (spend, impressions, clicks, actions), use `VOLATILE_TTL`. Otherwise use `REDIS_TTL`.

## Cache key conventions

All keys are namespaced per user. Patterns:

```
metaAdAccounts:<userId>
metaCampaigns:<userId>:<adAccountId>
metaAdsets:<userId>:<adAccountId>:<campaignId | "all">
metaCampaignAds:<userId>:<campaignId>
metaAdSetAds:<userId>:<adSetId>
metaAnalytics:<userId>:<adAccountId>:<datePreset>
metaDashboard:<userId>:<adAccountId | "all">:<datePreset>
metaInsights:<userId>:<adAccountId>:<datePreset>:<level>:<campaignId | "none">:<adsetId | "none">:<adId | "none">
metaAudit:<userId>:<adAccountId>
```

When you add a new endpoint, **always** prefix with `meta<Entity>:<userId>:` so the bulk-invalidation helpers can find your key by prefix.

## Invalidation tiers

Defined in `metaAdLauncher.js`:

```js
const STATUS_CACHE_PREFIXES = [
  "metaCampaigns",
  "metaAdsets",
  "metaCampaignAds",
  "metaAdSetAds",
  "metaDashboard",
];

const ALL_CACHE_PREFIXES = [
  ...STATUS_CACHE_PREFIXES,
  "metaAnalytics",
  "metaInsights",
  "metaAudit",
  "metaAdAccounts",
];
```

### Helpers

- `invalidateMetaCacheByPrefixes(userId, prefixes)` — generic prefix-based wipe via Redis SCAN.
- `invalidateUserMetaCache(userId)` — wipes `STATUS_CACHE_PREFIXES`. Used by `updateStatus`.
- `invalidateAllUserMetaCache(userId)` — wipes `ALL_CACHE_PREFIXES`. Used by FB disconnect (exported as a named export so the disconnect handler in `/ad-posting/users` can call it without importing the whole controller class).
- `invalidateAfterCreate(userId, { adAccountId, campaignId, adSetId })` — surgical bust used by create-campaign / create-adset / create-ad. Only kills the relevant list keys; leaves analytics alone.

### When to invalidate

| Mutation | What to invalidate |
|---|---|
| Status update (campaign/adset/ad pause/resume) | `invalidateUserMetaCache(userId)` |
| Create campaign | `invalidateAfterCreate(userId, { adAccountId })` |
| Create adset | `invalidateAfterCreate(userId, { adAccountId, campaignId })` |
| Create ad | `invalidateAfterCreate(userId, { adAccountId, adSetId })` |
| Delete campaign | `invalidateUserMetaCache(userId)` + `invalidateMetaCacheByPrefixes(userId, ["metaAnalytics", "metaAudit"])` (cascades to adsets/ads server-side, so we wipe broadly) |
| FB disconnect | `invalidateAllUserMetaCache(userId)` |
| Edit (Phase 6+) | At minimum `invalidateUserMetaCache(userId)`. If the edit changes spend/budget, also bust analytics. |

## Adding a new cache

1. **Pick a key namespace.** `meta<Entity>:<userId>:...` — never escape the `meta*` prefix; the bulk invalidators rely on it.
2. **Pick a TTL.** Use the decision rule above.
3. **Decide invalidation.** Which `*_CACHE_PREFIXES` array does your new entity belong in? If it's a status-bearing entity, add the prefix to `STATUS_CACHE_PREFIXES`. Otherwise add to `ALL_CACHE_PREFIXES` only.
4. **Wire the bust into every mutation that affects it.** Search for places that call `invalidateUserMetaCache` and audit each.

## Cross-preset consistency

The single biggest source of "data is wrong" complaints comes from the same metric being cached separately under different `datePreset` keys, fetched at different moments. This is unavoidable — but bounded by `VOLATILE_TTL`. Keep that constant short. Do not raise it to "save Meta API calls"; the user-trust cost is much higher than the API call savings.

## Frontend cache awareness

The frontend has no explicit cache layer (everything goes through axios → backend → Redis). But two patterns matter:

1. **Force refresh.** `getAdAccounts({ refresh: true })` adds `?refresh=true` which makes the backend skip the cache read AND invalidate the existing key. Used after FB OAuth callback so newly-granted accounts appear immediately. Mirror this pattern when you add a "force refresh" UX affordance to a new tab.
2. **Component-level loading state.** When a mutation succeeds, the table view re-fetches via the parent's `onRefresh` callback. The fetch itself is unconditionally fresh because the mutation invalidated the cache. Don't add a layer of frontend-side caching on top — it'll de-sync from Redis.
