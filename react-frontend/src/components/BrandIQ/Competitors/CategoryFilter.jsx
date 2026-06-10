import React, { useState, useRef, useEffect, useCallback } from 'react';
import { ChevronDown, Search, X, Check, Loader } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import axios from 'axios';

const AI_CAT_SEARCH_URL = import.meta.env.VITE_AI_CAT_SEARCH_URL;

const CategoryFilter = ({ categories: staticCategories = [], activeCategoryId, activeSubCategoryId, onChange }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [categories, setCategories] = useState([]);
  const [searching, setSearching] = useState(false);
  const [expandedCats, setExpandedCats] = useState(new Set());
  const [selectedLabel, setSelectedLabel] = useState({ cat: '', sub: '' });
  const containerRef = useRef(null);
  const debounceRef = useRef(null);

  const displayLabel = selectedLabel.sub || selectedLabel.cat || 'All categories';

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
      // Build a deduped category tree from matches
      const catMap = new Map();
      for (const match of data.matches || []) {
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

  const handleSelectCategory = (cat) => {
    if (typeof onChange !== 'function') return;
    onChange({ categoryId: cat.id, subCategoryId: '' });
    setSelectedLabel({ cat: cat.name, sub: '' });
    setIsOpen(false);
    setSearchTerm('');
  };

  const handleSelectSubcategory = (cat, sub) => {
    if (typeof onChange !== 'function') return;
    onChange({ categoryId: cat.id, subCategoryId: sub.id });
    setSelectedLabel({ cat: cat.name, sub: sub.name });
    setIsOpen(false);
    setSearchTerm('');
  };

  const handleClear = (e) => {
    e.stopPropagation();
    if (typeof onChange !== 'function') return;
    onChange({ categoryId: '', subCategoryId: '' });
    setSelectedLabel({ cat: '', sub: '' });
  };

  // Radio circle helper
  const Radio = ({ checked }) => (
    <div
      className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border transition-all ${
        checked
          ? 'border-[#02C8C4] bg-[#02C8C4]/20'
          : 'border-white/20 bg-transparent'
      }`}
    >
      {checked && <div className="h-2 w-2 rounded-full bg-[#02C8C4]" />}
    </div>
  );

  // Checkbox helper for subcategories
  const Checkbox = ({ checked }) => (
    <div
      className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-all ${
        checked
          ? 'border-[#02C8C4] bg-[#02C8C4]'
          : 'border-white/20 bg-transparent'
      }`}
    >
      {checked && <Check className="h-3 w-3 text-black" strokeWidth={3} />}
    </div>
  );

  return (
    <div className="relative" ref={containerRef}>
      {/* Trigger */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex h-8 items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs text-white/80 transition-all hover:bg-white/10"
      >
        <span className="max-w-[120px] truncate">{displayLabel}</span>
        <ChevronDown className={`h-3 w-3 text-white/40 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
        {(activeCategoryId || activeSubCategoryId) && (
          <span
            onClick={handleClear}
            className="ml-1 flex h-4 w-4 items-center justify-center rounded-full bg-white/10 text-white/60 hover:bg-white/20 hover:text-white"
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
            className="absolute top-full left-0 z-40 mt-2 w-80 overflow-hidden rounded-xl border border-white/10 bg-[#1a1a1a] shadow-2xl"
          >
            {/* Search */}
            <div className="border-b border-white/10 p-3">
              <div className="relative">
                <Search className="absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-white/30" />
                <input
                  type="text"
                  placeholder="Search categories..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full rounded-lg border border-white/10 bg-white/5 py-2 pr-3 pl-8 text-xs text-white placeholder:text-white/30 outline-none focus:border-[#02C8C4]/50"
                  autoFocus
                />
              </div>
            </div>

            {/* Tree */}
            <div className="max-h-[360px] overflow-y-auto p-2 cf-scroll">
              {/* All categories option */}
              <button
                onClick={() => {
                  if (typeof onChange !== 'function') return;
                  onChange({ categoryId: '', subCategoryId: '' });
                  setSelectedLabel({ cat: '', sub: '' });
                  setIsOpen(false);
                  setSearchTerm('');
                }}
                className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-xs transition-all ${
                  !activeCategoryId && !activeSubCategoryId
                    ? 'bg-gradient-to-r from-[#02C8C4] to-[#5867EB] text-white'
                    : 'text-white/70 hover:bg-white/5 hover:text-white'
                }`}
              >
                <Radio checked={!activeCategoryId && !activeSubCategoryId} />
                <span>All categories</span>
              </button>

              {/* Loading state */}
              {searching && (
                <div className="flex items-center justify-center gap-2 py-6 text-xs text-white/40">
                  <Loader className="h-3.5 w-3.5 animate-spin text-[#5867EB]" />
                  <span>Searching...</span>
                </div>
              )}

              {/* Static tree placeholder — only shown if no static categories */}
              {!searching && !searchTerm && staticCategories.length === 0 && (
                <div className="py-4 text-center text-xs text-white/30">
                  No categories available
                </div>
              )}

              {/* No results */}
              {!searching && searchTerm && categories.length === 0 && (
                <div className="py-4 text-center text-xs text-white/30">No categories found</div>
              )}

              {/* Results tree */}
              {!searching && categories.map((cat) => {
                const isExpanded = expandedCats.has(cat.id);
                const isCatSelected = activeCategoryId === cat.id && !activeSubCategoryId;
                const hasSubs = cat.subcategories && cat.subcategories.length > 0;

                return (
                  <div key={cat.id} className="mt-0.5">
                    {/* Category row */}
                    <div className="flex items-center">
                      {hasSubs && (
                        <button
                          onClick={() => toggleExpand(cat.id)}
                          className="flex h-6 w-6 shrink-0 items-center justify-center text-white/40 transition-transform hover:text-white/70"
                        >
                          <ChevronDown className={`h-3 w-3 transition-transform ${isExpanded ? 'rotate-180' : '-rotate-90'}`} />
                        </button>
                      )}
                      {!hasSubs && <div className="h-6 w-6 shrink-0" />}
                      <button
                        onClick={() => handleSelectCategory(cat)}
                        className={`flex flex-1 items-center gap-2.5 rounded-lg px-2 py-1.5 text-xs transition-all ${
                          isCatSelected
                            ? 'bg-gradient-to-r from-[#02C8C4] to-[#5867EB] text-white'
                            : 'text-white/70 hover:bg-white/5 hover:text-white'
                        }`}
                      >
                        <Radio checked={isCatSelected} />
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
                          <div className="ml-6 border-l border-white/10 pl-2">
                            {cat.subcategories.map((sub) => {
                              const isSubSelected = activeSubCategoryId === sub.id;
                              return (
                                <button
                                  key={sub.id}
                                  onClick={() => handleSelectSubcategory(cat, sub)}
                                  className={`flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-xs transition-all ${
                                    isSubSelected
                                      ? 'bg-gradient-to-r from-[#02C8C4] to-[#5867EB] text-white'
                                      : 'text-white/50 hover:bg-white/5 hover:text-white/80'
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
        .cf-scroll::-webkit-scrollbar-thumb {
          background-color: rgba(255, 255, 255, 0.4);
          border-radius: 9999px;
        }
        .cf-scroll::-webkit-scrollbar-track {
          background: rgba(40, 40, 40, 0.4);
          border-radius: 9999px;
        }
      `}</style>
    </div>
  );
};

export default CategoryFilter;
