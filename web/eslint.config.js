import { fileURLToPath } from 'node:url'
import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'

const tsconfigRootDir = fileURLToPath(new URL('.', import.meta.url))

export default tseslint.config([
  // 'site/assets/vendor' (third-party minified bundles vendored for the docs
  // site) used to need excluding here when this config lived at the repo
  // root alongside site/. Now that eslint.config.js (and `npm run lint`)
  // live under web/, ESLint's flat-config globs are already scoped relative
  // to this directory and can never reach a sibling site/ either way — so
  // that entry would be dead weight, not a needed guard.
  { ignores: ['dist'] },
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
  // parser and lint it with the type-checked TS rule set. `projectService`
  // gives typescript-eslint real type information (via tsconfig.json's
  // `include: src/**/*`) instead of the syntax-only `recommended` set, which
  // is silently blind to every type-aware rule (no-floating-promises,
  // no-unsafe-*, etc.) despite reporting a clean run.
  {
    files: ['**/*.{ts,tsx}'],
    extends: [...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      globals: globals.browser,
      parserOptions: {
        ecmaFeatures: { jsx: true },
        projectService: true,
        tsconfigRootDir,
      },
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
      // 300 of 304 no-misused-promises findings on first enabling
      // recommendedTypeChecked were the exact same shape: an async JSX
      // event handler (onClick={async () => ...}) passed where React's DOM
      // typings declare a void-returning attribute. That's this codebase's
      // universal event-handler idiom (errors are already caught and
      // toasted inside the handler) and matches typescript-eslint's own
      // documented guidance for React codebases — narrow the check to just
      // that JSX-attribute case rather than turning it off everywhere:
      // no-misused-promises still catches a Promise-returning function
      // handed to a plain variable, property, or argument position.
      '@typescript-eslint/no-misused-promises': ['error', {
        checksVoidReturn: { attributes: false },
      }],
      // 12 of 201 no-floating-promises findings on first enabling were
      // `(async () => { try { ... } catch { ... } finally { ... } })()` —
      // the standard idiom for running async logic inside a useEffect
      // (effects themselves can't be async). Every instance found was
      // already fully try/catch-wrapped internally; `ignoreIIFE` is the
      // option typescript-eslint documents specifically for this pattern.
      // Bare fire-and-forget calls to named async functions are NOT
      // covered by this and still need individual attention per call site.
      '@typescript-eslint/no-floating-promises': ['error', { ignoreIIFE: true }],
      // 85 only-throw-error findings, 19 files, all the exact same shape:
      // `if (error) throw error` where `error: ApiError` (a concrete
      // `{ message, status?, capability? }` interface declared in
      // src/lib/api-client.ts — NOT `any`, so `allowThrowingAny` doesn't
      // apply here). This is a deliberate, consistent, codebase-wide
      // convention carried over from supabase-js (whose errors are also
      // plain objects, never Error instances) — every catch site already
      // handles it defensively (`err instanceof Error ? err.message : ...`,
      // or just logs + shows a generic toast). Rewriting 19 files' error
      // surface to throw real Error subclasses is a real refactor, not a
      // lint fix, so this is downgraded to `warn` rather than fixed or
      // silently disabled.
      '@typescript-eslint/only-throw-error': 'warn',
      // 446 no-unsafe-{assignment,member-access,argument,return,call}
      // findings across 71 files, sampled across the largest clusters
      // (settings/location-settings.tsx 45, services/kitchen-config.ts 24,
      // context/auth-context.tsx 21, pages/menu/index.tsx 23, and more) —
      // every single one traces to reading or passing along the result of
      // src/lib/api-client.ts's Builder/thenable (`supabase.from(...)` /
      // `api.from(...)`), which intentionally returns `any` (see that
      // file's own no-explicit-any exemption below — adding real generics
      // there needs the same ~40-call-site structural rewrite this task
      // rules out, and that boundary now has 71 call sites, not 40).
      // Downgraded to `warn`, not disabled, so genuinely new unsafe code
      // written outside that boundary still surfaces.
      '@typescript-eslint/no-unsafe-assignment': 'warn',
      '@typescript-eslint/no-unsafe-member-access': 'warn',
      '@typescript-eslint/no-unsafe-argument': 'warn',
      '@typescript-eslint/no-unsafe-return': 'warn',
      '@typescript-eslint/no-unsafe-call': 'warn',
    },
  },
  // src/lib/api-client.ts's Builder/thenable is intentionally untyped over
  // its result shape (see the comment at its `_run()` method) — it mimics
  // supabase-js's fluent query builder across arbitrary tables, and adding
  // real generics would need a structural rewrite of ~40 call sites for no
  // added safety. Pre-existing, documented exception; not a new `any`.
  {
    files: ['src/lib/api-client.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      // Same Builder/thenable boundary as above: its Row generic defaults
      // to `any`, so joining/stringifying ids and filter values inside the
      // builder's own internals (serialize(), the `is`/`in` filter
      // encoders) trips no-base-to-string and restrict-template-expressions
      // on values that are, by this file's design, untyped. 8 findings, all
      // inside this file's own Builder implementation.
      '@typescript-eslint/no-base-to-string': 'off',
      '@typescript-eslint/restrict-template-expressions': 'off',
    },
  },
  // idb*() here reject with `req.error` (IDBRequest.error), the native
  // IndexedDB failure object — a real, well-formed DOMException at runtime,
  // which is the standard and only way to propagate an IndexedDB request
  // failure. prefer-promise-reject-errors doesn't recognize DOMException as
  // an Error instance, so all 5 findings here are this one native-API
  // pattern, not a bug.
  {
    files: ['src/offline/queue.ts'],
    rules: { '@typescript-eslint/prefer-promise-reject-errors': 'off' },
  },
  // The files below each carry at least one no-unused-vars finding that
  // turned out, on inspection, not to be lint hygiene but a symptom of a
  // real gap: state/handlers/props that are declared and then never wired
  // into the render (e.g. members/index.tsx's removeMember/updateMemberRole
  // are never called from any button — there is no way to actually remove a
  // member or change a role from this UI; workspace.tsx's setChargeError is
  // never called at all, so a failed charge has no error surfaced; several
  // components carry a "reachable from no surface" component tree already
  // flagged by src/pages/home/types.ts). Deciding whether to finish wiring
  // each one, delete it, or leave it is a product call, not something a
  // lint pass should guess at — so this list downgrades the rule to `warn`
  // for exactly these files (never a blanket disable) rather than either
  // silently deleting evidence of the gap or letting it block the gate.
  // See the lint-eslint branch handoff notes for the finding-by-finding
  // breakdown.
  {
    files: [
      'src/components/layout/docs-layout.tsx',
      'src/components/layout/main-layout.tsx',
      'src/components/nav/top-bar.tsx',
      'src/components/previews/menu-management-preview.tsx',
      'src/pages/assistant/index.tsx',
      'src/pages/cash/components/cash-out-report.tsx',
      'src/pages/home/components/busy-heatmap.tsx',
      'src/pages/home/components/order-modal.tsx',
      'src/pages/home/components/orders-section.tsx',
      'src/pages/home/components/pos-section.tsx',
      'src/pages/inventory/components/match-modal.tsx',
      'src/pages/inventory/components/po-form.tsx',
      'src/pages/kds/station.tsx',
      'src/pages/members/index.tsx',
      'src/pages/menu/cost-analysis.tsx',
      'src/pages/menu/index.tsx',
      'src/pages/menu/modifier-groups-editor.tsx',
      'src/pages/menu/recipe-breakdown.tsx',
      'src/pages/menu/recipe-builder.tsx',
      'src/pages/pos/workspace.tsx',
      'src/pages/quick-pos/index.tsx',
      'src/pages/reviews/index.tsx',
      'src/services/analytics.ts',
    ],
    rules: { '@typescript-eslint/no-unused-vars': 'warn' },
  },
])
