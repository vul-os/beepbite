#!/usr/bin/env node
/**
 * BeepBite screenshot generator, for README.md and docs/screenshots.md.
 * Writes docs/screenshots/, mirrors two shots into public/docs/ to fill
 * existing in-app documentation placeholders, and mirrors everything into
 * site/screenshots/ if that (sibling-branch, at time of writing) docs viewer
 * is present. See OUT_DIRS / PUBLIC_DOCS_FILLS below.
 *
 * Captures real UI at 1440x900 (Playwright/Chromium, light AND dark) by
 * driving an actual running instance: Postgres + `go run ./cmd/server` +
 * `npm run dev` — logged in with a real seeded tenant, no mocks, nothing
 * faked.
 *
 * PREREQUISITE, HONESTLY STATED: BeepBite needs Postgres. Unlike PropFix
 * (which has a `--demo` in-memory mode), there is no way to see BeepBite's
 * UI without a real database behind it. This script will stand one up for
 * you (see "What this script starts" below) — but Docker has to be
 * installed and running, or a $BEEPBITE_SCREENSHOT_DATABASE_URL you already
 * trust has to be supplied. There is no third option; a screenshot of an
 * unseeded or empty BeepBite would misrepresent the product, so this script
 * refuses to try.
 *
 * Usage:
 *   npx playwright install chromium   # one-time
 *   npm run screenshots
 *
 * What this script starts (and tears down again on exit — see "Reuse" below):
 *   1. A throwaway Postgres 16 container (docker run postgres:16-alpine),
 *      named beepbite-screenshots-pg, on $BEEPBITE_SCREENSHOT_DB_PORT
 *      (default 55432 — NOT Postgres' default 5432, so it can never collide
 *      with a real local instance).
 *   2. `go run ./cmd/migrate --env=dev --up` against it.
 *   3. `go run ./cmd/seedcopper --env=dev --clean` — the full "Copper Table"
 *      demo tenant: menu, floor plan, staff, 1500+ historical orders, live
 *      KDS tickets, inventory, the lot. (`--clean` deletes every OTHER org in
 *      the target database — safe here because the target database is one
 *      this script created for exactly this purpose; see the .env.dev guard
 *      below for why it refuses to run that against anything else.)
 *   4. `go run ./cmd/server --env=dev` (the API).
 *   5. `npm run dev` (the Vite frontend), pointed at that API via
 *      $VITE_API_URL passed as a real process env var — never written to a
 *      dotenv file (see below).
 *
 * Reuse: if something is already answering on the configured API/web ports,
 * this script reuses it as-is and skips ALL of the above — no Docker, no
 * migrate, no seed, no spawn. Point BEEPBITE_SCREENSHOT_API_PORT /
 * BEEPBITE_SCREENSHOT_WEB_PORT at your own already-running `go run
 * ./cmd/server` + `npm run dev` (seeded per docs/setup.md) to skip the whole
 * bootstrap. Only what THIS run started gets torn down on exit.
 *
 * Why .env.dev and not .env: BeepBite's config loader (backend/internal/
 * config) reads .env for --env=local and .env.dev for --env=dev, via
 * godotenv.Overload — which REPLACES any environment variables this script
 * passes to the Go subprocesses with whatever that file contains, for any
 * key the file sets. --env=local's .env is very likely to already exist for
 * anyone who has set up BeepBite per the Quick Start, and clobbering or
 * fighting it here — worse, running the destructive `seedcopper --clean`
 * against whatever database it points at — would be a genuine hazard. This
 * script never touches .env, only ever passes config via real process env
 * vars to its own subprocesses, and refuses to run at all if .env.dev
 * happens to exist (see assertNoStrayEnvDev below) rather than risk
 * silently reading a real one.
 *
 * HONESTY GUARD: before writing a single file, this script logs in through
 * the real /signin form with the seeded owner account and confirms it lands
 * on /home. If Postgres won't come up, migrate/seed fail, the servers don't
 * start, or the login doesn't work, it prints exactly why and exits
 * non-zero WITHOUT writing anything to docs/screenshots/ or public/docs/.
 * No placeholder or faked image is ever produced.
 *
 * Surfaces NOT captured, on purpose (see inline notes in ROUTES below):
 *   - /reports — genuinely near-empty for this seed data (it tracks WhatsApp
 *     conversation response times/ratings; seedcopper's orders are inserted
 *     directly, not via a simulated chat, so those metrics are honestly
 *     zero, not a rendering bug). A screenshot of it would look broken.
 *   - /track/:token (customer order tracking) — the page loads and the
 *     order-progress stepper works, but the map and ETA never render: the
 *     backend (internal/handlers/tracking/handler.go) returns a FLAT JSON
 *     shape (store_lat, delivery_address as a string, no eta_minutes) while
 *     the frontend (src/pages/track/index.jsx, src/services/tracking.js)
 *     destructures a NESTED shape (store.lat, delivery_address.label,
 *     eta_minutes) that the backend never sends. That's a real API contract
 *     bug, not a seeding gap — filed as a finding, not fixed here (out of
 *     scope for a screenshot pass).
 *   - The "Orders" tab inside /work (POS Workspace shell) — throws
 *     `TypeError: Cannot read properties of undefined (reading 'length')`
 *     and blanks the page. The Home dashboard's Live Orders panel is the
 *     working equivalent and is what "orders feed" below actually shows.
 */

