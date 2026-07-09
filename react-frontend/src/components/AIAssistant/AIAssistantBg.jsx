import bottomEffectImage from '@/assets/layouts/ad-factory/bottom-effect.svg';
import './AIAssistantBg.css';

// Individually twinkling stars. Positions avoid the centered chat column so
// nothing sparkles directly behind text; timing offsets keep them out of sync.
const SPARKLES = [
  { top: '16%', left: '14%', size: 3, duration: '5.5s', delay: '0s' },
  { top: '8%', left: '34%', size: 2, duration: '7s', delay: '1.6s' },
  { top: '22%', left: '74%', size: 2, duration: '6.2s', delay: '3.1s' },
  { top: '55%', left: '9%', size: 2, duration: '8s', delay: '2.2s' },
  { top: '68%', left: '88%', size: 3, duration: '6.8s', delay: '0.9s' },
  { top: '38%', left: '93%', size: 2, duration: '7.6s', delay: '4.3s' },
  { top: '82%', left: '26%', size: 2, duration: '9s', delay: '5.1s' },
];

/**
 * Ambient animated backdrop for the AI Assistant page: three gradient blobs
 * sweeping the page, the Ad Factory bottom aurora (now swaying), a drifting
 * star field, and two floating frosted-glass tiles.
 *
 * Purely decorative (aria-hidden, pointer-events-none) and cheap by design:
 * all motion is transform/opacity-only so it runs on the GPU compositor —
 * see AIAssistantBg.css for the full rationale.
 */
const AIAssistantBg = () => (
  <div
    aria-hidden="true"
    className="ai-bg pointer-events-none fixed inset-0 z-0 overflow-hidden"
  >
    {/* faint drifting star field (single tiled layer) */}
    <div className="ai-bg-stars" />

    {SPARKLES.map((s) => (
      <span
        key={`${s.top}-${s.left}`}
        className="ai-bg-star"
        style={{
          top: s.top,
          left: s.left,
          width: s.size,
          height: s.size,
          animationDuration: s.duration,
          animationDelay: s.delay,
        }}
      />
    ))}

    {/* big blue glow — same gradient Ad Factory uses, sweeping across the top */}
    <div className="ai-bg-blob-a absolute -top-[40%] right-[2vw] h-[19vw] w-[19vw] rounded-full bg-[linear-gradient(90deg,_#0975F0_0%,_#28BCFC_27%,_#8FC8FB_51%,_#28BCFC_72%,_#0975F0_100%)] opacity-50 blur-[100px] dark:opacity-100" />

    {/* indigo glow — crosses the page diagonally, echoing the heading gradient */}
    <div className="ai-bg-blob-b absolute -bottom-[16%] -left-[8%] h-[26vw] w-[26vw] rounded-full bg-[linear-gradient(120deg,_#5E66F5_0%,_#8B5CF6_55%,_#5E66F5_100%)] opacity-25 blur-[110px] dark:opacity-40" />

    {/* small cyan glow — tight circular orbit mid-right */}
    <div className="ai-bg-blob-c absolute top-[30%] right-[14%] h-[11vw] w-[11vw] rounded-full bg-[linear-gradient(90deg,_#15DCFF_0%,_#28BCFC_100%)] opacity-20 blur-[80px] dark:opacity-[0.35]" />

    {/* bottom aurora — the same Ad Factory asset, now gently swaying */}
    <div className="absolute bottom-0 left-1/2 w-[120vw] -translate-x-1/2 opacity-20 xl:top-[28%] xl:bottom-auto xl:opacity-30 dark:xl:opacity-100">
      <img src={bottomEffectImage} alt="" className="ai-bg-aurora w-full" />
    </div>

    {/* floating frosted-glass tiles that catch the moving gradient (2xl+ only —
        on narrower screens they would graze the chat column) */}
    <div className="ai-bg-glass ai-bg-glass-a hidden 2xl:block" />
    <div className="ai-bg-glass ai-bg-glass-b hidden 2xl:block" />
  </div>
);

export default AIAssistantBg;
