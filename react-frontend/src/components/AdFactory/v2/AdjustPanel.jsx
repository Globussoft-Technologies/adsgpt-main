import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSelector } from 'react-redux';
import { AlertCircle, Check } from 'lucide-react';

import { getWizardSchema } from '@/apis/adFactory/briefApi';
import { GhostBtn, Notice, Panel } from './Panel';
import {
  ChipList,
  EditableText,
  FieldBlock,
  FieldGrid,
  ImageStrip,
  PaletteEditor,
  PillGroup,
  Section,
  SectionRule,
  SelectField,
  Stepper,
  TogglePill,
} from './briefFields';
import { FAINT, FLAG_BADGE, MUTED, RULE_BORDER } from './_tokens';
import {
  AD_PLATFORMS,
  MAX_PLATFORMS,
  MAX_RATIOS,
  platform,
  pruneRatios,
  ratiosFor,
} from '@/components/AdFactory/adPlatforms';
import { uploadToS3 } from '@/utils/imageUpload';

const S3_BASE = import.meta.env.VITE_S3_BASE_URL || '';

// ----------------------------------------------------------------------------
// AdjustPanel — every field Full control collects, on demand and in place.
//
// Parity without ceremony. Two separate decisions, and only one of them was the
// problem with the previous attempt:
//
//   WHEN  — v2 put all twenty fields between the page read and the ads, so
//           everyone paid for them whether they wanted them or not. That is the
//           part that was wrong, and it stays fixed: this renders only when
//           asked for.
//   WHERE — an overlay was my own addition and it made things worse. Before
//           generation the page behind is nearly empty, so a drawer wasted the
//           width on one side and forced a cramped scroll on the other. It
//           expands in place instead, using the full page width, and pushes
//           what follows down rather than covering it.
//
// ─── Organisation ────────────────────────────────────────────────────────────
//
// ONE card, five bands, divided by hairlines. Not five cards, and not two
// collapsibles hanging off a grid — a brief is one document with parts, and
// stacking bordered panels inside a bordered panel is most of what made this
// screen feel cluttered. The bands, in the order a brief is actually argued:
//
//   Campaign        what Meta is being told to do          (objective → button)
//   Brand           who is speaking, and what they look like
//   Message         what these ads have to say
//   Audience & voice  who they say it to, and how
//   Output          what we make, for where, how many
//
// ─── Where the guesses live ──────────────────────────────────────────────────
//
// There used to be a "Worth a look" band at the top that RELOCATED every
// low-confidence field out of its section. It sounded helpful and wasn't: the
// same field lived in two different places depending on a confidence score the
// user cannot see, so nothing was ever where you left it, and four fields had
// to be conditionally suppressed from their real home to avoid rendering twice.
//
// Every field now stays in its section, always. A guess we are unsure about is
// marked in place with an amber border, and each section states how many of its
// own fields are guesses. Amber appears nowhere else on the screen, so the
// colour alone carries the whole meaning.
//
// A field the USER typed is never flagged, whatever its confidence started as.
// Flagging someone's own words back at them is how a product loses their trust
// in its judgement.
// ----------------------------------------------------------------------------

const LOW_CONFIDENCE = 0.5;

const humanize = (value) =>
  !value
    ? ''
    : String(value)
        .replace(/^OUTCOME_/, '')
        .toLowerCase()
        .replace(/_/g, ' ')
        .replace(/^./, (c) => c.toUpperCase());

const currentAsOption = (value) => (value ? [{ value, label: humanize(value) }] : []);

// Platforms and ratios come from the shared matrix, not a local copy. The copy
// that used to live here listed two of the nine platforms v1 supports, offered
// `1.91:1` — which no platform in the matrix accepts — and was missing `2:3`,
// which Pinterest needs. Ratios are now filtered to what the CHOSEN platforms
// can actually render, so "16:9 on TikTok" stops being selectable.
//
// Limits mirror v1: max 5 logos, max 5 key visuals, max 8 colours, max 50 ads.
const MAX_LOGOS = 5;
const MAX_KEY_VISUALS = 5;
const MAX_COLOURS = 8;
// v1's PairsPerCycleSection caps at 50, and so do the brief schema and its
// validator. Stepper's own default is 20, so leaving this off silently held the
// control 30 short of what the server would happily accept.
const MAX_ADS_PER_GENERATE = 50;

