/**
 * Media URL resolution for onboarding results — the one copy of it.
 *
 * Upstream returns every image path root-relative (`/creatives/…`,
 * `/api/v1/storyboards/images/…`). Put one of those straight into an `<img
 * src>` and the browser resolves it against OUR origin, where nothing of the
 * sort exists — the storyboard cards render as empty boxes.
 *
 * This used to live inside `controllers/onboarding/onboardingInitController.js`
 * and therefore applied to ONE path: `GET /sessions/:id`. The socket emit in
 * the webhook controller sent the raw upstream result, with no `src` on any
 * frame, so a client that got its storyboards live showed empty boxes until a
 * reload made it re-read the session. Same data, two shapes — which is why it
 * is a shared module now and both paths call it.
 */

/**
 * Turns one image object's relative paths into absolute URLs and adds `src`.
 *
 * `url` (the creatives CDN) is preferred over `local_url` (a 24h cache in front
 * of the onboarding service) deliberately: the cache expires, so preferring it
 * meant sessions rendering fine and then going to broken images hours later.
 */
function absolutise(image) {
  if (!image || typeof image !== "object") return image;

  const apiBase = (process.env.ONBOARDING_PYTHON_BASE_URL || "").replace(/\/+$/, "");
  const mediaBase = (process.env.AWS_IMAGE_VIEW_URL || "").replace(/\/+$/, "");

  const join = (base, path) => {
    if (!path) return "";
    if (/^https?:\/\//i.test(path)) return path; // already absolute upstream
    return base ? `${base}${path.startsWith("/") ? "" : "/"}${path}` : "";
  };

  const local = join(apiBase, image.local_url);
  const remote = join(mediaBase, image.url);

  return {
    ...image,
    // A single field the client can render without knowing any of the above.
    // Empty string when neither link resolves, so the UI shows a placeholder
    // rather than a broken image.
    src: remote || local || "",
    local_url_absolute: local || undefined,
    url_absolute: remote || undefined,
  };
}

/** Walks a storyboards result and absolutises every frame. */
function resolveStoryboardMedia(result) {
  const boards = result?.storyboards;
  if (!Array.isArray(boards)) return result;
  return {
    ...result,
    storyboards: boards.map((board) => ({
      ...board,
      images: Array.isArray(board.images) ? board.images.map(absolutise) : [],
    })),
  };
}

/**
 * Walks a videos result and absolutises every clip.
 *
 * Two things differ from a keyframe and both matter:
 *
 *   • A clip can be `ready` with an EMPTY `url`. The durable media-store upload
 *     runs after the render lands, so for a window of seconds the only working
 *     link is `local_url`. Preferring `url` and stopping there would show the
 *     user a finished tile that does not play.
 *
 *   • `poster` is a still PNG served from the VIDEO route, so it resolves
 *     through the same joiner but must not be mistaken for the clip itself. It
 *     is what the player shows before the first frame decodes.
 */
/**
 * Picks the link that will actually PLAY.
 *
 * `absolutise` prefers the durable media store over this API's own copy, which
 * is right for keyframes and right for clips in principle. In practice upstream
 * has been observed returning a durable `url` ending `.webp` for a clip whose
 * `mime_type` is `video/mp4` — the still's path, written onto the video row.
 * Handing that to a `<video>` produces a player that loads nothing, with no
 * error to explain it, while the working mp4 sat in `local_url` the whole time.
 *
 * So the durable link is preferred only when it does not look like an image.
 * The check is deliberately narrow: an unknown or extension-less path is
 * assumed fine, because a media store is entitled to serve a clip from a URL
 * that says nothing about its type. Only a link that positively claims to be a
 * picture is rejected.
 */
const IMAGE_EXTENSION = /\.(webp|png|jpe?g|gif|avif|bmp|svg)(?:[?#]|$)/i;

function preferPlayable(video) {
  const durable = video.url_absolute || "";
  const local = video.local_url_absolute || "";

  // `mime_type` beats the extension, and has to. Upstream stores these clips at
  // paths ending `.webp` while serving them as `Content-Type: video/mp4` — the
  // durable link IS the video, wearing the wrong extension. The extension check
  // below was written for the opposite case (a still's path written onto the
  // video row) and, on this data, throws the only working link away and falls
  // through to a `local_url` that 404s: a player that loads nothing, with no
  // error to explain it. When upstream tells us the type, believe it.
  const declaredVideo = /^video\//i.test(String(video.mime_type || ""));
  if (durable && declaredVideo) return durable;

  if (durable && !IMAGE_EXTENSION.test(durable)) return durable;
  if (local) return local;
  // Nothing else to offer. A wrong-looking durable link still beats no link:
  // the media store may simply be serving an mp4 from an oddly named path, and
  // a player that fails is more debuggable than a tile that stays blank.
  return durable;
}

function resolveVideoMedia(result) {
  const videos = result?.videos;
  if (!Array.isArray(videos)) return result;
  return {
    ...result,
    videos: videos.map((item) => {
      const video = item?.video;
      if (!video || typeof video !== "object") return item;
      // `absolutise` already prefers `url` over `local_url`, already leaves an
      // upstream-absolute link alone, and already falls back to "" — the exact
      // three rules a clip needs. Reused rather than re-derived so the two media
      // paths cannot drift apart.
      const resolved = absolutise(video);
      const src = preferPlayable(resolved);
      return {
        ...item,
        video: {
          ...resolved,
          src,
          // `playable` is the question the UI actually asks, and it is not the
          // same as `status === "ready"`: a ready clip whose durable upload has
          // not landed and whose local copy has expired has nothing to play.
          playable: resolved.status === "ready" && Boolean(src),
        },
      };
    }),
  };
}

/** Template previews are service-relative in the same way frames are. */
function resolveTemplateMedia(result) {
  const templates = result?.templates;
  if (!Array.isArray(templates)) return result;
  const apiBase = (process.env.ONBOARDING_PYTHON_BASE_URL || "").replace(/\/+$/, "");
  return {
    ...result,
    templates: templates.map((t) => ({
      ...t,
      preview_url:
        t.preview_path && !/^https?:\/\//i.test(t.preview_path)
          ? `${apiBase}/${String(t.preview_path).replace(/^\/+/, "")}`
          : t.preview_path || "",
    })),
  };
}

/**
 * Resolves whichever media a result of this `kind` carries.
 *
 * Kind-driven rather than shape-sniffing so a result that happens to contain a
 * `templates` array for some other reason is left alone. Unknown kinds — the
 * brand job included — pass through untouched.
 */
function resolveResultMedia(kind, result) {
  if (!result || typeof result !== "object") return result;
  const k = String(kind || "");
  if (k.startsWith("storyboard.")) return resolveStoryboardMedia(result);
  if (k === "video.generate") return resolveVideoMedia(result);
  if (k === "template.recommend") return resolveTemplateMedia(result);
  return result;
}

module.exports = {
  absolutise,
  resolveVideoMedia,
  resolveStoryboardMedia,
  resolveTemplateMedia,
  resolveResultMedia,
};
