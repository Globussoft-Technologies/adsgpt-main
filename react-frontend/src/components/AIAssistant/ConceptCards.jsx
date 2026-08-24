import { ArrowRight, Check, Lightbulb } from 'lucide-react';

// Renders the selectable ad-concept cards emitted by the `propose_ad_concepts`
// tool (SSE `concept_cards`). Picking a card sends a `concept_response` turn,
// which opens a creative brief (genCard) pre-filled from the chosen concept.
//
// cards: { title, creative_type, product, concepts: [{ id, angle, angle_label,
//          title, description, headline, visual_idea, creative_type }] }
const ConceptCards = ({ cards, messageId, result, onSelect, disabled }) => {
  const concepts = Array.isArray(cards?.concepts) ? cards.concepts : [];
  if (concepts.length === 0) return null;

  const chosenId = result?.conceptId || null;
  // Picking a concept used to disable the whole set, so exploring a second
  // direction meant regenerating the ideas — and paying for them again. Every
  // concept stays clickable; choosing another opens a fresh brief for it. Only
  // an in-flight turn (`disabled`) blocks selection.
  const locked = disabled;

  return (
    <div className="mt-3 w-full">
      <div className="mb-2 flex items-center gap-1.5 text-[12px] font-medium text-gray-500 dark:text-white/60">
        <Lightbulb className="h-3.5 w-3.5" />
        <span>
          {locked
            ? 'Generating — concepts are available again when this finishes'
            : cards?.title || 'Pick a concept to develop'}
        </span>
      </div>

      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
        {concepts.map((c) => {
          const isChosen = chosenId === c.id;
          return (
            <button
              key={c.id}
              type="button"
              disabled={locked}
              onClick={() => !locked && onSelect?.({ messageId, concept: c })}
              className={`group relative flex flex-col rounded-xl border p-3 text-left transition-all duration-150 ${
                isChosen
                  ? 'border-[#5E66F5] bg-[#5E66F5]/10 text-gray-900 dark:text-white'
                  : 'border-black/10 bg-white/70 hover:border-black/25 hover:bg-white text-gray-900 dark:border-white/10 dark:bg-white/[0.03] dark:hover:border-white/25 dark:hover:bg-white/[0.06] dark:text-white'
              } ${locked ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}
            >
              {c.angle_label ? (
                <span className="mb-1.5 inline-flex w-fit items-center rounded-full border border-black/10 bg-black/[0.04] px-2 py-0.5 text-[10px] font-medium tracking-wide text-gray-600 uppercase dark:border-white/10 dark:bg-white/[0.04] dark:text-white/55">
                  {c.angle_label}
                </span>
              ) : null}

              {c.title ? (
                <h4 className="text-[13.5px] leading-snug font-semibold text-gray-900 dark:text-white/90">{c.title}</h4>
              ) : null}

              {c.description ? (
                <p className="mt-1 text-[12px] leading-relaxed text-gray-600 dark:text-white/55 line-clamp-4">
                  {c.description}
                </p>
              ) : null}

              {c.headline ? (
                <p className="mt-2 border-l-2 border-black/15 pl-2 text-[11.5px] leading-snug text-gray-700 italic dark:border-white/15 dark:text-white/70">
                  “{c.headline}”
                </p>
              ) : null}

              <div className="mt-3 flex items-center justify-between pt-1">
                {c.creative_type ? (
                  <span className="text-[10.5px] text-gray-500 dark:text-white/40">
                    {c.creative_type.replace(/_/g, ' ')}
                  </span>
                ) : (
                  <span />
                )}
                <span
                  className={`inline-flex items-center gap-1 text-[11px] font-medium ${
                    isChosen ? 'text-[#5E66F5] dark:text-[#8b91ff]' : 'text-gray-500 group-hover:text-gray-900 dark:text-white/45 dark:group-hover:text-white/80'
                  }`}
                >
                  {isChosen ? (
                    <>
                      <Check className="h-3.5 w-3.5" /> Selected
                    </>
                  ) : (
                    <>
                      Develop <ArrowRight className="h-3.5 w-3.5" />
                    </>
                  )}
                </span>
              </div>
            </button>
          );
        })}
      </div>

      {chosenId ? (
        <p className="mt-2 text-[11px] text-gray-500 dark:text-white/40">
          Opening your creative brief on the right — tweak it and hit Generate. Pick
          another concept any time to open a brief for that one instead.
        </p>
      ) : null}
    </div>
  );
};

export default ConceptCards;
