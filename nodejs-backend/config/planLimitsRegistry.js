/**
 * Registry of every per-subscription-plan limit AdsGPT can apply.
 *
 * Single source of truth — same convention as config/modelRegistry.js and
 * config/wizardSchema.js: **adding a limit is ONE entry in this file**, not a
 * schema column, a validator branch, an admin-UI column, and a resolver
 * change scattered across five files. The admin Plans page, the persistence
 * layer, and every enforcement call site all walk this list generically.
 *
 * Deliberately NOT Meta-specific: the first two entries happen to be Meta
 * because that's what shipped first, but a TikTok / Google Ads / workspace-
 * seats / generation-quota limit is a new row here and nothing else on the
 * config, storage, or admin-UI side.
 *
 * ─── Adding a new limit ────────────────────────────────────────────────────
 *   1. Add an entry below.
 *   2. Point `counter` at a `(userId) => Promise<number>` for the thing being
 *      counted. Wrap it in a THUNK (see the `counter` note below).
 *   3. If it needs to actually BLOCK something, call
 *      `checkPlanLimit(userId, "<key>")` from utils/planLimits.js at the
 *      mutation point and return its error payload. **A registry entry alone
 *      gives you admin config + counting + the usage readout, NOT
 *      enforcement** — `enforcement` below documents which entries have a
 *      real gate wired and which are advisory-only.
 *
 * Nothing else needs touching: the model stores values keyed by `key`, the
 * admin page renders a column per entry, and the validator accepts exactly
 * the keys listed here.
 */

/**
 * `key` is persisted in Mongo as a field name inside the `limits` sub-object,
 * so it MUST NOT contain a dot — dots are path separators in a Mongo update
 * document, and a key like `meta.campaigns` would be written as a NESTED
 * object rather than a literal field, silently breaking every read. The colon
 * namespace separator below is legal in Mongo field names and keeps dotted
 * `$set` paths (`limits.meta:campaigns`) unambiguous. `KEY_PATTERN` +
 * test/planLimits/registry.test.js enforce this so it can't regress.
 */
const KEY_PATTERN = /^[a-z0-9]+(?::[a-z0-9_]+)+$/;

const LIMITS = [
  {
    key: "meta:ad_accounts",
    label: "Ad accounts",
    group: "Meta Ads",
    unit: "ad account",
    description:
      "Ad accounts visible across every connected Facebook Business. Advisory only — shows a usage banner, never hides or blocks an account.",
    // DISABLED 2026-08-06 — management wants campaigns capped, not ad
    // accounts. Kept (rather than deleted) as a ready-to-enable row: flip
    // this back to true and the admin column, the counting, and the usage
    // chip all return with no other change. Same `enabled` convention as
    // config/modelRegistry.js. While false, this limit is invisible
    // everywhere and never enforced — any value already stored against it
    // is ignored, not deleted, so re-enabling restores prior config.
    enabled: false,
    // "advisory" = counted + surfaced in the UI, but nothing is blocked.
    // "hard"     = a checkPlanLimit() gate refuses the mutation.
    enforcement: "advisory",
    scopeNote: "across all your connected Facebook accounts",
    // Lazy thunk, NOT a direct reference: utils/planUsage.js pulls in
    // metaAdLauncher.js (Redis, the Meta SDK, ~4600 lines) at require time.
    // Resolving it eagerly here would drag all of that into the load path of
    // anything that merely wants to read the registry — including the admin
    // panel and the unit tests — and re-open the circular-require trap
    // documented in the meta-ads-manager skill's gotchas.md.
    counter: () => require("../utils/planUsage").countUserAdAccounts,
    // Field this limit lived in before limits became a keyed map. Read as a
    // fallback so caps configured pre-migration keep working; see
    // resolvePlanLimitValues below.
    legacyField: "maxAdAccounts",
  },
  {
    key: "meta:campaigns",
    label: "Campaigns",
    group: "Meta Ads",
    unit: "campaign",
    description:
      "Campaigns the user has claimed a slot for. Connecting an ad account is unrestricted; only these campaigns can be opened, edited, paused/resumed, or automated. Creating a campaign claims a slot; releasing or deleting one frees it.",
    enforcement: "hard",
    scopeNote: "on your plan",
    remedy:
      "Release a campaign you're managing (Campaigns list → Manage toggle), or upgrade your plan.",
    // Counts the user's CLAIMED SLOTS, not campaigns present in Meta. This is
    // both the product rule ("operate on only N campaigns") and far cheaper
    // than the account-by-account Meta walk this used to do — one indexed
    // countDocuments, no Meta calls, no Redis reads.
    counter: () => require("../services/managedCampaigns").countManagedCampaigns,
    legacyField: "maxCampaigns",
  },
];

