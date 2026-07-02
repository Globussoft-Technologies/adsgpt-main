// Centralized feature flag reads. Each flag must literally equal the string
// 'true' to be considered enabled — missing / blank / any other value defaults
// to OFF. This keeps brand-new environments safe and forces an explicit opt-in.
//
// Usage:
//   import { IS_AUTOMATION_ENABLED } from '@/utils/featureFlags';
//   if (IS_AUTOMATION_ENABLED) { ... }

export const IS_AUTOMATION_ENABLED =
  import.meta.env.VITE_FEATURE_AUTOMATION === 'true';

// Landing Page Analyzer — hidden in prod (flag unset) while the BE ships; set
// VITE_FEATURE_LANDING_ANALYZER=true in an environment to expose the FE there.
export const IS_LANDING_ANALYZER_ENABLED =
  import.meta.env.VITE_FEATURE_LANDING_ANALYZER === 'true';

// Prompt template categories + search UI — hidden in prod while the new
// category-tagged prompts are seeded to the DB. Set
// VITE_FEATURE_PROMPT_CATEGORIES=true to expose the new UI.
export const IS_PROMPT_CATEGORIES_ENABLED =
  import.meta.env.VITE_FEATURE_PROMPT_CATEGORIES === 'true';