import { chromium } from 'playwright'
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync, copyFileSync, readdirSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const BACKEND_DIR = join(ROOT, 'backend')

const DB_CONTAINER = 'beepbite-screenshots-pg'
const DB_PORT = process.env.BEEPBITE_SCREENSHOT_DB_PORT || '55432'
const API_PORT = process.env.BEEPBITE_SCREENSHOT_API_PORT || '8099'
const WEB_PORT = process.env.BEEPBITE_SCREENSHOT_WEB_PORT || '5174' // matches vite.config.js's default

const API_URL = `http://localhost:${API_PORT}`
const WEB_URL = `http://localhost:${WEB_PORT}`

const VIEWPORT = { width: 1440, height: 900 }
// docs/screenshots/ is what README.md and docs/*.md reference directly.
// site/screenshots/ is what site/docs.html actually loads — it fetches
// docs/*.md at runtime and rewrites any "screenshots/x.png" path it finds to
// "./screenshots/x.png" (see the image-path rewrite in site/docs.html's
// load()) — so without this second copy the published docs viewer would 404
// on every image. This mirrors the equivalent PropFix convention exactly.
// Only added when site/docs.html actually exists on the checked-out branch
// (it was still mid-flight on a sibling branch as this script was written) —
// no point creating a directory nothing on this branch reads yet.
const HAS_SITE_DOCS = existsSync(join(ROOT, 'site', 'docs.html'))
const OUT_DIRS = HAS_SITE_DOCS
  ? [join(ROOT, 'docs', 'screenshots'), join(ROOT, 'site', 'screenshots')]
  : [join(ROOT, 'docs', 'screenshots')]
// A further, smaller mirror: src/pages/docs/*.jsx already has Screenshot
// components wired with a caption naming an exact /public/docs/*.png file to
// drop in. Where the subject matches something this script actually
// captures, the shot is copied there too (see PUBLIC_DOCS_FILLS below and
// docs/screenshots.md).
const PUBLIC_DOCS_DIR = join(ROOT, 'public', 'docs')

const OWNER_EMAIL = 'demo@beepbite.app'
const OWNER_PASSWORD = 'Demo1234!'

// seedcopper defaults to XTS/ZZ/+999 — reserved, deliberately-fictional
// placeholders (see its own header comment) so that ordinary demo/dev data
// can never be mistaken for a real jurisdiction. That reasoning is correct
// for the seeder's default. It is the WRONG choice for a screenshot that is
// going into the README: a prospective user who does not know XTS is an ISO
// 4217 test code reads "XTS 195.00" as a rendering bug, not a placeholder.
// The README's job is to show the product working; the seeder's job is to
// keep every code path honest about not assuming a country. Those are
// different jobs, so this script overrides the seeder's locale for its own
// run via the same SEED_* variables an operator would use (see
// backend/cmd/seedcopper/CONTRACT.md) — Portugal/EUR, chosen for no reason
// other than reading naturally. DO NOT change seedcopper's own defaults to
// "fix" this — that would defeat the reserved-placeholder guarantee for
// every other caller.
const SEED_LOCALE_ENV = {
  SEED_COUNTRY: 'PT',
  SEED_CURRENCY: 'EUR',
  SEED_TIMEZONE: 'Europe/Lisbon',
  SEED_LOCALE: 'pt-PT',
  SEED_TAX_RATE: '23',
  SEED_TAX_LABEL: 'IVA',
  SEED_PHONE_CC: '351',
}

