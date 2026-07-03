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
  const locked = disabled || !!chosenId;

  return (
    <div className="mt-3 w-full">
      <div className="mb-2 flex items-center gap-1.5 text-[12px] font-medium text-white/60">
        <Lightbulb className="h-3.5 w-3.5" />
        <span>{cards?.title || 'Pick a concept to develop'}</span>
      </div>

      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
        {concepts.map((c) => {
          const isChosen = chosenId === c.id;
          const dimmed = chosenId && !isChosen;
          return (
            <button
              key={c.id}
              type="button"
              disabled={locked}
              onClick={() => !locked && onSelect?.({ messageId, concept: c })}
              className={`group relative flex flex-col rounded-xl border p-3 text-left transition-all duration-150 ${
                isChosen
                  ? 'border-[#5E66F5] bg-[#5E66F5]/10'
                  : 'border-white/10 bg-white/[0.03] hover:border-white/25 hover:bg-white/[0.06]'
              } ${dimmed ? 'opacity-45' : ''} ${locked ? 'cursor-default' : 'cursor-pointer'}`}
            >
              {c.angle_label ? (
                <span className="mb-1.5 inline-flex w-fit items-center rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] font-medium tracking-wide text-white/55 uppercase">
                  {c.angle_label}
                </span>
              ) : null}

              {c.title ? (
                <h4 className="text-[13.5px] leading-snug font-semibold text-white/90">{c.title}</h4>
              ) : null}

              {c.description ? (
                <p className="mt-1 text-[12px] leading-relaxed text-white/55 line-clamp-4">
                  {c.description}
                </p>
              ) : null}

              {c.headline ? (
                <p className="mt-2 border-l-2 border-white/15 pl-2 text-[11.5px] leading-snug text-white/70 italic">
                  “{c.headline}”
                </p>
              ) : null}

              <div className="mt-3 flex items-center justify-between pt-1">
                {c.creative_type ? (
                  <span className="text-[10.5px] text-white/40">
                    {c.creative_type.replace(/_/g, ' ')}
                  </span>
                ) : (
                  <span />
                )}
                <span
                  className={`inline-flex items-center gap-1 text-[11px] font-medium ${
                    isChosen ? 'text-[#8b91ff]' : 'text-white/45 group-hover:text-white/80'
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
        <p className="mt-2 text-[11px] text-white/40">
          Opening your creative brief on the right — tweak it and hit Generate.
        </p>
      ) : null}
    </div>
  );
};

export default ConceptCards;
