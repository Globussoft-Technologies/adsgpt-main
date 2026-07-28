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

// AI Ads "Customize Script & Voice-over" entry points. Hidden by default while
// the workflow is under development. Set the flag to the literal string `true`
// to expose the eligible original-video controls.
export const IS_AI_ADS_CUSTOMIZE_SCRIPT_VOICE_ENABLED =
  import.meta.env.VITE_FEATURE_AI_ADS_CUSTOMIZE_SCRIPT_VOICE === 'true';

// AI Assistant navigation and route. Missing or any value other than the
// literal string `true` keeps the feature inaccessible.
export const IS_AI_ASSISTANT_ENABLED =
  import.meta.env.VITE_FEATURE_AI_ASSISTANT === 'true';

// Google as an AdFactory Automation target (Run-on-Schedule jobs that post to
// Google Ads). Hidden in prod while ONLY Meta automation ships — when off, the
// Google status pill, Google template picker, Google readiness/validation, and
// the Google targets in the job payload are all suppressed, and a Google-only
// campaign can't even open the schedule form. Set
// VITE_FEATURE_GOOGLE_AUTOMATION=true to expose Google automation.
// NOTE: this is independent of VITE_ENABLE_GOOGLE_POSTING (the separate
// manual "Post Ad" Google flow) and of the 'google' image model (Nano Banana).
// export const IS_GOOGLE_AUTOMATION_ENABLED =
//   import.meta.env.VITE_FEATURE_GOOGLE_AUTOMATION === 'true';
export const IS_GOOGLE_AUTOMATION_ENABLED =
  import.meta.env.VITE_ENABLE_GOOGLE_POSTING === 'true';
// Meta Ads "Ads Chat" MCP chatbot — still in active development. Gated two
// ways: this master switch (build-wide off switch), AND — separately — an
// explicit email allowlist (see isAdsChatAllowedForEmail below) so that even
// with the switch on, only specific testers actually see the launcher icon.
// Set VITE_FEATURE_META_ADS_CHAT=true to turn the feature on at all.
export const IS_META_ADS_CHAT_ENABLED =
  import.meta.env.VITE_FEATURE_META_ADS_CHAT === 'true';

// Comma-separated allowlist, e.g.
// VITE_META_ADS_CHAT_ALLOWED_EMAILS=chethan.s@globussoft.in,someone@else.com
const ADS_CHAT_ALLOWED_EMAILS = (import.meta.env.VITE_META_ADS_CHAT_ALLOWED_EMAILS || '')
  .split(',')
  .map((email) => email.trim().toLowerCase())
  .filter(Boolean);

export const isAdsChatAllowedForEmail = (email) => {
  if (!email) return false;
  return ADS_CHAT_ALLOWED_EMAILS.includes(String(email).trim().toLowerCase());
};
