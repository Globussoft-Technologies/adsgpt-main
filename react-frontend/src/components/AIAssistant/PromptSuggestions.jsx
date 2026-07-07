import { useState } from 'react';
import { Image as ImageIcon, PenLine, Film, LibraryBig, Sparkles } from 'lucide-react';

// Starter prompts for the empty/welcome screen. The list swaps based on the
// selected creative type so the suggestions always match what the user is
// trying to make. Picking one seeds the composer (the user can edit before
// sending). Keep each type to 3 short, concrete, editable prompts.
const CREATIVE_TYPES = [
  {
    key: 'image',
    label: 'Image ads',
    Icon: ImageIcon,
    suggestions: [
      'Design a scroll-stopping product shot for my wireless earbuds on a clean studio background',
      'Create a lifestyle Instagram ad showing my running shoes on a morning trail run',
      'Make a bold Black Friday sale banner for my skincare brand — 40% off',
    ],
  },
  {
    key: 'copy',
    label: 'Ad copy',
    Icon: PenLine,
    suggestions: [
      'Write 3 Facebook ad headlines and primary text for a productivity app for remote teams',
      'Write a punchy TikTok hook and caption for a $29 reusable water bottle',
      'Write LinkedIn ad copy for a B2B analytics SaaS targeting marketing directors',
    ],
  },
  {
    key: 'video',
    label: 'Video ads',
    Icon: Film,
    suggestions: [
      'Storyboard a 15-second UGC video ad for a meal-kit subscription',
      'Plan a 6-second product demo video for a smart water bottle',
      'Create a cinematic brand video concept for a premium coffee roaster',
    ],
  },
  {
    key: 'research',
    label: 'Competitor research',
    Icon: LibraryBig,
    suggestions: [
      "Show me what Nike's competitors are running on Instagram right now",
      'Find the best-performing skincare ads on Meta this month',
      'Pull up current Pinterest ads for the athleisure category',
    ],
  },
];

const PromptSuggestions = ({ onPick }) => {
  const [typeKey, setTypeKey] = useState(CREATIVE_TYPES[0].key);
  const active = CREATIVE_TYPES.find((t) => t.key === typeKey) || CREATIVE_TYPES[0];

  return (
    <div className="mt-6 w-full max-w-[1040px] px-3 sm:px-0">
      {/* Creative-type selector — drives which suggestions show below. */}
      <div className="flex flex-wrap items-center justify-center gap-2">
        {CREATIVE_TYPES.map((t) => {
          const on = t.key === typeKey;
          const Icon = t.Icon;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setTypeKey(t.key)}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12.5px] font-medium transition-all ${
                on
                  ? 'border-white/40 bg-white/10 text-white'
                  : 'border-white/10 text-white/55 hover:border-white/25 hover:text-white/80'
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {t.label}
            </button>
          );
        })}
      </div>

      {/* Suggestions for the selected creative type. */}
      <div className="mt-3 flex flex-col gap-2">
        {active.suggestions.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => onPick?.(s)}
            className="group flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3.5 py-2.5 text-left text-[13px] text-white/70 transition-all hover:border-white/25 hover:bg-white/[0.06] hover:text-white"
          >
            <Sparkles className="h-3.5 w-3.5 shrink-0 text-[#15DCFF]" />
            <span className="min-w-0 flex-1">{s}</span>
          </button>
        ))}
      </div>
    </div>
  );
};

export default PromptSuggestions;
