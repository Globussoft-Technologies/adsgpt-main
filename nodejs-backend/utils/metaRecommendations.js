const bizSdk = require("facebook-nodejs-business-sdk");
const AdAccount = bizSdk.AdAccount;
const AdSet = bizSdk.AdSet;
const Ad = bizSdk.Ad;
const { fetchAllPaged } = require("./metaHelpers");

// Meta's optimisation suggestions are readable ONLY from the ad-account edge
// (GET /act_<id>/recommendations), never from the per-object `recommendations`
// field that Campaign/AdSet/Ad document.
//
// That field is not rejected — asking for a genuinely bogus field returns
// `(#100) Tried accessing nonexisting field`, and `recommendations` does not —
// so it looks like it works. It simply never comes back: on a live account it
// was absent from all 8 campaigns, all 8 ad sets and all 100 ads, while the
// account edge returned the suggestion those very objects were missing.
// Reading the field is therefore a silent no-op, which is why the fields it
// would have supplied are not requested anywhere in this codebase.
//
// The two payloads are not interchangeable either. The account edge returns
//   { object_ids, type, recommendation_stage, recommendation_time, url,
//     recommendation_content: { body, lift_estimate, opportunity_score_lift } }
// with no title / message / importance / confidence / code / blame_field —
// all of which belong to the per-object `AdRecommendation` type instead.
//
// `object_ids` points at whichever level the suggestion is about (typically an
// ad set), so a campaign row only has something to show once its descendants'
// suggestions are rolled up into it. See collectDescendants below.

// Suggestions move on Meta's own schedule (they are recomputed mid-flight,
// not on edit), so they neither need the 5-minute freshness of spend metrics
// nor deserve the 2-hour TTL of a structural entity list.
const RECOMMENDATIONS_TTL = 1800;

