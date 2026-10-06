// studioImageRender — "Recreate this ad" from a DS image template (Ad Creative
// home gallery → ImageTemplateModal → Generate).
//
// Same DS route and request shape as onboarding's image Recreate
// (services/onboarding/templateAdClient.js), minus the session (decision
// 2026-10-05, ADS-003b):
//
//   POST /api/v1/images/from-template
//   { user_id, template_id, reference_image_urls, variations: 1, watermark,
//     instruction?, product_description }
//
//   · NO model, ratio or resolution — DS's deployment default renders it
//     (Nano Banana 2, the template's own ratio), exactly as onboarding.
//   · Sessionless, so `product_description` is required: the brand's
//     description (studioTemplates.loadBrandContext) takes the session's place.
//
// Price: Nano Banana 2 at the `medium` tier, read from the model config in
// Mongo (product decision: DS renders ~1K, which we price as medium).
//
// Delivery, like onboarding: Node follows the job's own event stream
// (GET /api/v1/jobs/{id}/events) AND accepts DS's callback
// (controllers/Ai/jobWebhookController.js). Whichever terminal arrives first
// finishes the render; updateImageResult's duplicate guard makes the second a
// no-op, so neither can double-charge.
//
// ── Why this goes through imageController rather than around it ───────────
// AdCreative's pipeline already owns everything that has to happen to a
// finished image: the ImageGeneration record My Space lists, the credit
// freeze → settle/release (with its duplicate-callback guard), GeneratedMedia
// rows, and the `imageCreated` socket that turns My Space's loader card into
// the image. So:
//   start  → the same record shape + the same freezeCredits call imageController
//            makes, keyed on the ImageGeneration id;
//   finish → the DS result is mapped into the Python-callback body and handed to
//            imageController.updateImageResult unchanged.
// No credit logic lives here (docs/ai/CONSTRAINTS.md #4). See ADS-R002, ADS-R003.

const axios = require("axios");
const { randomUUID } = require("crypto");
const AiJob = require("../../Module/ai/aiJob");
const ImageGeneration = require("../../Module/imageGeneration/imageModel");
const UnifiedCreditController = require("../../controllers/UnifiedCreditController");
const { createFlowLog } = require("../../utils/flowLog");
const { shouldWatermark } = require("../../utils/watermarkPolicy");
const { loadBrandContext } = require("./studioTemplates");
const { openJobEventStream } = require("../onboarding/onboardingClient");
const { createSseParser } = require("../onboarding/templateBridge");

const CREATE_TIMEOUT_MS = 30_000;

// The model DS renders with (its deployment default — not sent) and how we
// price it. `registryKey` is the model-config key credits are looked up by.
const RENDER_MODEL = {
  dsId: "gemini-3.1-flash-image",
  registryKey: "gemini-3.1-flash-image-preview",
  label: "Nano Banana 2",
};
const RENDER_QUALITY = "medium";

// The stream is a convenience on top of the callback; give up if it goes
// silent this long (same bound as onboarding's bridge).
const STREAM_IDLE_TIMEOUT_MS = 3 * 60 * 1000;
const following = new Set(); // jobIds with a live stream follower

