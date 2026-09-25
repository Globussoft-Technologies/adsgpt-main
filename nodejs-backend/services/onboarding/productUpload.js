// productUpload — the user's product photo, from a multipart upload to an
// ABSOLUTE url DS can fetch.
//
// Why this exists at all: `reference_image_urls` on both from-template routes
// takes absolute http(s) urls, and a browser upload is a Buffer. Something has
// to put the bytes somewhere public and hand back a link.
//
// Why it is not one of the three uploaders we already have: each of those
// returns a STORAGE KEY (`/mybrands/…`), which every caller then prefixes with
// `AWS_IMAGE_VIEW_URL` at render time. A key is useless to DS — it will fetch
// what it is given. So this stores through the same switch and the same key
// layout, and resolves the key before returning it.
//
// Deliberately the same `UPLOAD_TO_S3` switch, bucket and NAS endpoint as
// `brandIQEntry.storeRemoteImage` / `brandNamesList.uploadToS3`: a fourth
// storage convention in one module is how files end up somewhere nobody can
// find them later.

const axios = require("axios");
const FormData = require("form-data");
const { Readable } = require("node:stream");
const { randomUUID } = require("node:crypto");
const { PutObjectCommand } = require("@aws-sdk/client-s3");
const { s3Client } = require("../../storage/s3");

const UPLOAD_TO_S3 = process.env.UPLOAD_TO_S3 === "true";
const NAS_UPLOAD_URL = `${process.env.NEW_NAS_UPLOAD_URL}/ads-gpt-download`;

// A product photo, not a print master. Multer already caps the request; this is
// the second line, and it is what keeps a 30MB phone photo out of a render
// DS has to download before it can start.
const MAX_BYTES = 10 * 1024 * 1024;

// Only what an image model can actually read. A PDF or an HEIC named .jpg
// reaches DS as a fetch that succeeds and a render that fails with something
// unhelpful, so it is refused here where the message can be plain.
const EXTENSION_FOR = Object.freeze({
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/webp": "webp",
});

/** Absolute url for a stored key, or "" when the media base is unconfigured. */
function absolutise(keyOrUrl) {
  const value = String(keyOrUrl || "");
  if (!value) return "";
  // The NAS branch already answers with an absolute url.
  if (/^https?:\/\//i.test(value)) return value;
  const base = (process.env.AWS_IMAGE_VIEW_URL || "").replace(/\/+$/, "");
  if (!base) return "";
  return `${base}${value.startsWith("/") ? "" : "/"}${value}`;
}

/**
 * Put bytes somewhere public and answer with an absolute url.
 *
 * The one place in onboarding that touches storage. Both callers — the product
 * upload below and the finished ad in `templateAdResult` — go through it, so
 * there is one key layout, one S3/NAS switch, and one place to look when a file
 * is not where somebody expected.
 *
 * Returns `{ ok: true, url }` or `{ ok: false, reason }`; never throws.
 */
async function storeBuffer({ buffer, mime, key, fileName, log }) {
  try {
    if (UPLOAD_TO_S3) {
      await s3Client.send(
        new PutObjectCommand({
          Bucket: process.env.AWS_S3_BUCKET_NAME,
          Key: key,
          Body: buffer,
          ContentType: mime,
        }),
      );
      const url = absolutise(`/${key}`);
      // A stored object nobody can address is worse than a refused upload.
      if (!url) {
        log?.error?.("store.no_media_base", { key });
        return { ok: false, reason: "not_configured" };
      }
      return { ok: true, url };
    }

    const formData = new FormData();
    formData.append("file", Readable.from(buffer), { filename: fileName, contentType: mime });
    formData.append("type", "IMAGE");
    formData.append("userId", key);
    formData.append("download", "false");
    const nas = await axios.post(NAS_UPLOAD_URL, formData, { headers: formData.getHeaders() });
    if (nas.data?.code === 200 && nas.data?.data) {
      return { ok: true, url: absolutise(nas.data.data) };
    }
    log?.warn?.("store.nas_rejected", { key });
    return { ok: false, reason: "upload_failed" };
  } catch (error) {
    log?.error?.("store.failed", { key, message: error.message });
    return { ok: false, reason: "upload_failed" };
  }
}

/**
 * Stores one uploaded product image and returns an absolute url.
 *
 * Returns `{ ok: true, url }` or `{ ok: false, reason }`. Never throws — the
 * caller has not spent anything yet and must be able to answer 400 rather than
 * 500.
 *
 * `file` is a multer memory-storage file: `{ buffer, mimetype, originalname }`.
 */
async function storeProductImage({ file, userId, sessionId, log }) {
  const mime = String(file?.mimetype || "").split(";")[0].trim().toLowerCase();
  const ext = EXTENSION_FOR[mime];
  if (!ext) return { ok: false, reason: "unsupported_type" };
  if (!file?.buffer?.length) return { ok: false, reason: "empty_file" };
  if (file.buffer.length > MAX_BYTES) return { ok: false, reason: "too_large" };

  const fileName = `${Date.now()}-${randomUUID()}.${ext}`;
  // Under the session, not the brand: this image belongs to one recreate, and
  // filing it beside the brand's own assets would put a user's product photo
  // into BrandIQ's listing.
  const key = `onboarding/${userId}/recreate/${sessionId}/${fileName}`;

  return storeBuffer({ buffer: file.buffer, mime, key, fileName, log });
}

module.exports = {
  storeProductImage,
  storeBuffer,
  _internals: { EXTENSION_FOR, MAX_BYTES, absolutise },
};
