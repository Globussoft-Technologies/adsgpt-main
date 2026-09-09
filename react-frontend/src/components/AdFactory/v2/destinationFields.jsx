import React, { useEffect, useMemo, useState } from 'react';

import { getWizardSchema } from '@/apis/adFactory/briefApi';
import { FieldBlock, SelectField } from './briefFields';
import { INPUT } from './_tokens';

// ----------------------------------------------------------------------------
// DestinationFields — the CTA button and the URL it points at, asked once per
// PLATFORM instead of once per brief.
//
// They used to live in the brief's Campaign band (AdjustPanel), which made them
// one decision shared by every destination. That was wrong for the same reason
// the ad account is not shared: the button and the landing page are properties
// of where the ad RUNS, not of the brief it came from — the Meta ad can say
// "Shop now" into a product page while the Google ad points at a category page.
//
// So this renders inside the launch panel, under whichever platform tab is
// open, and the value it edits lives on that platform's own connection object.
// Because the connection is what both endpoints already send whole, the two
// fields reach the server without either payload builder growing a new
// argument.
// ----------------------------------------------------------------------------

const humanize = (value) =>
  String(value || '')
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/^./, (c) => c.toUpperCase());

// What the picker offers when Meta's wizard schema is unavailable, or when no
// objective/location pair has been chosen yet to narrow it. Meta's own enum
// values — Google maps unknown keys to null and simply omits the label, so the
// same list is safe on both tabs.
export const FALLBACK_CTAS = [
  'SHOP_NOW',
  'LEARN_MORE',
  'SIGN_UP',
  'SUBSCRIBE',
  'BOOK_TRAVEL',
  'CONTACT_US',
  'DOWNLOAD',
  'GET_OFFER',
  'GET_QUOTE',
  'APPLY_NOW',
  'ORDER_NOW',
  'SEE_MENU',
  'WATCH_MORE',
  'DONATE_NOW',
  'NO_BUTTON',
];

// One fetch per page, shared by every tab that asks. The schema is a static
// description of Meta's objective tree, so re-requesting it per platform tab
// would be three identical round trips for one answer.
let schemaPromise = null;
const loadWizardSchema = () => {
  if (!schemaPromise) {
    schemaPromise = getWizardSchema()
      .then((data) => (data?.objectives ? data : null))
      .catch(() => null);
  }
  return schemaPromise;
};

/**
 * The CTA list Meta accepts for one objective + conversion location cell.
 * Falls back to the common list whenever the cell can't be resolved — an
 * empty picker is worse than a slightly generous one, because the user cannot
 * tell the difference between "not allowed" and "not loaded".
 */
export function useCtaOptions({ objective, conversionLocation } = {}) {
  const [schema, setSchema] = useState(null);

  useEffect(() => {
    let alive = true;
    loadWizardSchema().then((data) => {
      if (alive) setSchema(data);
    });
    return () => {
      alive = false;
    };
  }, []);

  return useMemo(() => {
    const allowed =
      schema?.objectives?.[objective]?.conversionLocations?.[conversionLocation]?.ctas?.allowed;
    const values = allowed?.length ? allowed : FALLBACK_CTAS;
    return values.map((value) => ({ value, label: humanize(value) }));
  }, [schema, objective, conversionLocation]);
}

/**
 * Both fields, stacked, for one platform.
 *
 * @param {string}  ctaButton   current enum value, e.g. 'SHOP_NOW'
 * @param {string}  ctaUrl      current destination url
 * @param {func}    onChange    ({ ctaButton?, ctaUrl? }) => void — patch, not replace
 * @param {string}  objective   narrows the CTA list when known
 * @param {string}  conversionLocation
 */
export default function DestinationFields({
  ctaButton,
  ctaUrl,
  onChange,
  objective,
  conversionLocation,
  disabled = false,
  urlLabel = 'Button goes to',
  urlHint,
}) {
  const options = useCtaOptions({ objective, conversionLocation });

  // Local draft so typing a URL doesn't re-render the whole launch panel per
  // keystroke; committed on blur, the same contract EditableText uses.
  const [draft, setDraft] = useState(ctaUrl ?? '');
  const [typing, setTyping] = useState(false);
  useEffect(() => {
    if (!typing) setDraft(ctaUrl ?? '');
  }, [ctaUrl, typing]);

  const commitUrl = () => {
    setTyping(false);
    const next = draft.trim();
    if (next !== (ctaUrl || '')) onChange?.({ ctaUrl: next });
  };

  return (
    <div className="flex flex-col gap-4">
      <FieldBlock label="CTA" tooltip="The call to action printed on the ad.">
        <SelectField
          value={ctaButton || ''}
          options={options}
          placeholder="Choose a CTA"
          disabled={disabled}
          onChange={(v) => onChange?.({ ctaButton: v })}
        />
      </FieldBlock>
      <FieldBlock label={urlLabel} hint={urlHint}>
        <input
          type="url"
          className={INPUT}
          value={draft}
          placeholder="https://…"
          disabled={disabled}
          onChange={(e) => {
            setTyping(true);
            setDraft(e.target.value);
          }}
          onBlur={commitUrl}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              e.currentTarget.blur();
            }
          }}
        />
      </FieldBlock>
    </div>
  );
}
