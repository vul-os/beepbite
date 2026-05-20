# BeepBite — Wave Progress Tracker

Hand-maintained checklist. Update status markers when a wave is complete or in-progress.
Format: `- [x] Wave N` = DONE, `- [~] Wave N` = IN-PROGRESS, `- [ ] Wave N` = not started.

---

## Completed Waves ✅

- [x] **Wave 0** — Schema consolidation + Row-Level Security
  - Consolidated all legacy migrations into 19 numbered SQL files (`001`–`019`)
  - RLS policies applied across all tenant-scoped tables
  - Sub-items (onboarding RLS hotfix, migrations 016–019):
    - `016_rls_bootstrap_fixes.sql` — RLS bootstrap edge-case fixes
    - `017_trigger_elevate_to_service_role.sql` — service-role elevation trigger
    - `018_org_created_by_returning_fix.sql` — RETURNING clause fix for org creation
    - `019_owner_default_capabilities.sql` — owner capability defaults
- [x] **Wave 6** — Safety: tenant isolation, audit attribution, KDS resilience
  - Tenant isolation enforced via RLS on all tables
  - Audit attribution wired to staff actor overlay
  - KDS resilience improvements shipped
- [x] **Wave 7** — Marketplace foundations
  - Marketplace handler + routes scaffolded
  - Discover/store pages live
- [x] **Wave 8** — Generic multi-provider payments + BYO keys + on-delivery
  - Paystack integration with BYO API keys
  - On-delivery payment option
  - Webhook handler for transfer events
- [x] **Wave 9** — Staff PIN actor-overlay + capability flags
  - Staff PIN auth flow (`staffauth` package: handlers, service, store)
  - Capability flags schema + enforcement middleware
- [x] **Wave 18** — Pricing model exploration
  - Billing model doc + pricing directory added
  - Tiered plan structure defined

---

## In Progress ⏳

- [~] **Wave 11** — POS dual UI + full workspace hardening
  - POS handler package scaffolded (`backend/internal/handlers/pos/`)
  - Dual-mode UI (cashier/manager) in progress
  - Workspace hardening ongoing

---

## Not Started ⬜

- [ ] **Wave 10** — USD billing via FX
- [ ] **Wave 12** — KDS hardening + UI completeness
- [ ] **Wave 13** — Offline Tier 1 (network resilience)
- [ ] **Wave 14** — Testing infrastructure (smoke + e2e + seeded fixtures)
- [ ] **Wave 15** — Penetration testing
- [ ] **Wave 16** — Drivers, delivery portal, live tracking
- [ ] **Wave 17** — WhatsApp account binding
- [ ] **Wave 19** — Wallet + quotas + multi-LLM provider abstraction
- [ ] **Wave 20** — Customer chat assistant
- [ ] **Wave 21** — Manage your store from WhatsApp
- [ ] **Wave 22** — Public API + scoped keys + tenant webhooks
- [ ] **Wave 23** — Custom domains
- [ ] **Wave 24** — Easy wins (10 POS quality-of-life features)
- [ ] **Wave 25** — Observability + multi-region deployment
- [ ] **Wave 26** — Platform admin tool
- [ ] **Wave 27** — Receipts (PDF + email + WhatsApp + reprint)
- [ ] **Wave 28** — Customer marketplace reviews
- [ ] **Wave 29** — Hardware integration (ESC/POS printers + scanner + display + scale)
- [ ] **Wave 30** — Internationalization (i18n) + accessibility
- [ ] **Wave 31** — Backups + DR + GDPR/POPIA data deletion
- [ ] **Wave 32** — Help center + onboarding wizard
- [ ] **Wave 33** — v2 deferred (later)
- [ ] **Wave 34** — Invoicing (platform → stores, B2B, VAT-aware)
- [ ] **Wave 35** — Unified workspace: one app, role-aware views
- [ ] **Wave 36** — Responsiveness sweep
- [ ] **Wave 37** — WhatsApp multi-number support
- [ ] **Wave 38** — BYO SMTP + central email metering
- [ ] **Wave 39** — Security gaps: 2FA + tenant audit-log + activity alerts
- [ ] **Wave 40** — Operational gaps: image uploads, time-clock, WA templates, EOD email
- [ ] **Wave 41** — Easy wins extended (10 more POS features)
- [ ] **Wave 42** — Legal foundation: ToS / Privacy / Cookie consent / Compliance pack
- [ ] **Wave 43** — Native shell (Tauri + Capacitor)
- [ ] **Wave 44** — Deferred follow-ups (drop-in slots)
