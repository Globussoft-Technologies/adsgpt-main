// templateAdClient — Recreate: build a new ad from a chosen reference template.
//
// The sibling of `videoClient`, and shaped like it on purpose: freeze, POST,
// read `meta` off the 202, true up, record the job, start the bridge. What is
// different is which contract it speaks and what it is allowed to spend.
//
// Contract: `/TEMPLATE_AD_GENERATION_API_CONTRACT.md`
//
//   image template → POST /api/v1/images/from-template
//   video template → POST /api/v1/videos/from-template
//
// ── Three things this does that videoClient does not ────────────────────────
//
// 1. IT NEVER CLAIMS THE FREE RENDER. `videoClient` calls `securePayment`,
//    which spends the one lifetime free onboarding render. A recreate is a
//    different purchase — spending that claim here would retire the entry
//    banner for a render nobody promised was free. See the template-ad section
//    of `renderBilling`.
//
// 2. IT SENDS NO `model`. Which model each route renders with is agreed with
//    DS and configured on their deployment — Veo 3.1 fast for video, Gemini 3.1
//    Flash Image for image — so naming it in the request would be this code
//    asserting a fact it does not own (decision, Bharath 2026-09-23).
//
//    Our ceiling is priced from those same two models, so the two agree by
//    AGREEMENT rather than by construction. What catches a drift:
//      · video — `meta.model` always comes back populated, so `rateFor` prices
//        the real model and `trueUpTemplateAd` logs "actual EXCEEDS ceiling" if
//        it is dearer than we held. Loud, but after the fact.
//      · image — `meta.model` may come back EMPTY (the contract says so), and
//        `imageRateFor` deliberately falls back to the agreed model rather than
//        pricing an empty string at zero.
//
// 3. THE PRODUCT IS THE CALLER'S, NEVER THE TEMPLATE'S. `reference_image_urls`
//    is required on both routes now, with or without a session, and the
//    contract is explicit that none of the session's own scraped imagery is
//    used. The template lends composition and style; the uploaded image is the
//    product. That is why the sheet's upload field is mandatory.

const axios = require("axios");
const { randomUUID } = require("node:crypto");
const AiJob = require("../../Module/ai/aiJob");
const { startJobStreamBridge } = require("./jobStreamBridge");
const { markBoardStarted } = require("./sessionMirror");
const {
  secureTemplateAdPayment,
  trueUpTemplateAd,
  returnAllowance,
} = require("./renderBilling");
const UnifiedCreditController = require("../../controllers/UnifiedCreditController");
const { createFlowLog } = require("../../utils/flowLog");

// The POST only queues the render. The 15-60s of actual work happens on the
// job stream, not on this connection.
const CREATE_TIMEOUT_MS = 30_000;

// One take. The contract is blunt about the alternative: "Variations cost real
// money… requesting 4 costs 4x a single render." Onboarding has no spend
// controls on this screen (ONB-004), so it does not get to spend four times.
const VARIATIONS = 1;

// What a recreated video runs for. The route's own default, named here so the
// number the ceiling is priced from and the number we ask for cannot drift.
const VIDEO_DURATION_S = 8;

/**
 * Give back whatever was actually taken.
 *
 * Two forms of payment, never both: the allowance, or a wallet hold. Releasing
 * a reservation that was never opened is harmless but silent, and returning
 * allowance that was never spent would mint budget — so this branches on which
 * one the payment used rather than trying both.
 */
async function undoPayment({ payment, userId, renderId }) {
  // A render can be paid for by BOTH purses since ONB-010, so both are undone —
  // `else` here would have quietly kept the allowance half of a split.
  if (payment?.allowanceSpent) await returnAllowance(userId, payment.allowanceSpent);
  if (payment?.coveredByAllowance) return true;
  return UnifiedCreditController.releaseCredits(renderId);
}

/**
 * The key a recreate is stored under, inside `recreates.boards`.
 *
 * Its OWN section, not `videos` — that was the first attempt and it was wrong.
 * Both sections derive a status and a result list from `Object.values(boards)`,
 * so sharing one map put an image into the session's list of clips and let a
 * running recreate report the storyboard module as running. The per-card
 * lookups never collided; the section-level ones always did.
 *
 * The `recreate:` prefix survives the move even though the section already
 * namespaces it, because the FRONTEND keeps one `byBoard` map for both kinds —
 * so a template id and a storyboard id still share a keyspace there.
 */
