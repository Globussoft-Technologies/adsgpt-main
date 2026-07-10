import React, { useState } from 'react';
import { Check, Copy, ExternalLink, Loader2 } from 'lucide-react';

// Embeds Meta's own preview_iframe.php (returned by the ads_get_ad_preview /
// ads_generate_preview MCP tools) directly in the chat — the actual ad
// mockup renders inline, with the raw URL also shown (copyable + a new-tab
// fallback) rather than making that the only way to see the preview.
const AdPreviewCard = ({ title, format, previewUrl }) => {
  const [loaded, setLoaded] = useState(false);
  const [copied, setCopied] = useState(false);

  if (!previewUrl) return null;

  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white/60 dark:border-white/10 dark:bg-white/[0.03]">
      <div className="flex items-center justify-between gap-2 border-b border-gray-200 px-3 py-2 dark:border-white/10">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-gray-900 dark:text-white">
            {title || 'Ad preview'}
          </p>
          {format && <p className="text-10 text-gray-400 dark:text-gray-500">{format}</p>}
        </div>
        <a
          href={previewUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex shrink-0 items-center gap-1 text-[11px] font-medium text-gray-400 hover:text-gray-600 dark:text-white/50 dark:hover:text-white/80"
        >
          Open <ExternalLink className="h-3 w-3" />
        </a>
      </div>
      <div className="relative bg-gray-50 dark:bg-[#111]">
        {!loaded && (
          <div className="flex h-[420px] w-full items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-gray-400 dark:text-white/30" />
          </div>
        )}
        <iframe
          src={previewUrl}
          title={title || 'Ad preview'}
          onLoad={() => setLoaded(true)}
          className={`w-full border-0 ${loaded ? 'h-[420px]' : 'h-0'}`}
          sandbox="allow-scripts allow-same-origin allow-popups"
        />
      </div>
      {/* raw URL — visible + copyable alongside the embedded preview above */}
      <div className="flex items-center gap-2 border-t border-gray-200 px-3 py-2 dark:border-white/10">
        <p className="min-w-0 flex-1 truncate font-mono text-[11px] text-gray-500 dark:text-gray-400">
          {previewUrl}
        </p>
        <button
          type="button"
          title="Copy preview URL"
          className="shrink-0 rounded-md p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-white/10 dark:hover:text-gray-200"
          onClick={() =>
            navigator.clipboard?.writeText(previewUrl).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            })
          }
        >
          {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
        </button>
      </div>
    </div>
  );
};

export default AdPreviewCard;
