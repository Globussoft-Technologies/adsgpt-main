import { CheckCircle, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useSelector } from 'react-redux';

const TextSlider = ({ adCopies, onSelect, selectedText, setAdCopies, onAddCopy }) => {
  const [editingId, setEditingId] = useState(null);
  const [localCopies, setLocalCopies] = useState(adCopies);
  const isDarkMode = useSelector((state) => state.theme.isDarkMode);

  // Sync with parent adCopies when they change
  useEffect(() => {
    setLocalCopies(adCopies);
  }, [adCopies]);

  // Auto-select first ad copy when copies are loaded and no *valid* copy is selected
  // Handles cases where `selectedText` might be an empty array/object or have empty fields
  useEffect(() => {
    const hasValidSelection =
      selectedText &&
      (typeof selectedText === 'object' && !Array.isArray(selectedText)
        ? Boolean(
            (selectedText.primaryText && selectedText.primaryText.trim()) ||
            (selectedText.headline && selectedText.headline.trim())
          )
        : false);

    if (adCopies?.length > 0 && !hasValidSelection && onSelect) {
      onSelect(adCopies[0]);
    }
  }, [adCopies, selectedText, onSelect]);

  useEffect(() => {
    setEditingId(null);
  }, [selectedText]);

  const updateCopy = (id, field, value) => {
    setLocalCopies((prev) =>
      prev.map((copy) => (copy?.id === id ? { ...copy, [field]: value } : copy))
    );
  };

  const handleSaveEdit = (adCopy) => {
    // Update parent state
    setAdCopies((prev) => prev?.map((copy) => (copy?.id === adCopy?.id ? adCopy : copy)));

    // If this copy is currently selected, update the selected text
    if (selectedText?.id === adCopy?.id) {
      onSelect(adCopy);
    }

    // Exit editing mode
    setEditingId(null);
  };

  const handleSelect = (adCopy) => {
    if (editingId === adCopy?.id) {
      // Save changes before selecting
      const editedCopy = localCopies.find((c) => c?.id === adCopy?.id);
      if (editedCopy) {
        handleSaveEdit(editedCopy);
      }
    }
    onSelect(adCopy);
  };

  return (
    <div className="flex items-start gap-2">
      {/* Scroller — copies only. flex-1 + min-w-0 so it fills the space left of
          the add card and scrolls horizontally without pushing it off-screen. */}
      <div
        className={`${isDarkMode ? 'scrollbar-white' : ''} flex min-w-0 flex-1 gap-2 overflow-x-auto pb-4`}
      >
      {localCopies.map((adCopy, index) => {
        const isSelected =
          adCopy?.headline + adCopy?.primaryText ===
          selectedText?.headline + selectedText?.primaryText;
        const isEditing = editingId === adCopy?.id;
        const currentCopy = isEditing ? localCopies?.find((c) => c?.id === adCopy?.id) : adCopy;

        const labelClass = `mb-1 shrink-0 text-[11px] font-semibold uppercase tracking-wide ${
          isSelected ? 'text-white/80' : 'text-gray-400 dark:text-white/50'
        }`;
        const bodyScroll = `min-h-0 flex-1 overflow-y-auto pr-1 text-xs whitespace-pre-wrap break-words 2xl:text-sm ${
          isSelected ? 'scrollbar-white text-white' : 'scrollbar-thin text-gray-500 dark:text-[#DFDFDF]'
        }`;

        return (
          <div
            key={adCopy?.id}
            className={`relative flex h-64 w-55 flex-shrink-0 flex-col overflow-hidden rounded-xl p-4 text-xs 2xl:h-78 2xl:w-[240px] ${
              isSelected
                ? 'bg-gradient-to-br from-[#424CFF] to-[#22C5FD] text-white'
                : 'bg-black/5 dark:bg-white/10 text-gray-500 dark:text-white/70'
            }`}
            onClick={() => handleSelect(adCopy)}
          >
            <div className="mb-2 flex shrink-0 items-center justify-between gap-2">
              <p className={`text-base font-bold ${isSelected ? 'text-white' : 'text-gray-900 dark:text-white'} 2xl:text-lg`}>
                Ad Copy {index + 1}
              </p>
              {isEditing && (
                <button onClick={(e) => { e.stopPropagation(); handleSelect(adCopy); }}>
                  <CheckCircle className={`h-4.5 w-4.5 ${isSelected ? 'text-white/80 hover:text-white' : 'text-gray-500 dark:text-white/70 hover:text-black dark:hover:text-white'}`} />
                </button>
              )}
            </div>

            {isEditing ? (
              <div className="flex min-h-0 flex-1 flex-col gap-2">
                <textarea
                  value={currentCopy?.primaryText || ''}
                  onChange={(e) => updateCopy(adCopy?.id, 'primaryText', e?.target?.value)}
                  className="min-h-0 w-full flex-1 resize-none rounded-md bg-black/20 p-2.5 text-xs text-white outline-none 2xl:text-sm"
                  placeholder="Primary text"
                />
                <input
                  value={currentCopy?.headline || ''}
                  onChange={(e) => updateCopy(adCopy?.id, 'headline', e?.target?.value)}
                  className="w-full shrink-0 rounded-md bg-black/20 p-2.5 text-xs text-white outline-none 2xl:text-sm"
                  placeholder="Headline"
                />
              </div>
            ) : (
              // Two independent sections so a long headline never pushes the
              // primary text — each gets its own bounded, scrollable box.
              <div className="flex min-h-0 flex-1 flex-col gap-3">
                <div className="flex min-h-0 flex-[3] flex-col">
                  <span className={labelClass}>Primary text</span>
                  <div className={bodyScroll}>{adCopy?.primaryText || '—'}</div>
                </div>
                <div className="flex min-h-0 flex-[2] flex-col">
                  <span className={labelClass}>Headline</span>
                  <div className={bodyScroll}>{adCopy?.headline || '—'}</div>
                </div>
              </div>
            )}
          </div>
        );
      })}
      </div>

      {/* Add card — fixed on the right, always visible, never overlapped. */}
      {onAddCopy && (
        <button
          type="button"
          onClick={onAddCopy}
          className="group flex h-64 w-55 flex-shrink-0 flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-black/15 bg-gray-100 text-gray-500 transition-colors hover:border-[#2364B8] hover:text-[#2364B8] 2xl:h-78 2xl:w-[240px] dark:border-white/15 dark:bg-white/5 dark:text-white/60 dark:hover:border-[#2364B8] dark:hover:text-white"
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-black/5 transition-colors group-hover:bg-[#2364B8]/10 dark:bg-white/10 2xl:h-11 2xl:w-11">
            <Plus className="h-5 w-5 2xl:h-6 2xl:w-6" />
          </span>
          <span className="text-xs font-medium 2xl:text-sm">Add ad copy</span>
        </button>
      )}
    </div>
  );
};

export default TextSlider;