// `enabled: false` entries stay in the file but are invisible to the rest of
// the system — not listed in admin, not resolved, not counted, never enforced,
// and any value already stored against them is ignored rather than deleted.
// Everything below operates on ACTIVE only; LIMITS is the full authored list.
const ACTIVE_LIMITS = LIMITS.filter((entry) => entry.enabled !== false);
const BY_KEY = new Map(ACTIVE_LIMITS.map((entry) => [entry.key, entry]));

/** Every ACTIVE limit definition, in admin-UI display order. */
function listPlanLimits() {
  return ACTIVE_LIMITS;
}

/** Active limits only — a disabled key resolves to null, so the gates no-op. */
function getPlanLimitDef(key) {
  return BY_KEY.get(String(key || "")) || null;
}

function isValidPlanLimitKey(key) {
  return BY_KEY.has(String(key || ""));
}

const PLAN_LIMIT_KEYS = ACTIVE_LIMITS.map((entry) => entry.key);

/**
 * The registry minus the `counter` thunks — safe to JSON-serialise to the
 * admin panel, which renders its columns from exactly this.
 */
function serializePlanLimits() {
  return ACTIVE_LIMITS.map(({ counter, legacyField, ...rest }) => rest);
}

/** Resolve an entry's counter thunk to the actual async fn. */
function resolvePlanLimitCounter(def) {
  if (typeof def?.counter !== "function") return null;
  const fn = def.counter();
  return typeof fn === "function" ? fn : null;
}

/**
 * Merge a persisted PlanLimit document down to `{ [key]: number | null }`,
 * where null means unlimited.
 *
 * Precedence per key: the `limits` map → the entry's `legacyField` column →
 * null. The legacy fallback exists because this feature originally stored
 * `maxAdAccounts`/`maxCampaigns` as named columns; without it, every cap an
 * admin had already configured would silently read as "unlimited" after the
 * move to a keyed map — the same class of silent data-orphaning as an
 * unpinned Mongoose collection rename.
 *
 * Pure (no Mongo, no registry side effects) so it's unit-testable directly.
 * Accepts either a hydrated doc or a `.lean()` object — a Mongoose Map
 * arrives as a real Map from the former and a plain object from the latter.
 */
function resolvePlanLimitValues(doc) {
  const raw = doc?.limits;
  const readStored = (key) => {
    if (!raw) return undefined;
    if (typeof raw.get === "function") return raw.get(key);
    return raw[key];
  };

  const out = {};
  for (const def of ACTIVE_LIMITS) {
    const stored = readStored(def.key);
    const legacy = def.legacyField ? doc?.[def.legacyField] : undefined;
    const value = stored ?? legacy ?? null;
    out[def.key] = Number.isFinite(value) ? value : null;
  }
  return out;
}

/**
 * User-facing copy for a limit that's been hit. Kept here rather than at the
 * call site so every surface (wizard banner, API error, future TikTok gate)
 * words it identically, and so a new limit gets a sensible message for free.
 */
function buildPlanLimitMessage(def, { limit, current }) {
  if (typeof def?.message === "function") return def.message({ limit, current });
  const unit = def?.unit || "item";
  const plural = limit === 1 ? unit : `${unit}s`;
  const scope = def?.scopeNote ? ` ${def.scopeNote}` : "";
  const remedy = def?.remedy || "Upgrade your plan to add more.";
  return `You're managing ${current} of ${limit} ${plural} allowed${scope}. ${remedy}`;
}

module.exports = {
  KEY_PATTERN,
  PLAN_LIMIT_KEYS,
  listPlanLimits,
  getPlanLimitDef,
  isValidPlanLimitKey,
  serializePlanLimits,
  resolvePlanLimitCounter,
  resolvePlanLimitValues,
  buildPlanLimitMessage,
};
