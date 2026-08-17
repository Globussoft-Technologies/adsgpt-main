import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, AlertTriangle, Check } from 'lucide-react';

import { getWizardSchema } from '@/apis/adFactory/briefApi';
import { Notice, Panel, PanelHeader, GhostBtn } from './Panel';
import {
  ChipList,
  Disclosure,
  EditableText,
  FieldBlock,
  ImageStrip,
  PaletteEditor,
  PillGroup,
  SelectField,
  Stepper,
  TogglePill,
} from './briefFields';

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
// The order within it is the argument:
//
//   1. WORTH A LOOK   — only what we guessed AND are unsure about. If we got
//                       everything right this section doesn't exist, and the
//                       drawer opens on a settled brief with nothing shouting.
//   2. THE ESSENTIALS — the handful that change what the ads say.
//   3. Collapsed      — brand detail and generation settings, for the user who
//                       came looking for them.
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

const RATIO_OPTIONS = ['1:1', '4:5', '9:16', '16:9', '1.91:1'];
const PLATFORM_OPTIONS = [
  { value: 'meta', label: 'Meta' },
  { value: 'google', label: 'Google' },
];

export default function AdjustPanel({ brief, open, onClose, onEditField, saving = false }) {
  const brand = brief?.brand || {};
  const offer = brief?.offer || {};
  const delivery = brief?.delivery || {};
  const generation = brief?.generation || {};
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
  const changeObjective = (nextObjective) => {
    const locs = schema?.objectives?.[nextObjective]?.conversionLocations || {};
    const nextLocation = locs[offer.conversionLocation]
      ? offer.conversionLocation
      : Object.keys(locs)[0] || '';
    editOffer('primaryObjective', nextObjective);
    editOffer('conversionLocation', nextLocation);
    editOffer('cta', { ...(offer.cta || {}), button: '' });
  };

  const toggleIn = (list, value) => {
    const cur = Array.isArray(list) ? list : [];
    return cur.includes(value) ? cur.filter((x) => x !== value) : [...cur, value];
  };

  // Which of the fields we render are actually flagged. Drives section 1.
  const flagged = useMemo(
    () =>
      [
        ['brand.name', 'Brand'],
        ['brand.description', 'What it does'],
        ['brand.voice', 'Voice'],
        ['brand.tone', 'Tone of voice'],
        ['brand.dos', 'Do'],
        ['brand.donts', "Don't"],
        ['offer.audience', 'Audience'],
        ['offer.statedGoal', 'Goal'],
        ['offer.primaryObjective', 'Campaign objective'],
        ['offer.cta.button', 'Button'],
      ].filter(([path]) => isLow(path)),
    [isLow],
  );

  if (!open) return null;

  const field = (path) => {
    switch (path) {
      case 'brand.name':
        return (
          <EditableText
            value={brand.name}
            placeholder="Brand name"
            flagged
            onSave={(v) => editBrand('name', v)}
          />
        );
      case 'brand.description':
        return (
          <EditableText
            value={brand.description}
            placeholder="What does this brand do?"
            flagged
            multiline
            rows={2}
            onSave={(v) => editBrand('description', v)}
          />
        );
      case 'brand.voice':
        return (
          <ChipList
            items={brand.voice}
            flagged
            placeholder="warm, direct…"
            onChange={(next) => editBrand('voice', next)}
          />
        );
      case 'brand.tone':
        return (
          <EditableText
            value={brand.tone}
            placeholder="How should the copy sound?"
            flagged
            multiline
            rows={2}
            onSave={(v) => editBrand('tone', v)}
          />
        );
      case 'brand.dos':
        return (
          <ChipList
            items={brand.dos}
            flagged
            placeholder="always…"
            onChange={(next) => editBrand('dos', next)}
          />
        );
      case 'brand.donts':
        return (
          <ChipList
            items={brand.donts}
            flagged
            placeholder="never…"
            onChange={(next) => editBrand('donts', next)}
          />
        );
      case 'offer.audience':
        return (
          <ChipList
            items={offer.audience}
            flagged
            placeholder="who are we talking to?"
            onChange={(next) => editOffer('audience', next)}
          />
        );
      case 'offer.statedGoal':
        return (
          <EditableText
            value={offer.statedGoal}
            placeholder="What should these ads achieve?"
            flagged
            onSave={(v) => editOffer('statedGoal', v)}
          />
        );
      case 'offer.primaryObjective':
        return (
          <SelectField
            value={offer.primaryObjective}
            options={
              objectiveOptions.length ? objectiveOptions : currentAsOption(offer.primaryObjective)
            }
            flagged
            onChange={changeObjective}
          />
        );
      case 'offer.cta.button':
        return (
          <SelectField
            value={offer.cta?.button}
            options={ctaOptions.length ? ctaOptions : currentAsOption(offer.cta?.button)}
            placeholder="Choose a button"
            flagged
            onChange={(v) => editOffer('cta', { ...(offer.cta || {}), button: v })}
          />
        );
      default:
        return null;
    }
  };

  return (
    <Panel>
      <PanelHeader
        title="Adjust"
        subtitle={
          flagged.length > 0
            ? `Everything's editable — ${flagged.length} ${flagged.length === 1 ? 'thing is' : 'things are'} worth a look first.`
            : 'Everything here is editable. Changes save as you make them.'
        }
        right={
          <span className="flex items-center gap-3">
            {saving && <span className="text-10 text-gray-400 dark:text-white/40">Saving…</span>}
            <GhostBtn onClick={onClose}>
              <Check className="h-3.5 w-3.5" />
              <span>Done</span>
            </GhostBtn>
          </span>
        }
      />

      <div className="px-4 py-4 2xl:px-5 2xl:py-5">
        <div className="flex flex-col gap-5">
            {/* 1 ── Worth a look */}
            {flagged.length > 0 && (
              <section className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3.5">
                <div className="mb-3 flex items-center gap-2">
                  <AlertTriangle className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
                  <span className="text-10 font-extrabold tracking-wider text-amber-700 uppercase dark:text-amber-400">
                    Worth a look
                  </span>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                  {flagged.map(([path, label]) => (
                    <FieldBlock key={path} label={label}>
                      {field(path)}
                    </FieldBlock>
                  ))}
                </div>
              </section>
            )}

            {schemaFailed && (
              <Notice tone="warn" icon={AlertCircle}>
                <span className="flex flex-wrap items-center gap-2">
                  <span>
                    Couldn&apos;t load Meta&apos;s objective list, so objective, location and
                    button can&apos;t be changed yet.
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
            )}

            {/* 2 ── The essentials */}
            <section className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
              {!isLow('brand.name') && (
                <FieldBlock label="Brand">
                  <EditableText
                    value={brand.name}
                    placeholder="Brand name"
                    onSave={(v) => editBrand('name', v)}
                  />
                </FieldBlock>
              )}
              <FieldBlock label="Category" hint="e.g. beauty, food">
                <EditableText
                  value={brand.category}
                  placeholder="Category"
                  onSave={(v) => editBrand('category', v)}
                />
              </FieldBlock>
              {!isLow('brand.description') && (
                <FieldBlock label="What it does" wide>
                  <EditableText
                    value={brand.description}
                    placeholder="What does this brand do?"
                    multiline
                    rows={2}
                    onSave={(v) => editBrand('description', v)}
                  />
                </FieldBlock>
              )}
              {!isLow('offer.audience') && (
                <FieldBlock label="Audience">
                  <ChipList
                    items={offer.audience}
                    placeholder="who are we talking to?"
                    onChange={(next) => editOffer('audience', next)}
                  />
                </FieldBlock>
              )}
              {!isLow('brand.voice') && (
                <FieldBlock label="Voice" hint="a few words">
                  <ChipList
                    items={brand.voice}
                    placeholder="warm, direct…"
                    onChange={(next) => editBrand('voice', next)}
                  />
                </FieldBlock>
              )}
              {!isLow('offer.primaryObjective') && (
                <FieldBlock label="Campaign objective" hint="sent to Meta">
                  <SelectField
                    value={offer.primaryObjective}
                    options={
                      objectiveOptions.length
                        ? objectiveOptions
                        : currentAsOption(offer.primaryObjective)
                    }
                    onChange={changeObjective}
                  />
                </FieldBlock>
              )}
              <FieldBlock label="Conversion location">
                <SelectField
                  value={offer.conversionLocation}
                  options={
                    locationOptions.length
                      ? locationOptions
                      : currentAsOption(offer.conversionLocation)
                  }
                  onChange={(v) => editOffer('conversionLocation', v)}
                />
              </FieldBlock>
              {!isLow('offer.cta.button') && (
                <FieldBlock label="Button" hint="shown on the ad">
                  <SelectField
                    value={offer.cta?.button}
                    options={ctaOptions.length ? ctaOptions : currentAsOption(offer.cta?.button)}
                    placeholder="Choose a button"
                    onChange={(v) => editOffer('cta', { ...(offer.cta || {}), button: v })}
                  />
                </FieldBlock>
              )}
              <FieldBlock label="Button goes to">
                <EditableText
                  value={offer.cta?.url}
                  placeholder="https://…"
                  onSave={(v) => editOffer('cta', { ...(offer.cta || {}), url: v })}
                />
              </FieldBlock>
            </section>

            {/* 3 ── Collapsed detail */}
            <div className="flex flex-col gap-2.5">
              <Disclosure
                title="More about the brand"
                hint={[
                  brand.logoUrls?.length ? `${brand.logoUrls.length} logo` : null,
                  offer.coreIdea ? 'core idea' : null,
                  offer.promotions?.length ? `${offer.promotions.length} offers` : null,
                  generation.seedImages?.length ? `${generation.seedImages.length} visuals` : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              >
                {!isLow('brand.tone') && (
                  <FieldBlock label="Tone of voice" wide>
                    <EditableText
                      value={brand.tone}
                      placeholder="How should the copy sound?"
                      multiline
                      rows={2}
                      onSave={(v) => editBrand('tone', v)}
                    />
                  </FieldBlock>
                )}
                {!isLow('brand.dos') && (
                  <FieldBlock label="Do">
                    <ChipList
                      items={brand.dos}
                      placeholder="always…"
                      onChange={(next) => editBrand('dos', next)}
                    />
                  </FieldBlock>
                )}
                {!isLow('brand.donts') && (
                  <FieldBlock label="Don't">
                    <ChipList
                      items={brand.donts}
                      placeholder="never…"
                      onChange={(next) => editBrand('donts', next)}
                    />
                  </FieldBlock>
                )}
                <FieldBlock label="Brand colours" wide>
                  <PaletteEditor
                    colors={brand.palette}
                    onChange={(next) => editBrand('palette', next)}
                  />
                </FieldBlock>
                <FieldBlock label="Core idea" hint="the one thing to land" wide>
                  <EditableText
                    value={offer.coreIdea}
                    placeholder="The central message"
                    multiline
                    rows={2}
                    onSave={(v) => editOffer('coreIdea', v)}
                  />
                </FieldBlock>
                <FieldBlock label="Offers & promotions">
                  <ChipList
                    items={offer.promotions}
                    placeholder="Free shipping over ₹999"
                    onChange={(next) => editOffer('promotions', next)}
                  />
                </FieldBlock>
                <FieldBlock label="Extra guidelines" hint="the ads must follow these">
                  <EditableText
                    value={offer.notes}
                    placeholder="Constraints, legal wording, things to avoid…"
                    multiline
                    rows={2}
                    onSave={(v) => editOffer('notes', v)}
                  />
                </FieldBlock>
                <FieldBlock label="Logo">
                  <ImageStrip
                    urls={brand.logoUrls}
                    onChange={(next) => editBrand('logoUrls', next)}
                    emptyLabel="No logo found on the page"
                  />
                </FieldBlock>
                <FieldBlock label="Key visuals" hint="from your page">
                  <ImageStrip
                    urls={generation.seedImages}
                    onChange={(next) => onEditField?.('generation', 'seedImages', next)}
                    emptyLabel="No images found on the page"
                  />
                </FieldBlock>
              </Disclosure>

              <Disclosure
                title="How the ads are made"
                hint={`${(delivery.platforms || ['meta']).join(', ')} · ${
                  (delivery.ratios || []).join(' ') || 'auto ratios'
                } · ${generation.imageCount ?? 3} images`}
              >
                <FieldBlock label="Platforms">
                  <PillGroup>
                    {PLATFORM_OPTIONS.map((p) => (
                      <TogglePill
                        key={p.value}
                        on={(delivery.platforms || []).includes(p.value)}
                        onClick={() => {
                          const next = toggleIn(delivery.platforms, p.value);
                          if (next.length === 0) return; // at least one must stay on
                          onEditField?.('delivery', 'platforms', next);
                        }}
                      >
                        {p.label}
                      </TogglePill>
                    ))}
                  </PillGroup>
                </FieldBlock>
                <FieldBlock label="Creative ratios">
                  <PillGroup>
                    {RATIO_OPTIONS.map((r) => (
                      <TogglePill
                        key={r}
                        on={(delivery.ratios || []).includes(r)}
                        onClick={() =>
                          onEditField?.('delivery', 'ratios', toggleIn(delivery.ratios, r))
                        }
                      >
                        {r}
                      </TogglePill>
                    ))}
                  </PillGroup>
                </FieldBlock>
                <FieldBlock label="Images per run">
                  <Stepper
                    value={generation.imageCount ?? 3}
                    onChange={(n) => onEditField?.('generation', 'imageCount', n)}
                    suffix="images"
                  />
                </FieldBlock>
                <FieldBlock label="Copies per run">
                  <Stepper
                    value={generation.textCount ?? 3}
                    onChange={(n) => onEditField?.('generation', 'textCount', n)}
                    suffix="variants"
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
              </Disclosure>
            </div>
        </div>
      </div>
    </Panel>
  );
}
