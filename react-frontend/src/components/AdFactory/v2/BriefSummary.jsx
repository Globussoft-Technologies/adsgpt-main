import React, { useMemo } from 'react';
import { AlertTriangle, ChevronUp, Sliders } from 'lucide-react';
import { BTN_GHOST, FAINT, MUTED, NUM, TITLE } from './_tokens';

// ----------------------------------------------------------------------------
// BriefSummary — the page's masthead.
//
// Not a card any more, and that is the point. It used to be a bordered box
// holding an avatar, a 14px name and a row of 10px pill chips, sitting directly
// above another bordered box holding the same information as editable fields.
// Two panels of equal weight, neither of them the top of the page, and the
// biggest type on screen was the same size as a form label — which is exactly
// what "nothing stands out" describes.
//
// Now the brand name is the page title (21px, the largest thing anywhere on the
// screen) with one grey line under it saying where we read it from and how much
// of it we guessed. The card below it starts the brief. That is the hierarchy:
// title → document → action.
//
// The chips stay. They are a glance at the five facts that change what the ads
// look like, and with the fields expanded underneath they are the fast way to
// confirm the shape of the brief without reading five sections. They are just
// no longer competing with the title for it.
// ----------------------------------------------------------------------------

const LOW_CONFIDENCE = 0.5;

// Autofill returns Google's product taxonomy verbatim — "Business and
// Industrial", "Apparel & Accessories > Clothing". Useful to the generator,
// machine-generated to a reader, so the chip shows the most specific leaf and
// lowercases it to sit alongside the other chips as a word rather than a label.
// The stored value is untouched; this is display only.
const category = (value) => {
  const leaf = String(value || '')
    .split(/[>/]/)
    .pop()
    .trim();
  return leaf.length > 28 ? `${leaf.slice(0, 27)}…` : leaf.toLowerCase();
};

const humanize = (value) =>
  !value
    ? ''
    : String(value)
        .replace(/^OUTCOME_/, '')
        .toLowerCase()
        .replace(/_/g, ' ')
        .replace(/^./, (c) => c.toUpperCase());

export default function BriefSummary({
  brief,
  budget,
  currencySymbol = '₹',
  onAdjust,
  adjusting = false,
  busy = false,
}) {
  const brand = brief?.brand || {};
  const offer = brief?.offer || {};
  const provenance = brief?.provenance || {};

  // Count only what we GUESSED and are unsure about. A value the user typed
  // carries confidence 1 and must never be flagged back at them.
  const flaggedCount = useMemo(
    () =>
      Object.values(provenance).filter(
        (m) =>
          m &&
          m.source !== 'user' &&
          typeof m.confidence === 'number' &&
          m.confidence <= LOW_CONFIDENCE
      ).length,
    [provenance]
  );

  // The audience list can be long; the line shows the first and counts the
  // rest rather than wrapping to three rows.
  const audience = Array.isArray(offer.audience) ? offer.audience.filter(Boolean) : [];
  const audienceLabel =
    audience.length > 1 ? `${audience[0]} +${audience.length - 1}` : audience[0] || '';

  const facts = [
    brand.category && { key: 'category', label: category(brand.category) },
    audienceLabel && { key: 'audience', label: audienceLabel },
    offer.primaryObjective && {
      key: 'objective',
      label: humanize(offer.primaryObjective),
      strong: true,
    },
    offer.cta?.button && { key: 'cta', label: humanize(offer.cta.button) },
    Number(budget) > 0 && {
      key: 'budget',
      label: `${currencySymbol}${Number(budget).toLocaleString('en-IN')}/day`,
      strong: true,
    },
  ].filter(Boolean);

  const host = brief?.source?.url ? hostOf(brief.source.url) : '';

  // One grey sentence, assembled from what is actually true — not a fixed
  // template with empty slots in it.
  const provenanceLine = [
    host && `Read from ${host}`,
    flaggedCount > 0 &&
      `${flaggedCount} ${flaggedCount === 1 ? 'value was' : 'values were'} guessed`,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3 rounded-lg border border-[#DED2BD] bg-[#FFFDF8] px-4 py-3 shadow-none dark:border-[#252B33] dark:bg-[#14181D]">
      <div className="flex min-w-0 flex-col gap-2">
        <div className="flex min-w-0 items-center gap-2.5">
          {brand.logoUrls?.[0] && (
            <img
              src={brand.logoUrls[0]}
              alt=""
              className="size-7 shrink-0 rounded-md border border-[#DED2BD] bg-[#F7F1E8] object-contain dark:border-[#2E353E] dark:bg-[#1E232A]"
            />
          )}
          <h1 className={`min-w-0 truncate ${TITLE}`}>{brand.name || 'Your brand'}</h1>
        </div>

        {provenanceLine && (
          <p className={MUTED}>
            {host && <span>Read from {host}</span>}
            {host && flaggedCount > 0 && <span className={FAINT}> · </span>}
            {flaggedCount > 0 && (
              <button
                type="button"
                onClick={onAdjust}
                className="text-[#B45309] underline-offset-2 hover:underline dark:text-[#E8A33D]"
              >
                <AlertTriangle className="mr-1 inline h-3 w-3 align-[-1px]" />
                <span className={NUM}>{flaggedCount}</span>{' '}
                {flaggedCount === 1 ? 'value was' : 'values were'} guessed
              </button>
            )}
          </p>
        )}

        {/* The five facts that change what the ads look like. Plain text
            separated by dots — a row of bordered pills is another five boxes on
            a screen that already has plenty. */}
        {facts.length > 0 && (
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {facts.map((f, i) => (
              <React.Fragment key={f.key}>
                {i > 0 && <span className={FAINT}>·</span>}
                <span
                  className={
                    f.strong
                      ? 'text-13 font-medium text-[#111827] dark:text-[#ECEFF3]'
                      : 'text-13 text-[#6B7280] dark:text-[#AFB6C0]'
                  }
                >
                  {f.label}
                </span>
              </React.Fragment>
            ))}
          </p>
        )}
      </div>

      {/* A toggle, not a launcher — the fields expand directly beneath this,
          so the control has to say which way it will go. */}
      <span className="flex shrink-0 items-center gap-3">
        {busy && <span className={FAINT}>Saving…</span>}
        <button
          type="button"
          onClick={onAdjust}
          disabled={busy}
          aria-expanded={adjusting}
          className={BTN_GHOST}
        >
          {adjusting ? <ChevronUp className="h-3.5 w-3.5" /> : <Sliders className="h-3.5 w-3.5" />}
          {adjusting ? 'Done' : 'Adjust'}
        </button>
      </span>
    </div>
  );
}

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}
