import React, { useEffect, useState } from 'react';

import { FieldBlock, PillGroup, SelectField, Stepper, TogglePill } from './briefFields';
import { CARD, FAINT, SECTION, SECTION_PAD } from './_tokens';
import {
  AD_PLATFORMS,
  MAX_PLATFORMS,
  MAX_RATIOS,
  platform,
  pruneRatios,
  ratiosFor,
} from '@/components/AdFactory/adPlatforms';
import { fetchAdFactoryConfig } from '@/utils/fetchAdCreativeConfig';

// Same models/credits the Full-control form pulls from the backend
// (`/adsgpt/usage/model-credit-value?media=ad_factory`) — Quick setup used to
// hardcode "Google"/"OpenAI" here, which drifted from whatever the backend
// actually offered.
const AUTO_OPTION = { value: 'auto', label: 'Choose for me' };

// ----------------------------------------------------------------------------
// OutputPanel — what we make, at what sizes, how many, with which model.
//
// This was the fifth band of AdjustPanel, at the bottom of a full-width
// document the user had to scroll past four other bands to reach. It is in the
// right rail now, directly above the card that prices it and the button that
// spends it, because that is the actual relationship: every control here
// changes the number on the This-run card.
//
// Nothing about the CONTROLS changed — same platform matrix, same ratio
// filtering, same paired imageCount/textCount write. Only where they live.
//
// One naming note carried over: "Ads per run" here is how many ads ONE press
// of Generate makes. The schedule's "ads each run" (`delivery.pairsPerCycle`)
// is how many each scheduled cycle makes. Different fields, different screens
// — the schedule's reads inside a sentence, which is what keeps them apart.
// ----------------------------------------------------------------------------

// The brief schema and its validator both cap a single generate at 50.
const MAX_ADS_PER_GENERATE = 50;

const toggleIn = (list, value) => {
  const cur = Array.isArray(list) ? list : [];
  return cur.includes(value) ? cur.filter((x) => x !== value) : [...cur, value];
};

export default function OutputPanel({ brief, onEditField, onEditFields }) {
  const delivery = brief?.delivery || {};
  const generation = brief?.generation || {};

  const [imageModelOptions, setImageModelOptions] = useState([AUTO_OPTION]);
  useEffect(() => {
    let cancelled = false;
    fetchAdFactoryConfig()
      .then((models) => {
        if (cancelled) return;
        setImageModelOptions([
          AUTO_OPTION,
          ...models.map((m) => ({
            value: m.apiId,
            label: m.label,
            aliases: Array.isArray(m.aliases) ? m.aliases : [],
          })),
        ]);
      })
      .catch(() => {}); // keep the "Choose for me" fallback on failure
    return () => {
      cancelled = true;
    };
  }, []);

  const selectedPlatforms = delivery.platforms?.length ? delivery.platforms : ['meta'];
  const persistedImageModel = generation.imageModel || AUTO_OPTION.value;
  const isLegacyAuto = persistedImageModel.toLowerCase() === 'google'
    && brief?.provenance?.['generation.imageModel']?.source !== 'user';
  const legacySelectedModel = imageModelOptions.find((option) =>
    option.aliases?.some((alias) => String(alias).toLowerCase() === persistedImageModel.toLowerCase()),
  );
  const selectedImageModel = isLegacyAuto
    ? AUTO_OPTION.value
    : imageModelOptions.some((option) => option.value === persistedImageModel)
    ? persistedImageModel
    : legacySelectedModel?.value || AUTO_OPTION.value;
  const allowedRatios = ratiosFor(selectedPlatforms);
  const platformNames = selectedPlatforms.map((id) => platform(id)?.label || id).join(', ');

  // Chosen platforms we can generate for but not post to.
  const downloadOnly = selectedPlatforms
    .filter((id) => {
      const p = platform(id);
      return p && !p.isLaunchable && p.label !== 'X';
    })
    .map((id) => platform(id).label);

  // An ad IS an image plus a copy, so the image count is what "ads per run"
  // means. The brief still stores imageCount and textCount separately — Python
  // is told both — so this control writes both, in ONE request. Two calls
  // raced, and the loser's value was written back over the winner's.
  const adsPerRun = generation.imageCount ?? 3;

  return (
    <div className={`${CARD} ${SECTION_PAD}`}>
      <div className="mb-3 flex flex-wrap items-baseline gap-2">
        <h3 className={SECTION}>Output</h3>
        <span className={FAINT}>sizes the creatives</span>
      </div>

      <div className="flex flex-col gap-3.5">
        <FieldBlock label="Platforms">
          <PillGroup>
            {AD_PLATFORMS.map((p) => (
              <TogglePill
                key={p.id}
                on={selectedPlatforms.includes(p.id)}
                onClick={() => {
                  const next = toggleIn(selectedPlatforms, p.id);
                  if (next.length === 0) return; // at least one must stay on
                  if (next.length > MAX_PLATFORMS) return;
                  // A ratio the new selection cannot render has to go with it —
                  // leaving 16:9 ticked after Meta is swapped for TikTok would
                  // send a size nothing renders at. Both in one request.
                  const kept = pruneRatios(delivery.ratios, next);
                  onEditFields?.('delivery', {
                    platforms: next,
                    ...(kept.length !== (delivery.ratios || []).length ? { ratios: kept } : {}),
                  });
                }}
              >
                {p.label}
              </TogglePill>
            ))}
          </PillGroup>
          {/* Only when the selection actually raises it — a per-pill
              "download" tag next to eight of nine platforms read as a button. */}
          {downloadOnly.length > 0 && (
            <p className={FAINT}>
              We&apos;ll make the {downloadOnly.join(', ')} sizes for you to download.
            </p>
          )}
        </FieldBlock>

        <FieldBlock
          label="Creative ratios"
          // Meta only offers four sizes, so on the default selection a flat
          // "up to 5" advertised a limit that could never be reached. The verb
          // agrees too: one platform "accepts", several "accept".
          hint={
            allowedRatios.length > MAX_RATIOS
              ? `pick up to ${MAX_RATIOS}`
              : `${platformNames} ${selectedPlatforms.length === 1 ? 'accepts' : 'accept'}`
          }
        >
          <PillGroup>
            {allowedRatios.map((r) => {
              const on = (delivery.ratios || []).includes(r);
              return (
                <TogglePill
                  key={r}
                  on={on}
                  disabled={!on && (delivery.ratios || []).length >= MAX_RATIOS}
                  onClick={() => onEditField?.('delivery', 'ratios', toggleIn(delivery.ratios, r))}
                >
                  {r}
                </TogglePill>
              );
            })}
          </PillGroup>
        </FieldBlock>

        <div className="grid grid-cols-2 gap-3">
          <FieldBlock label="Ads per run">
            <Stepper
              value={adsPerRun}
              max={MAX_ADS_PER_GENERATE}
              onChange={(n) => onEditFields?.('generation', { imageCount: n, textCount: n })}
            />
          </FieldBlock>

          <FieldBlock label="Image model">
            <SelectField
              value={selectedImageModel}
              options={imageModelOptions}
              onChange={(v) => onEditField?.('generation', 'imageModel', v)}
            />
          </FieldBlock>
        </div>
      </div>
    </div>
  );
}