const recreateBoardKey = (templateId) => `recreate:${templateId}`;

function resolveBaseUrl() {
  return String(process.env.ONBOARDING_PYTHON_BASE_URL || "").replace(/\/+$/, "");
}

/**
 * Start one recreate.
 *
 * `productUrls` are absolute http(s) URLs the caller has ALREADY uploaded —
 * this function does not take files. That ordering matters for money: the
 * upload is the step most likely to fail, and a failed upload must not leave a
 * hold on the user's credits.
 *
 * Returns `{ ok: true, jobId, renderId, amount, meta }`, or
 * `{ ok: false, reason }` — the caller turns a reason into a status code.
 * Never throws: a failed recreate belongs on one card, not as a 500 on the page.
 */
async function startTemplateAdRun({
  userId,
  sessionId,
  templateId,
  kind, // "image" | "video"
  productUrls = [],
  instruction = "",
  maxWalletCredits,
}) {
  const baseUrl = resolveBaseUrl();
  if (!baseUrl) return { ok: false, reason: "not_configured" };
  if (!userId || !sessionId || !templateId) return { ok: false, reason: "bad_request" };
  if (!Array.isArray(productUrls) || !productUrls.length) {
    // Refused here rather than upstream so the message names the real cause:
    // the route's own 400 is "reference_image_urls is required: it is the
    // product this ad is built from".
    return { ok: false, reason: "product_required" };
  }

  const isImage = kind === "image";
  const log = createFlowLog("recreate", { session: sessionId, user: userId });

  // The hold needs a name and DS's job id does not exist until after the call,
  // so Node mints one — the same reason and the same mechanism as ONB-003.
  const renderId = randomUUID();

  const payment = await secureTemplateAdPayment({
    userId,
    sessionId,
    templateId,
    renderId,
    kind: isImage ? "image" : "video",
    // What the confirmation screen quoted as the wallet's share.
    maxWalletCredits,
  });
  if (!payment.ok) {
    log.info("payment.refused", { template: templateId, reason: payment.reason });
    return {
      ok: false,
      reason: payment.reason,
      quote:
        payment.reason === "price_changed"
          ? {
              wallet: payment.walletAmount,
              allowance: payment.allowanceAmount,
              total: payment.total,
            }
          : undefined,
    };
  }

  const route = isImage ? "images" : "videos";
  const body = {
    // Session-backed. The contract recommends it: the brand context steers the
    // look, and the session is what a failure can be monitored and retried
    // against. It does NOT supply the product — `reference_image_urls` does.
    user_id: userId,
    session_id: sessionId,
    template_id: templateId,
    reference_image_urls: productUrls,
    variations: VARIATIONS,
    // NO `model`. Which model each route renders with is a configuration agreed
    // with DS — Veo 3.1 fast for video, Gemini 3.1 Flash Image for image — and
    // it lives on their deployment, not in our request. See the header note.
    ...(isImage
      ? {
          // The route calls the free-text direction `instruction`; the video
          // route has no equivalent and takes `product_description` instead.
          ...(instruction ? { instruction } : {}),
        }
      : {
          duration_s: VIDEO_DURATION_S,
          ...(instruction ? { product_description: instruction } : {}),
        }),
  };

  log.ds("out", `${route}.from-template`, {
    kind,
    template: templateId,
    refs: productUrls.length,
  });

  const startedAt = Date.now();
  try {
    const { data } = await axios.post(`${baseUrl}/api/v1/${route}/from-template`, body, {
      headers: {
        "Content-Type": "application/json",
        // A fresh key per attempt. Reusing one returns the ORIGINAL job, which
        // on a retry is precisely the failure being retried.
        "Idempotency-Key": randomUUID(),
      },
      timeout: CREATE_TIMEOUT_MS,
    });

    const jobId = data?.job_id;
    if (!jobId) {
      log.error("accept.no_job_id", { template: templateId });
      await undoPayment({ payment, userId, renderId });
      return { ok: false, reason: "upstream_error" };
    }

    // What DS actually chose, which we could not know before the call. Trueing
    // up here rather than at settlement hands the unused hold back in seconds.
    //
    // Skipped when the allowance paid ALL of it: there is no wallet hold to
    // true down, and the budget was spent at the ceiling — which for both
    // routes IS the actual (ONBOARDING_ALLOWANCE.md R2).
    const amount = payment.coveredByAllowance
      ? 0
      : await trueUpTemplateAd({
          renderId,
          frozenAmount: payment.amount,
          allowanceSpent: payment.allowanceSpent,
          meta: data?.meta,
          kind: isImage ? "image" : "video",
        });

    log.ds("in", `${route}.from-template`, {
      kind,
      template: templateId,
      status: data.status || "queued",
      ms: Date.now() - startedAt,
      model: data?.meta?.model || "(default)",
      charged: amount,
      allowance: payment.allowanceSpent,
      paidBy: payment.coveredByAllowance
        ? "allowance"
        : payment.allowanceSpent
          ? "split"
          : "wallet",
    });

    const boardKey = recreateBoardKey(templateId);

    // Before anything else: the webhook refuses a callback for a job it has
    // never seen, and DS can call back faster than the rest of this runs.
    await AiJob.updateOne(
      { jobId },
      {
        $set: { kind: isImage ? "image.from_template" : "video.from_template", userId, sessionId },
        $setOnInsert: { status: data.status || "queued", seq: 0 },
      },
      { upsert: true },
    );

    // Recorded on the session under its own board key, exactly as a storyboard
    // render is. This is what makes the money safe — `settleBoard` finds the
    // billing record from a job id and nothing else — and what makes a reload
    // mid-render find the run instead of an empty screen.
    await markBoardStarted(
      sessionId,
      boardKey,
      jobId,
      {
        renderId: payment.coveredByAllowance ? "" : renderId,
        // `free` here means "no wallet hold exists", which is what every
        // downstream reader keys on. The allowance still paid for it.
        free: Boolean(payment.coveredByAllowance),
        // How much BUDGET this render spent — on a split that is a real number
        // alongside a real wallet charge, not an either/or.
        allowanceSpent: Number(payment.allowanceSpent) || 0,
        amount,
        model: data?.meta?.model || "",
        // What this render was built FROM, so the clip view can name it and a
        // re-render can find its way back to the same template.
        templateId,
        kind: isImage ? "image" : "video",
        // Kept so the finished ad can be labelled with what was asked for —
        // the terminal frame carries no echo of the request.
        instruction: instruction.slice(0, 300),
      },
      1,
      "recreates",
    );

    // An idempotent replay comes back already finished; there is no stream left
    // to attach to.
    if (data.status !== "succeeded" && data.status !== "failed") {
      startJobStreamBridge({ jobId, userId, sessionId });
    }

    return {
      ok: true,
      jobId,
      boardId: boardKey,
      // No reservation exists when the allowance paid, and handing one out
      // would have the webhook try to settle a hold that was never taken.
      renderId: payment.coveredByAllowance ? "" : renderId,
      amount,
      coveredByAllowance: Boolean(payment.coveredByAllowance),
      allowanceSpent: Number(payment.allowanceSpent) || 0,
      meta: data?.meta || {},
    };
  } catch (error) {
    const status = error?.response?.status;
    // The POST failed, so no render exists to pay for.
    await undoPayment({ payment, userId, renderId }).catch((e) =>
      log.error("release.failed", { template: templateId, message: e.message }),
    );
    log.error("create.failed", {
      kind,
      template: templateId,
      status,
      why: error?.response?.data?.error || error.message,
    });
    // 404 on the VIDEO route means this deployment was never shown that
    // template — the contract's "must have been recommended here" rule. Its own
    // reason, because it is not retryable and the user needs a different
    // template rather than a retry button.
    if (status === 404) return { ok: false, reason: "template_unavailable" };
    if (status === 400) return { ok: false, reason: "bad_request" };
    return { ok: false, reason: "upstream_error" };
  }
}

module.exports = {
  startTemplateAdRun,
  recreateBoardKey,
  _internals: { VARIATIONS, VIDEO_DURATION_S },
};
