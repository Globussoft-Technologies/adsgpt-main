// Centralized feature flag reads. Each flag must literally equal the string
// 'true' to be considered enabled — missing / blank / any other value defaults
// to OFF. This keeps brand-new environments safe and forces an explicit opt-in.
//
// Usage:
//   import { IS_AUTOMATION_ENABLED } from '@/utils/featureFlags';
//   if (IS_AUTOMATION_ENABLED) { ... }

export const IS_AUTOMATION_ENABLED =
  import.meta.env.VITE_FEATURE_AUTOMATION === 'true';