// Ordered roughly by the README's feature table. "home" is the hero.
const ROUTES = [
  {
    name: 'home',
    path: '/home',
    hero: true,
    caption: 'Dashboard — sales trend, busy hours, and the live orders feed',
  },
  {
    name: 'pos-workspace',
    path: '/pos/workspace',
    caption: 'POS till — menu grid, eat-in/takeaway, running cart',
    // An empty-cart POS till doesn't sell the product — open a table and add
    // a couple of real menu items so the ticket panel actually shows a
    // running order, the way an operator would see it mid-service. This
    // opens a REAL draft ticket that persists server-side (confirmed by
    // hand: reloading /pos/workspace still shows it) — so light and dark use
    // DIFFERENT tables, or the dark pass would double up on top of light's
    // items rather than showing a comparable fresh order.
    setup: async (page, theme) => {
      const table = theme === 'dark' ? 'T2' : 'T1'
      await page.getByText(table, { exact: true }).click()
      await sleep(500)
      for (const item of ['300g Rump Steak', 'Chargrilled Octopus', 'Coca-Cola 300ml']) {
        await page.getByText(item, { exact: true }).click()
        await sleep(250)
      }
    },
  },
  {
    name: 'kds-expo',
    path: '/kds/expo',
    caption: 'Kitchen display — expo view with per-station routing and fire timers',
  },
  {
    name: 'floor',
    path: '/floor',
    caption: 'Floor plan — live table status, auto-refreshing every 15s',
  },
  {
    name: 'menu',
    path: '/menu',
    caption: 'Menu management — items, recipes, cost and margin per dish',
  },
  {
    name: 'inventory-purchase-orders',
    path: '/inventory/purchase-orders',
    caption: 'Inventory — purchase orders by supplier and status',
  },
]

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function health(url) {
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    return await res.json().catch(() => ({}))
  } catch {
    return null
  }
}

async function webUp(url) {
  try {
    const res = await fetch(url)
    return res.ok
  } catch {
    return false
  }
}

function run(cmd, args, opts = {}) {
  execFileSync(cmd, args, { stdio: 'inherit', ...opts })
}

// `go run` execs a compiled binary as a SEPARATE child process (a different
// PID from the `go run` wrapper) — same for `npm run dev` execing vite.
// Signalling only the wrapper leaves the real server/dev-server running
// after this script exits. spawn(..., {detached:true}) makes the child the
// leader of its own process group, so `-pid` signals the whole tree.
function spawnGroup(cmd, args, opts = {}) {
  return spawn(cmd, args, { ...opts, detached: true })
}
function killGroup(proc, signal) {
  try {
    process.kill(-proc.pid, signal)
  } catch {
    try {
      proc.kill(signal)
    } catch {}
  }
}

// ---------------------------------------------------------------------------
// Safety guard: never run against a .env.dev this script did not create.
// See the file header for why.
// ---------------------------------------------------------------------------
function assertNoStrayEnvDev() {
  const envDev = join(ROOT, '.env.dev')
  if (existsSync(envDev)) {
    throw new Error(
      `${envDev} already exists.\n` +
        '  This script bootstraps a throwaway Postgres + seeds it with\n' +
        '  `seedcopper --clean` (which DELETES every other organisation in the\n' +
        "  target database) — and BeepBite's --env=dev config loader would read\n" +
        "  YOUR .env.dev's DATABASE_URL instead of the throwaway one this script\n" +
        '  passes in, because godotenv.Overload replaces process env with file\n' +
        '  contents for any key the file sets. Rather than guess whether that\n' +
        '  file points at something disposable, this script refuses to run.\n' +
        '  Move .env.dev aside (or delete it if it is not in use), or start\n' +
        '  BeepBite yourself against it and re-run — an already-running\n' +
        '  instance on the configured ports is reused untouched (see --help\n' +
        '  in this file for BEEPBITE_SCREENSHOT_API_PORT / _WEB_PORT).',
    )
  }
}

