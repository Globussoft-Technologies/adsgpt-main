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
]);
