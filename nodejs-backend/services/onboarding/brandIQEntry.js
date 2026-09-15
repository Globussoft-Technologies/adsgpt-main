// brandIQEntry — the onboarded brand, filed where the user's other brands live.
//
// Onboarding researches a brand thoroughly and then keeps the result on the
// session, which is right for the workspace and wrong for everything after it.
// BrandIQ is the brand library: a brand that is not in it cannot be picked in
// AdCreative, cannot be targeted by AdFactory, and cannot have competitors or
// keywords discovered for it. As far as the rest of the product is concerned,
// a brand that never reached this collection was never created.
//
// So a session whose brand job succeeds also gets a `BrandsList` entry.
//
// ── Two contracts meeting ───────────────────────────────────────────────────
//
// Python's context and our `brandSchema` name almost nothing the same way, and
// the mapping below is the whole of this file. It is deliberately conservative:
// only fields we can fill honestly are filled. `logo_urls`, `image_urls` and
// `color_palette` all come back `null` on a prompt-only run — no site was
// scraped, so there was nothing to take — and writing empty arrays for them
// would make a brand look researched when it was described.
//
// ── Why it is not an upsert on brandName ────────────────────────────────────
//
// The list is one document per user with brands embedded, and a user can
// legitimately onboard the same brand twice (a second run, a corrected prompt).
// Keying on the SESSION is what makes this idempotent without collapsing two
// genuinely different runs into one row: the webhook is at-least-once and the
// SSE bridge delivers the same terminal result again, so this runs more than
// once per brand as a matter of course.

const { randomUUID } = require("node:crypto");
const axios = require("axios");
const FormData = require("form-data");
const { Readable } = require("stream");
const { PutObjectCommand } = require("@aws-sdk/client-s3");
const { s3Client } = require("../../storage/s3");
const BrandsList = require("../../Module/brandNames/brandNamesSchema");
const { createFlowLog } = require("../../utils/flowLog");

// ── Storing scraped media the way BrandIQ stores uploads ─────────────────────
//
// BrandIQ's list API (`controllers/brandNamesList.js`) prefixes EVERY stored
// logo/image with `AWS_IMAGE_VIEW_URL`, because the brand form uploads files and
// stores the root-relative key (`/mybrands/<user>/<folder>/<brand>/<file>`).
// Onboarding used to store the scraped third-party links as-is, which that
// prefix turned into `https://contents.adsgpt.io` + `https://site.com/logo.svg`
// — a broken image on every onboarded brand. So each scraped file is fetched and
// uploaded under the same key layout, via the same S3-or-NAS switch the brand
// form's `uploadToS3` uses, and only the key is stored.
const UPLOAD_TO_S3 = process.env.UPLOAD_TO_S3 === "true";
const NAS_UPLOAD_URL = `${process.env.NEW_NAS_UPLOAD_URL}/ads-gpt-download`;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 8000;
const MAX_LOGOS = 3;
const MAX_IMAGES = 6;

/** File extension for a response content type; null for anything not an image. */
function extensionFor(contentType) {
  const type = String(contentType || "").split(";")[0].trim().toLowerCase();
  if (!type.startsWith("image/")) return null;
  const sub = type.slice("image/".length);
  if (sub === "jpeg" || sub === "jpg") return "jpg";
  if (sub === "svg+xml") return "svg";
  if (sub === "x-icon" || sub === "vnd.microsoft.icon") return "ico";
  return /^[a-z0-9]+$/.test(sub) ? sub : null;
}

/**
 * Fetches one scraped image and stores it like a brand-form upload.
 * Returns the root-relative key, or null when the file could not be taken
 * (blocked, not an image, too large, timed out) — a missing image beats a
 * broken one, so failures are skipped rather than stored.
 */
async function storeRemoteImage({ url, userId, brandId, folder, log }) {
  try {
    const response = await axios.get(url, {
      responseType: "arraybuffer",
      timeout: FETCH_TIMEOUT_MS,
      maxContentLength: MAX_IMAGE_BYTES,
      // Some sites refuse requests without a browser-ish agent.
      headers: { "User-Agent": "Mozilla/5.0 (compatible; AdsGPT-BrandIQ/1.0)" },
    });
    const ext = extensionFor(response.headers["content-type"]);
    if (!ext) {
      log.warn("image.not_image", { url, type: response.headers["content-type"] });
      return null;
    }
    const buffer = Buffer.from(response.data);
    const contentType = String(response.headers["content-type"]).split(";")[0].trim();
    const fileName = `${Date.now()}-${randomUUID()}.${ext}`;
    const key = `mybrands/${userId}/${folder}/${brandId}/${fileName}`;

    if (UPLOAD_TO_S3) {
      await s3Client.send(
        new PutObjectCommand({
          Bucket: process.env.AWS_S3_BUCKET_NAME,
          Key: key,
          Body: buffer,
          ContentType: contentType,
        })
      );
      return `/${key}`;
    }

    // NAS branch — same request shape as brandNamesList's `uploadToS3`.
    const formData = new FormData();
    formData.append("file", Readable.from(buffer), { filename: fileName, contentType });
    formData.append("type", "IMAGE");
    formData.append("userId", key);
    formData.append("download", "false");
    const nas = await axios.post(NAS_UPLOAD_URL, formData, { headers: formData.getHeaders() });
    if (nas.data?.code === 200 && nas.data?.data) return nas.data.data;
    log.warn("image.nas_rejected", { url });
    return null;
  } catch (error) {
    log.warn("image.store_failed", { url, message: error.message });
    return null;
  }
}

