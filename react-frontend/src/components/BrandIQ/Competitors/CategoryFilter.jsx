import React, { useState, useRef, useEffect, useCallback } from 'react';
import { ChevronDown, Search, X, Check, Minus, Loader } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import axios from 'axios';

const AI_CAT_SEARCH_URL = import.meta.env.VITE_AI_CAT_SEARCH_URL;

// Matches weaker than this are treated as irrelevant and dropped.
// NOTE: assumes a lower score = a closer/better match (distance-style).
// If the API's score is similarity (higher = better), flip the comparison below.
const SCORE_THRESHOLD = 0.59;

const CategoryFilter = ({
  categories: staticCategories = [],
  activeCategoryIds = [],
  activeSubCategoryIds = [],
  onChange,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [categories, setCategories] = useState([]);
  const [searching, setSearching] = useState(false);
  const [expandedCats, setExpandedCats] = useState(new Set());
  // Remembers id → display name as the user toggles, so the chip can show a
  // single selection's label without re-deriving it from the (search-mutated) tree.
  const [nameById, setNameById] = useState({});
  // Local selection state. We deliberately keep these separate:
  //  - selectedCats: categories the user checked DIRECTLY (independent filter)
  //  - selectedSubs: subcategories the user checked
  //  - subParent:    subId → parent categoryId, so a selected subcategory can
  //                  carry its parent categoryId in the payload (old behavior).
  const [selectedCats, setSelectedCats] = useState(() => new Set(activeCategoryIds));
  const [selectedSubs, setSelectedSubs] = useState(() => new Set(activeSubCategoryIds));
  const [subParent, setSubParent] = useState({});
  const containerRef = useRef(null);
  const debounceRef = useRef(null);

  const hasSelection = selectedCats.size + selectedSubs.size > 0;

  // Chip label: collapse a fully-selected category into ONE unit so picking a
  // whole category reads as "Alcohol" (or "1 selected") rather than "5 selected".
  // staticCategories is the full, stable tree (independent of the search view).
  const selectionUnits = [];
  for (const c of staticCategories) {
    const subs = c.subcategories || [];
    if (subs.length === 0) continue;
    const sel = subs.filter((s) => selectedSubs.has(s.id));
    if (sel.length > 0 && sel.length === subs.length) {
      selectionUnits.push(c.name); // whole category
    } else {
      for (const s of sel) selectionUnits.push(nameById[s.id] || s.name);
    }
  }
  for (const id of selectedCats) selectionUnits.push(nameById[id] || 'Category');
  const displayLabel =
    selectionUnits.length === 0
      ? 'All categories'
      : selectionUnits.length === 1
        ? selectionUnits[0]
        : `${selectionUnits.length} selected`;

  const rememberName = (id, name) =>
    setNameById((prev) => (prev[id] ? prev : { ...prev, [id]: name }));

  // Build the onChange payload. A selected subcategory contributes BOTH its own
  // id AND its parent categoryId, so the backend gets category + subcategory
  // together — exactly like the previous single-select behavior. Directly
  // checked categories are added independently.
  const emitChange = (cats, subs, parents) => {
    if (typeof onChange !== 'function') return;
    const categoryIds = new Set(cats);
    for (const subId of subs) {
      const parentId = parents[subId];
      if (parentId) categoryIds.add(parentId);
    }
    onChange({ categoryIds: [...categoryIds], subCategoryIds: [...subs] });
  };

  // Close on outside click
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [staticCategories]);

  // Debounced search — hits AI Cat Search API
  const doSearch = useCallback(async (query) => {
    if (!query.trim()) {
      setCategories(staticCategories);
      setSearching(false);
      return;
    }
    setSearching(true);
    try {
      const { data } = await axios.post(AI_CAT_SEARCH_URL, { query });
      // Drop weak matches: if score > threshold, treat as irrelevant.
      // When everything is filtered out, the tree is empty and the UI
      // falls through to the existing "No categories found" empty state.
      const relevantMatches = (data.matches || []).filter(
        (m) => typeof m.score !== 'number' || m.score <= SCORE_THRESHOLD
      );
      // Build a deduped category tree from matches
      const catMap = new Map();
      for (const match of relevantMatches) {
        const catId = String(match.major_category_id);
        if (!catMap.has(catId)) {
          catMap.set(catId, {
            id: catId,
            name: match.major_category,
            subcategories: new Map(),
          });
        }
        const cat = catMap.get(catId);
        const subId = String(match.sub_category_id);
        if (!cat.subcategories.has(subId)) {
          cat.subcategories.set(subId, { id: subId, name: match.sub_category });
        }
      }
      const tree = Array.from(catMap.values()).map((c) => ({
        ...c,
        subcategories: Array.from(c.subcategories.values()),
      }));
      setCategories(tree);
      // Auto-expand all returned categories
      setExpandedCats(new Set(tree.map((c) => c.id)));
    } catch {
      setCategories([]);
    } finally {
      setSearching(false);
    }
  }, []);

  // Initialize with static categories when opened
  useEffect(() => {
    if (isOpen && !searchTerm) {
      setCategories(staticCategories);
      setExpandedCats(new Set(staticCategories.map((c) => c.id)));
    }
  }, [isOpen, staticCategories, searchTerm]);

  useEffect(() => {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSearch(searchTerm), 400);
    return () => clearTimeout(debounceRef.current);
  }, [searchTerm, doSearch]);

  const toggleExpand = (catId) => {
    setExpandedCats((prev) => {
      const next = new Set(prev);
      if (next.has(catId)) next.delete(catId);
      else next.add(catId);
      return next;
    });
  };

  // Multi-select: toggle the id in/out of the active set; dropdown stays open
  // so the user can pick several before closing.
  // Selecting a category selects ALL of its subcategories (and deselecting
  // clears them). This keeps every subcategory paired with its parent in the
  // payload, so the backend never has to guess which sub belongs to which cat.
  const handleSelectCategory = (cat) => {
    rememberName(cat.id, cat.name);
    const subs = cat.subcategories || [];

    // Categories without subcategories are a simple independent toggle.
    if (subs.length === 0) {
      const nextCats = new Set(selectedCats);
      if (nextCats.has(cat.id)) nextCats.delete(cat.id);
      else nextCats.add(cat.id);
      setSelectedCats(nextCats);
      emitChange(nextCats, selectedSubs, subParent);
      return;
    }

    const allSelected = subs.every((s) => selectedSubs.has(s.id));
    const nextSubs = new Set(selectedSubs);
    const parents = { ...subParent };
    for (const s of subs) {
      if (allSelected) {
        nextSubs.delete(s.id);
      } else {
        nextSubs.add(s.id);
        parents[s.id] = cat.id;
        rememberName(s.id, s.name);
      }
    }
    setSelectedSubs(nextSubs);
    setSubParent(parents);
    emitChange(selectedCats, nextSubs, parents);
  };

  const handleSelectSubcategory = (cat, sub) => {
    rememberName(sub.id, sub.name);
    const next = new Set(selectedSubs);
    const parents = { ...subParent, [sub.id]: cat.id };
    if (next.has(sub.id)) next.delete(sub.id);
    else next.add(sub.id);
    setSelectedSubs(next);
    setSubParent(parents);
    emitChange(selectedCats, next, parents);
  };

  const clearAll = () => {
    setSelectedCats(new Set());
    setSelectedSubs(new Set());
    emitChange(new Set(), new Set(), subParent);
  };

  const handleClear = (e) => {
    e.stopPropagation();
    clearAll();
  };

  // Radio circle helper
  const Radio = ({ checked }) => (
    <div
      className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border transition-all ${
        checked
          ? 'border-[#02C8C4] bg-[#02C8C4]/20'
          : 'border-black/20 bg-transparent dark:border-white/20'
      }`}
    >
      {checked && <div className="h-2 w-2 rounded-full bg-[#02C8C4]" />}
    </div>
  );

  // Checkbox helper. `indeterminate` renders a dash — used on a parent category
  // when only some of its subcategories are selected.
  const Checkbox = ({ checked, indeterminate }) => (
    <div
      className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-all ${
        checked || indeterminate
          ? 'border-[#02C8C4] bg-[#02C8C4]'
          : 'border-black/20 bg-transparent dark:border-white/20'
      }`}
    >
      {checked && <Check className="h-3 w-3 text-black" strokeWidth={3} />}
      {!checked && indeterminate && <Minus className="h-3 w-3 text-black" strokeWidth={3} />}
    </div>
  );

  return (
    <div className="relative" ref={containerRef}>
      {/* Trigger */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex h-8 items-center gap-2 rounded-full border border-black/10 bg-gray-50 px-4 py-2 text-xs text-gray-700 transition-all hover:bg-gray-100 dark:border-white/10 dark:bg-white/5 dark:text-white/80 dark:hover:bg-white/10"
      >
        <span className="max-w-[120px] truncate">{displayLabel}</span>
        <ChevronDown
          className={`h-3 w-3 text-gray-400 transition-transform dark:text-white/40 ${isOpen ? 'rotate-180' : ''}`}
        />
        {hasSelection && (
          <span
            onClick={handleClear}
            className="ml-1 flex h-4 w-4 items-center justify-center rounded-full bg-gray-100 text-gray-700 hover:bg-gray-200 hover:text-gray-900 dark:bg-white/10 dark:text-white/60 dark:hover:bg-white/20 dark:hover:text-white"
          >
            <X className="h-2.5 w-2.5" />
          </span>
        )}
      </button>

      {/* Dropdown */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: -5 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -5 }}
            transition={{ duration: 0.15 }}
            className="absolute top-full left-0 z-40 mt-2 w-80 overflow-hidden rounded-xl border border-black/10 bg-white shadow-2xl dark:border-white/10 dark:bg-[#1a1a1a]"
          >
            {/* Search */}
            <div className="border-b border-black/10 dark:border-white/10 p-3">
              <div className="relative">
                <Search className="absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-gray-400 dark:text-white/30" />
                <input
                  type="text"
                  placeholder="Search categories..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full rounded-lg border border-black/10 bg-gray-50 py-2 pr-3 pl-8 text-xs text-gray-800 outline-none placeholder:text-gray-400 focus:border-[#02C8C4]/50 dark:border-white/10 dark:bg-[#1a1a1a] dark:text-white dark:placeholder:text-white/30"
                  autoFocus
                />
              </div>
            </div>

            {/* Tree */}
            <div className="cf-scroll max-h-[360px] overflow-y-auto p-2">
              {/* All categories option */}
              <button
                onClick={() => {
                  // "All categories" = clear every selection. Keep the dropdown
                  // open so the reset is visible alongside the other options.
                  clearAll();
                }}
                className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-xs transition-all ${
                  !hasSelection ? 'text-gray-900 dark:text-white font-medium' : 'text-gray-700 dark:text-white/70 dark:hover:text-white'
                } hover:bg-gray-100 dark:hover:bg-white/5`}
              >
                <Radio checked={!hasSelection} />
                <span>All categories</span>
              </button>

              {/* Loading state */}
              {searching && (
                <div className="flex items-center justify-center gap-2 py-6 text-xs text-gray-400 dark:text-white/40">
                  <Loader className="h-3.5 w-3.5 animate-spin text-[#5867EB]" />
                  <span>Searching...</span>
                </div>
              )}

              {/* Static tree placeholder — only shown if no static categories */}
              {!searching && !searchTerm && staticCategories.length === 0 && (
                <div className="py-4 text-center text-xs text-gray-400 dark:text-white/30">
                  No categories available
                </div>
              )}

              {/* No results */}
              {!searching && searchTerm && categories.length === 0 && (
                <div className="py-4 text-center text-xs text-gray-500">No categories found</div>
              )}

              {/* Results tree */}
              {!searching &&
                categories.map((cat) => {
                  const isExpanded = expandedCats.has(cat.id);
                  const hasSubs = cat.subcategories && cat.subcategories.length > 0;
                  const selectedSubCount = hasSubs
                    ? cat.subcategories.filter((s) => selectedSubs.has(s.id)).length
                    : 0;
                  // A category is "selected" when every subcategory is selected
                  // (or, for sub-less categories, when picked directly).
                  const isCatSelected = hasSubs
                    ? selectedSubCount === cat.subcategories.length
                    : selectedCats.has(cat.id);
                  const isCatIndeterminate =
                    hasSubs && selectedSubCount > 0 && selectedSubCount < cat.subcategories.length;

                  return (
                    <div key={cat.id} className="mt-0.5">
                      {/* Category row */}
                      <div className="flex items-center">
                        {hasSubs && (
                          <button
                            onClick={() => toggleExpand(cat.id)}
                            className="flex h-6 w-6 shrink-0 items-center justify-center text-gray-400 hover:text-gray-700 dark:text-white/40 dark:hover:text-white/70 transition-transform"
                          >
                            <ChevronDown
                              className={`h-3 w-3 transition-transform ${isExpanded ? 'rotate-180' : '-rotate-90'}`}
                            />
                          </button>
                        )}
                        {!hasSubs && <div className="h-6 w-6 shrink-0" />}
                        <button
                          onClick={() => handleSelectCategory(cat)}
                          className={`flex flex-1 items-center gap-2.5 rounded-lg px-2 py-1.5 text-xs transition-all hover:bg-gray-100 dark:hover:bg-white/5 ${
                            isCatSelected ? 'text-gray-900 dark:text-white font-medium' : 'text-gray-700 hover:text-gray-950 dark:text-white/70 dark:hover:text-white'
                          }`}
                        >
                          <Checkbox checked={isCatSelected} indeterminate={isCatIndeterminate} />
                          <span className="truncate text-left font-medium">{cat.name}</span>
                        </button>
                      </div>

                      {/* Subcategories */}
                      <AnimatePresence>
                        {isExpanded && hasSubs && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.15 }}
                            className="overflow-hidden"
                          >
                            <div className="ml-6 border-l border-black/10 dark:border-white/10 pl-2">
                              {cat.subcategories.map((sub) => {
                                const isSubSelected = selectedSubs.has(sub.id);
                                return (
                                  <button
                                    key={sub.id}
                                    onClick={() => handleSelectSubcategory(cat, sub)}
                                    className={`flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-xs transition-all hover:bg-gray-100 dark:hover:bg-white/5 ${
                                      isSubSelected
                                        ? 'text-gray-900 dark:text-white font-medium'
                                        : 'text-gray-500 hover:text-gray-800 dark:text-white/50 dark:hover:text-white/80'
                                    }`}
                                  >
                                    <Checkbox checked={isSubSelected} />
                                    <span className="truncate text-left">{sub.name}</span>
                                  </button>
                                );
                              })}
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  );
                })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      {/* Scoped scrollbar styles — avoids polluting global index.css */}
      <style>{`
        .cf-scroll::-webkit-scrollbar {
          width: 5px;
          height: 5px;
        }
        /* Light mode scrollbars */
        .cf-scroll::-webkit-scrollbar-thumb {
          background-color: rgba(0, 0, 0, 0.18);
          border-radius: 9999px;
        }
        .cf-scroll::-webkit-scrollbar-track {
          background: rgba(0, 0, 0, 0.06);
          border-radius: 9999px;
        }
        /* Dark mode overrides (applies when html.dark is present) */
        html.dark .cf-scroll::-webkit-scrollbar-thumb {
          background-color: rgba(255, 255, 255, 0.4);
        }
        html.dark .cf-scroll::-webkit-scrollbar-track {
          background: rgba(40, 40, 40, 0.4);
        }
      `}</style>
    </div>
  );
};

export default CategoryFilter;
