import { ChevronLeft, ChevronRight, PanelRightClose, Sparkles } from 'lucide-react';
import ChoiceForm from './ChoiceForm';

// Right-side, non-modal canvas for genCards (creative briefs) — the chat stays
// interactive on the left (like Claude's canvas). One genCard shows at a time;
// when a chat has several, the arrows page between them. Auto-opened by the
// parent when a new brief arrives; closable via the X. Rendered inside the chat
// flex row so it takes real layout width on desktop and overlays on mobile.
//
// cards: [{ id, choiceForm, choiceFormResult }] — assistant messages with a brief.
const GenCanvas = ({
  open,
  cards = [],
  activeIndex = 0,
  onPrev,
  onNext,
  onClose,
  onChoiceFormSubmit,
  pending,
}) => {
  const count = cards.length;
  const idx = Math.min(Math.max(activeIndex, 0), Math.max(count - 1, 0));
  const active = cards[idx] || null;
  const isOpen = open && count > 0 && !!active;

  return (
    <aside
      aria-hidden={!isOpen}
      className={`z-30 flex h-full shrink-0 flex-col border-l border-white/[0.08] bg-[#0A0A0A]/75 backdrop-blur-2xl transition-[width,transform] duration-300 ease-out ${
        isOpen
          ? 'pointer-events-auto w-full translate-x-0 opacity-100 sm:w-[440px] lg:w-[520px]'
          : 'pointer-events-none w-0 translate-x-full opacity-0'
      } max-sm:absolute max-sm:inset-y-0 max-sm:right-0`}
    >
      {isOpen && (
        <>
          {/* Header */}
          <div className="flex items-center justify-between gap-2 border-b border-white/[0.06] px-3 py-2.5">
            <div className="inline-flex min-w-0 items-center gap-1.5">
              <Sparkles className="h-3.5 w-3.5 shrink-0 text-[#15DCFF]" />
              <span className="truncate text-[12.5px] font-semibold text-white/85">
                Creative Studio
              </span>
            </div>
            <div className="flex items-center gap-1">
              {count > 1 && (
                <>
                  <button
                    type="button"
                    onClick={onPrev}
                    disabled={idx === 0}
                    title="Previous brief"
                    className="inline-flex h-7 w-7 items-center justify-center rounded-md text-white/55 transition-colors hover:bg-white/[0.07] hover:text-white disabled:opacity-30 disabled:hover:bg-transparent"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <span className="min-w-[38px] text-center text-[11px] tabular-nums text-white/45">
                    {idx + 1} / {count}
                  </span>
                  <button
                    type="button"
                    onClick={onNext}
                    disabled={idx === count - 1}
                    title="Next brief"
                    className="inline-flex h-7 w-7 items-center justify-center rounded-md text-white/55 transition-colors hover:bg-white/[0.07] hover:text-white disabled:opacity-30 disabled:hover:bg-transparent"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </>
              )}
              <button
                type="button"
                onClick={onClose}
                title="Close canvas"
                className="ml-1 inline-flex h-7 w-7 items-center justify-center rounded-md text-white/55 transition-colors hover:bg-white/[0.07] hover:text-white"
              >
                <PanelRightClose className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Body — the active genCard. No scroll here: ChoiceForm fills this
              and manages its own internal scroll region so its credit total /
              image count / Generate footer stay pinned in view. */}
          <div className="flex min-h-0 flex-1 flex-col px-3 pb-4">
            {active?.choiceForm && (
              <ChoiceForm
                key={active.id}
                form={active.choiceForm}
                messageId={active.id}
                result={active.choiceFormResult}
                onSubmit={onChoiceFormSubmit}
                disabled={pending}
              />
            )}
          </div>
        </>
      )}
    </aside>
  );
};

export default GenCanvas;
