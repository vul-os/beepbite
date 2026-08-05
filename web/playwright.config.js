// playwright.config.js
// Playwright E2E configuration.
//
// Browser install note: on some OS versions (e.g. Ubuntu 26.04) the bundled
// Chromium binary does not install via `npx playwright install chromium`.
// Workaround: install system Chromium and point PLAYWRIGHT_BROWSERS_PATH or
// set `channel: 'chromium'` here. Or run inside a supported Docker image:
//   docker run --rm -it -v $PWD:/app mcr.microsoft.com/playwright:v1.49.0-jammy bash
//
// To run manually once Chromium is available:
//   npx playwright test

import { defineConfig, devices } from '@playwright/test';

const DEV_PORT = process.env.VITE_PORT || 5173;

export default defineConfig({
  testDir: './tests-e2e',
  testMatch: '**/*.spec.js',

  /* Global test timeout */
  timeout: 30_000,

  /* Retry once on CI to reduce flakiness from first-paint timing */
  retries: process.env.CI ? 1 : 0,

  reporter: process.env.CI ? 'github' : 'list',

  use: {
    baseURL: `http://localhost:${DEV_PORT}`,
    /* Collect trace on first retry (CI only) */
    trace: 'on-first-retry',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  /* Start the Vite dev server before running tests.
   * Remove / comment out this block if you prefer to start the server
   * manually before invoking playwright. */
  webServer: {
    command: 'npm run dev',
    url: `http://localhost:${DEV_PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