// ---------------------------------------------------------------------------
// Postgres
// ---------------------------------------------------------------------------
async function ensurePostgres() {
  if (process.env.BEEPBITE_SCREENSHOT_DATABASE_URL) {
    console.log('  using $BEEPBITE_SCREENSHOT_DATABASE_URL as-is (not managed by this script)')
    return { databaseUrl: process.env.BEEPBITE_SCREENSHOT_DATABASE_URL, teardown: async () => {} }
  }

  try {
    run('docker', ['info'], { stdio: 'ignore' })
  } catch {
    throw new Error(
      'Docker is required to stand up a throwaway Postgres for screenshots ' +
        '(no Docker daemon reachable via `docker info`). Start Docker/OrbStack ' +
        'and retry, or set BEEPBITE_SCREENSHOT_DATABASE_URL to a Postgres you ' +
        'already trust as disposable, or start BeepBite yourself (docs/setup.md) ' +
        'and re-run — an already-running instance is reused untouched.',
    )
  }

  const databaseUrl = `postgres://postgres:postgres@localhost:${DB_PORT}/beepbite?sslmode=disable`

  const inspect = () => {
    try {
      return execFileSync('docker', ['inspect', '-f', '{{.State.Running}}', DB_CONTAINER], {
        stdio: ['ignore', 'pipe', 'ignore'],
      })
        .toString()
        .trim()
    } catch {
      return null // container does not exist
    }
  }

  const state = inspect()
  let createdByUs = false
  if (state === 'true') {
    console.log(`  reusing running ${DB_CONTAINER} container`)
  } else if (state === 'false') {
    console.log(`  starting existing (stopped) ${DB_CONTAINER} container`)
    run('docker', ['start', DB_CONTAINER])
  } else {
    console.log(`  creating throwaway Postgres container ${DB_CONTAINER} on port ${DB_PORT}…`)
    run('docker', [
      'run', '-d', '--name', DB_CONTAINER,
      '-e', 'POSTGRES_USER=postgres',
      '-e', 'POSTGRES_PASSWORD=postgres',
      '-e', 'POSTGRES_DB=beepbite',
      '-p', `${DB_PORT}:5432`,
      'postgres:16-alpine',
    ])
    createdByUs = true
  }

  // -h 127.0.0.1 forces pg_isready to check over TCP rather than the local
  // Unix socket: the official postgres image's entrypoint does an internal
  // Unix-socket-only startup for initdb, then restarts listening on TCP — a
  // socket-only pg_isready reports ready during that first phase, while the
  // TCP connection this script (and migrate/seedcopper/the API) actually
  // needs is still a moment away.
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    try {
      execFileSync('docker', ['exec', DB_CONTAINER, 'pg_isready', '-U', 'postgres', '-h', '127.0.0.1'], { stdio: 'ignore' })
      break
    } catch {
      await sleep(500)
    }
  }

  const teardown = createdByUs
    ? async () => {
        console.log(`  removing throwaway ${DB_CONTAINER} container`)
        try {
          run('docker', ['rm', '-f', DB_CONTAINER], { stdio: 'ignore' })
        } catch {}
      }
    : async () => {}

  return { databaseUrl, teardown }
}