class StudioRenderError extends Error {
  constructor(message, { status = 500, code = "INTERNAL" } = {}) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function resolveBaseUrl() {
  return String(process.env.ONBOARDING_PYTHON_BASE_URL || "").replace(/\/+$/, "");
}

/**
 * What one render costs, from the model config (Mongo, cached at boot).
 * Exposed so the controller can tell the modal the price before Generate.
 */
function renderPrice() {
  return Number(UnifiedCreditController.getModelDeductionByQuality(RENDER_MODEL.registryKey, RENDER_QUALITY)) || 0;
}

/**
 * Starts one render. Called by controllers/adStudio/studioTemplateController.generate
 * with inputs already validated (Validations/adStudio/studioTemplates.validator.js).
 * `userId` comes from the JWT; the brand is looked up under that user.
 *
 * Resolves `{ image }` — the pending ImageGeneration record, the same thing
 * imageController.generateImage returns, so the client hands off to My Space
 * the same way. Throws StudioRenderError on anything the user should hear about.
 */
async function startStudioImageRender({
  userId,
  brandId,
  templateId,
  templateUrl,
  productImageUrls,
  prompt = "",
}) {
  const log = createFlowLog("adstudio.render", { user: userId });

  const baseUrl = resolveBaseUrl();
  if (!baseUrl) throw new StudioRenderError("image service is not configured", { status: 503, code: "NOT_CONFIGURED" });

  // Sessionless from-template requires `product_description`; the brand's
  // description is what stands in for the onboarding session's context.
  const context = await loadBrandContext(userId, brandId);
  if (!context) throw new StudioRenderError("brand not found", { status: 404, code: "BRAND_NOT_FOUND" });
  const productDescription = context.description || String(context.brand.brandName || "").trim();
  if (!productDescription) {
    throw new StudioRenderError("Add a description to this brand in BrandIQ to recreate ads.", {
      status: 422,
      code: "NO_DESCRIPTION",
    });
  }

  // Same fields imageController.buildDbInputs would persist, so My Space cards
  // read this row like any other. Aspect is the template's own (DS decides);
  // the finished image's ratio is written by updateImageResult.
  const image = await ImageGeneration.create({
    userId,
    status: "pending",
    inputs: {
      type: "studio_template",
      model: RENDER_MODEL.registryKey,
      modelLabel: RENDER_MODEL.label,
      quality: RENDER_QUALITY,
      numberOfImages: 1,
      userPrompt: prompt,
      productDescription,
      productImages: productImageUrls,
      referenceImages: [templateUrl],
      instructions: `template:${templateId}`,
    },
  });
  const imageId = image._id.toString();

  // The same freeze imageController.generateImage makes; updateImageResult
  // settles or releases it against this same key.
  const amount = renderPrice();
  // Prices come from the AIModelConfiguration cache loaded at boot
  // (services/modelConfigurationService.js). An empty cache, or a registry key
  // that no longer matches a row there, prices at 0 — and a 0 freeze is a free
  // render. Refuse instead of giving it away.
  if (!(amount > 0)) {
    await ImageGeneration.deleteOne({ _id: imageId });
    log.error("price.missing", { model: RENDER_MODEL.registryKey, quality: RENDER_QUALITY, amount });
    throw new StudioRenderError("Pricing for this model is unavailable right now.", { status: 503, code: "NO_PRICE" });
  }
  const freeze = await UnifiedCreditController.freezeCredits({
    userId,
    reservationKey: imageId,
    amount,
    meta: { service_type: "image_gen", model: RENDER_MODEL.registryKey, imageType: "studio_template", totalImages: 1 },
  });
  if (!freeze.ok) {
    await ImageGeneration.deleteOne({ _id: imageId });
    if (freeze.reason === "NO_BASE_PLAN") {
      throw new StudioRenderError("An active subscription plan is required.", { status: 403, code: "NO_BASE_PLAN" });
    }
    if (freeze.reason === "INSUFFICIENT") {
      throw new StudioRenderError(
        `Insufficient credits. You need ${amount} credits but only have ${freeze.remaining}.`,
        { status: 402, code: "INSUFFICIENT" }
      );
    }
    throw new StudioRenderError("Could not reserve credits. Please try again.", { status: 503, code: "FREEZE_FAILED" });
  }

  // Onboarding's request shape (templateAdClient), sessionless. The user's
  // prompt goes in `instruction` as typed — nothing composed on top.
  //
  // NO `user_id`: DS requires `user_id` and `session_id` TOGETHER or not at all
  // ("user_id and session_id must be given together", 400 — seen live
  // 2026-10-05). Sessionless means neither; `product_description` carries the
  // brand instead. Who the render belongs to is on our AiJob/ImageGeneration rows.
  const body = {
    template_id: templateId,
    reference_image_urls: productImageUrls,
    variations: 1,
    product_description: productDescription,
    // Free plans get the logo, paid plans get a clean image
    // (utils/watermarkPolicy.js). Sent EXPLICITLY, never omitted: DS's own
    // default is ON, so leaving it out brands a paying customer's image.
    watermark: await shouldWatermark(userId),
  };
  if (prompt) body.instruction = prompt;

  let jobId;
  const dsUrl = `${baseUrl}/api/v1/images/from-template`;
  try {
    const response = await axios.post(dsUrl, body, {
      headers: {
        "Content-Type": "application/json",
        // Fresh per attempt (as onboarding): a reused key returns the ORIGINAL job.
        "Idempotency-Key": randomUUID(),
      },
      timeout: CREATE_TIMEOUT_MS,
    });
    jobId = response.data?.job_id;
    if (!jobId) throw new Error("image service returned no job_id");
  } catch (error) {
    await UnifiedCreditController.releaseCredits(imageId);
    await ImageGeneration.deleteOne({ _id: imageId });
    const upstream = error?.response?.data?.error;
    log.error("start.failed", { status: error?.response?.status, message: upstream || error.message });
    const status = error?.response?.status;
    throw new StudioRenderError(upstream || "Could not start the image. Please try again.", {
      status: status === 400 || status === 404 ? status : 502,
      code: "UPSTREAM_FAILED",
    });
  }

  // Recorded before we answer, so the callback can find it. A callback landing
  // in the few ms before this write 404s and DS retries it (non-2xx).
  const job = await AiJob.create({
    jobId,
    kind: "image.from_template",
    userId,
    sessionId: "",
    source: "adstudio",
    refId: imageId,
    status: "queued",
  });
  await ImageGeneration.updateOne({ _id: imageId }, { $set: { status: "processing", taskId: jobId } });

  followJobStream({ job: job.toObject ? job.toObject() : job });

  log.info("started", { job: jobId, image: imageId, credits: amount });
  return { image: { ...image.toObject(), status: "processing", taskId: jobId } };
}

/**
 * Follows the job's event stream and finishes the render on its terminal
 * frame — onboarding's bridge pattern, without onboarding's session writes.
 * Fire-and-forget; the callback is the backup if this never attaches or drops.
 */
function followJobStream({ job }) {
  if (!job?.jobId || following.has(job.jobId)) return;
  following.add(job.jobId);
  const log = createFlowLog("adstudio.render", { user: job.userId, job: job.jobId });

  (async () => {
    let stream;
    try {
      stream = await openJobEventStream(job.jobId);
    } catch (error) {
      log.warn("stream.unavailable", { message: error.message }); // callback still covers it
      return;
    }
    await new Promise((resolve) => {
      let idle = null;
      const done = () => {
        clearTimeout(idle);
        stream.removeAllListeners?.();
        stream.destroy?.();
        resolve();
      };
      const arm = () => {
        clearTimeout(idle);
        idle = setTimeout(() => {
          log.warn("stream.idle_timeout");
          done();
        }, STREAM_IDLE_TIMEOUT_MS);
      };
      arm();
      const feed = createSseParser((event, data) => {
        arm();
        if (event === "done") {
          finishStudioImageRender({
            job,
            status: data?.status || "succeeded",
            result: data?.result,
            error: data?.error,
            via: "stream",
          }).catch((e) => log.error("stream.finish_failed", { message: e.message }));
          done();
        } else if (event === "error") {
          finishStudioImageRender({
            job,
            status: "failed",
            error: data?.message || data?.error || "image generation failed",
            via: "stream",
          }).catch((e) => log.error("stream.finish_failed", { message: e.message }));
          done();
        }
      });
      stream.on("data", feed);
      stream.on("error", (e) => {
        log.warn("stream.errored", { message: e.message });
        done();
      });
      stream.on("end", done);
    });
  })()
    .catch((e) => log.error("stream.crashed", { message: e?.message }))
    .finally(() => following.delete(job.jobId));
}

/**
 * Every finished image file in a DS result, with the take's ratio. Reads both
 * shapes: from-template's nested `{ images: [take{ images:[{url}], input }] }`
 * (or the single `image` take), and the flat `{ images: [{ url }] }`.
 * Same reading as services/onboarding/templateAdResult.js.
 */
function filesOf(result) {
  const takes = Array.isArray(result?.images) ? result.images : result?.image ? [result.image] : [];
  const files = [];
  for (const take of takes) {
    if (take?.url) {
      files.push({ url: take.url, aspectRatio: take.aspect_ratio });
      continue;
    }
    for (const file of Array.isArray(take?.images) ? take.images : []) {
      if (file?.url) files.push({ url: file.url, aspectRatio: file.aspect_ratio || take?.input?.aspect_ratio });
    }
  }
  return files;
}

// DS has returned root-relative temp links before (`/api/v1/images/files/{id}`,
// +10 min). Make them absolute so they at least load, and flag them: a temp link
// in My Space is an ad that silently disappears later (onboarding's assertDurable).
function absoluteUrl(url, log) {
  const raw = String(url || "");
  if (/\/api\/v1\/images\/files\//.test(raw)) log.warn("result.temporary_url", { url: raw.slice(-60) });
  return /^https?:\/\//i.test(raw) ? raw : `${resolveBaseUrl()}${raw.startsWith("/") ? "" : "/"}${raw}`;
}

/**
 * Terminal DS result for an Ad Studio render → imageController.updateImageResult.
 *
 * Called from followJobStream (via "stream") and from
 * controllers/Ai/jobWebhookController.receive (callback) for jobs with
 * `source: "adstudio"`. Maps DS's result into the Python-callback body that
 * handler validates, then calls the handler itself, so settle/release, the
 * duplicate guard, GeneratedMedia and the `imageCreated` socket all run
 * unchanged. Required lazily to keep the webhook controller's load order untouched.
 */
async function finishStudioImageRender({ job, status, result, error, via = "callback" }) {
  const log = createFlowLog("adstudio.render", { user: job.userId, job: job.jobId });
  const imageController = require("../../controllers/imageController");

  const record = await ImageGeneration.findById(job.refId).select("inputs.model").lean();
  if (!record) {
    log.error("finish.no_record", { image: job.refId });
    return;
  }

  const files = filesOf(result);
  const succeeded = status === "succeeded" && files.length > 0;
  const takeMs = Array.isArray(result?.images) ? result.images[0]?.time_taken_s : result?.image?.time_taken_s;
  const totalMs = Math.round((Number(takeMs ?? result?.time_taken_s) || 0) * 1000);
  const now = new Date().toISOString();

  const payload = {
    taskId: job.jobId,
    userId: job.userId,
    sessionId: job.refId,
    creativeType: "studio_template",
    model: record.inputs?.model,
    type: "image",
    status: succeeded ? "completed" : "failed",
    error: succeeded ? null : String(error || result?.error || "Image generation failed"),
    images: succeeded
      ? files.map((f) => ({ generatedImageUrl: absoluteUrl(f.url, log), aspectRatio: f.aspectRatio || undefined }))
      : [],
    timing: { generationMs: totalMs, s3UploadMs: 0, totalMs },
    queuedAt: (job.createdAt ? new Date(job.createdAt) : new Date()).toISOString(),
    completedAt: now,
  };

  // updateImageResult is an express handler; capture what it would have sent.
  const outcome = { code: 200, body: null };
  const res = {
    status(code) {
      outcome.code = code;
      return this;
    },
    json(body) {
      outcome.body = body;
      return this;
    },
  };
  await imageController.updateImageResult({ body: payload, params: {} }, res);

  if (outcome.code >= 400) {
    log.error("finish.rejected", { code: outcome.code, error: outcome.body?.error, via });
  } else {
    log.info("finished", { image: job.refId, status: payload.status, duplicate: Boolean(outcome.body?.duplicate), via });
  }
  return outcome;
}

module.exports = {
  startStudioImageRender,
  finishStudioImageRender,
  renderPrice,
  StudioRenderError,
  RENDER_MODEL,
  RENDER_QUALITY,
  _internals: { filesOf, followJobStream, following },
};
