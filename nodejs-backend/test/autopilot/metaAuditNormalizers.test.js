#!/usr/bin/env node
/**
 * Tests for the campaign / adset / ad normalizers in metaAuditService.
 *
 * Pure unit tests — no Meta calls, no Mongo. We feed `buildNormalisers`
 * fake insights rows + the surrounding maps it needs and assert the
 * returned shape matches the contract user rules + the LLM audit
 * downstream both depend on.
 *
 * Today's coverage focus: CPI / installs computation across all three
 * levels (campaign / adset / ad), plus the prev-window counterparts.
 * App-promotion campaigns are a recent addition to the rule catalog
 * and the only reason `installs` / `cpi` exist; this test locks in
 * the contract so a future refactor doesn't silently zero them out.
 */

const assert = require('node:assert/strict');
const { _internals } = require('../../services/metaAuditService');

const {
  buildNormalisers,
  getActionValue,
  getRoas,
  getPurchaseCount,
  resolveInsightTimeOptions,
} = _internals;

let pass = 0;
let fail = 0;
const FAILURES = [];

function test(name, fn) {
  try {
    fn();
    pass += 1;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    fail += 1;
    FAILURES.push({ name, err });
    console.log(`  ✗ ${name}`);
    console.log(`      ${err.message}`);
  }
}
function group(label, fn) {
  console.log(`\n${label}`);
  return fn();
}

// ─── helpers ────────────────────────────────────────────────────────────────

// Tiny actions-array factory — Meta returns actions as a list of
// { action_type, value } objects. The normalizer reads them via
// `getActionValue`.
const actions = (map) =>
  Object.entries(map).map(([action_type, value]) => ({
    action_type,
    value: String(value),
  }));

// Same shape but for `cost_per_action_type` — Meta-supplied per-action
// cost. CPI is now read from this array rather than computed locally,
// so most tests need both `actions` (for the install COUNT field) and
// `cost_per_action_type` (for the CPI value).
const costs = actions; // identical shape

// Build a normalizer set with the bare minimum collaborators so we can
// drive a single insight row through it.
function makeNormalisers({
  campaign = { id: 'camp_1', status: 'ACTIVE', _data: {} },
  adSet = { id: 'as_1', status: 'ACTIVE', _data: {} },
  ad = { id: 'ad_1', status: 'ACTIVE', _data: {} },
  prevCampaignActions = null, // map → actions array seed for prev window
  prevAdsetActions = null,
  prevAdActions = null,
  prevCampaignCosts = null, // map → cost_per_action_type for prev window
  prevAdsetCosts = null,
  prevAdCosts = null,
  prevSpend = 0,
} = {}) {
  const prevRow = (acts, costMap) =>
    acts
      ? {
          spend: prevSpend,
          actions: actions(acts),
          cost_per_action_type: costMap ? costs(costMap) : [],
          ctr: 0,
          cpc: 0,
          cpm: 0,
          clicks: 0,
          purchase_roas: [],
        }
      : null;
  return buildNormalisers({
    currency: 'INR',
    campaignMap: new Map([[campaign.id, campaign]]),
    adSetMap: new Map([[adSet.id, adSet]]),
    adMap: new Map([[ad.id, ad]]),
    prevCampaignMap: new Map(
      prevCampaignActions
        ? [[campaign.id, prevRow(prevCampaignActions, prevCampaignCosts)]]
        : [],
    ),
    prevAdsetMap: new Map(
      prevAdsetActions
        ? [[adSet.id, prevRow(prevAdsetActions, prevAdsetCosts)]]
        : [],
    ),
    prevAdMap: new Map(
      prevAdActions ? [[ad.id, prevRow(prevAdActions, prevAdCosts)]] : [],
    ),
    campaignInsights: [],
    adInsights: [],
    account_avg_cpa: 0,
    ageGuard: null,
    spendFloor: 0,
  });
}

// ─── tests ──────────────────────────────────────────────────────────────────

