export const getModelAspectRatios = (models, surface, canonicalModel) => {
  if (!canonicalModel) return [];

  const model = models.find(
    (entry) => (entry.canonical || entry.model) === canonicalModel
  );
  const capabilities =
    model?.surface_capabilities?.[surface] ||
    model?.surfaceCapabilities?.[surface] ||
    model?.capabilities?.[surface];
  const ratios =
    model?.aspectRatios ||
    model?.aspect_ratios ||
    capabilities?.aspect_ratios ||
    capabilities?.aspectRatios ||
    [];

  return [...new Set(ratios.filter((ratio) => /^\d+:\d+$/.test(ratio)))].map((ratio) => ({
    value: ratio,
    label: ratio,
  }));
};

export const toVideoDurationValue = (value) => {
  const match = String(value ?? '').trim().match(/^(\d+(?:\.\d+)?)\s*s?$/i);
  if (!match || Number(match[1]) <= 0) return '';

  return `${Number(match[1])}s`;
};

// The UI displays seconds with a suffix, while video APIs expect seconds as a string.
export const toVideoDurationSeconds = (value) => toVideoDurationValue(value).replace(/s$/, '');

export const getModelDurationOptions = (models, canonicalModel) => {
  const model = models.find((entry) => (entry.canonical || entry.model) === canonicalModel);
  const durations = Array.isArray(model?.durations) ? model.durations : [];
  return [...new Set(durations.map(toVideoDurationValue).filter(Boolean))]
    .sort((a, b) => Number(a) - Number(b))
    .map((duration) => ({ value: duration, label: duration }));
};

export const getSelectedModelDuration = (durationOptions, duration) =>
  durationOptions.find((option) => option.value === toVideoDurationValue(duration))?.value || '';

export const AspectRatioPreview = ({ ratio, className = '' }) => {
  const [width, height] = String(ratio).split(':').map(Number);
  if (!Number.isFinite(width) || !Number.isFinite(height) || !width || !height) return null;

  const isWide = width >= height;
  return (
    <span className={`flex h-4 w-4 shrink-0 items-center justify-center ${className}`} aria-hidden="true">
      <span
        className="rounded-[2px] border border-current"
        style={{
          aspectRatio: `${width} / ${height}`,
          width: isWide ? '100%' : 'auto',
          height: isWide ? 'auto' : '100%',
        }}
      />
    </span>
  );
};
