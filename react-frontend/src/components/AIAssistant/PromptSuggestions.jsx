import { useSelector } from 'react-redux';

// Small starter-prompt hints for the empty/welcome screen. They change with the
// creative type the user has selected — which IS the tool chip already inside
// the composer (Web / Ad Library / Ad Copy / Creative / Video), so there's no
// second row of buttons. Rendered as small, plain text pills (no icons).
// Clicking one seeds the composer so the user can edit before sending.
const SUGGESTIONS = {
  image: [
    'Product shot for wireless earbuds',
    'Lifestyle ad for running shoes',
    'Black Friday sale banner — 40% off',
  ],
  video: [
    '15s UGC ad for a meal kit',
    '6s product demo video',
    'Cinematic brand video for a coffee roaster',
  ],
  copy: [
    '3 Facebook ad headlines for a SaaS app',
    'TikTok hook for a $29 water bottle',
    'LinkedIn ad copy for B2B analytics',
  ],
  research: [
    "Competitor ads for Nike on Instagram",
    'Best skincare ads on Meta',
    'Pinterest ads in athleisure',
  ],
  // No creative tool selected yet — a small mixed set.
  default: [
    'Product shot for wireless earbuds',
    '3 Facebook ad headlines for a SaaS app',
    'Competitor ads for Nike on Instagram',
  ],
};

// The active creative type is whichever composer tool chip is on. When several
// are on, prefer the most specific creative intent.
const TOOL_TO_TYPE = [
  ['adCreativeGenerator', 'image'],
  ['adVideoGenerator', 'video'],
  ['adCopyGenerator', 'copy'],
  ['searchTheAdLibrary', 'research'],
  ['searchTheWeb', 'research'],
];

const PromptSuggestions = ({ onPick }) => {
  const enabled = useSelector((s) => s.aiAssistant?.enabledTools) || [];
  const match = TOOL_TO_TYPE.find(([tool]) => enabled.includes(tool));
  const list = SUGGESTIONS[match ? match[1] : 'default'] || SUGGESTIONS.default;

  return (
    <div className="mt-4 flex w-full max-w-[1040px] flex-wrap justify-center gap-1.5 px-3 sm:px-0">
      {list.map((s) => (
        <button
          key={s}
          type="button"
          onClick={() => onPick?.(s)}
          className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-[11.5px] text-white/50 transition-colors hover:border-white/25 hover:text-white/85"
        >
          {s}
        </button>
      ))}
    </div>
  );
};

export default PromptSuggestions;
