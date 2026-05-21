// render-smoke.spec.js
//
// PURPOSE: Catch uncaught JS exceptions (TDZ / "not defined" errors) that
// blank the screen at runtime but are NOT caught by `npm run build`.
//
// Strategy per route:
//   - Collect all `page.on('pageerror')` events  → hard JS exceptions.
//   - Collect all `page.on('console', 'error')` messages.
//   - Filter for fatal patterns: TDZ ("Cannot access … before initialization"),
//     "is not defined", "is not a function", React uncaught errors.
//   - A redirect to /signin by a ProtectedRoute is FINE (status 200 on the
//     redirect target, no JS exception). A TDZ crash IS a failure.
//
// Auth stub: we seed localStorage so ProtectedRoute receives a token-shaped
// value. The backend calls will 401/network-fail which is expected — we only
// care that the module-level JS doesn't blow up before any fetch fires.

import { test, expect } from '@playwright/test';

// ---- Routes to smoke-test ----
// Format: [label, path, requiresAuthSeed]
const ROUTES = [
  ['Landing /', '/', false],
  ['Sign-in /signin', '/signin', false],
  ['Sign-up /signup', '/signup', false],
  ['Discover /discover', '/discover', false],
  ['Store /store/test-slug', '/store/test-slug', false],
  ['Quick-POS /q/test-slug', '/q/test-slug', false],
  ['Staff-pin /s/test-slug', '/s/test-slug', false],

  // Auth-gated — will redirect to /signin unless stub is present; we seed
  // a fake token so the React tree mounts and we can detect any TDZ crash.
  ['Home /home', '/home', true],
  ['POS workspace /pos/workspace', '/pos/workspace', true],
  ['KDS expo /kds/expo', '/kds/expo', true],
  ['Menu /menu', '/menu', true],
  ['Menu courses /menu/courses', '/menu/courses', true],
  ['Floor /floor', '/floor', true],
  ['Cash /cash', '/cash', true],
  ['Settings org /settings/organization', '/settings/organization', true],
];

// Patterns that indicate a blank-screen fatal error.
const FATAL_PATTERNS = [
  /Cannot access .+ before initialization/i, // Temporal Dead Zone
  /is not defined/i,
  /is not a function/i,
  /Minified React error/i,
  /Uncaught.*Error/i,
];

function isFatal(msg) {
  return FATAL_PATTERNS.some((p) => p.test(msg));
}

// Seed auth stub into localStorage so ProtectedRoute doesn't short-circuit
// the component tree before we can observe any TDZ crash.
async function seedAuthStub(page) {
  await page.addInitScript(() => {
    const stub = JSON.stringify({
      access_token: 'smoke-stub-token',
      refresh_token: 'smoke-stub-refresh',
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      user: { id: 'smoke-user-id', email: 'smoke@test.local' },
    });
    localStorage.setItem('bb.auth', stub);
    // Supabase client also checks this key in some versions
    localStorage.setItem(
      'sb-auth-token',
      stub,
    );
  });
}

for (const [label, path, needsAuth] of ROUTES) {
  test(`renders without uncaught errors — ${label}`, async ({ page }) => {
    const pageErrors = [];
    const consoleErrors = [];

    page.on('pageerror', (err) => {
      pageErrors.push(err.message);
    });

    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    if (needsAuth) {
      await seedAuthStub(page);
    }

    // Navigate — allow any HTTP status; we only care about JS exceptions.
    await page.goto(path, { waitUntil: 'domcontentloaded', timeout: 15_000 });

    // Wait a beat for lazy-loaded chunks / React Suspense to resolve.
    // 2 s is enough for a local dev server; adjust if your machine is slow.
    await page.waitForTimeout(2000);

    // --- Assertions ---

    // 1. No hard JS exceptions at all.
    expect(
      pageErrors,
      `Page threw uncaught JS error(s) on ${path}: ${pageErrors.join(' | ')}`,
    ).toHaveLength(0);

    // 2. No fatal console errors (TDZ / not-defined patterns).
    const fatalConsoleErrors = consoleErrors.filter(isFatal);
    expect(
      fatalConsoleErrors,
      `Fatal console error(s) on ${path}: ${fatalConsoleErrors.join(' | ')}`,
    ).toHaveLength(0);

    // 3. Page must have a <body> — ensures HTML was delivered.
    await expect(page.locator('body')).toBeAttached();
  });
}
