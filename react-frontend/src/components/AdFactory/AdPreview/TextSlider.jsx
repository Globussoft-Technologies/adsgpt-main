import { Check, CheckCircle, Pencil } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useSelector } from 'react-redux';

const TextSlider = ({ adCopies, onSelect, selectedText, setAdCopies }) => {
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
    <div className={`${isDarkMode ? "scrollbar-white" : ""} flex gap-2 overflow-x-auto pb-4`}>
      {localCopies.map((adCopy, index) => {
        const isSelected =
          adCopy?.headline + adCopy?.primaryText ===
          selectedText?.headline + selectedText?.primaryText;
        const isEditing = editingId === adCopy?.id;
        const currentCopy = isEditing ? localCopies?.find((c) => c?.id === adCopy?.id) : adCopy;

        return (
          <div
            key={adCopy?.id}
            className={`scrollbar-hide relative flex h-64 w-55 flex-shrink-0 flex-col overflow-auto rounded-xl p-4 text-xs 2xl:h-78 2xl:w-[240px] ${
              isSelected
                ? 'bg-gradient-to-br from-[#424CFF] to-[#22C5FD] text-white'
                : 'bg-black/5 dark:bg-white/10 text-gray-500 dark:text-white/70'
            }`}
            onClick={() => handleSelect(adCopy)}
          >
            <button>
              {isEditing && (
                <CheckCircle
                  className="h-4.5 w-4.5 text-gray-500 dark:text-white/70 hover:text-black dark:hover:text-white"
                  onClick={() => handleSelect(adCopy)}
                />
              )}
            </button>

            <p className={`mb-2 text-base font-bold ${isSelected ? 'text-white' : 'text-gray-900 dark:text-white'} 2xl:text-lg`}>Ad Copy {index + 1}</p>

            {isEditing ? (
              <textarea
                value={currentCopy?.primaryText || ''}
                onChange={(e) => updateCopy(adCopy?.id, 'primaryText', e?.target?.value)}
                className="mb-2 h-50 w-full resize-none rounded-md bg-black/20 p-2.5 text-xs text-white outline-none 2xl:text-sm"
                rows={4}
              />
            ) : (
              <p
                className={`mb-3 max-h-[150px] overflow-auto text-xs 2xl:text-sm ${isSelected ? 'scrollbar-white text-white' : 'scrollbar-thin text-gray-500 dark:text-[#DFDFDF]'}`}
              >
                Primary Text: {adCopy?.primaryText} <br />
                {adCopy?.ctaLabel}
              </p>
            )}

            {isEditing ? (
              <input
                value={currentCopy?.headline || ''}
                onChange={(e) => updateCopy(adCopy?.id, 'headline', e?.target?.value)}
                className="mb-2 w-full rounded-md bg-black/20 p-2.5 text-xs text-white outline-none 2xl:text-sm"
              />
            ) : (
              <p
                className={`${isSelected ? 'text-white' : 'text-gray-500 dark:text-[#DFDFDF]'} my-2 text-xs 2xl:text-sm`}
              >
                Headline: {adCopy?.headline}
              </p>
            )}

            {/* <button
              disabled={isEditing}
              className={`mt-auto self-center rounded-full bg-white px-4 py-1.5 text-[13px] font-semibold text-[#0F0F0F] shadow-md shadow-white/25 ${
                isEditing ? 'cursor-not-allowed opacity-50' : 'hover:opacity-75'
              }`}
              onClick={() => handleSelect(adCopy)}
            >
              {isSelected ? 'Selected' : 'Select'}
            </button> */}
          </div>
        );
      })}
    </div>
  );
};

export default TextSlider;
