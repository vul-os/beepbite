# Sub-Processors — BeepBite

**Last updated:** 2026-05-21

This page lists the third-party sub-processors that BeepBite (Exolution Technologies Pty) uses to deliver the platform. Sub-processors may receive personal data as part of their service.

---

## Communication

| Sub-processor | Purpose | Personal data involved | Location |
|---|---|---|---|
| **Meta Platforms (WhatsApp Business API)** | Customer order notifications, payment links, support chat | Phone number, order summary | United States |
| **Resend / SendGrid** | Transactional email (receipts, account alerts, staff invites) | Email address, name, order details | United States |

## Artificial Intelligence

| Sub-processor | Purpose | Personal data involved | Location |
|---|---|---|---|
| **Anthropic** | AI-assisted menu suggestions, customer chatbot (Claude) | Order context, menu queries (no PII required by design) | United States |
| **OpenAI** | AI-assisted features (menu import, LLM fallback) | Menu and order context (no PII required by design) | United States |

## Payments

| Sub-processor | Purpose | Personal data involved | Location |
|---|---|---|---|
| **Paystack** | Card payment processing (South Africa and West Africa) | Name, email, card token, amount | Nigeria / South Africa |
| **Stripe** | Card payment processing (international) | Name, email, card token, amount | United States |

## Infrastructure

| Sub-processor | Purpose | Personal data involved | Location |
|---|---|---|---|
| **Fly.io** | Application server hosting | All application data in transit and at rest | EU and US regions |
| **Cloudflare R2** | Media storage (menu images, receipts) | Image files (no direct PII) | Global CDN |

## Authentication

| Sub-processor | Purpose | Personal data involved | Location |
|---|---|---|---|
| **Google (OAuth)** | Google Sign-In authentication | Email address, display name, profile picture | United States |

---

## Notes

- BeepBite does not sell personal data to any third party.
- All sub-processors are contractually bound to process personal data only on BeepBite's documented instructions.
- Data residency: primary data storage is hosted by Fly.io in the EU and/or US region depending on your instance configuration.
- To request a Data Processing Agreement (DPA), email **privacy@beepbite.io**.

For questions, contact **privacy@beepbite.io**.