// ---------------------------------------------------------------------------
// Backend (Postgres + migrate + seedcopper + go run ./cmd/server)
// ---------------------------------------------------------------------------
async function ensureBackend() {
  const running = await health(`${API_URL}/health`)
  if (running?.status === 'ok') {
    console.log(`  reusing running BeepBite API at ${API_URL} (env=${running.env})`)
    return { teardown: async () => {} }
  }

  assertNoStrayEnvDev()
  const pg = await ensurePostgres()

  const goEnv = {
    ...process.env,
    APP_ENV: 'dev',
    DATABASE_URL: pg.databaseUrl,
    JWT_SECRET: randomBytes(32).toString('hex'),
    APP_KEY_ENCRYPTION_SECRET: randomBytes(32).toString('hex'),
    PORT: API_PORT,
    CORS_ORIGINS: `http://localhost:${WEB_PORT},http://127.0.0.1:${WEB_PORT}`,
  }

  console.log('  applying migrations…')
  run('go', ['run', './cmd/migrate', '--env=dev', '--up'], { cwd: BACKEND_DIR, env: goEnv })

  console.log(`  seeding "The Copper Table" demo tenant as ${SEED_LOCALE_ENV.SEED_COUNTRY}/${SEED_LOCALE_ENV.SEED_CURRENCY} (go run ./cmd/seedcopper --clean)…`)
  run('go', ['run', './cmd/seedcopper', '--env=dev', '--clean'], {
    cwd: BACKEND_DIR,
    env: { ...goEnv, ...SEED_LOCALE_ENV },
  })

  console.log(`  starting API on ${API_URL}…`)
  const proc = spawnGroup('go', ['run', './cmd/server', '--env=dev'], { cwd: BACKEND_DIR, env: goEnv, stdio: ['ignore', 'pipe', 'pipe'] })
  const logs = []
  proc.stdout.on('data', (d) => logs.push(String(d)))
  proc.stderr.on('data', (d) => logs.push(String(d)))
  let exited = null
  proc.on('exit', (code) => { exited = code })

  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    if (exited !== null) throw new Error(`beepbite API exited early (code ${exited}):\n${logs.join('')}`)
    if ((await health(`${API_URL}/health`))?.status === 'ok') break
    await sleep(200)
  }
  if ((await health(`${API_URL}/health`))?.status !== 'ok') {
    killGroup(proc, 'SIGTERM')
    throw new Error(`beepbite API did not become ready on ${API_URL}:\n${logs.join('')}`)
  }

  const teardown = async () => {
    killGroup(proc, 'SIGTERM')
    const stopDeadline = Date.now() + 5000
    while (exited === null && Date.now() < stopDeadline) await sleep(25)
    if (exited === null) killGroup(proc, 'SIGKILL')
    await pg.teardown()
  }
  return { teardown }
}

