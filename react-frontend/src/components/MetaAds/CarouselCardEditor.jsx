/**
 * CarouselCardEditor — the multi-card Ad-step editor behind Meta's carousel.
 *
 * Lives outside CreateCampaignWizardV2.jsx deliberately: that file is already
 * ~4600 lines, and this editor is the piece dynamic creative and asset feed
 * are both expected to build on, so it wants its own surface.
 *
 * Card shape (wizard form state, NOT the Meta payload):
 *   { id, mediaType, imageFile, imageUrl, videoFile, videoUrl,
 *     videoThumbnailUrl, headline, description, link }
 *
 * `id` is a client-side key only. It exists so the launch handler can cache
 * each card's uploaded media against a stable key and skip re-uploading it on
 * a retry — reordering or removing a card must not invalidate its siblings'
 * uploads. Never sent to Meta.
 */

import React, { useState, useMemo, useEffect } from 'react';
import {
  Plus,
  Trash2,
  ChevronDown,
  ChevronUp,
  ArrowUp,
  ArrowDown,
  Image as ImageIcon,
  Video as VideoIcon,
  Link2,
} from 'lucide-react';
import { TextField, ImageField, VideoField, SegButton, FieldShell } from './wizardFields';
import LibraryPicker from './LibraryPicker';

let cardSeq = 0;
export const newCard = (over = {}) => ({
  id: `card-${Date.now()}-${(cardSeq += 1)}`,
  mediaType: 'image',
  imageFile: null,
  imageUrl: null,
  videoFile: null,
  videoUrl: null,
  videoThumbnailUrl: null,
  headline: '',
  description: '',
  link: '',
  ...over,
});

/**
 * Strip a URL down to something that fits a badge — "example.com/spring" from
 * "https://example.com/spring?utm_source=fb". Falls back to the raw string for
 * anything unparseable, since the field is free text and may be mid-typing.
 */
