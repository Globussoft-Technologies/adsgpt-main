function parseCreditsPerUnit(valueStr) {
  if (!valueStr) return null;
  const num = parseFloat(valueStr);
  return isNaN(num) ? null : num;
}

// model value → API label (exact match from /usage/model-credit-value)
const IMAGE_MODEL_LABEL = {
  'ADSGPT-1.0': 'Imagen',
  'ADSGPT-2.0': 'Nano Banana Pro',
  'ADSGPT-3.0': 'OpenAI 1.5',
};

export function estimateAdCreativeCredits({ model, no_of_ads = 1, modelCredits }) {
  const targetLabel = IMAGE_MODEL_LABEL[model]?.toLowerCase();
  const entry = modelCredits?.imageModels?.find((m) => m.label?.toLowerCase() === targetLabel);
  const costPerImage = parseCreditsPerUnit(entry?.value) ?? 7;
  return costPerImage * no_of_ads;
}

export function estimateAdVideoCredits({ video_duration, no_of_ads = 1, creditsPerSecond }) {
  const durationSecs = parseFloat(video_duration);
  const configuredRate = Number(creditsPerSecond);
  if (!Number.isFinite(durationSecs) || !Number.isFinite(configuredRate)) return 0;
  return Math.ceil(configuredRate * durationSecs * no_of_ads);
}