// ---------------------------------------------------------------------------
// Frontend (npm run dev)
// ---------------------------------------------------------------------------
async function ensureFrontend() {
  if (await webUp(WEB_URL)) {
    console.log(`  reusing running frontend at ${WEB_URL}`)
    return { teardown: async () => {} }
  }

  console.log(`  starting frontend on ${WEB_URL}…`)
  const proc = spawnGroup('npm', ['run', 'dev', '--', '--port', WEB_PORT], {
    cwd: ROOT,
    env: { ...process.env, VITE_API_URL: API_URL },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const logs = []
  proc.stdout.on('data', (d) => logs.push(String(d)))
  proc.stderr.on('data', (d) => logs.push(String(d)))
  let exited = null
  proc.on('exit', (code) => { exited = code })

  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    if (exited !== null) throw new Error(`vite dev server exited early (code ${exited}):\n${logs.join('')}`)
    if (await webUp(WEB_URL)) break
    await sleep(200)
  }
  if (!(await webUp(WEB_URL))) {
    killGroup(proc, 'SIGTERM')
    throw new Error(`frontend did not become ready on ${WEB_URL}:\n${logs.join('')}`)
  }

  const teardown = async () => {
    killGroup(proc, 'SIGTERM')
    const stopDeadline = Date.now() + 5000
    while (exited === null && Date.now() < stopDeadline) await sleep(25)
    if (exited === null) killGroup(proc, 'SIGKILL')
  }
  return { teardown }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function run_() {
  console.log('\nBeepBite screenshotter')
  console.log(`  API_URL : ${API_URL}`)
  console.log(`  WEB_URL : ${WEB_URL}`)
  console.log(`  output  : ${OUT_DIRS.join(', ')}\n`)

  const backend = await ensureBackend()
  try {
    const frontend = await ensureFrontend()
    try {
      // HONESTY GUARD: log in for real before writing anything.
      console.log('\nsmoke-testing sign-in before capturing anything…')
      const browser = await chromium.launch({ headless: true })
      try {
        const probeCtx = await browser.newContext({ viewport: VIEWPORT })
        const probe = await probeCtx.newPage()
        await probe.goto(`${WEB_URL}/signin`, { waitUntil: 'networkidle', timeout: 20_000 })
        const emailField = probe.getByLabel('Email address')
        if ((await emailField.count()) === 0) {
          throw new Error(`GET ${WEB_URL}/signin did not render the sign-in form (no "Email address" field found).`)
        }
        await emailField.fill(OWNER_EMAIL)
        await probe.getByLabel('Password').fill(OWNER_PASSWORD)
        await probe.getByRole('button', { name: /sign in to dashboard/i }).click()
        await probe.waitForURL(`${WEB_URL}/home`, { timeout: 20_000 })
        await probeCtx.close()
      } finally {
        await browser.close()
      }
      console.log('  ✓ signed in as demo@beepbite.app and reached /home\n')

      for (const dir of OUT_DIRS) mkdirSync(dir, { recursive: true })

      const browser2 = await chromium.launch({ headless: true })
      try {
        for (const theme of ['light', 'dark']) {
          const ctx = await browser2.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2 })
          await ctx.addInitScript((t) => {
            localStorage.setItem('vite-ui-theme', t)
            // Pre-accept the cookie banner so it never occludes a screenshot —
            // this is the same consent an operator would give once, for real.
            localStorage.setItem('bb.cookie-consent', JSON.stringify({ necessary: true, analytics: true, marketing: false }))
          }, theme)
          const page = await ctx.newPage()

          await page.goto(`${WEB_URL}/signin`, { waitUntil: 'networkidle' })
          await page.getByLabel('Email address').fill(OWNER_EMAIL)
          await page.getByLabel('Password').fill(OWNER_PASSWORD)
          await page.getByRole('button', { name: /sign in to dashboard/i }).click()
          await page.waitForURL(`${WEB_URL}/home`)

          for (const route of ROUTES) {
            try {
              await page.goto(`${WEB_URL}${route.path}`, { waitUntil: 'networkidle', timeout: 20_000 })
              if (route.setup) await route.setup(page, theme)
              await page.evaluate(() => document.fonts.ready)
              await sleep(400)

              const suffix = theme === 'dark' ? '-dark' : ''
              const name = `${route.name}${suffix}.png`
              await page.screenshot({ path: join(OUT_DIRS[0], name) })
              console.log(`  ✓ ${name}`)
              if (route.hero && theme === 'light') {
                await page.screenshot({ path: join(OUT_DIRS[0], 'hero.png') })
                console.log(`  ✓ hero.png (copy of ${name})`)
              }
            } catch (err) {
              console.log(`  ✗ SKIPPED ${route.path} (${theme}): ${String(err.message || err).split('\n')[0]}`)
            }
          }
          await ctx.close()
        }
      } finally {
        await browser2.close()
      }

      // Mirror everything into site/screenshots/ (site/docs.html loads shots
      // from there — see its image-path rewrite) when that viewer exists.
      const files = readdirSync(OUT_DIRS[0]).filter((f) => f.endsWith('.png'))
      if (HAS_SITE_DOCS) {
        for (const f of files) copyFileSync(join(OUT_DIRS[0], f), join(OUT_DIRS[1], f))
        console.log(`\nMirrored ${files.length} screenshots into site/screenshots/`)
      } else {
        console.log('\n(site/docs.html not present on this branch — skipped the site/screenshots/ mirror)')
      }

      // Fill the two in-app documentation placeholders whose subject matches
      // a real capture (see docs/screenshots.md for the rest, which do not).
      mkdirSync(PUBLIC_DOCS_DIR, { recursive: true })
      const PUBLIC_DOCS_FILLS = [
        ['pos-workspace.png', 'pos-layout.png'], // src/pages/docs/pos-overview.jsx
        ['menu.png', 'menu-editor.png'],          // src/pages/docs/menu-management.jsx
      ]
      for (const [src, dest] of PUBLIC_DOCS_FILLS) {
        const from = join(OUT_DIRS[0], src)
        if (existsSync(from)) {
          copyFileSync(from, join(PUBLIC_DOCS_DIR, dest))
          console.log(`  ✓ public/docs/${dest} (from ${src})`)
        }
      }

      console.log('\nSkipped on purpose (see header comment for why):')
      console.log('  - /reports                — empty for this seed (unseeded WhatsApp chat metrics, not a bug)')
      console.log('  - /track/:token            — frontend/backend response-shape mismatch (map/ETA never render)')
      console.log('  - /work "Orders" tab       — crashes to a blank page (TypeError); Home\'s Live Orders panel is the working surface')
      console.log('\nDone.')
    } finally {
      await frontend.teardown()
    }
  } finally {
    await backend.teardown()
  }
}

run_().catch((err) => {
  console.error('\nscreenshotter error:', err.message)
  process.exit(1)
})
