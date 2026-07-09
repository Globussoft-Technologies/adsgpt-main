import { useEffect, useMemo, useRef, useState } from 'react';
import {
  fetchPromptTemplates,
  fetchPromptTemplateCategories,
  ensureBrandCategory,
} from '../ai-creatives/apiClient';
import { IS_PROMPT_CATEGORIES_ENABLED } from '@/utils/featureFlags';

const GENERAL_CATEGORY = 'General';

// Original panel height — the size the picker opens at and resets back to
// whenever it's closed (so a prior drag doesn't carry over to the next open).
const DEFAULT_PANEL_HEIGHT = IS_PROMPT_CATEGORIES_ENABLED ? 320 : 279;

// Replace every {placeholder} in a template prompt. Tokens with no value
// (or only whitespace) are stripped out so the literal placeholder text never
// reaches the generation call. After stripping, we clean up leftover spaces
// and punctuation so the prompt still reads naturally.
function resolveTemplate(prompt, values = {}) {
  if (!prompt) return '';
  const resolved = prompt.replace(/\{([^}]+)\}/g, (match, key) => {
    const value = (values[key] ?? '').trim();
    return value ? value : '';
  });
  return cleanupResolvedPrompt(resolved);
}

// Remove artifacts left behind when empty placeholders are stripped:
// multiple spaces, spaces before punctuation, and dangling whitespace.
function cleanupResolvedPrompt(text) {
  return text
    .replace(/\s+([.,;:!?])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+$/gm, '')
    .trim();
}