/** Stores a list of scraped links; keeps only the ones that made it. */
async function storeRemoteImages({ urls, max, ...rest }) {
  const candidates = [...new Set(urls.filter((u) => /^https?:\/\//i.test(String(u || ""))))].slice(0, max);
  const keys = await Promise.all(candidates.map((url) => storeRemoteImage({ url, ...rest })));
  return keys.filter(Boolean);
}

/** First non-empty string from a list of candidates. */
const firstText = (...values) => {
  for (const v of values) {
    const s = typeof v === "string" ? v.trim() : "";
    if (s) return s;
  }
  return "";
};

/** Upstream returns `null` for these on a prompt-only run; keep arrays only. */
const arrayOr = (value, fallback = []) => (Array.isArray(value) ? value : fallback);

/**
 * Files the onboarded brand into BrandIQ.
 *
 * Returns the brand id when one was written, the existing id when this session
 * has already been filed, or null when there was nothing worth filing.
 *
 * Never throws at the caller. The library copy is a convenience; failing it
 * must not fail the webhook that reports the brand, or upstream retries a job
 * that actually succeeded.
 */
async function fileBrandToBrandIQ({ userId, sessionId, result }) {
  const context = result?.context;
  if (!userId || !context) return null;

  const log = createFlowLog("brandiq", { session: sessionId, user: userId });

  // A brand with no name is not a brand. Onboarding can finish without one on a
  // prompt so thin that nothing could be inferred, and an unnamed row in a
  // picker is worse than an absent one.
  const brandName = firstText(context.brand_name);
  if (!brandName) {
    log.warn("skipped.no_brand_name");
    return null;
  }

  const existing = await BrandsList.findOne(
    { user_id: userId, "brands.onboardingSessionId": sessionId },
    { "brands.$": 1 }
  ).lean();
  if (existing?.brands?.[0]) return existing.brands[0].id;

  const industry = [context.industry_major, context.industry_sub]
    .filter(Boolean)
    .join(" · ");

  const brandId = randomUUID();

  // Scraped media, copied into our storage. Absent on a prompt-only run, and
  // absent is the honest answer there. The logo scrape often repeats inside
  // `image_urls`, so those are dropped from the product images.
  const scrapedLogos = arrayOr(context.logo_urls);
  const scrapedImages = arrayOr(context.image_urls).filter((u) => !scrapedLogos.includes(u));
  const [logoKeys, imageKeys] = await Promise.all([
    storeRemoteImages({ urls: scrapedLogos, max: MAX_LOGOS, userId, brandId, folder: "logos", log }),
    storeRemoteImages({ urls: scrapedImages, max: MAX_IMAGES, userId, brandId, folder: "productimages", log }),
  ]);

  // Re-check after the uploads: they take seconds, and the webhook and the SSE
  // bridge both deliver this result, so another delivery may have filed it.
  const filedMeanwhile = await BrandsList.findOne(
    { user_id: userId, "brands.onboardingSessionId": sessionId },
    { "brands.$": 1 }
  ).lean();
  if (filedMeanwhile?.brands?.[0]) return filedMeanwhile.brands[0].id;

  const brand = {
    id: brandId,
    brandName,
    // `summary` is the paragraph the workspace shows; `description` is
    // upstream's shorter line. Either is a better description than none, and
    // the longer one is what a person recognises the brand by.
    brandDescription: firstText(context.summary, context.description),
    // The site the run was started from, when it was started from one. Not
    // taken from the context: `source_urls` is provenance and belongs to the
    // result, not to the brand profile.
    websiteUrl: firstText(arrayOr(result.source_urls)[0]),
    // Storage keys, not the scraped links — see `storeRemoteImage`.
    logoUrls: logoKeys,
    logoUrl: logoKeys[0] || "",
    imageUrls: imageKeys,
    targetAudiences: arrayOr(context.target_audience).filter(
      (a) => typeof a === "string" && a.trim()
    ),
    // BrandIQ's own taxonomy is one of 45 names in utils/categoryTaxonomy.js.
    // Python's `category` is its own vocabulary and is NOT that list, so this
    // is left null on purpose: the lazy classifier that already exists for
    // brands without a category will fill it with a value the picker can use.
    // Writing Python's word here would look correct and match nothing.
    category: null,
    // Where this brand came from, and the dedupe key. Not on the schema as a
    // declared field — brandSchema is not strict about extras — but it is what
    // makes a redelivered webhook a no-op.
    onboardingSessionId: sessionId,
    source: "onboarding",
    createdAt: new Date(),
  };

  await BrandsList.updateOne(
    { user_id: userId },
    { $push: { brands: brand }, $setOnInsert: { user_id: userId } },
    { upsert: true }
  );

  log.info("filed", {
    brand: brand.id,
    name: brandName,
    industry: industry || "-",
    logos: `${logoKeys.length}/${scrapedLogos.length}`,
    images: `${imageKeys.length}/${scrapedImages.length}`,
  });
  return brand.id;
}

module.exports = { fileBrandToBrandIQ, _internals: { firstText, arrayOr, extensionFor } };
