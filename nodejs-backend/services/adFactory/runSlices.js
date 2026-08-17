/**
 * runSlices — split a campaign's cumulative results into per-run batches.
 *
 * PURE. No DB, no network.
 *
 * `campaign.results.image` and `.text` are APPEND-ONLY across every generation
 * this campaign has ever done. `CampaignHistory` snapshots the whole campaign
 * before each regenerate, so each snapshot holds the cumulative array AS IT
 * STOOD at that moment — not that run's output.
 *
 * Reading a snapshot's length as "ads in that run" therefore reports a running
 * total. Observed on a real campaign: runs of 5, 3 and 1 displayed as 5, 8 and
 * 9. The counts grow monotonically no matter what each run actually produced,
 * which is exactly the "you are merging all and storing" symptom.
 *
 * The snapshot lengths are boundaries, not batches. Given cumulative counts
 * [5, 8] and a campaign now holding 9:
 *
 *   run 1 = results[0..5]   (5)
 *   run 2 = results[5..8]   (3)
 *   run 3 = results[8..9]   (1)   <- current, no snapshot yet
 *
 * Slicing the CAMPAIGN's array by those boundaries — rather than reading
 * entries out of each snapshot — means the snapshots are only needed for their
 * lengths, and every batch comes from one authoritative array.
 *
 * One honest limitation: history only knows what it recorded. The first
 * snapshot is taken before the SECOND generate, so the oldest bucket is
 * "everything before history started", which may be several runs merged. It is
 * labelled accordingly rather than claimed as one run.
 */

const plain = (v) => (v && typeof v.toObject === "function" ? v.toObject() : v || {});

// Same definition of "delivered" the preview and the orchestrator use: a slot
// Python answered with usable data. Pending and failed slots are not batch
// members and must not shift the boundaries.
const delivered = (entry) => {
  const e = plain(entry);
  return e.status === 200 && e.data != null && e.data !== "";
};

const deliveredOnly = (arr) => (Array.isArray(arr) ? arr.filter(delivered) : []);

/**
 * @param {object}   campaignResults  campaign.results ({ image, text })
 * @param {object[]} snapshots        CampaignHistory rows, ASCENDING by version,
 *                                    each with previousData.results
 * @returns {{ runs: object[], currentFrom: number }}
 *          `runs` oldest-first, each { version, at, from, to, images, texts,
 *          adCount, partial }. `currentFrom` is the index the in-progress run
 *          starts at, for the caller to slice the live batch with.
 */
function sliceRuns(campaignResults, snapshots = []) {
  const results = plain(campaignResults);
  const images = deliveredOnly(results.image);
  const texts = deliveredOnly(results.text);

  // Boundaries must be non-decreasing and within range. A snapshot longer than
  // the campaign means results were removed since (a Full control edit wipes
  // `creatives`, and a future change could prune results) — clamp rather than
  // produce a negative slice.
  let prev = 0;
  const runs = [];

  (Array.isArray(snapshots) ? snapshots : []).forEach((snap, i) => {
    const s = plain(snap);
    const count = Math.min(
      Math.max(deliveredOnly(plain(s.previousData).results?.image).length, prev),
      images.length,
    );

    runs.push({
      version: s.version ?? i + 1,
      at: s.createdAt || null,
      from: prev,
      to: count,
      images: images.slice(prev, count),
      texts: texts.slice(prev, count),
      adCount: count - prev,
      // The oldest bucket predates history: the first snapshot is written
      // before the SECOND generate, so anything already in the campaign by
      // then could be one run or several. Say so rather than implying one.
      partial: i === 0 && count - prev > 0,
    });
    prev = count;
  });

  return { runs, currentFrom: prev };
}

module.exports = { sliceRuns, _internals: { delivered, deliveredOnly } };