// Which provenance paths belong to which band, so a band can count its own
// guesses without anyone maintaining a second list by hand.
const BAND_PATHS = {
  campaign: ['offer.primaryObjective', 'offer.cta.button'],
  brand: ['brand.name', 'brand.description'],
  message: ['offer.statedGoal'],
  voice: ['offer.audience', 'brand.voice', 'brand.tone', 'brand.dos', 'brand.donts'],
};

export default function AdjustPanel({
  brief,
  open,
  onClose,
  onEditField,
  onEditFields,
  saving = false,
  estimate = null,
}) {
  const brand = brief?.brand || {};
  const offer = brief?.offer || {};
  const delivery = brief?.delivery || {};
  const generation = brief?.generation || {};

  // Ratios follow the platform choice rather than a fixed list, so a size the
  // selected platforms cannot render is never offered.
  // Uploads go through the same S3 helper v1's asset and logo pickers use, so
  // a file added here is indistinguishable from one added on the canvas.
  const userId = useSelector((st) => st.auth?.userData?.user_id || st.user?.userData?.user_id);
  const uploadAsset = useCallback(
    async (file) => {
      const key = await uploadToS3(file, userId, true);
      return key ? `${S3_BASE}${key}` : '';
    },
    [userId],
  );

  const selectedPlatforms = delivery.platforms?.length ? delivery.platforms : ['meta'];
  const allowedRatios = ratiosFor(selectedPlatforms);
  const platformNames = selectedPlatforms.map((id) => platform(id)?.label || id).join(', ');
  // Chosen platforms we can generate for but not post to.
  const downloadOnly = selectedPlatforms
    .filter((id) => platform(id) && !platform(id).isLaunchable)
    .map((id) => platform(id).label);
  const provenance = brief?.provenance || {};

  const [schema, setSchema] = useState(null);
  const [schemaFailed, setSchemaFailed] = useState(false);

  const loadSchema = useCallback(() => {
    setSchemaFailed(false);
    getWizardSchema()
      .then((data) => {
        // `objectives` is the shape check — a response missing it is a schema
        // we can't drive pickers from, whatever the HTTP status said.
        if (data?.objectives) setSchema(data);
        else setSchemaFailed(true);
      })
      .catch(() => setSchemaFailed(true));
  }, []);

  useEffect(() => {
    if (open && !schema) loadSchema();
  }, [open, schema, loadSchema]);

  // Escape collapses it again. Not a modal — nothing is trapped behind it — but
  // Escape is what a keyboard user reaches for to dismiss an expanded region.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === 'Escape' && onClose?.();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const isLow = useCallback(
    (path) => {
      const m = provenance?.[path];
      // `source === 'user'` wins over any stale confidence value.
      if (!m || m.source === 'user') return false;
      return typeof m.confidence === 'number' && m.confidence <= LOW_CONFIDENCE;
    },
    [provenance],
  );

  // How many of a band's own fields we guessed and are unsure about.
  const guessCount = useCallback(
    (band) => (BAND_PATHS[band] || []).filter((p) => isLow(p)).length,
    [isLow],
  );

  const objectiveOptions = useMemo(() => {
    if (!schema?.objectives) return [];
    return Object.entries(schema.objectives).map(([value, o]) => ({
      value,
      label: o.label || humanize(value),
    }));
  }, [schema]);

  const locationOptions = useMemo(() => {
    const locs = schema?.objectives?.[offer.primaryObjective]?.conversionLocations;
    if (!locs) return [];
    return Object.entries(locs).map(([value, l]) => ({ value, label: l.label || humanize(value) }));
  }, [schema, offer.primaryObjective]);

  // CTAs come from the SELECTED cell, so changing objective immediately narrows
  // the button list to what Meta accepts for it.
  const ctaOptions = useMemo(() => {
    const cell =
      schema?.objectives?.[offer.primaryObjective]?.conversionLocations?.[offer.conversionLocation];
    return (cell?.ctas?.allowed || []).map((value) => ({ value, label: humanize(value) }));
  }, [schema, offer.primaryObjective, offer.conversionLocation]);

  const editBrand = (field, value) => onEditField?.('brand', field, value);
  const editOffer = (field, value) => onEditField?.('offer', field, value);

  // Changing objective can strand a CTA the new cell forbids. Clear it so the
  // picker re-defaults rather than carrying an invalid value through to launch.
  // Three fields, ONE request. Sent separately they raced: the server's update
  // reads the brief, merges the incoming section and saves, so requests two and
  // three read before one had written and saved stale siblings back over it.
  // Changing the objective is the worst case — it rewrites the location and
  // clears the button, and losing any of the three leaves an illegal Meta
  // combination the user cannot see.
  const changeObjective = (nextObjective) => {
    const locs = schema?.objectives?.[nextObjective]?.conversionLocations || {};
    const nextLocation = locs[offer.conversionLocation]
      ? offer.conversionLocation
      : Object.keys(locs)[0] || '';
    onEditFields?.('offer', {
      primaryObjective: nextObjective,
      conversionLocation: nextLocation,
      cta: { ...(offer.cta || {}), button: '' },
    });
  };

  // An ad needs an image, so the image count is what "ads per run" means. A
  // campaign adopted from Full control may carry mismatched counts; this shows
  // the honest number and only normalises the two when the user actually
  // changes it, rather than silently rewriting their data on open.
  const adsPerRun = generation.imageCount ?? 3;

  const toggleIn = (list, value) => {
    const cur = Array.isArray(list) ? list : [];
    return cur.includes(value) ? cur.filter((x) => x !== value) : [...cur, value];
  };

  if (!open) return null;

  // The badge a band wears when it holds a guess we're unsure about. Amber
  // appears here and on the field's own border, and nowhere else.
  const guessBadge = (band) => {
    const n = guessCount(band);
    if (!n) return null;
    return (
      <span className={FLAG_BADGE}>
        <span className="h-1.5 w-1.5 rounded-full bg-current" />
        {n} guessed
      </span>
    );
  };

  return (
    <Panel>
      {/* Not a title bar — the brand name above is the page's title, and a
          second heading here only competed with it. This states the one thing
          the user needs to know about the whole card (it saves itself) and
          gives them the way out. */}
      <div
        className={`flex flex-wrap items-center justify-between gap-3 border-b px-5 py-3 ${RULE_BORDER} 2xl:px-6`}
      >
        <p className={MUTED}>Everything here is editable. Changes save as you make them.</p>
        <span className="flex items-center gap-3">
          {saving && <span className={FAINT}>Saving…</span>}
          <GhostBtn onClick={onClose}>
            <Check className="h-3.5 w-3.5" />
            <span>Done</span>
          </GhostBtn>
        </span>
      </div>

      {schemaFailed && (
        <div className={`border-b px-5 py-3 ${RULE_BORDER} 2xl:px-6`}>
          <Notice tone="warn" icon={AlertCircle}>
            <span className="flex flex-wrap items-center gap-2">
              <span>
                Couldn&apos;t load Meta&apos;s objective list, so objective, location and button
                can&apos;t be changed yet.
              </span>
              <button
                type="button"
                onClick={loadSchema}
                className="font-semibold underline underline-offset-2"
              >
                Try again
              </button>
            </span>
          </Notice>
        </div>
      )}

      {/* ── Campaign ── objective decides which locations are legal, the
          location decides which buttons are, and the button is what the
          destination hangs off. One Meta unit, so one row. */}
      <Section title="Campaign" badge={guessBadge('campaign')}>
        <FieldGrid cols={4}>
          <FieldBlock label="Objective" tooltip="What Meta optimises the campaign for.">
            <SelectField
              value={offer.primaryObjective}
              options={
                objectiveOptions.length
                  ? objectiveOptions
                  : currentAsOption(offer.primaryObjective)
              }
              flagged={isLow('offer.primaryObjective')}
              onChange={changeObjective}
            />
          </FieldBlock>
          <FieldBlock label="Conversion location">
            <SelectField
              value={offer.conversionLocation}
              options={
                locationOptions.length ? locationOptions : currentAsOption(offer.conversionLocation)
              }
              onChange={(v) => editOffer('conversionLocation', v)}
            />
          </FieldBlock>
          <FieldBlock label="Button" tooltip="The call to action printed on the ad.">
            <SelectField
              value={offer.cta?.button}
              options={ctaOptions.length ? ctaOptions : currentAsOption(offer.cta?.button)}
              placeholder="Choose a button"
              flagged={isLow('offer.cta.button')}
              onChange={(v) => editOffer('cta', { ...(offer.cta || {}), button: v })}
            />
          </FieldBlock>
          <FieldBlock label="Button goes to">
            <EditableText
              value={offer.cta?.url}
              placeholder="https://…"
              onSave={(v) => editOffer('cta', { ...(offer.cta || {}), url: v })}
            />
          </FieldBlock>
        </FieldGrid>
      </Section>

      <SectionRule />

      {/* ── Brand ── who is speaking, and what they look like. The three visual
          inputs sit here rather than behind a fold: they are what the generator
          actually draws from, and the first thing anyone wants to correct after
          seeing a batch. */}
      <Section title="Brand" badge={guessBadge('brand')}>
        <FieldGrid cols={4}>
          <FieldBlock label="Name">
            <EditableText
              value={brand.name}
              placeholder="Brand name"
              flagged={isLow('brand.name')}
              onSave={(v) => editBrand('name', v)}
            />
          </FieldBlock>
          <FieldBlock label="Category" hint="e.g. beauty, food">
            <EditableText
              value={brand.category}
              placeholder="Category"
              onSave={(v) => editBrand('category', v)}
            />
          </FieldBlock>
          <FieldBlock label="What it does" wide>
            <EditableText
              value={brand.description}
              placeholder="What does this brand do?"
              flagged={isLow('brand.description')}
              multiline
              rows={2}
              onSave={(v) => editBrand('description', v)}
            />
          </FieldBlock>
        </FieldGrid>

        <div className="mt-5 flex flex-wrap items-start gap-x-9 gap-y-5">
          <FieldBlock label="Key visuals" hint="what the ads are built from">
            <ImageStrip
              urls={generation.seedImages}
              max={MAX_KEY_VISUALS}
              uploadFile={uploadAsset}
              onChange={(next) => onEditField?.('generation', 'seedImages', next)}
              emptyLabel="Nothing found on the page — add one"
            />
          </FieldBlock>
          <FieldBlock label="Logo">
            <ImageStrip
              urls={brand.logoUrls}
              max={MAX_LOGOS}
              uploadFile={uploadAsset}
              onChange={(next) => editBrand('logoUrls', next)}
              emptyLabel="No logo found on the page"
            />
          </FieldBlock>
          <FieldBlock label="Colours">
            <PaletteEditor
              colors={brand.palette}
              max={MAX_COLOURS}
              onChange={(next) => editBrand('palette', next)}
            />
          </FieldBlock>
        </div>
      </Section>

      <SectionRule />

      {/* ── Message ── the four fields that change what the ads actually say. */}
      <Section title="Message" badge={guessBadge('message')}>
        <FieldGrid cols={4}>
          <FieldBlock label="Core idea" hint="the one thing to land" wide>
            <EditableText
              value={offer.coreIdea}
              placeholder="The central message"
              multiline
              rows={2}
              onSave={(v) => editOffer('coreIdea', v)}
            />
          </FieldBlock>
          <FieldBlock label="Goal" hint="what these ads should achieve">
            <EditableText
              value={offer.statedGoal}
              placeholder="What should these ads achieve?"
              flagged={isLow('offer.statedGoal')}
              onSave={(v) => editOffer('statedGoal', v)}
            />
          </FieldBlock>
          <FieldBlock label="Offers & promotions">
            <ChipList
              items={offer.promotions}
              placeholder="Free shipping over ₹999"
              onChange={(next) => editOffer('promotions', next)}
            />
          </FieldBlock>
          <FieldBlock label="Extra guidelines" hint="the ads must follow these" wide>
            <EditableText
              value={offer.notes}
              placeholder="Constraints, legal wording, things to avoid…"
              multiline
              rows={2}
              onSave={(v) => editOffer('notes', v)}
            />
          </FieldBlock>
        </FieldGrid>
      </Section>

      <SectionRule />

      {/* ── Audience & voice ── who we say it to, and how it should sound. */}
      <Section title="Audience & voice" badge={guessBadge('voice')}>
        <FieldGrid cols={4}>
          <FieldBlock label="Talking to">
            <ChipList
              items={offer.audience}
              flagged={isLow('offer.audience')}
              placeholder="who are we talking to?"
              onChange={(next) => editOffer('audience', next)}
            />
          </FieldBlock>
          <FieldBlock label="Sounding" hint="a few words">
            <ChipList
              items={brand.voice}
              flagged={isLow('brand.voice')}
              placeholder="warm, direct…"
              onChange={(next) => editBrand('voice', next)}
            />
          </FieldBlock>
          <FieldBlock label="Tone of voice" wide>
            <EditableText
              value={brand.tone}
              placeholder="How should the copy sound?"
              flagged={isLow('brand.tone')}
              multiline
              rows={2}
              onSave={(v) => editBrand('tone', v)}
            />
          </FieldBlock>
          <FieldBlock label="Always">
            <ChipList
              items={brand.dos}
              flagged={isLow('brand.dos')}
              placeholder="always…"
              onChange={(next) => editBrand('dos', next)}
            />
          </FieldBlock>
          <FieldBlock label="Never">
            <ChipList
              items={brand.donts}
              flagged={isLow('brand.donts')}
              placeholder="never…"
              onChange={(next) => editBrand('donts', next)}
            />
          </FieldBlock>
        </FieldGrid>
      </Section>

      <SectionRule />

      {/* ── Output ── what we make, at what sizes, how many, with which model. */}
      <Section title="Output">
        <div className="flex flex-col gap-5">
          <FieldBlock
            label="Platforms"
            hint="what we size the creatives for"
            full
          >
            <PillGroup>
              {AD_PLATFORMS.map((p) => (
                <TogglePill
                  key={p.id}
                  on={selectedPlatforms.includes(p.id)}
                  onClick={() => {
                    const next = toggleIn(selectedPlatforms, p.id);
                    if (next.length === 0) return; // at least one must stay on
                    if (next.length > MAX_PLATFORMS) return;
                    // A ratio the new selection cannot render has to go with
                    // it — leaving 16:9 ticked after Meta is swapped for
                    // TikTok would send a size nothing renders at. Both in one
                    // request: as two they raced, and whichever lost was
                    // written back stale.
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
            {/* A per-pill "download" tag next to eight of the nine platforms
                read as a button, not a caveat — the first question it got was
                "what is this download". The point is narrow enough to say once,
                in a sentence, and only when the selection actually raises it. */}
            {downloadOnly.length > 0 && (
              <p className={FAINT}>
                We&apos;ll make the {downloadOnly.join(', ')} sizes for you to download — only Meta
                can be posted from here.
              </p>
            )}
          </FieldBlock>

          <FieldGrid cols={4}>
            <FieldBlock
              label="Creative ratios"
              // "up to 5" was stated unconditionally, and Meta only offers four
              // sizes — so on the default selection it advertised a limit that
              // could never be reached. It appears only when the available list
              // is actually longer than the cap. The verb also has to agree:
              // one platform "accepts", several "accept".
              hint={
                allowedRatios.length > MAX_RATIOS
                  ? `${platformNames} — pick up to ${MAX_RATIOS}`
                  : `the sizes ${platformNames} ${
                      selectedPlatforms.length === 1 ? 'accepts' : 'accept'
                    }`
              }
              wide
            >
              <PillGroup>
                {allowedRatios.map((r) => {
                  const on = (delivery.ratios || []).includes(r);
                  return (
                    <TogglePill
                      key={r}
                      on={on}
                      disabled={!on && (delivery.ratios || []).length >= MAX_RATIOS}
                      onClick={() =>
                        onEditField?.('delivery', 'ratios', toggleIn(delivery.ratios, r))
                      }
                    >
                      {r}
                    </TogglePill>
                  );
                })}
              </PillGroup>
            </FieldBlock>

            {/* ONE number, because an ad IS an image plus a copy. Two
                independent counts could only ever disagree, and the pairing
                downstream is by index — 3 images against 2 copies makes a third
                card with no words on it, which is not a thing anyone asked for.

                The brief still stores imageCount and textCount separately:
                Python is told both, Full control may legitimately set them
                apart, and collapsing the SCHEMA would lose that. Only this
                control is merged, and it writes both. */}
            {/* NOT the same number as the schedule's "ads each run", which is
                `delivery.pairsPerCycle`. This one is how many ads a press of
                Generate makes; that one is how many each scheduled cycle makes.
                Both were labelled "per run", on different screens, showing
                different values. */}
            <FieldBlock
              label="Ads per generate"
              // The number of ads IS the price, so the price belongs on the
              // control that sets it — not only beside the button, by which
              // point the decision is already made.
              hint={
                estimate?.total != null
                  ? `~${estimate.total} credits each time`
                  : 'one image + one copy each'
              }
            >
              <Stepper
                value={adsPerRun}
                max={MAX_ADS_PER_GENERATE}
                // BOTH counts in one request. Two `onEditField` calls sent two
                // PATCHes that raced, and the loser's value was written back
                // over the winner's.
                onChange={(n) => onEditFields?.('generation', { imageCount: n, textCount: n })}
                suffix="ads"
              />
            </FieldBlock>

            <FieldBlock label="Image model">
              <SelectField
                value={generation.imageModel || 'auto'}
                options={[
                  { value: 'auto', label: 'Choose for me' },
                  { value: 'google', label: 'Google' },
                  { value: 'openai', label: 'OpenAI' },
                ]}
                onChange={(v) => onEditField?.('generation', 'imageModel', v)}
              />
            </FieldBlock>
          </FieldGrid>
        </div>
      </Section>
    </Panel>
  );
}
