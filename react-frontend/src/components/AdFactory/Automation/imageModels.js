// ----------------------------------------------------------------------------
// Image model registry for the AdFactory Automation form.
//
// MODEL_OPTIONS: the dropdown choices surfaced in PairsPerCycleSection.
//   value  → provider key the backend image worker expects
//            (mirrors ServicesForm's imageModelProvider enum)
//   label  → human display string, MUST match the label returned by
//            /adsgpt/usage/model-credit-value so AutomationForm can
//            resolve the live credit cost by label.
//
// FALLBACK_CREDITS_PER_IMAGE: used when the live credit config hasn't
// loaded yet or the API failed. Kept here so the form degrades to the
// previously hardcoded cost rather than zero / NaN.
// ----------------------------------------------------------------------------

export const FALLBACK_CREDITS_PER_IMAGE = 7;

export const MODEL_OPTIONS = [
  { value: 'google', label: 'Nano Banana Pro' },
  { value: 'openai', label: 'OpenAI 1.5' },
];
