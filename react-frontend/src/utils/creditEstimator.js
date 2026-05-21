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

const VIDEO_MODEL_LABEL = {
  sora: 'Sora 2',
  soraPro: 'Sora 2 Pro',
  soraPro_4k: 'Sora 2 Pro 4K',
  veo: 'Veo 3',
  'veo-3.1-fast': 'Veo 3.1 fast',
  veo_4k: 'Veo 4K',
  seedance_fast: 'Seedance 2.0 Fast',
  seedance_v2: 'Seedance 2.0',
  seedance_v1: 'Seedance 1.5 Pro',
  'kling_3.0': 'Kling 3.0',
};

export function estimateAdCreativeCredits({ model, no_of_ads = 1, modelCredits }) {
  const targetLabel = IMAGE_MODEL_LABEL[model]?.toLowerCase();
  const entry = modelCredits?.imageModels?.find((m) => m.label?.toLowerCase() === targetLabel);
  const costPerImage = parseCreditsPerUnit(entry?.value) ?? 7;
  return costPerImage * no_of_ads;
}

export function estimateAdVideoCredits({ video_model, video_duration, no_of_ads = 1, modelCredits }) {
  const durationSecs = parseFloat(video_duration) || 4;
  const targetLabel = VIDEO_MODEL_LABEL[video_model]?.toLowerCase();
  const entry = modelCredits?.videoModels?.find((m) => m.label?.toLowerCase() === targetLabel);
  const creditsPerSec = parseCreditsPerUnit(entry?.value) ?? 10;
  return Math.ceil(creditsPerSec * durationSecs * no_of_ads);
}
