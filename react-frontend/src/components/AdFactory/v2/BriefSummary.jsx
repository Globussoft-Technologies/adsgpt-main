import React, { useMemo } from 'react';
import { AlertTriangle, ChevronUp, Sliders } from 'lucide-react';

// ----------------------------------------------------------------------------
// BriefSummary — what we read, in one line.
//
// This is the screen's correction. The previous attempt put a 539-line,
// twenty-field, four-column grid between "we read your page" and "here are your
// ads", which turned "two inputs, not twelve" into "review twenty pre-filled
// fields" and put configuration back in front of value.
//
// Everything that grid held still exists and is still editable — it expands in
// place beneath this card (AdjustPanel), one click away, flagged fields first.
// The difference is that reading it is the user's choice rather than a toll
// gate. Full parity, not full ceremony.
//
// What earns a place on the line: the five facts that change what the ads look
// like, plus a count of what we're unsure about. Anything else is detail.
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
          m.confidence <= LOW_CONFIDENCE,
      ).length,
    [provenance],
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

  const initial = String(brand.name || brief?.source?.url || '?')
    .replace(/^https?:\/\/(www\.)?/, '')
    .trim()
    .charAt(0)
    .toUpperCase();

  return (
    <div className="rounded-2xl border border-gray-200 bg-white dark:border-white/10 dark:bg-[#14181D]">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-3 px-4 py-3.5">
        {brand.logoUrls?.[0] ? (
          <img
            src={brand.logoUrls[0]}
            alt=""
            className="size-8 shrink-0 rounded-lg bg-gray-100 object-contain dark:bg-white/10"
          />
        ) : (
          <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-linear-to-br from-[#15DCFF]/20 to-[#6b72f8]/20 text-13 font-extrabold text-[#6b72f8] dark:text-[#aeb6ff]">
            {initial}
          </span>
        )}

        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <div className="flex items-baseline gap-2">
            <span className="truncate text-sm font-bold text-gray-900 dark:text-white">
              {brand.name || 'Your brand'}
            </span>
            {brief?.source?.url && (
              <span className="hidden truncate text-10 text-gray-400 sm:inline dark:text-white/40">
                read from {hostOf(brief.source.url)}
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {facts.map((f) => (
              <span
                key={f.key}
                className="inline-flex items-center rounded-full border border-gray-200 bg-gray-100 px-2.5 py-1 text-11 text-gray-600 dark:border-white/10 dark:bg-white/6 dark:text-white/60"
              >
                <span className={f.strong ? 'font-semibold text-gray-900 dark:text-white/90' : ''}>
                  {f.label}
                </span>
              </span>
            ))}

            {flaggedCount > 0 && (
              <button
                type="button"
                onClick={onAdjust}
                className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 text-11 font-semibold text-amber-700 transition hover:bg-amber-500/20 dark:text-amber-400"
              >
                <AlertTriangle className="h-3 w-3" />
                {flaggedCount} worth a look
              </button>
            )}
          </div>
        </div>

        {/* A toggle, not a launcher — the fields expand directly beneath this
            card, so the control has to say which way it will go. */}
        <button
          type="button"
          onClick={onAdjust}
          disabled={busy}
          aria-expanded={adjusting}
          className={`inline-flex shrink-0 items-center gap-2 rounded-xl border px-3.5 py-2 text-xs font-semibold transition disabled:opacity-50 ${
            adjusting
              ? 'border-gray-300 bg-gray-200 text-gray-900 dark:border-white/25 dark:bg-white/12 dark:text-white'
              : 'border-gray-200 bg-gray-100 text-gray-900 hover:border-gray-300 dark:border-white/10 dark:bg-white/6 dark:text-white dark:hover:border-white/25'
          }`}
        >
          {adjusting ? <ChevronUp className="h-3.5 w-3.5" /> : <Sliders className="h-3.5 w-3.5" />}
          {adjusting ? 'Done' : 'Adjust'}
        </button>
      </div>
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