// Owns: fetch (lazy on first open), panel open state, previewed vs used
// templates, live re-resolve of placeholders when the brand changes, and
// auto-clear of the active template when the user edits the textarea.
export function usePromptTemplates({
  type,
  brandName = '',
  targetAudience = '',
  // The selected brand's taxonomy category (from get-lists / autofill). When
  // present and it has templates, the picker auto-selects it. When absent and
  // a brandId is given, we ask the backend to classify the brand (lazy).
  brandCategory = '',
  brandId = '',
  // When false, picking/having a brand does NOT auto-open the panel (used by
  // the Recreate flow, which should land with the picker collapsed).
  autoOpen = true,
  currentValue = '',
  onSelect,
  // Fired when the user starts typing into a {brand} / {target_audience}
  // (or any other {placeholder}) token in the panel. Per spec the manual
  // entry "wins" over the brand chip — so we ask the consumer to deselect
  // any active brand so the UI matches what's actually driving the resolved
  // prompt.
  onClearBrand,
}) {
  const [open, setOpen] = useState(false);
  // Height (px) of the templates panel, adjustable via the drag handle
  // between the panel and the prompt box. Resets to DEFAULT_PANEL_HEIGHT on
  // close so reopening always starts at the original size.
  const [panelHeight, setPanelHeight] = useState(DEFAULT_PANEL_HEIGHT);
  const [templates, setTemplates] = useState([]);
  const [state, setState] = useState('idle');
  const [error, setError] = useState('');
  const [categories, setCategories] = useState([]);
  const [selectedCategory, setSelectedCategory] = useState(GENERAL_CATEGORY);
  // Cache templates by category so switching categories is instant after the
  // initial prefetch.
  const [templatesByCategory, setTemplatesByCategory] = useState({});
  const [loadedCategories, setLoadedCategories] = useState(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  // True while we're classifying a brand that has no category yet (the
  // ~1-2s on-select Gemini call). Drives the "finding your prompts…" hint.
  const [categoryResolving, setCategoryResolving] = useState(false);
  // Which row is currently shown in the right detail panel.
  const [previewedTemplate, setPreviewedTemplate] = useState(null);
  // Which template's text is currently in the textarea (drives the tick on
  // the rail and the live re-resolve when the brand changes).
  const [activeTemplate, setActiveTemplate] = useState(null);
  // Manual override layer for every {placeholder} slot. Seeded from the
  // brand props, then becomes the sole source of truth once the user types.
  const [manualValues, setManualValues] = useState(() => ({
    brand: brandName || '',
    target_audience: targetAudience || '',
  }));

  const categoryAbortRef = useRef(null);
  const loadedCategoriesRef = useRef(new Set());
  const loadedTypeRef = useRef(null);
  const lastResolvedRef = useRef('');
  const onSelectRef = useRef(onSelect);
  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  // Lazy load the distinct categories for this type on first open and on
  // type change. Skipped when IS_PROMPT_CATEGORIES_ENABLED is off — categories
  // stays empty, so only General templates load (prod behaviour).
  useEffect(() => {
    if (!IS_PROMPT_CATEGORIES_ENABLED) return undefined;
    if (!open) return undefined;
    if (loadedTypeRef.current === type) return undefined;

    categoryAbortRef.current?.abort();
    const ctrl = new AbortController();
    categoryAbortRef.current = ctrl;

    fetchPromptTemplateCategories(type, ctrl.signal)
      .then((cats) => {
        loadedTypeRef.current = type;
        setCategories(cats);
      })
      .catch((err) => {
        if (err.name === 'AbortError') return;
        // eslint-disable-next-line no-console
        console.warn('Failed to load template categories:', err.message);
      });

    return () => ctrl.abort();
  }, [open, type]);

  // Load templates for every category (plus General) incrementally as soon
  // as the category list is known. Each category is cached independently so
  // the selected category can render the moment its own fetch completes,
  // while the rest continue loading in the background. Switching categories
  // after that is instant.
  useEffect(() => {
    if (!open) return undefined;

    const catsToLoad =
      categories.length > 0
        ? [GENERAL_CATEGORY, ...categories]
        : [GENERAL_CATEGORY];

    const controllers = [];

    catsToLoad.forEach((cat) => {
      // Avoid duplicate in-flight fetches when the effect re-runs.
      if (loadedCategoriesRef.current.has(cat)) return;

      const ctrl = new AbortController();
      controllers.push(ctrl);
      const options = cat === GENERAL_CATEGORY ? {} : { category: cat };

      fetchPromptTemplates(type, options, ctrl.signal)
        .then((items) => {
          setTemplatesByCategory((prev) => ({ ...prev, [cat]: items }));
          setLoadedCategories((prev) => new Set(prev).add(cat));
          loadedCategoriesRef.current.add(cat);
        })
        .catch((err) => {
          if (err.name === 'AbortError') return;
          // Per-category failures are soft — show an empty list for that
          // category rather than breaking the whole panel.
          setTemplatesByCategory((prev) => ({ ...prev, [cat]: [] }));
          setLoadedCategories((prev) => new Set(prev).add(cat));
          loadedCategoriesRef.current.add(cat);
        });
    });

    return () => controllers.forEach((c) => c.abort());
  }, [open, type, categories]);

  // Sync the visible templates + state with the selected category cache.
  useEffect(() => {
    if (!open) return;
    if (loadedCategories.has(selectedCategory)) {
      setTemplates(templatesByCategory[selectedCategory] || []);
      setState('loaded');
    } else {
      setState('loading');
    }
  }, [open, selectedCategory, templatesByCategory, loadedCategories]);

  // Search behaviour:
  //  - No term  → show only the selected category's templates (browse mode).
  //  - With term → search GLOBALLY across every loaded category, matching the
  //    title, the prompt body, OR the category name (so typing a category name
  //    surfaces its prompts). Each result is tagged with its `_category` so the
  //    list can show where it came from. A template lives in exactly one
  //    category, but we keep a seen-set to be safe.
  const filteredTemplates = useMemo(() => {
    const term = (searchQuery || '').trim().toLowerCase();
    if (!term) return templates;

    const results = [];
    const seen = new Set();
    Object.entries(templatesByCategory).forEach(([cat, items]) => {
      (items || []).forEach((t) => {
        if (seen.has(t._id)) return;
        const catName = t.category || cat || '';
        const matches =
          (t.title || '').toLowerCase().includes(term) ||
          (t.prompt || '').toLowerCase().includes(term) ||
          catName.toLowerCase().includes(term);
        if (matches) {
          seen.add(t._id);
          results.push({ ...t, _category: catName });
        }
      });
    });
    return results;
  }, [templates, searchQuery, templatesByCategory]);

  // If the active search hides the currently previewed template, clear it so
  // the defaulting effect can pick a visible one.
  useEffect(() => {
    if (
      previewedTemplate &&
      !filteredTemplates.some((t) => t._id === previewedTemplate._id)
    ) {
      setPreviewedTemplate(null);
    }
  }, [filteredTemplates, previewedTemplate]);

  // Closing the panel clears the right-side preview so re-open re-defaults,
  // and resets any dragged height back to the original size.
  useEffect(() => {
    if (!open) {
      setPreviewedTemplate(null);
      setPanelHeight(DEFAULT_PANEL_HEIGHT);
    }
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
    if (autoOpen && !prev && brandName && !open) setOpen(true);
    // `open` deliberately not in deps — we only want to react to brand
    // changes, and setOpen(true) when already true is a no-op.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brandName]);

  // Auto-select the prompt category that matches the selected brand. Gated on
  // the category system being enabled and the category list being known (so we
  // only switch to a category that actually has templates). If the brand has a
  // category already (from get-lists / DS autofill) we use it directly; if not
  // (an existing brand that predates DS), we ask the backend to classify it
  // once (lazy, ~1-2s) and apply the result.
  const ensuredBrandIdRef = useRef(null);
  useEffect(() => {
    if (!IS_PROMPT_CATEGORIES_ENABLED) return undefined;
    if (!open) return undefined;

    let cancelled = false;
    // Resolve the brand's category: if it has templates for this type, switch
    // to it; otherwise fall back to General so a previously-matched category
    // doesn't linger after switching to a brand we have no templates for
    // (e.g. Lockheed→Business, then Coca-Cola→category with no templates).
    const applyResolved = (cat) => {
      if (cancelled) return;
      setSelectedCategory(cat && categories.includes(cat) ? cat : GENERAL_CATEGORY);
    };

    if (brandCategory) {
      // Switch to the brand's category the MOMENT we know it — even before the
      // category list has loaded — so General templates never flash first.
      // The panel shows a loading state for that category until its templates
      // arrive; once the list is known we correct to General if the brand has
      // no templates for this type.
      if (categories.length === 0) {
        setSelectedCategory(brandCategory);
      } else {
        applyResolved(brandCategory);
      }
      return () => {
        cancelled = true;
      };
    }

    // Below this point we need the category list to validate a classified id.
    if (categories.length === 0) {
      return () => {
        cancelled = true;
      };
    }

    // No category on the brand → lazy-classify via backend, once per brand.
    if (brandId && ensuredBrandIdRef.current !== brandId) {
      ensuredBrandIdRef.current = brandId;
      setCategoryResolving(true);
      ensureBrandCategory(brandId)
        .then((cat) => applyResolved(cat))
        .catch(() => {})
        .finally(() => {
          if (!cancelled) setCategoryResolving(false);
        });
    }

    return () => {
      cancelled = true;
    };
  }, [open, brandCategory, brandId, categories]);

  // On open (once templates are loaded), default the preview: the used
  // template if one is set (shown with its tick in the rail), otherwise the
  // first filtered template in the list. Never leaves the right panel empty.
  useEffect(() => {
    if (!open || state !== 'loaded' || filteredTemplates.length === 0) return;
    if (previewedTemplate) return;
    const used = activeTemplate
      ? filteredTemplates.find((t) => t._id === activeTemplate._id)
      : null;
    setPreviewedTemplate(used || filteredTemplates[0]);
  }, [open, state, filteredTemplates, previewedTemplate, activeTemplate]);

  // Variant switch invalidates everything — including any manual token
  // entries (they belong to the section the user was just in).
  useEffect(() => {
    setActiveTemplate(null);
    setPreviewedTemplate(null);
    lastResolvedRef.current = '';
    setManualValues({
      brand: brandName || '',
      target_audience: targetAudience || '',
    });
    setSelectedCategory(GENERAL_CATEGORY);
    setSearchQuery('');
    setCategories([]);
    setTemplatesByCategory({});
    setLoadedCategories(new Set());
    loadedCategoriesRef.current = new Set();
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
      setManualValues((prev) => ({
        ...prev,
        brand: brandName,
        target_audience: targetAudience || '',
      }));
    }
  }, [brandName, targetAudience]);

  // Active template / manual values change → push resolved text out.
  // Reads from manualValues so manual entries take precedence over the
  // brand chip (and so they live-update the textarea like brand changes
  // used to).
  useEffect(() => {
    if (!activeTemplate) return;
    const resolved = resolveTemplate(activeTemplate.prompt, manualValues);
    lastResolvedRef.current = resolved;
    onSelectRef.current?.(resolved);
  }, [activeTemplate, manualValues]);

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

  useEffect(
    () => () => {
      categoryAbortRef.current?.abort();
    },
    [],
  );

  const previewTemplate = (t) => setPreviewedTemplate(t);

  // "Use this prompt" — commit the previewed template to the textarea.
  // Panel stays open so the user can keep browsing.
  const useTemplate = () => {
    if (!previewedTemplate) return;
    setActiveTemplate(previewedTemplate);
  };

  // Token input handler — called from TokenInput in the panel as the user
  // types. Only the {brand} token edit deselects the brand chip; editing
  // any other placeholder leaves the chip alone so the user can still keep
  // (e.g.) WWE's logo and brand images while overriding audience text.
  // The sync effect above sees the brand clear (truthy → '') and
  // intentionally does NOT sync, which is what preserves the user's
  // typing into the brand input.
  const updateManualValue = (key, value) => {
    setManualValues((prev) => ({ ...prev, [key]: value }));
    if (key === 'brand') onClearBrand?.();
  };

  return {
    open,
    setOpen,
    panelHeight,
    setPanelHeight,
    state,
    error,
    templates,
    filteredTemplates,
    categories,
    selectedCategory,
    setSelectedCategory,
    searchQuery,
    setSearchQuery,
    previewedTemplate,
    activeTemplate,
    previewTemplate,
    useTemplate,
    brandName,
    targetAudience,
    brandCategory,
    categoryResolving,
    manualValues,
    updateManualValue,
  };
}