// Meta sends the enum but no display string. Title-casing it keeps every
// future type Meta adds readable without inventing copy for it — the real
// explanation is `body`, which the UI shows underneath.
function labelRecommendationEnum(value, fallback = "") {
  const raw = String(value || "").trim();
  if (!raw) return fallback;
  const words = raw.toLowerCase().replace(/_/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

// Meta's own popover leads with the OUTCOME ("You could get 8% lower cost per
// result by optimising your Reels format"), not the enum — but the API ships no
// title, so Meta composes that sentence client-side from the same two pieces we
// already receive. We do the same, with one restriction: only the outcome half
// is composed. Deriving "by optimising your Reels format" would mean inventing
// grammar for an enum set we have never seen in full (labelRecommendationEnum
// exists precisely because Meta keeps adding types), so the enum stays a
// separate label rather than being forced into a sentence.
//
// `lift_estimate` is prose from Meta ("8% lower cost per result"). Guard on it
// reading as a phrase — a bare "8%" would make "You could get 8%" nonsense — and
// fall back to the enum label when it doesn't.
function composeHeadline(liftEstimate, enumLabel) {
  const lift = String(liftEstimate || "").trim();
  const looksLikePhrase = lift.length > 0 && /\s/.test(lift);
  return looksLikePhrase ? `You could get ${lift}` : enumLabel;
}

function normalizeRecommendation(raw) {
  const content = raw?.recommendation_content || {};
  const lift = Number(content.opportunity_score_lift);
  const enumLabel = labelRecommendationEnum(
    raw?.type,
    "Recommendation from Meta",
  );
  return {
    type: raw?.type || null,
    title: enumLabel,
    // Benefit-led headline for the card; `title` stays the enum label so the
    // two can be shown together the way Meta's popover does.
    headline: composeHeadline(content.lift_estimate, enumLabel),
    body: content.body || "",
    liftEstimate: content.lift_estimate || "",
    opportunityScoreLift: Number.isFinite(lift) ? lift : null,
    stage: raw?.recommendation_stage || null,
    stageLabel: labelRecommendationEnum(raw?.recommendation_stage),
    time: raw?.recommendation_time || null,
    url: raw?.url || "",
    objectIds: Array.isArray(raw?.object_ids)
      ? raw.object_ids.map((id) => String(id))
      : [],
  };
}

// The edge returns groups (AdAccountRecommendations), each wrapping a
// `recommendations` array — not the suggestions themselves.
async function fetchAccountRecommendations(adAccountId) {
  const account = new AdAccount(`act_${adAccountId}`);
  const groups = await fetchAllPaged(
    account.getRecommendations([], { limit: 100 }),
  );
  return groups.flatMap((group) => {
    const list = group?._data?.recommendations || group?.recommendations;
    return Array.isArray(list) ? list.map(normalizeRecommendation) : [];
  });
}

// Account-level Opportunity Score — the 0-100 pill Meta shows next to the ad
// account name, of which each recommendation's `opportunity_score_lift` is one
// increment.
//
// Read defensively on purpose. The per-object `recommendations` field on this
// same API looks supported and silently returns nothing (see the note at the
// top of this file), so a sibling field being *documented* is not evidence it
// comes back populated. Meta has also shipped this as a bare number and as an
// object across versions. Anything unrecognised resolves to null and the UI
// simply omits the pill rather than rendering a wrong score.
async function fetchOpportunityScore(adAccountId) {
  const account = new AdAccount(`act_${adAccountId}`);
  const res = await account.read([AdAccount.Fields.opportunity_score]);
  const raw = res?.opportunity_score ?? res?._data?.opportunity_score;

  const pick = (v) => {
    if (v == null) return null;
    if (typeof v === "number") return v;
    if (typeof v === "string" && v.trim() !== "") return Number(v);
    if (typeof v === "object") {
      // Seen as {score}, and as an edge-style {data:[{score}]}.
      return pick(v.score ?? v.opportunity_score ?? v?.data?.[0]?.score);
    }
    return null;
  };

  const score = pick(raw);
  return Number.isFinite(score) ? score : null;
}

function indexRecommendationsByObjectId(recommendations) {
  const index = {};
  for (const rec of recommendations) {
    for (const id of rec.objectIds) {
      if (!index[id]) index[id] = [];
      index[id].push(rec);
    }
  }
  return index;
}

// Ad set -> campaign and ad -> {ad set, campaign}, so a suggestion attached to
// a child can also surface on its ancestors' rows. Two field-light calls;
// only worth making when there is at least one suggestion to place.
async function fetchAccountHierarchy(adAccountId) {
  const account = new AdAccount(`act_${adAccountId}`);
  const [adSets, ads] = await Promise.all([
    fetchAllPaged(
      account.getAdSets([AdSet.Fields.id, AdSet.Fields.campaign_id], {
        limit: 500,
      }),
    ),
    fetchAllPaged(
      account.getAds(
        [Ad.Fields.id, Ad.Fields.adset_id, Ad.Fields.campaign_id],
        { limit: 500 },
      ),
    ),
  ]);

  const adSetToCampaign = {};
  for (const adSet of adSets) {
    const data = adSet?._data || adSet;
    if (data?.id && data?.campaign_id) {
      adSetToCampaign[String(data.id)] = String(data.campaign_id);
    }
  }

  const adToCampaign = {};
  const adToAdSet = {};
  for (const ad of ads) {
    const data = ad?._data || ad;
    if (!data?.id) continue;
    if (data.campaign_id) adToCampaign[String(data.id)] = String(data.campaign_id);
    if (data.adset_id) adToAdSet[String(data.id)] = String(data.adset_id);
  }

  return { adSetToCampaign, adToCampaign, adToAdSet };
}

// Inverts the hierarchy into "ids whose suggestions this row should also show".
function collectDescendants(hierarchy) {
  const byCampaign = {};
  const byAdSet = {};
  const push = (bucket, key, id) => {
    if (!key) return;
    if (!bucket[key]) bucket[key] = [];
    bucket[key].push(id);
  };

  for (const [adSetId, campaignId] of Object.entries(
    hierarchy?.adSetToCampaign || {},
  )) {
    push(byCampaign, campaignId, adSetId);
  }
  for (const [adId, campaignId] of Object.entries(
    hierarchy?.adToCampaign || {},
  )) {
    push(byCampaign, campaignId, adId);
  }
  for (const [adId, adSetId] of Object.entries(hierarchy?.adToAdSet || {})) {
    push(byAdSet, adSetId, adId);
  }

  return { byCampaign, byAdSet };
}

// A suggestion listing several object_ids would otherwise be repeated on a
// parent row once per matching child.
function recommendationsForIds(index, ids) {
  const seen = new Set();
  const out = [];
  for (const id of ids) {
    for (const rec of index?.[id] || []) {
      const key = `${rec.type}|${rec.time}|${rec.objectIds.join(",")}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(rec);
    }
  }
  return out;
}

module.exports = {
  RECOMMENDATIONS_TTL,
  fetchAccountRecommendations,
  fetchOpportunityScore,
  composeHeadline,
  fetchAccountHierarchy,
  indexRecommendationsByObjectId,
  collectDescendants,
  recommendationsForIds,
  labelRecommendationEnum,
};