const shortUrl = (url) => {
  const raw = String(url || '').trim();
  if (!raw) return '';
  try {
    const u = new URL(raw);
    const path = u.pathname === '/' ? '' : u.pathname;
    return `${u.host.replace(/^www\./, '')}${path}`;
  } catch {
    return raw.replace(/^https?:\/\//, '');
  }
};

/** A card counts as having media once either source is set. */
/**
 * CardThumb — a card's thumbnail, including media that has only been picked,
 * not yet uploaded.
 *
 * THE BUG THIS FIXES: the thumbnail read `card.imageUrl` and ignored
 * `card.imageFile`, so a card filled through Upload / URL rendered a grey
 * placeholder in its collapsed row and in the "Image selected" panel. The
 * image was visible ONLY inside the open Upload / URL panel, which has its own
 * preview — so the upload looked like it had silently failed, and switching
 * tabs looked like what "fixed" it. Library picks set `imageUrl` and were
 * unaffected, which is why only uploads showed the symptom.
 *
 * A separate component rather than a value in the parent so the blob URL can
 * be memoised on the File identity. Deriving it in the parent would rebuild
 * every URL on each keystroke in a headline field (patch returns a new array),
 * flickering every thumbnail in the list — the same trap ImageField documents.
 *
 * Video files get no blob preview: a video blob in an <img> renders nothing.
 * They fall back to `videoThumbnailUrl`, then the icon.
 */
function CardThumb({ card, className, iconClassName }) {
  const isVideo = card?.mediaType === 'video';
  const file = isVideo ? null : card?.imageFile;
  const src = useMemo(() => {
    if (file) return URL.createObjectURL(file);
    return (isVideo ? card?.videoThumbnailUrl : card?.imageUrl) || null;
  }, [file, isVideo, card?.videoThumbnailUrl, card?.imageUrl]);
  useEffect(() => {
    if (!src?.startsWith('blob:')) return undefined;
    return () => URL.revokeObjectURL(src);
  }, [src]);

  if (src) return <img src={src} alt="" className={className} />;
  const Icon = isVideo ? VideoIcon : ImageIcon;
  return <Icon className={iconClassName} />;
}

export const cardHasMedia = (card) =>
  card?.mediaType === 'video'
    ? !!(card.videoFile || card.videoUrl)
    : !!(card.imageFile || card.imageUrl);

// Meta's own guidance on card count, which its API does NOT enforce — both
// of these launch clean and then underperform, so the only place a user can
// learn them is here.
//
// The ceiling was verified live against the API (2026-09-09) rather than
// taken from the docs, which disagree with each other: the
// ad-creative-link-data reference claims 2-5 unless `multi_share_optimized`
// is set. That is wrong. 11 cards is rejected with "(#105) param
// child_attachments has too many elements" whether the flag is on or off,
// and 10 passes either way — the flag changes card ORDER, never the limit.
function cardCountHint(count, max) {
  const base = `${count} of ${max} cards · shown left-to-right in this order`;
  // "You should use at least 3 objects for optimal performance; 2 objects is
  // for enabling lightweight integrations and using 2 objects can result in
  // sub-optimal campaign results." — Meta's carousel guide.
  if (count <= 2) return `${base} · Meta suggests at least 3 for better results`;
  // "You can add up to 10 products and Facebook will automatically select the
  // best performing 5 to show in the ad." — Meta's own carousel_ad.py sample.
  // Not verifiable through the API (it is a delivery behaviour, invisible to
  // creative validation), so this is worded as Meta's claim, not ours.
  if (count > 5) return `${base} · above 5, Meta shows the best-performing 5`;
  return base;
}

export default function CarouselCardEditor({
  cards = [],
  onChange,
  min = 2,
  max = 10,
  // Cell-level media lock. Video-only cells are never carousel-eligible, so in
  // practice this is 'any' or 'image'.
  mediaKind = 'any',
  // Per-card errors keyed by index: { 0: { media: '…', link: '…' } }
  cardErrors = {},
  // Which cards may SHOW those errors, by index. A card the user just added is
  // empty by definition, so validating it on sight paints a red "Upload an
  // image or pick one from the library" the instant they click Add — QA
  // reported exactly that. The wizard reveals a card when a failed Continue
  // touches it; interacting with the card reveals it too. Mirrors the wizard's
  // own `touched` rule, which the per-card errors were bypassing.
  revealedCards = [],
  // Shown under the list when the *set* is wrong (too few cards, etc.)
  error,
  // Edit mode: the creative's media is reused as-is (it is never re-uploaded),
  // so the pickers are hidden and cards can't be added, removed or reordered —
  // only copy and links are editable. Matches how single-media edit behaves.
  mediaLocked = false,
}) {
  const [expandedId, setExpandedId] = useState(cards[0]?.id || null);
  const [libraryModeById, setLibraryModeById] = useState({});
  // Which cards are showing the full media grid. A card with media already
  // picked collapses to a thumbnail: the grid is ~300px of tiles, and leaving
  // it open pushed the headline/description/link fields AND the "Add card"
  // button below the fold. QA's report was literally "where is the add more
  // option?" followed by "after adding two images it's very confusing for the
  // user what to do".
  //
  // Collapsing the PICKER rather than the whole card is the point: collapsing
  // the card was the first suggestion and it's wrong — the text fields are
  // still unfilled at that moment, so it hides the next thing to do.
  const [browsingById, setBrowsingById] = useState({});

  // Cards the user has actually put something into. `add` deliberately does
  // NOT mark the new card — that is the whole point — while `patch` does, so
  // a card given a headline but no image still surfaces its media error.
  const [interactedById, setInteractedById] = useState({});

  const imageOnly = mediaKind === 'image';

  const patch = (index, changes) => {
    const target = cards[index];
    if (target) setInteractedById((p) => ({ ...p, [target.id]: true }));
    onChange(cards.map((c, i) => (i === index ? { ...c, ...changes } : c)));
  };

  const add = () => {
    if (cards.length >= max) return;
    const card = newCard();
    onChange([...cards, card]);
    setExpandedId(card.id);
    // Explicit so a new card can't inherit a stale collapsed picker.
    setBrowsingById((p) => ({ ...p, [card.id]: true }));
  };

  const remove = (index) => {
    // Meta's floor is `min`; below it the ad isn't a carousel any more.
    if (cards.length <= min) return;
    onChange(cards.filter((_, i) => i !== index));
  };

  const move = (index, delta) => {
    const target = index + delta;
    if (target < 0 || target >= cards.length) return;
    const next = [...cards];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };

  return (
    <FieldShell
      label="Carousel cards"
      required
      error={error}
      hint={mediaLocked
        ? `${cards.length} cards · media can't be changed here — edit the text and links`
        : cardCountHint(cards.length, max)}
    >
      <div className="flex flex-col gap-2">
        {/* Add is duplicated at the top because the bottom button sits below
            the expanded card and scrolls out of reach — QA's report was
            "where is the add more option?". Header placement keeps it in view
            whichever card is open. */}
        {!mediaLocked && cards.length < max && (
          <div className="flex justify-end">
            <button
              type="button"
              onClick={add}
              className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-2.5 py-1 text-11 font-semibold text-gray-600 transition-colors hover:border-gray-300 hover:text-gray-900 dark:border-white/10 dark:text-white/60 dark:hover:text-white"
            >
              <Plus className="h-3 w-3" />
              Add card
            </button>
          </div>
        )}
        {cards.map((card, index) => {
          const expanded = expandedId === card.id;
          const showErrs = !!revealedCards[index] || !!interactedById[card.id];
          const errs = showErrs ? cardErrors[index] || {} : {};
          const hasError = Object.keys(errs).length > 0;
          const libraryMode = libraryModeById[card.id] !== false;
          // Media is picked once, then the grid stops earning its height.
          const hasPicked = !!(card.imageUrl || card.videoUrl || card.imageFile || card.videoFile);
          const browsing = browsingById[card.id] ?? !hasPicked;

          return (
            <div
              key={card.id}
              className={`rounded-2xl border transition-colors ${
                hasError
                  ? 'border-red-400/50 dark:border-red-400/40'
                  : 'border-gray-200 dark:border-white/10'
              } bg-gray-50 dark:bg-white/3`}
            >
              {/* ── header row ── */}
              <div className="flex items-center gap-3 p-3">
                <div className="flex h-11 w-16 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-gray-200 bg-gray-100 dark:border-white/10 dark:bg-[#1e1e1e]">
                  <CardThumb
                    card={card}
                    className="h-full w-full object-cover"
                    iconClassName="h-4 w-4 text-gray-400 dark:text-white/25"
                  />
                </div>

                <button
                  type="button"
                  onClick={() => setExpandedId(expanded ? null : card.id)}
                  className="flex min-w-0 flex-1 items-center gap-2 text-left"
                >
                  <span className="shrink-0 rounded-md bg-gray-200 px-1.5 py-0.5 text-10 font-bold text-gray-600 dark:bg-white/10 dark:text-white/60">
                    {index + 1}
                  </span>
                  <span className="truncate text-13 font-medium text-gray-900 dark:text-white">
                    {card.headline || <span className="text-gray-400 dark:text-white/35">Untitled card</span>}
                  </span>
                  {!cardHasMedia(card) && (
                    <span className="shrink-0 rounded-md bg-amber-100 px-1.5 py-0.5 text-10 font-semibold text-amber-700 dark:bg-amber-400/10 dark:text-amber-300">
                      No media
                    </span>
                  )}
                  {/* Where this card actually goes. Without it the collapsed
                      list shows no destination at all, and the ad-level URL
                      below the cards reads as though every card shares it. */}
                  <span
                    className="hidden shrink-0 items-center gap-1 text-10 text-gray-400 sm:flex dark:text-white/35"
                    title={
                      card.link
                        ? `This card links to ${card.link}`
                        : "Uses the ad's default destination URL"
                    }
                  >
                    <Link2 className="h-2.5 w-2.5 shrink-0" />
                    <span className="max-w-32 truncate">
                      {card.link ? shortUrl(card.link) : 'Default link'}
                    </span>
                  </span>
                </button>

                <div className="flex shrink-0 items-center gap-1">
                  {!mediaLocked && (
                  <>
                  <button
                    type="button"
                    onClick={() => move(index, -1)}
                    disabled={index === 0}
                    title="Move left"
                    className="flex h-7 w-7 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-gray-200 hover:text-gray-700 disabled:cursor-not-allowed disabled:opacity-30 dark:text-white/40 dark:hover:bg-white/10 dark:hover:text-white"
                  >
                    <ArrowUp className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => move(index, 1)}
                    disabled={index === cards.length - 1}
                    title="Move right"
                    className="flex h-7 w-7 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-gray-200 hover:text-gray-700 disabled:cursor-not-allowed disabled:opacity-30 dark:text-white/40 dark:hover:bg-white/10 dark:hover:text-white"
                  >
                    <ArrowDown className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => remove(index)}
                    disabled={cards.length <= min}
                    title={
                      cards.length <= min
                        ? `A carousel needs at least ${min} cards`
                        : 'Remove card'
                    }
                    className="flex h-7 w-7 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-30 dark:text-white/40 dark:hover:bg-red-500/10 dark:hover:text-red-400"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                  </>
                  )}
                  <button
                    type="button"
                    onClick={() => setExpandedId(expanded ? null : card.id)}
                    className="flex h-7 w-7 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-gray-200 hover:text-gray-700 dark:text-white/40 dark:hover:bg-white/10 dark:hover:text-white"
                  >
                    {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                  </button>
                </div>
              </div>

              {/* ── expanded body ──
                  Only the open card mounts a LibraryPicker; ten of them at
                  once would each fetch the media library on mount. */}
              {expanded && (
                <div className="flex flex-col gap-3 border-t border-gray-200 p-3 dark:border-white/10">
                  {mediaLocked ? (
                    <div className="flex items-center gap-3 rounded-2xl border border-gray-200 bg-white p-3 dark:border-white/10 dark:bg-white/3">
                      <div className="flex h-16 w-24 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-gray-200 bg-gray-100 dark:border-white/10 dark:bg-[#1e1e1e]">
                        <CardThumb
                          card={card}
                          className="h-full w-full object-cover"
                          iconClassName="h-5 w-5 text-gray-400 dark:text-white/25"
                        />
                      </div>
                      <div className="text-12 text-gray-600 dark:text-white/55">
                        {card.mediaType === 'video' ? 'Current video' : 'Current image'} · reused as-is
                      </div>
                    </div>
                  ) : (
                  <>
                  <div className="flex items-stretch gap-2 max-w-xs">
                    <SegButton
                      active={libraryMode}
                      onClick={() => setLibraryModeById((p) => ({ ...p, [card.id]: true }))}
                    >
                      From library
                    </SegButton>
                    <SegButton
                      active={!libraryMode}
                      onClick={() => setLibraryModeById((p) => ({ ...p, [card.id]: false }))}
                    >
                      Upload / URL
                    </SegButton>
                  </div>

                  {libraryMode ? (
                    !browsing ? (
                      // Picked state — thumbnail + Change, ~64px instead of the
                      // grid's ~300px. What the user needs next (the text
                      // fields, and the Add card button below the list) is now
                      // on screen instead of scrolled past.
                      <div className="flex items-center gap-3 rounded-2xl border border-gray-200 bg-white p-3 dark:border-white/12 dark:bg-white/4">
                        <div className="flex h-12 w-20 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-gray-200 bg-gray-100 dark:border-white/10 dark:bg-[#1e1e1e]">
                          <CardThumb
                            card={card}
                            className="h-full w-full object-cover"
                            iconClassName="h-4 w-4 text-gray-400 dark:text-white/25"
                          />
                        </div>
                        <div className="min-w-0 flex-1 text-12 text-gray-600 dark:text-white/55">
                          {card.mediaType === 'video' ? 'Video selected' : 'Image selected'}
                        </div>
                        <button
                          type="button"
                          onClick={() => setBrowsingById((p) => ({ ...p, [card.id]: true }))}
                          className="shrink-0 rounded-lg border border-gray-200 px-2.5 py-1 text-11 font-semibold text-gray-600 transition-colors hover:border-gray-300 hover:text-gray-900 dark:border-white/10 dark:text-white/60 dark:hover:text-white"
                        >
                          Change
                        </button>
                      </div>
                    ) : (
                    <div className="scrollbar-thin max-h-72 overflow-y-auto rounded-2xl border border-gray-200 bg-white p-3 dark:border-white/12 dark:bg-white/4">
                      <LibraryPicker
                        type={imageOnly ? 'image' : 'all'}
                        selectedUrl={card.mediaType === 'video' ? card.videoUrl : card.imageUrl}
                        onPick={(absoluteUrl, doc) => {
                          // Kind is derived from the picked item, and the other
                          // media set is cleared — the backend enforces exactly
                          // one per card, so stale state would fail at launch.
                          if (doc?.type === 'video') {
                            patch(index, {
                              mediaType: 'video',
                              videoUrl: absoluteUrl,
                              videoFile: null,
                              videoThumbnailUrl: null,
                              imageFile: null,
                              imageUrl: null,
                            });
                          } else {
                            patch(index, {
                              mediaType: 'image',
                              imageUrl: absoluteUrl,
                              imageFile: null,
                              videoFile: null,
                              videoUrl: null,
                              videoThumbnailUrl: null,
                            });
                          }
                          setBrowsingById((p) => ({ ...p, [card.id]: false }));
                        }}
                      />
                    </div>
                    )
                  ) : (
                    <>
                      {!imageOnly && (
                        <div className="flex items-stretch gap-2 max-w-xs">
                          <SegButton
                            active={card.mediaType === 'image'}
                            onClick={() =>
                              patch(index, {
                                mediaType: 'image',
                                videoFile: null,
                                videoUrl: null,
                                videoThumbnailUrl: null,
                              })
                            }
                          >
                            Image
                          </SegButton>
                          <SegButton
                            active={card.mediaType === 'video'}
                            onClick={() =>
                              patch(index, { mediaType: 'video', imageFile: null, imageUrl: null })
                            }
                          >
                            Video
                          </SegButton>
                        </div>
                      )}
                      {card.mediaType === 'video' ? (
                        <VideoField
                          videoFile={card.videoFile}
                          videoUrl={card.videoUrl}
                          videoThumbnailUrl={card.videoThumbnailUrl}
                          onChangeFile={(f) => patch(index, { videoFile: f })}
                          onChangeUrl={(u) => patch(index, { videoUrl: u })}
                          onChangeThumbnailUrl={(u) => patch(index, { videoThumbnailUrl: u })}
                        />
                      ) : (
                        <ImageField
                          imageFile={card.imageFile}
                          imageUrl={card.imageUrl}
                          onChangeFile={(f) => patch(index, { imageFile: f })}
                          onChangeUrl={(u) => patch(index, { imageUrl: u })}
                        />
                      )}
                    </>
                  )}

                  </>
                  )}

                  {errs.media && !mediaLocked && (
                    <p className="text-11 font-medium text-red-600 dark:text-red-400">{errs.media}</p>
                  )}

                  <TextField
                    label="Headline"
                    value={card.headline}
                    onChange={(v) => patch(index, { headline: v })}
                    placeholder="Shown under this card"
                    maxLength={40}
                    error={errs.headline}
                  />
                  <TextField
                    label="Description"
                    value={card.description}
                    onChange={(v) => patch(index, { description: v })}
                    placeholder="Optional subtext"
                    maxLength={30}
                    error={errs.description}
                  />
                  <TextField
                    label="Link"
                    value={card.link}
                    onChange={(v) => patch(index, { link: v })}
                    placeholder="Leave blank to use the ad's main link"
                    error={errs.link}
                  />
                </div>
              )}
            </div>
          );
        })}

        {!mediaLocked && (
        <button
          type="button"
          onClick={add}
          disabled={cards.length >= max}
          className="flex items-center justify-center gap-1.5 rounded-2xl border border-dashed border-gray-300 py-2.5 text-12 font-semibold text-gray-500 transition-colors hover:border-gray-400 hover:bg-gray-50 hover:text-gray-700 disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/15 dark:text-white/50 dark:hover:border-white/25 dark:hover:bg-white/4 dark:hover:text-white"
        >
          <Plus className="h-3.5 w-3.5" />
          {cards.length >= max ? `Maximum ${max} cards` : 'Add card'}
        </button>
        )}
      </div>
    </FieldShell>
  );
}
