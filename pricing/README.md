# Pricing Exploration

Exploring billing models for BeepBite before we commit one in code. The goal is to find a model that:

1. Has a **real free tier** (a side-hustle stall can use BeepBite for $0).
2. Lets a **busy restaurant** scale into paid usage without sticker shock.
3. **Covers our costs** (LLM, WhatsApp, hosting) at every tier — no negative-margin customers.
4. Is **easy to explain** on the landing page in one sentence.

## Run it

```bash
python3 scenarios.py
```

Prints a comparison table: every pricing model × every customer profile, monthly cost + our margin.

## Files

- `pricing.py` — pricing model classes (FlatSubscription, PerTransactionFee, WalletPayAsYouGo, FreemiumWallet, TieredSubscription, HybridLowBasePlusTxn).
- `usage.py` — customer profiles (SideHustle, SmallBistro, BusyRestaurant, MultiLocation, Chain).
- `costs.py` — what each metered action costs *us* (Anthropic API, WhatsApp BSP, etc.).
- `scenarios.py` — runs every model × every profile, prints text tables.

Stdlib only. No requirements.txt needed.

## Outputs

`scenarios.py` produces three tables:

1. **Customer cost** — what each profile pays per month under each model.
2. **Our margin** — what we keep after metered costs.
3. **Cliff analysis** — at what monthly order volume each model breaks the customer's budget assumption.

## Notes on costs (rough current rates, USD)

| Resource | Our unit cost |
|---|---|
| LLM message (Claude Sonnet, ~1k in / 0.5k out, with prompt caching) | $0.005 |
| WhatsApp outbound (utility/service category, average across regions) | $0.020 |
| WhatsApp outbound (marketing category) | $0.050 |
| Hosting (amortised per tenant per month, Fly + Postgres) | $0.50 |
| Payment processing | $0 (tenant brings their own keys) |
| Storage (per GB-month) | $0.10 |

These are tunable in `costs.py`. The current numbers are conservative — actual Anthropic costs drop further with caching on long prompts; actual WhatsApp pricing varies by country and Meta's pricing tiers.
