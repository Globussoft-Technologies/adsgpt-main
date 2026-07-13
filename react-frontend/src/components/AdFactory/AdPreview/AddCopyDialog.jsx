import { useEffect, useState } from 'react';
import { toast } from 'react-toastify';
import { Loader2, Check, Wand2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { generateAdCopy } from '@/apis/metaAds/metaAdsApi';

// Platform character limits. `rec` = recommended (soft), `max` = hard cap.
// Meta: Primary 1–2200 (125 rec), Headline 1–255 (40 rec), Description 1–30.
// Google: Primary/Description 1–90, Headline 1–30.
const LIMITS = {
  meta: {
    primaryText: { max: 2200, rec: 125 },
    headline: { max: 255, rec: 40 },
    description: { max: 30 },
  },
  google: {
    primaryText: { max: 90 },
    headline: { max: 30 },
    description: { max: 90 },
  },
};

const AddCopyDialog = ({ open, onClose, onAdd, platform = 'meta' }) => {
  const [prompt, setPrompt] = useState('');
  const [generating, setGenerating] = useState(false);
  const [fields, setFields] = useState({ primaryText: '', headline: '', description: '' });

  // Reset everything each time the dialog opens.
  useEffect(() => {
    if (open) {
      setPrompt('');
      setGenerating(false);
      setFields({ primaryText: '', headline: '', description: '' });
    }
  }, [open]);

  const setField = (k, v) => setFields((f) => ({ ...f, [k]: v }));

  const limits = LIMITS[platform] || LIMITS.meta;
  const overMax = (k) => {
    const m = limits[k]?.max;
    return m != null && fields[k].length > m;
  };
  const anyOver = overMax('primaryText') || overMax('headline') || overMax('description');

  const handleGenerate = async () => {
    const p = prompt.trim();
    if (!p) {
      toast.error('Describe what the ad copy should say.');
      return;
    }
    setGenerating(true);
    try {
      const data = await generateAdCopy({ prompt: p });
      const c = data?.adCopy || data || {};
      setFields({
        primaryText: c.primary_text || c.primaryText || '',
        headline: c.headline || '',
        description: c.description || '',
      });
    } catch {
      toast.error('Could not generate ad copy. Please try again.');
    } finally {
      setGenerating(false);
    }
  };

  const canAdd = Boolean(fields.primaryText.trim() || fields.headline.trim()) && !anyOver;

  const handleAdd = () => {
    if (!canAdd) return;
    onAdd?.({
      primaryText: fields.primaryText.trim(),
      headline: fields.headline.trim(),
      description: fields.description.trim(),
    });
    onClose?.();
  };

  const inputBase =
    'w-full rounded-xl border bg-transparent p-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none dark:text-white dark:placeholder:text-white/40';
  const borderClass = (k) =>
    overMax(k)
      ? 'border-red-500 focus:border-red-500'
      : 'border-black/15 focus:border-[#2364B8] dark:border-white/15';

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose?.()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add ad copy</DialogTitle>
          <DialogDescription>
            Generate a draft with AI or write your own — it&apos;s added to the{' '}
            {platform.charAt(0).toUpperCase() + platform.slice(1)} copies.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          {/* AI helper — optional, fills the fields below (which stay editable) */}
          <div className="flex flex-col gap-2 rounded-2xl bg-black/5 p-3 dark:bg-white/5">
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={2}
              placeholder="Describe the copy for AI (optional) — e.g. Punchy summer-sale copy for running shoes, mention free shipping"
              className="w-full resize-none rounded-xl border border-black/15 bg-transparent p-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-[#2364B8] focus:outline-none dark:border-white/15 dark:text-white dark:placeholder:text-white/40"
            />
            <div className="flex items-center justify-end">
              <button
                disabled={generating || !prompt.trim()}
                onClick={handleGenerate}
                className={`flex items-center gap-2 rounded-full px-4 py-2 text-xs font-semibold transition-all ${
                  !generating && prompt.trim()
                    ? 'bg-[#2364B8] text-white hover:opacity-85'
                    : 'cursor-not-allowed bg-black/10 text-gray-400 dark:bg-white/10 dark:text-white/40'
                }`}
              >
                {generating ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" /> Generating…
                  </>
                ) : (
                  <>
                    <Wand2 className="h-4 w-4" /> Generate
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Editable fields — write your own or tweak the generated draft */}
          <div className="flex flex-col gap-3">
            {limits.primaryText && (
              <Field label="Primary text" value={fields.primaryText} limit={limits.primaryText}>
                <textarea
                  value={fields.primaryText}
                  onChange={(e) => setField('primaryText', e.target.value)}
                  rows={3}
                  placeholder="Main body of the ad…"
                  className={`resize-none ${inputBase} ${borderClass('primaryText')}`}
                />
              </Field>
            )}
            <Field label="Headline" value={fields.headline} limit={limits.headline}>
              <input
                value={fields.headline}
                onChange={(e) => setField('headline', e.target.value)}
                placeholder="Short headline…"
                className={`${inputBase} ${borderClass('headline')}`}
              />
            </Field>
            <Field
              label="Description (optional)"
              value={fields.description}
              limit={limits.description}
            >
              <input
                value={fields.description}
                onChange={(e) => setField('description', e.target.value)}
                placeholder="Supporting line…"
                className={`${inputBase} ${borderClass('description')}`}
              />
            </Field>
          </div>

          <button
            disabled={!canAdd}
            onClick={handleAdd}
            className={`flex items-center justify-center gap-2 rounded-full px-6 py-2.5 text-sm font-semibold transition-all ${
              canAdd
                ? 'bg-gray-900 text-white hover:opacity-80 dark:bg-white dark:text-black'
                : 'cursor-not-allowed bg-black/10 text-gray-400 dark:bg-white/10 dark:text-white/40'
            }`}
          >
            <Check className="h-4 w-4" /> Add this copy
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

const Field = ({ label, value = '', limit, children }) => {
  const len = value.length;
  const max = limit?.max;
  const rec = limit?.rec;
  const over = max != null && len > max;
  const overRec = rec != null && len > rec && !over;
  return (
    <label className="flex flex-col gap-1">
      <div className="flex items-center justify-between px-1">
        <span className="text-xs font-medium text-gray-500 dark:text-white/50">{label}</span>
        {max != null && (
          <span
            className={`text-[11px] tabular-nums ${
              over
                ? 'text-red-500'
                : overRec
                  ? 'text-amber-500'
                  : 'text-gray-400 dark:text-white/40'
            }`}
          >
            {len}/{max}
            {/* {rec ? ` · ${rec} rec` : ''} */}
          </span>
        )}
      </div>
      {children}
      {over && (
        <span className="px-1 text-[11px] text-red-500">Exceeds the {max}-character limit.</span>
      )}
    </label>
  );
};

export default AddCopyDialog;
