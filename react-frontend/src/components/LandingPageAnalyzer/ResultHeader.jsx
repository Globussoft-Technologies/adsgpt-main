import { useState } from 'react';
import { Check, Copy, ExternalLink, Globe, RotateCw } from 'lucide-react';
import { GhostBtn, GradBtn } from './_atoms';
import { buildRecommendationsText, prettyDate, prettyHost, scoreBand } from './helpers';

// Header row: analysed URL + inline score/verdict pill + date, and the
// Copy / Relaunch actions. Copy gives transient inline feedback.
export default function ResultHeader({ report, url, onRelaunch, relaunching }) {
  const [copied, setCopied] = useState(false);

  const host = prettyHost(url || report?.url);
  const overall = report?.overall || {};
  const band = scoreBand(overall.score);
  const analyzedAt = prettyDate(report?.scanned_at);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(buildRecommendationsText(report));
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard blocked */
    }
  };

  return (
    <div className="flex flex-wrap items-start justify-between gap-4 py-5">
      <div className="flex flex-wrap items-center gap-3.5">
        <a
          href={url || report?.url || '#'}
          target="_blank"
          rel="noreferrer"
          className="group inline-flex items-center gap-3 text-[32px] font-extrabold tracking-tight text-gray-900 dark:text-white 2xl:text-[36px]"
        >
          <Globe className="h-7 w-7 text-gray-400 dark:text-white/55" />
          <span className="group-hover:underline">{host}</span>
          <ExternalLink className="h-5 w-5 text-gray-400 dark:text-white/45" />
        </a>
        <span
          className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 ${band.bg} ${band.ring}`}
        >
          <span className="text-lg font-extrabold tabular-nums" style={{ color: band.stroke }}>
            {overall.score}
          </span>
          <span className="text-sm font-bold" style={{ color: band.stroke }}>
            {overall.grade || band.label}
          </span>
        </span>
        {analyzedAt && (
          <span className="text-sm text-gray-400 dark:text-white/45">analyzed {analyzedAt}</span>
        )}
      </div>

      <div className="flex items-center gap-2 pt-1">
        <GhostBtn icon={copied ? Check : Copy} onClick={handleCopy}>
          {copied ? 'Copied' : 'Copy recommendations'}
        </GhostBtn>
        <GradBtn icon={RotateCw} spinning={relaunching} onClick={onRelaunch} disabled={relaunching}>
          {relaunching ? 'Relaunching…' : 'Relaunch Analysis'}
        </GradBtn>
      </div>
    </div>
  );
}
