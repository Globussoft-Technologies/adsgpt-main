import { useDispatch, useSelector } from 'react-redux';
import { Globe, LibraryBig, PenLine, Image as ImageIcon, Film, X } from 'lucide-react';
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
              backgroundColor: `${accent}26`, // ~15% alpha
              boxShadow: `0 0 0 1px ${accent}55, 0 0 12px ${accent}33`,
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
                  ? 'text-white'
                  : 'border-white/10 bg-transparent text-white/50 hover:border-white/20 hover:text-white/80'
              }`}
            >
              <Icon className="h-3 w-3" style={isOn ? { color: accent } : undefined} />
              <span>{label}</span>
              {isOn && (
                <X
                  className="h-3 w-3 text-white/70 transition-colors group-hover:text-white"
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
