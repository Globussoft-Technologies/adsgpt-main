// onboardingPush — which onboarding jobs are worth waking a phone for.
//
// Onboarding already reports everything over the socket, which is enough for a
// browser tab and for an app held open in the foreground. It is not enough for
// an app that has been backgrounded or closed, and onboarding is full of waits
// long enough that people do exactly that: a clip takes 40-60 seconds, and the
// natural thing to do with a minute is to look at something else.
//
// So this maps a finished job to an FCM notification, or to `null` for "say
// nothing". The channel is `services/push/notifyUser`, the same dispatcher Ad
// Studio's image and video callbacks use.
//
// ── Why only three kinds ──────────────────────────────────────────────────
// An onboarding run produces brand research, a template list, three
// storyboards, their keyframes, and then whatever the user generates. Pushing
// each of those is five or six buzzes for one sitting, which trains people to
// turn the whole thing off — and the early ones are not even worth it: the
// user is watching the thinking screen while they happen.
//
// What is worth it is the work the user STARTS and then waits on (product
// decision 2026-10-12):
//
//   video.generate      a storyboard concept rendered into a clip   40-60s
//   video.from_template a recreate rendered as video                40-60s
//   image.from_template a recreate rendered as an image             ~15s
//
// The image is short enough to argue about. It is in because it is the same
// button to the user — "recreate this ad" — and a notification that depends on
// which output format they picked is harder to explain than one that does not.
//
// Everything else — `onboarding.init`, `template.recommend`,
// `storyboard.generate`, `storyboard.images.generate` — is deliberately
// silent. `storyboard.images.generate` doubly so: it is the keyframe RECOVERY
// job, so pushing it would buzz about a repair the user never knew was needed.

/** Jobs a push may be sent for. Everything else is silent by default. */
const PUSHABLE = new Set(["video.generate", "video.from_template", "image.from_template"]);

const isVideo = (kind) => String(kind || "").startsWith("video.");

/**
 * The notification for a finished onboarding job, or `null` for silence.
 *
 * Terminal events only — the caller must not pass progress. A push per
 * progress tick would buzz a pocket a dozen times per render.
 *
 * @param {object} job
 * @param {string} job.kind      AiJob kind, e.g. `video.generate`.
 * @param {string} job.status    `succeeded` | `failed`.
 * @param {string} job.sessionId Onboarding session, for the deep link.
 * @param {string} job.jobId
 * @returns {{title: string, body: string, data: object} | null}
 */
function pushForJob({ kind, status, sessionId, jobId } = {}) {
  if (!PUSHABLE.has(String(kind || ""))) return null;
  // No session, no deep link — and no onboarding job, either. Every kind above
  // is session-scoped, so an absent one means this is not what we think it is.
  if (!sessionId) return null;

  const succeeded = status === "succeeded";
  const failed = status === "failed";
  // Anything that is neither is not terminal, whatever the caller believed.
  if (!succeeded && !failed) return null;

  const video = isVideo(kind);

  // The app reads these on tap. `type: "onboarding"` is what tells it to open
  // the session rather than the Ad Studio library — Ad Studio's own pushes
  // send `type: "video"` / `type: "image"` with a media id, and an onboarding
  // render has no library row to point at yet.
  const data = {
    type: "onboarding",
    kind,
    status,
    session_id: sessionId,
    job_id: jobId || "",
  };

  if (succeeded) {
    return video
      ? { title: "Video ready 🎬", body: "Your ad video is ready. Tap to view it.", data }
      : { title: "Image ready 🎨", body: "Your ad image is ready. Tap to view it.", data };
  }

  // Ad Studio stays quiet on failure. Onboarding does not, by request
  // (2026-10-12), and the reason it is right here is the reason the push
  // exists at all: this user left the app during a render. Silence means they
  // come back later to an empty card and no idea what happened, having already
  // waited. A failed render is never charged, so there is nothing alarming to
  // say — only that it is worth another go.
  return {
    title: video ? "Video didn’t render" : "Image didn’t render",
    body: "Something went wrong generating your ad. Tap to try again.",
    data,
  };
}

module.exports = { pushForJob, _internals: { PUSHABLE } };
