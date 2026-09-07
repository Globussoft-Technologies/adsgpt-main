import js from '@eslint/js';
import globals from 'globals';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import { defineConfig, globalIgnores } from 'eslint/config';

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{js,jsx}'],
    plugins: { react },
    extends: [
      js.configs.recommended,
      reactHooks.configs['recommended-latest'],
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    linterOptions: {
      // Don't warn about eslint-disable comments that no longer match anything.
      reportUnusedDisableDirectives: 'off',
    },
    rules: {
      // Noise rules are turned off entirely so `eslint` reports nothing for
      // them. Real-bug rules (no-dupe-else-if, no-constant-binary-expression,
      // react-hooks/rules-of-hooks) stay as errors via the recommended presets
      // above.
      'no-unused-vars': 'off',
      'react-refresh/only-export-components': 'off',
      'react-hooks/exhaustive-deps': 'off',
      // Catch undefined JSX components (e.g. a used component whose import was
      // removed/commented). ESLint core's no-undef can't see JSX element names;
      // this rule can. Enabled on its own — we intentionally skip the rest of
      // react/recommended to avoid reintroducing warnings.
      'react/jsx-no-undef': 'error',
    },
  },
  {
    // Temporal-dead-zone reads: a `const` used above its own declaration in
    // the SAME scope throws at runtime but is valid syntax, so neither the
    // bundler nor the build catches it. A real one shipped here — the ad
    // drawer read `media` above its useState and threw on every render, which
    // surfaced as a UI flicker with no error anyone saw.
    //
    // SCOPED to the Meta Ads surface on purpose: app-wide this rule reports
    // ~188 pre-existing hits, almost all module-level consts referenced from
    // component bodies (safe — the module finishes evaluating before any
    // component runs). Turning it on globally is a separate cleanup, not a
    // side effect of this feature. `functions: false` keeps hoisted function
    // declarations allowed.
    files: ['src/components/MetaAds/**/*.{js,jsx}', 'src/apis/metaAds/**/*.js'],
    rules: {
      'no-use-before-define': [
        'error',
        { variables: true, functions: false, classes: false, allowNamedExports: true },
      ],
    },
  },
]);
