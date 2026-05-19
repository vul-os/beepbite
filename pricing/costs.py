"""Our underlying costs per metered action. All USD.

Sources (Q1 2026):
- Anthropic API: https://www.anthropic.com/pricing (Claude Sonnet 4.5 / Haiku 4.5)
- Meta WhatsApp BCAPI: https://developers.facebook.com/docs/whatsapp/pricing
- Twilio Programmable Messaging: https://www.twilio.com/en-us/sms/pricing
- Fly.io: https://fly.io/docs/about/pricing/
- Cloudflare R2: https://www.cloudflare.com/r2/
"""

from dataclasses import dataclass


# ─────────────────────────────────────────────────────────────────────────────
# WhatsApp per-message UTILITY rates (USD), Meta BCAPI as of Jan 2026.
# These are *our cost* to send a message. Service-category (customer-initiated,
# 24h window) is free; we mostly bill utility (order confirmations, kitchen-
# ready, delivery updates). Marketing is 2-3× higher and we avoid it.
# ─────────────────────────────────────────────────────────────────────────────
WHATSAPP_UTILITY_BY_COUNTRY = {
    # Africa — our launch market is heavier here
    "ZA": 0.0167,  # South Africa
    "NG": 0.0214,  # Nigeria
    "KE": 0.0144,  # Kenya
    "GH": 0.0224,  # Ghana
    "EG": 0.0220,  # Egypt
    # Latam
    "BR": 0.0080,  # Brazil
    "MX": 0.0040,  # Mexico
    "AR": 0.0618,  # Argentina (notably high)
    # Asia
    "IN": 0.0014,  # India (cheapest)
    "ID": 0.0098,  # Indonesia
    "PH": 0.0118,  # Philippines
    # Western
    "US": 0.0079,  # United States
    "GB": 0.0319,  # United Kingdom
    "DE": 0.0825,  # Germany (high)
    "FR": 0.1432,  # France (very high)
    "CA": 0.0149,  # Canada
    "AU": 0.0473,  # Australia
}

# Weighted global average assuming our target mix:
# 50% Africa, 20% Asia, 15% Latam, 15% Western/other.
WHATSAPP_UTILITY_GLOBAL_AVG = (
    0.50 * 0.0193  # Africa avg
    + 0.20 * 0.0058  # Asia avg
    + 0.15 * 0.0246  # Latam avg
    + 0.15 * 0.0546  # Western/other avg
)  # ≈ $0.014


# ─────────────────────────────────────────────────────────────────────────────
# SMS per-message rates (USD), Twilio Programmable Messaging Jan 2026.
# ─────────────────────────────────────────────────────────────────────────────
SMS_BY_COUNTRY = {
    "ZA": 0.0775,
    "NG": 0.0608,
    "KE": 0.0387,
    "IN": 0.0258,
    "BR": 0.0250,
    "US": 0.0083,
    "GB": 0.0379,
    "DE": 0.0860,
}
SMS_GLOBAL_AVG = 0.040


# ─────────────────────────────────────────────────────────────────────────────
# Claude API per-message cost. Assumes Sonnet 4.5 + prompt caching.
# Per turn:
#   - System prompt (tool defs + store context): ~1500 tokens, cached
#       cached read: 1500 × $0.30/MTok = $0.00045
#   - Fresh user message: ~150 tokens × $3/MTok = $0.00045
#   - Tool result (when used): ~200 tokens × $3/MTok = $0.0006
#   - Assistant output: ~250 tokens × $15/MTok = $0.00375
#   Total per turn: ~$0.005 customer-facing chat, ~$0.008 owner chat
# Bulk imports (vision): ~5k input tokens × $3/MTok + 2k output × $15/MTok = $0.045
# ─────────────────────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class UnitCosts:
    """What it costs *us* to provide each unit, all USD."""
    # Anthropic Claude Sonnet 4.5 with caching
    llm_customer_msg_usd: float = 0.005
    llm_owner_msg_usd: float = 0.008
    llm_bulk_import_usd: float = 0.045  # PDF/image vision parse

    # Meta WhatsApp BCAPI (utility category, global blended)
    whatsapp_utility_usd: float = 0.014    # ≈ blended global, see WHATSAPP_UTILITY_BY_COUNTRY
    whatsapp_marketing_usd: float = 0.040  # ~3× utility, blended
    whatsapp_auth_usd: float = 0.020       # OTPs etc.

    # Twilio SMS (blended global)
    sms_usd: float = 0.040

    # Email via Resend: free 3k/mo, Pro $20/mo for 50k = $0.0004/email
    # Amazon SES alternative: $0.10/1k = $0.0001/email
    # Conservative: $0.0004/email
    email_usd: float = 0.0004

    # Fly.io shared infrastructure amortized per tenant
    # Production Fly app: ~$10-30/mo across all tenants on a region
    # Postgres on Fly: ~$15/mo shared
    # At ~100 tenants per region: $0.30-0.50/tenant
    hosting_per_tenant_usd: float = 0.50

    # Storage: Cloudflare R2 = $0.015/GB-month, no egress
    # Plus Postgres storage ~$0.10/GB-month
    storage_per_gb_usd: float = 0.025

    # Backwards-compat alias: treat default LLM cost as customer-msg cost
    @property
    def llm_message_usd(self) -> float:
        return self.llm_customer_msg_usd


COSTS = UnitCosts()


# ─────────────────────────────────────────────────────────────────────────────
# Quick sanity print
# ─────────────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    print("UNIT COSTS (USD, sourced from public pricing pages, Jan 2026):")
    print(f"  Customer LLM message    ${COSTS.llm_customer_msg_usd:.4f}  (Sonnet 4.5 + caching, ~1500 sys / 250 out)")
    print(f"  Owner LLM message       ${COSTS.llm_owner_msg_usd:.4f}  (longer system, more tools)")
    print(f"  Bulk import (vision)    ${COSTS.llm_bulk_import_usd:.4f}  (PDF or photo of menu)")
    print(f"  WhatsApp utility (avg)  ${COSTS.whatsapp_utility_usd:.4f}  (blended; range $0.001 IN to $0.14 FR)")
    print(f"  WhatsApp marketing      ${COSTS.whatsapp_marketing_usd:.4f}")
    print(f"  SMS (avg)               ${COSTS.sms_usd:.4f}")
    print(f"  Hosting per tenant      ${COSTS.hosting_per_tenant_usd:.4f}/mo (Fly + shared Postgres amortized)")
    print(f"  Storage per GB-month    ${COSTS.storage_per_gb_usd:.4f}  (R2 + Postgres)")
    print()
    print("WhatsApp utility cost by country — wide range:")
    for cc in ("IN", "MX", "BR", "US", "ZA", "NG", "GB", "DE", "FR"):
        print(f"    {cc}  ${WHATSAPP_UTILITY_BY_COUNTRY[cc]:.4f}")
