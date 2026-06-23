import { useState } from 'react';
import { Check, Copy, ExternalLink, Globe, RotateCw } from 'lucide-react';
import { globalToast } from '@/utils/globalToast';
import { GhostBtn, GradBtn } from './_atoms';
import { buildRecommendationsText, prettyDate, prettyUrl, scoreBand } from './helpers';

// Header row: analysed URL + inline score/verdict pill + date, and the
// Copy / Relaunch actions. Copy gives transient inline feedback.
export default function ResultHeader({ report, url, onRelaunch, relaunching }) {
  const [copied, setCopied] = useState(false);

  const displayUrl = prettyUrl(url || report?.url);
  const overall = report?.overall || {};
  const band = scoreBand(overall.score);
  const analyzedAt = prettyDate(report?.scanned_at);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(buildRecommendationsText(report));
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
      globalToast.success('Recommendations copied to clipboard');
    } catch {
      globalToast.error('Couldn’t copy — clipboard access was blocked');
    }
  };

  return (
    <div className="flex flex-wrap items-center justify-between gap-4 py-2">
      <div className="flex flex-wrap items-center gap-3">
        <a
          href={url || report?.url || '#'}
          target="_blank"
          rel="noreferrer"
          className="group inline-flex items-center gap-2.5 text-2xl font-extrabold tracking-tight text-gray-900 dark:text-white 2xl:text-[26px]"
        >
          <Globe className="h-5 w-5 shrink-0 text-gray-400 dark:text-white/55 2xl:h-6 2xl:w-6" />
          <span className="group-hover:underline">{displayUrl}</span>
          <ExternalLink className="h-4 w-4 2xl:h-5 2xl:w-5 shrink-0 text-gray-400 dark:text-white/45" />
        </a>
        <span
          className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 ${band.bg} ${band.ring}`}
        >
          <span className="text-sm font-extrabold tabular-nums" style={{ color: band.stroke }}>
            {overall.score} / 100
          </span>
          <span className="text-13 font-bold" style={{ color: band.stroke }}>
            {overall.grade || band.label}
          </span>
        </span>
        {analyzedAt && (
          <span className="text-sm text-gray-400 dark:text-white/45">Analyzed {analyzedAt}</span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 pt-1">
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
