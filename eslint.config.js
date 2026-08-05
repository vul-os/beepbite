import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'

export default tseslint.config([
  // 'site/assets/vendor' holds third-party minified bundles (marked, mermaid)
  // vendored for the docs site — never our code to lint.
  { ignores: ['dist', 'site/assets/vendor'] },
  // Shared across both JS and TS: the app's own plugin rules don't care
  // which language a file is written in. eslint-plugin-react-hooks stays on
  // its v5 "rules-of-hooks + exhaustive-deps" rule set here rather than v7's
  // React Compiler safety rules (set-state-in-effect, immutability, purity,
  // refs, static-components, preserve-manual-memoization, use-memo) — this
  // codebase was never written against the Compiler's assumptions, so pulling
  // that rule set in would need its own dedicated audit, not a coverage fix.
  {
    files: ['**/*.{js,jsx,ts,tsx}'],
    plugins: { 'react-refresh': reactRefresh, 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },
  // Remaining plain JS/JSX (config files, scripts/, site/, e2e specs) keeps
  // the original eslint-recommended setup.
  {
    files: ['**/*.{js,jsx}'],
    extends: [js.configs.recommended],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
  },
  // src is now TS/TSX end to end — parse it with the typescript-eslint
  // parser and lint it with the recommended TS rule set.
  {
    files: ['**/*.{ts,tsx}'],
    extends: [...tseslint.configs.recommended],
    languageOptions: {
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: {
      // The codebase's existing convention for a deliberately-unused binding
      // (param, catch, or destructured element) is a leading underscore —
      // teach the rule that instead of leaving it blind to it.
      '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
        destructuredArrayIgnorePattern: '^_',
      }],
    },
  },
  // src/lib/api-client.ts's Builder/thenable is intentionally untyped over
  // its result shape (see the comment at its `_run()` method) — it mimics
  // supabase-js's fluent query builder across arbitrary tables, and adding
  // real generics would need a structural rewrite of ~40 call sites for no
  // added safety. Pre-existing, documented exception; not a new `any`.
  {
    files: ['src/lib/api-client.ts'],
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },
])
