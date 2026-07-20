# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Removed
- Payment facilitator: Paystack, Stripe and Yoco integrations, payment
  webhooks, merchant payouts, bank accounts and subscription billing. BeepBite
  records tenders; it never touches your money.
- Firebase hosting and analytics, Google OAuth, Resend, and the Gemini-backed
  AI menu creator. A fresh install now makes no outbound network calls.
- The delivery-marketplace partner tables (Uber Eats, DoorDash, Grubhub).

### Added
- `PaymentProvider` seam with a single manual-tender implementation — cash,
  card, transfer and voucher recorded against the order and reconciled into the
  drawer at close.

### Fixed
- Cash tenders were never linked to the cash-drawer session, so every drawer
  close read as a shortage.
- The POS "Card" button referenced a tender code that did not exist and would
  have failed on use.
- The end-to-end suite was silently skipping every test rather than running
  them, hiding three live breakages.

### Changed
- `PAYMENT_KEY_ENCRYPTION_SECRET` renamed to `APP_KEY_ENCRYPTION_SECRET`.
  **Existing deployments must rename this variable.**
- Country and currency assumptions are being removed throughout; currency now
  resolves per location.
