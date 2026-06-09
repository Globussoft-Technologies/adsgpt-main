import { useEffect, useRef, useState } from 'react';
import { fetchPromptTemplates } from '../ai-creatives/apiClient';

// Replace {brand} / {target_audience} in a template prompt. Tokens with no
// value (or only whitespace) stay literal so the user can fill them later.
//
// Single-pass regex replace instead of sequential `replaceAll`s — that
// guarantees a value typed into the brand slot isn't re-interpreted as a
// target_audience token (and vice-versa). Whitespace is trimmed off the
// inputs so a user who only types spaces doesn't get a textarea full of
// hidden gaps.
function resolveTemplate(prompt, brandName, targetAudience) {
  if (!prompt) return '';
  const brand = (brandName || '').trim();
  const audience = (targetAudience || '').trim();
  return prompt.replace(/\{brand\}|\{target_audience\}/g, (match) => {
    if (match === '{brand}' && brand) return brand;
    if (match === '{target_audience}' && audience) return audience;
    return match;
  });
}

// Owns: fetch (lazy on first open), panel open state, previewed vs used
// templates, live re-resolve of placeholders when the brand changes, and
// auto-clear of the active template when the user edits the textarea.
export function usePromptTemplates({
  type,
  brandName = '',
  targetAudience = '',
  currentValue = '',
  onSelect,
  // Fired when the user starts typing into a {brand} / {target_audience}
  // token in the panel. Per spec the manual entry "wins" over the brand
  // chip — so we ask the consumer to deselect any active brand so the UI
  // matches what's actually driving the resolved prompt.
  onClearBrand,
}) {
  const [open, setOpen] = useState(false);
  const [templates, setTemplates] = useState([]);
  const [state, setState] = useState('idle');
  const [error, setError] = useState('');
  // Which row is currently shown in the right detail panel.
  const [previewedTemplate, setPreviewedTemplate] = useState(null);
  // Which template's text is currently in the textarea (drives the tick on
  // the rail and the live re-resolve when the brand changes).
  const [activeTemplate, setActiveTemplate] = useState(null);
  // Manual override layer for the {brand} and {target_audience} token
  // slots. Seeded from the brand props, then becomes the sole source of
  // truth once the user types — see the sync effect and updateManualValue
  // handler below.
  const [manualValues, setManualValues] = useState(() => ({
    brand: brandName || '',
    targetAudience: targetAudience || '',
  }));

  const abortRef = useRef(null);
  const loadedTypeRef = useRef(null);
  const lastResolvedRef = useRef('');
  const onSelectRef = useRef(onSelect);
  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  // Lazy fetch on first open; refetch when type changes.
  useEffect(() => {
    if (!open) return undefined;
    if (loadedTypeRef.current === type) return undefined;

    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setState('loading');
    setError('');

    fetchPromptTemplates(type, ctrl.signal)
      .then((items) => {
        loadedTypeRef.current = type;
        setTemplates(items);
        setState('loaded');
      })
      .catch((err) => {
        if (err.name === 'AbortError') return;
        setError(err.message || 'Failed to load templates');
        setState('error');
      });

    return () => ctrl.abort();
  }, [open, type]);

  // Closing the panel clears the right-side preview so re-open re-defaults.
  useEffect(() => {
    if (!open) setPreviewedTemplate(null);
  }, [open]);

  // Auto-open the panel the moment the user picks a brand — the templates
  // become resolvable (brand name + target audience get substituted into
  // the prompt body), so the panel surfaces itself without an extra click.
  // Only fires on a genuine empty → truthy transition: brand swaps
  // (truthy → truthy) and clears (truthy → '') are no-ops so the user's
  // explicit close after a prior brand selection isn't reopened.
  const prevBrandNameRef = useRef(brandName);
  useEffect(() => {
    const prev = prevBrandNameRef.current;
    prevBrandNameRef.current = brandName;
    if (!prev && brandName && !open) setOpen(true);
    // `open` deliberately not in deps — we only want to react to brand
    // changes, and setOpen(true) when already true is a no-op.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brandName]);

  // On open (once templates are loaded), default the preview: the used
  // template if one is set (shown with its tick in the rail), otherwise the
  // first template in the list. Never leaves the right panel empty.
  useEffect(() => {
    if (!open || state !== 'loaded' || templates.length === 0) return;
    if (previewedTemplate) return;
    const used = activeTemplate
      ? templates.find((t) => t._id === activeTemplate._id)
      : null;
    setPreviewedTemplate(used || templates[0]);
  }, [open, state, templates, previewedTemplate, activeTemplate]);

  // Variant switch invalidates everything — including any manual token
  // entries (they belong to the section the user was just in).
  useEffect(() => {
    setActiveTemplate(null);
    setPreviewedTemplate(null);
    lastResolvedRef.current = '';
    setManualValues({ brand: brandName || '', targetAudience: targetAudience || '' });
    // brandName/targetAudience deliberately omitted — we only want this to
    // fire on a real variant switch, not whenever the brand changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type]);

  // Sync manual token values from the brand chip. Only fires on truthy
  // transitions of brandName (initial selection or brand swap) — a clear
  // (truthy → '') is intentionally NOT synced, because that path is
  // triggered by updateManualValue calling onClearBrand and re-syncing
  // here would wipe the user's input mid-keystroke.
  const prevBrandForSyncRef = useRef(brandName);
  useEffect(() => {
    const prev = prevBrandForSyncRef.current;
    prevBrandForSyncRef.current = brandName;
    if (brandName && brandName !== prev) {
      setManualValues({ brand: brandName, targetAudience: targetAudience || '' });
    }
  }, [brandName, targetAudience]);

  // Active template / manual values change → push resolved text out.
  // Reads from manualValues so manual entries take precedence over the
  // brand chip (and so they live-update the textarea like brand changes
  // used to).
  useEffect(() => {
    if (!activeTemplate) return;
    const resolved = resolveTemplate(
      activeTemplate.prompt,
      manualValues.brand,
      manualValues.targetAudience,
    );
    lastResolvedRef.current = resolved;
    onSelectRef.current?.(resolved);
  }, [activeTemplate, manualValues.brand, manualValues.targetAudience]);

  // Manual-edit detection: parent value drifted from what we last wrote.
  // Depends only on `currentValue` so this doesn't spuriously fire on the
  // same render where `activeTemplate` was just set by useTemplate() — at
  // that point currentValue is still stale (the parent hasn't rendered the
  // resolve effect's onSelect yet), which would otherwise clear the active
  // template immediately. The ref lets us read the latest activeTemplate
  // without taking a dep on it.
  const activeTemplateRef = useRef(activeTemplate);
  useEffect(() => {
    activeTemplateRef.current = activeTemplate;
  }, [activeTemplate]);
  useEffect(() => {
    if (activeTemplateRef.current && currentValue !== lastResolvedRef.current) {
      setActiveTemplate(null);
      lastResolvedRef.current = '';
    }
  }, [currentValue]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const previewTemplate = (t) => setPreviewedTemplate(t);

  // "Use this prompt" — commit the previewed template to the textarea.
  // Panel stays open so the user can keep browsing.
  const useTemplate = () => {
    if (!previewedTemplate) return;
    setActiveTemplate(previewedTemplate);
  };

  // Token input handler — called from TokenInput in the panel as the user
  // types. Only the brand-token edit deselects the brand chip; editing
  // {target_audience} leaves the chip alone so the user can still keep
  // (e.g.) WWE's logo and brand images while overriding the audience
  // text. The sync effect above sees the brand clear (truthy → '') and
  // intentionally does NOT sync, which is what preserves the user's
  // typing into the brand input.
  const updateManualValue = (key, value) => {
    setManualValues((prev) => ({ ...prev, [key]: value }));
    if (key === 'brand') onClearBrand?.();
  };

  return {
    open,
    setOpen,
    state,
    error,
    templates,
    previewedTemplate,
    activeTemplate,
    previewTemplate,
    useTemplate,
    brandName,
    targetAudience,
    manualBrand: manualValues.brand,
    manualTargetAudience: manualValues.targetAudience,
    updateManualValue,
  };
}
