import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, Search, X, Check } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

const CategoryFilter = ({ categories, activeCategoryId, activeSubCategoryId, onChange }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [expandedCats, setExpandedCats] = useState(new Set());
  const containerRef = useRef(null);

  const selectedCat = categories.find((c) => c.id === activeCategoryId);
  const selectedSub = selectedCat?.subcategories?.find((s) => s.id === activeSubCategoryId);

  const displayLabel = selectedSub
    ? selectedSub.name
    : selectedCat
      ? selectedCat.name
      : 'All categories';

  // Close on outside click
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Auto-expand categories that match search or have selected subcategory
  useEffect(() => {
    const toExpand = new Set();
    for (const cat of categories) {
      if (searchTerm) {
        const matches =
          cat.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
          cat.subcategories?.some((s) => s.name.toLowerCase().includes(searchTerm.toLowerCase()));
        if (matches) toExpand.add(cat.id);
      }
      if (cat.id === activeCategoryId) {
        toExpand.add(cat.id);
      }
    }
    setExpandedCats(toExpand);
  }, [categories, searchTerm, activeCategoryId]);

  const toggleExpand = (catId) => {
    setExpandedCats((prev) => {
      const next = new Set(prev);
      if (next.has(catId)) next.delete(catId);
      else next.add(catId);
      return next;
    });
  };

  const handleSelectCategory = (catId) => {
    if (typeof onChange !== 'function') {
      // console.warn('CategoryFilter: onChange prop is not a function');
      return;
    }
    onChange({ categoryId: catId, subCategoryId: '' });
    setIsOpen(false);
    setSearchTerm('');
  };

  const handleSelectSubcategory = (catId, subId) => {
    if (typeof onChange !== 'function') {
      // console.warn('CategoryFilter: onChange prop is not a function');
      return;
    }
    onChange({ categoryId: catId, subCategoryId: subId });
    setIsOpen(false);
    setSearchTerm('');
  };

  const handleClear = (e) => {
    e.stopPropagation();
    if (typeof onChange !== 'function') {
      // console.warn('CategoryFilter: onChange prop is not a function');
      return;
    }
    onChange({ categoryId: '', subCategoryId: '' });
  };

  const filteredCategories = categories.filter((cat) => {
    if (!searchTerm) return true;
    const term = searchTerm.toLowerCase();
    return (
      cat.name.toLowerCase().includes(term) ||
      cat.subcategories?.some((s) => s.name.toLowerCase().includes(term))
    );
  });

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

              {filteredCategories.map((cat) => {
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
                        onClick={() => handleSelectCategory(cat.id)}
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
                                  onClick={() => handleSelectSubcategory(cat.id, sub.id)}
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

              {filteredCategories.length === 0 && (
                <div className="py-4 text-center text-xs text-white/30">No categories found</div>
              )}
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