(async () => {
  await group('resolveInsightTimeOptions — lifetime preset', () => {
    test('maximum maps to Meta lifetime and has no previous window', () => {
      const result = resolveInsightTimeOptions({
        lookbackDays: 14,
        prevLookbackDays: 14,
        lookbackPreset: 'maximum',
      });

      assert.deepEqual(result.current, { date_preset: 'maximum' });
      assert.equal(result.previous, null);
      assert.equal(result.isMaximumLookback, true);
    });
  });

  await group('getActionValue — install action_type sums', () => {
    test('mobile_app_install returns its numeric value', () => {
      assert.equal(
        getActionValue(actions({ mobile_app_install: 12 }), 'mobile_app_install'),
        12,
      );
    });
    test('omni_app_install is independent of mobile_app_install', () => {
      const acts = actions({ mobile_app_install: 5, omni_app_install: 7 });
      assert.equal(getActionValue(acts, 'mobile_app_install'), 5);
      assert.equal(getActionValue(acts, 'omni_app_install'), 7);
    });
    test('missing action_type returns 0 (no throw)', () => {
      assert.equal(getActionValue(actions({}), 'mobile_app_install'), 0);
    });
  });

  // Meta reports the same conversion under two action types and WHICH ONE
  // APPEARS VARIES BY ACCOUNT. This had already been solved for installs
  // (getInstallCount) and then not applied to ROAS or purchases — so `roas`
  // read 0 for every entity on every account, and an account reporting only
  // `omni_purchase` looked like it had zero purchases, which a
  // `purchases == 0` PAUSE rule would act on.
  await group('omni_* dedupe — roas and purchases', () => {
    const roasArr = (o) =>
      Object.entries(o).map(([action_type, value]) => ({
        action_type,
        value: String(value),
      }));

    test('roas reads omni_purchase when that is the only key present', () => {
      // Exactly the live shape: [{"action_type":"omni_purchase", ...}]
      assert.equal(getRoas(roasArr({ omni_purchase: 0.632837 })), 0.632837);
    });
    test('roas still reads the legacy purchase key', () => {
      assert.equal(getRoas(roasArr({ purchase: 2.5 })), 2.5);
    });
    test('roas takes the max when both are present, never the sum', () => {
      // They describe the same conversions; summing would double ROAS.
      assert.equal(getRoas(roasArr({ purchase: 2.5, omni_purchase: 2.5 })), 2.5);
      assert.equal(getRoas(roasArr({ purchase: 1, omni_purchase: 3 })), 3);
    });
    test('roas is 0 for a non-commerce campaign, and never throws', () => {
      assert.equal(getRoas([]), 0);
      assert.equal(getRoas(null), 0);
      assert.equal(getRoas(undefined), 0);
      assert.equal(getRoas('not-an-array'), 0);
      assert.equal(getRoas(roasArr({ purchase: 'nonsense' })), 0);
    });

    test('purchases reads omni_purchase when purchase is absent', () => {
      assert.equal(getPurchaseCount(actions({ omni_purchase: 149 })), 149);
    });
    test('purchases takes the max, so CPA is not halved', () => {
      // Summing would double the count and halve every CPA.
      assert.equal(
        getPurchaseCount(actions({ purchase: 149, omni_purchase: 149 })),
        149,
      );
    });
    test('purchases is 0 when neither key is present', () => {
      assert.equal(getPurchaseCount(actions({ link_click: 5 })), 0);
      assert.equal(getPurchaseCount(null), 0);
    });
  });

  await group('normalizeCampaign — installs + cpi', () => {
    test('cpi reads Meta`s cost_per_action_type (not spend/installs)', () => {
      // The normalizer no longer divides spend by installs — that drifted
      // from Ads Manager. CPI now comes from cost_per_action_type which
      // is Meta`s authoritative per-action cost (accounts for attribution
      // window quirks + dedup we couldn't reproduce locally).
      const { normalizeCampaign } = makeNormalisers();
      const row = normalizeCampaign({
        campaign_id: 'camp_1',
        campaign_name: 'App Camp',
        spend: '1000',
        clicks: '50',
        impressions: '10000',
        ctr: '0.5',
        cpc: '20',
        cpm: '100',
        actions: actions({ mobile_app_install: 10, omni_app_install: 10 }),
        cost_per_action_type: costs({
          // Pretend Meta says CPI = 97.50 (slightly different from
          // 1000/10 = 100 to prove we're reading Meta's number, not
          // computing it locally).
          mobile_app_install: 97.5,
          omni_app_install: 97.5,
        }),
      });
      assert.equal(row.installs, 10);
      assert.equal(row.cpi, 97.5);
    });

    test('cpi takes max of mobile + omni cost values', () => {
      // Same dedup rationale as the install count: the two action types
      // describe the same conversions. Pick max so an intermittent
      // missing report doesn't zero the CPI out.
      const { normalizeCampaign } = makeNormalisers();
      const row = normalizeCampaign({
        campaign_id: 'camp_1',
        spend: '900',
        clicks: '0',
        impressions: '0',
        actions: actions({ mobile_app_install: 9, omni_app_install: 9 }),
        cost_per_action_type: costs({
          mobile_app_install: 80,
          omni_app_install: 100,
        }),
      });
      assert.equal(row.cpi, 100, 'should pick max(80, 100) = 100');
    });

    test('cpi=0 when cost_per_action_type lacks install entries', () => {
      // Non-app campaign or fresh ad with no install conversions yet.
      const { normalizeCampaign } = makeNormalisers();
      const row = normalizeCampaign({
        campaign_id: 'camp_1',
        spend: '500',
        clicks: '20',
        impressions: '5000',
        actions: actions({ purchase: 2 }),
        cost_per_action_type: costs({ purchase: 250 }),
      });
      assert.equal(row.installs, 0);
      assert.equal(row.cpi, 0);
    });

    test('cpi=0 when cost_per_action_type field is missing entirely', () => {
      // Defensive: Meta sometimes omits the array on rows with no
      // attributable conversions. Must return 0, not throw.
      const { normalizeCampaign } = makeNormalisers();
      const row = normalizeCampaign({
        campaign_id: 'camp_1',
        spend: '500',
        clicks: '20',
        impressions: '5000',
        actions: [],
      });
      assert.equal(row.cpi, 0);
    });

    test('installs still uses actions array (not cost_per_action_type)', () => {
      // The `installs` count is a separate field from CPI — it has its
      // own use cases (e.g. `installs > 5` rule). We keep computing it
      // from the actions array; only `cpi` switched to Meta's number.
      const { normalizeCampaign } = makeNormalisers();
      const row = normalizeCampaign({
        campaign_id: 'camp_1',
        spend: '0',
        clicks: '0',
        impressions: '0',
        actions: actions({ mobile_app_install: 13, omni_app_install: 13 }),
        cost_per_action_type: costs({ omni_app_install: 44.68 }),
      });
      assert.equal(row.installs, 13);
      assert.equal(row.cpi, 44.68);
    });

    test('prev_cpi reads prev-window cost_per_action_type', () => {
      const { normalizeCampaign } = makeNormalisers({
        prevCampaignActions: { mobile_app_install: 4 },
        prevCampaignCosts: { mobile_app_install: 200 },
        prevSpend: 800,
      });
      const row = normalizeCampaign({
        campaign_id: 'camp_1',
        spend: '0',
        clicks: '0',
        impressions: '0',
        actions: [],
      });
      assert.equal(row.prev_installs, 4);
      assert.equal(row.prev_cpi, 200);
    });

    test('prev_cpi is null when no prev window data', () => {
      const { normalizeCampaign } = makeNormalisers();
      const row = normalizeCampaign({
        campaign_id: 'camp_1',
        spend: '0',
        clicks: '0',
        impressions: '0',
        actions: [],
      });
      assert.equal(row.prev_installs, null);
      assert.equal(row.prev_cpi, null);
    });
  });

  await group('normalizeAdset — installs + cpi', () => {
    test('adset rows expose installs + cpi alongside cpa', () => {
      const { normalizeAdset } = makeNormalisers();
      const row = normalizeAdset({
        adset_id: 'as_1',
        campaign_id: 'camp_1',
        spend: '600',
        clicks: '30',
        actions: actions({ mobile_app_install: 6, purchase: 2 }),
        cost_per_action_type: costs({
          mobile_app_install: 100,
          purchase: 300,
        }),
      });
      assert.equal(row.installs, 6);
      assert.equal(row.cpi, 100); // from cost_per_action_type
      assert.equal(row.purchases, 2);
      assert.equal(row.cpa, 300); // 600 / 2 — purchase still computed locally
    });

    test('prev_cpi reads prev-window cost_per_action_type on adsets', () => {
      const { normalizeAdset } = makeNormalisers({
        prevAdsetActions: { omni_app_install: 5 },
        prevAdsetCosts: { omni_app_install: 150 },
        prevSpend: 750,
      });
      const row = normalizeAdset({
        adset_id: 'as_1',
        campaign_id: 'camp_1',
        spend: '0',
        clicks: '0',
        actions: [],
      });
      assert.equal(row.prev_installs, 5);
      assert.equal(row.prev_cpi, 150);
    });
  });

  await group('normalizeAd — installs + cpi', () => {
    test('ad rows expose installs + cpi from cost_per_action_type', () => {
      const { normalizeAd } = makeNormalisers();
      const row = normalizeAd({
        ad_id: 'ad_1',
        adset_id: 'as_1',
        campaign_id: 'camp_1',
        spend: '300',
        ctr: '0.4',
        impressions: '8000',
        actions: actions({ mobile_app_install: 3 }),
        cost_per_action_type: costs({ mobile_app_install: 100 }),
      });
      assert.equal(row.installs, 3);
      assert.equal(row.cpi, 100);
    });

    test('prev_cpi reads prev-window cost_per_action_type on ads', () => {
      const { normalizeAd } = makeNormalisers({
        prevAdActions: { mobile_app_install: 2, omni_app_install: 1 },
        prevAdCosts: {
          mobile_app_install: 300,
          omni_app_install: 300,
        },
        prevSpend: 600,
      });
      const row = normalizeAd({
        ad_id: 'ad_1',
        adset_id: 'as_1',
        campaign_id: 'camp_1',
        spend: '0',
        ctr: '0',
        impressions: '0',
        actions: [],
      });
      // installs still uses Math.max of action counts → max(2, 1) = 2
      assert.equal(row.prev_installs, 2);
      // prev_cpi reads cost_per_action_type, not spend/installs
      assert.equal(row.prev_cpi, 300);
    });
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) {
    console.log('\nFailures:');
    for (const f of FAILURES) {
      console.log(`  - ${f.name}: ${f.err.stack || f.err.message}`);
    }
    process.exit(1);
  }
})();
