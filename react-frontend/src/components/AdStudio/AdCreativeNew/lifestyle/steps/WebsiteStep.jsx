import { useState } from 'react';
import { Link2, LinkIcon, X } from 'lucide-react';
import { LifestyleShell } from '../LifestyleShell';

export function WebsiteStep({
  initialUrl = '',
  errorMessage,
  title,
  onSubmit,
  onAddManually,
  onSkip,
  onClose,
}) {
  const [value, setValue] = useState(initialUrl);

  // Accept input with or without scheme/www. We normalise here so downstream
  // consumers (autofill, payload) always see a clean https:// URL.
  const normaliseUrl = (raw) => {
    let s = (raw || '').trim();
    if (!s) return '';
    // Strip a leading scheme if any, then re-prepend https://. This also
    // collapses inputs like `http://example.com` to `https://example.com`.
    s = s.replace(/^\s*https?:\/\//i, '');
    return `https://${s}`;
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    const trimmed = value.trim();
    if (!trimmed) return;
    onSubmit(normaliseUrl(trimmed));
  };

  const canSubmit = value.trim().length > 0;
  const hasError = Boolean(errorMessage);

  return (
    <LifestyleShell title={title} onClose={onClose}>
      <form
        onSubmit={handleSubmit}
        className="relative w-full min-w-[420px] max-w-[750px] rounded-[24px] bg-white dark:bg-[#303030]/30 px-7 backdrop-blur-md sm:px-12 pb-5 pt-18"
      >
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="absolute right-5 top-5 text-gray-500 dark:text-white/70 transition-colors hover:text-black dark:hover:text-white"
          >
            <X size={26} strokeWidth={1.8} />
          </button>
        )}

        <label
          htmlFor="brand-website"
          className="block text-[16px] font-semibold text-gray-900 dark:text-white sm:text-[17px]"
        >
          Brand Website
        </label>

        <div className="relative mt-5">
          <input
            id="brand-website"
            // text (not "url") so the browser doesn't reject inputs without a
            // scheme like "www.myntra.com" — handleSubmit normalises the URL
            // before passing it on.
            type="text"
            inputMode="url"
            autoComplete="url"
            placeholder="Enter your website…"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className={`
              h-[56px] w-full rounded-full bg-gray-100 dark:bg-[#9092941A] pl-6 pr-14
              text-[15px] text-gray-900 dark:text-white outline-none ring-1
              placeholder:text-gray-500 dark:placeholder:text-[#AFAFAF]
              focus-visible:ring-2 focus-visible:ring-white/30
              sm:h-[60px] sm:text-[16px]
              ${hasError ? 'ring-red-400/50' : 'ring-white/5'}
            `}
            autoFocus
          />
          <LinkIcon
            size={20}
            strokeWidth={1.6}
            className="pointer-events-none absolute right-5 top-1/2 -translate-y-1/2 text-gray-500 dark:text-white/60"
          />
        </div>

        {hasError && (
          <p className="mt-3 text-[13px] text-red-400" role="alert" aria-live="polite">
            Website fetching failed.{' '}
            {onAddManually ? (
              <button
                type="button"
                onClick={onAddManually}
                className="font-medium text-red-600 underline underline-offset-2 hover:text-red-700 dark:text-red-300 dark:hover:text-red-200"
              >
                Please add manually
              </button>
            ) : (
              'Please add manually.'
            )}
          </p>
        )}

        <div className="mt-10 flex justify-end gap-3">
          {onSkip && (
            <button
              type="button"
              onClick={onSkip}
              className="rounded-full bg-black/5 dark:bg-white/[0.08] px-8 py-2.5 text-sm font-medium text-gray-500 dark:text-white/60 transition hover:bg-black/5 dark:hover:bg-white/10 hover:text-black dark:hover:text-white"
            >
              Skip
            </button>
          )}
          <button
            type="submit"
            disabled={!canSubmit}
            className={`rounded-full bg-gray-900 dark:bg-white px-8 py-2.5 text-sm font-bold text-white dark:text-black shadow-lg transition hover:scale-[1.02] hover:opacity-90 active:scale-[0.98] ${
              !canSubmit ? 'cursor-not-allowed opacity-50' : ''
            }`}
          >
            {hasError ? 'Retry' : 'Next'}
          </button>
        </div>
      </form>
    </LifestyleShell>
  );
}
