# Third-party services

BeepBite is self-hosted, open-source software. **There is no BeepBite service
operator**, no hosted instance and no company processing your data on your
behalf. You run the binary; you are the data controller and, where the law uses
the term, your own processor.

That means this page cannot be a sub-processor list in the usual sense. Nobody
is a sub-processor to BeepBite, because BeepBite is not a service. What follows
is the honest version: the third parties **you** may choose to engage, what data
leaves your server if you do, and what happens if you do not.

Every one of them is optional. BeepBite runs with none of them configured.

---

## Optional integrations

| Service | Enabled by | What leaves your server | If you skip it |
|---|---|---|---|
| **Meta (WhatsApp Business API)** | `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID` | Customer phone number, order summary, chat messages | No WhatsApp ordering channel. QR / web ordering still works. |
| **SMTP server of your choice** | `SMTP_HOST` and friends | Email address, name, receipt and invite contents | No transactional email. Everything else works. |
| **SendGrid / Mailgun / Amazon SES** | `EMAIL_PROVIDER_DEFAULT` | Same as above | Use plain SMTP instead — it is the default. |
| **Mapbox** | `MAPBOX_TOKEN` | Delivery addresses being geocoded | The chatbot asks customers to share a location pin instead of typing an address. |
| **Google (Gemini)** | `GEMINI_API_KEY` | Floor-plan descriptions, menu text you paste in, owner-assistant prompts | No AI floor-plan generator and no owner assistant. |

The WhatsApp credentials are **yours**, registered under your own Meta Business
account. BeepBite never holds them and there is no shared account.

## What is deliberately not here

- **No payment processor.** BeepBite records tenders and never touches a card.
  See [Payments](help/payments.md).
- **No analytics or telemetry.** Nothing phones home. There is no crash
  reporter, no product analytics and no usage beacon.
- **No identity provider.** Sign-in is email + password and staff PIN, verified
  against your own database.
- **No hosting dependency.** Where the binary and the Postgres database run is
  entirely your choice.

## Your obligations

Because you operate the instance, the DPAs, privacy notices and data-residency
decisions are yours to make. If you enable any service above, its terms apply
between you and that vendor. BeepBite is not a party to it.
