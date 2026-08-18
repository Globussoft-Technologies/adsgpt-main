import { useDispatch, useSelector } from 'react-redux';
import {
  BadgeDollarSign,
  Film,
  Globe,
  Image as ImageIcon,
  LibraryBig,
  PenLine,
  X,
} from 'lucide-react';
import { toggleTool, TOGGLEABLE_TOOLS } from '@/store/reducers/aiAssistant/aiAssistantSlice';
import Tip from './Tip';

// Order matches the chip rail order below. Keys MUST match TOGGLEABLE_TOOLS
// in the slice (which match the Agent's _TOOL_PACKAGES keys).
//
// `accent` and `tint` are paired — accent is the icon/border color when
// active, tint is the same hue at ~15% alpha used as the chip background.
const TOOL_META = {
  searchTheWeb: {
    label: 'Web',
    title: 'Search the Web — discovery + URL deep-dive.',
    Icon: Globe,
    accent: '#15DCFF',
  },
  searchTheAdLibrary: {
    label: 'Ad Library',
    title: 'Search PowerAdSpy for real competitor ads across every platform.',
    Icon: LibraryBig,
    accent: '#F59E0B',
  },
  metaAdsManager: {
    label: 'Meta Ads',
    title:
      'Analyze your connected Meta Ads account. Every live-account change requires fresh approval.',
    Icon: BadgeDollarSign,
    accent: '#1877F2',
  },
  adCopyGenerator: {
    label: 'Ad Copy',
    title: 'Generate ad copy (headline, body, CTA, hashtags).',
    Icon: PenLine,
    accent: '#10B981',
  },
  adCreativeGenerator: {
    label: 'Creative',
    title: 'Generate ad images — product shot, lifestyle, social post, banner.',
    Icon: ImageIcon,
    accent: '#EC4899',
  },
  adVideoGenerator: {
    label: 'Video',
    title: 'Generate ad videos — b-roll, UGC, product demo, scenes, full storyboards.',
    Icon: Film,
    accent: '#A855F7',
  },
};

const ToolToggles = () => {
  const dispatch = useDispatch();
  const enabled = useSelector((state) => state.aiAssistant.enabledTools);

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {TOGGLEABLE_TOOLS.map((key) => {
        const meta = TOOL_META[key];
        if (!meta) return null;
        const { Icon, label, title, accent } = meta;
        const isOn = enabled.includes(key);

        // Inline style is the cleanest way to drive the per-tool accent
        // through Tailwind without spinning up a custom color scale.
        const activeStyle = isOn
          ? {
              borderColor: accent,
              backgroundColor: `${accent}25`,
              boxShadow: `0 0 0 1.5px ${accent}, 0 0 18px ${accent}66, 0 0 6px ${accent}44`,
            }
          : undefined;

        return (
          <Tip key={key} content={title}>
            <button
              type="button"
              onClick={() => dispatch(toggleTool(key))}
              aria-pressed={isOn}
              style={activeStyle}
              className={`group inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[11.5px] font-medium transition-all duration-150 ${
                isOn
                  ? 'text-zinc-950 font-semibold dark:text-white'
                  : 'border-black/15 bg-black/[0.04] text-zinc-700 hover:border-black/30 hover:bg-black/[0.08] hover:text-zinc-950 dark:border-white/15 dark:bg-white/[0.06] dark:text-white/70 dark:hover:border-white/30 dark:hover:bg-white/[0.12] dark:hover:text-white'
              }`}
            >
              <Icon
                className="h-3 w-3 shrink-0 transition-colors"
                style={isOn ? { color: accent } : undefined}
              />
              <span>{label}</span>
              {isOn && (
                <X
                  className="h-3.5 w-3.5 shrink-0 text-zinc-800 transition-colors group-hover:text-black dark:text-white/80 dark:group-hover:text-white"
                  aria-hidden="true"
                />
              )}
            </button>
          </Tip>
        );
      })}
    </div>
  );
};

export default ToolToggles;
