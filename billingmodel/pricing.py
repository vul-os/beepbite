"""
BeepBite billing model — pricing for South Africa, Africa & India.

All amounts are in ZAR / month unless noted. USD shown for reference only.

Target ICP: SMB restaurants / takeaways / cloud kitchens in price-sensitive
emerging markets. Product bundle:
  • Full restaurant POS (card + cash, tables, KDS)
  • Recipe & food-cost engine (per-item cost, menu engineering, wastage)
  • Inventory + suppliers
  • WhatsApp ordering + customer comms
  • Payments

FX used for reference (indicative, 2026):
  R18.50 per USD     — USD equivalents below

Competitive landscape observed:
  Local SA POS (GAAP/Pilot/POSStar)   R500 – R2,000 / mo
  Loyverse POS                         free base, ~R460 / store
  Wati (India entry)                   ~R555 / mo   (₹2,499)
  AiSensy (India entry)                ~R335 / mo   (₹1,500)
  Petpooja (India, restaurant POS)     ~R185 / mo   (₹10k/yr)

BeepBite sits at or below the cheapest of these, because our value prop is
POS + costing + WhatsApp together — messaging revenue through the wallet
is where we make money, not on seat inflation.

Meta WhatsApp rates (South Africa, per-message model, 2026):
  service (in 24h window) : R0.00
  utility                 : R0.26
  authentication          : R0.26
  marketing               : R1.59
"""

from dataclasses import dataclass
from typing import Dict


# Meta WhatsApp Business rates for South Africa (ZAR per message)
META_RATES: Dict[str, float] = {
    "service": 0.00,
    "utility": 0.26,
    "authentication": 0.26,
    "marketing": 1.59,
}

USD_TO_ZAR = 18.5  # reference only


@dataclass(frozen=True)
class Tier:
    name: str
    price_zar: float
    included_service: int
    included_utility: int
    included_marketing: int
    included_stores: int
    included_staff: int
    features: tuple
    infra_cost_zar: float       # server/db/storage/AI cost per client/mo
    support_cost_zar: float     # avg human support cost per client/mo


FREE = Tier(
    name="Free",
    price_zar=0,
    included_service=100,
    included_utility=0,
    included_marketing=0,
    included_stores=1,
    included_staff=1,
    features=(
        "1 store, 1 staff seat",
        "Up to 50 orders / month",
        "Basic POS (cash only, card via wallet add-on)",
        "Recipe costing — up to 20 recipes",
        "WhatsApp ordering (BeepBite-branded replies)",
        "Community support",
    ),
    infra_cost_zar=4.60,
    support_cost_zar=1.85,
)

STARTER = Tier(
    name="Starter",
    price_zar=149,               # under R150 psychological floor
    included_service=1_000,
    included_utility=50,
    included_marketing=0,
    included_stores=1,
    included_staff=3,
    features=(
        "1 store, 3 staff seats",
        "Unlimited orders",
        "Full POS (card + cash, tables, KDS)",
        "Recipe costing — unlimited recipes",
        "Food-cost % per item + menu engineering matrix",
        "Basic inventory + wastage log",
        "Order status utility templates",
        "Email / WhatsApp support",
        "Remove BeepBite branding",
    ),
    infra_cost_zar=18.50,
    support_cost_zar=14.80,
)

GROWTH = Tier(
    name="Growth",
    price_zar=499,
    included_service=5_000,
    included_utility=200,
    included_marketing=0,
    included_stores=3,
    included_staff=10,
    features=(
        "Up to 3 stores, 10 staff seats",
        "Everything in Starter, plus:",
        "Supplier management + purchase orders",
        "Advanced food-cost — theoretical vs actual variance",
        "Stock takes, yields, sub-recipes",
        "Marketing broadcasts (wallet-paid)",
        "Loyalty + vouchers",
        "Daily sales + food-cost reports",
        "Priority support",
        "Webhooks",
    ),
    infra_cost_zar=55.50,
    support_cost_zar=46.25,
)

PRO = Tier(
    name="Pro",
    price_zar=1_299,             # still under the cheapest SA restaurant POS
    included_service=20_000,
    included_utility=1_000,
    included_marketing=0,
    included_stores=9999,
    included_staff=50,
    features=(
        "Unlimited stores, 50 staff seats",
        "Everything in Growth, plus:",
        "Multi-location dashboards + consolidated P&L",
        "Central kitchen / commissary costing",
        "API access + accounting exports (Xero, Sage, Zoho)",
        "Franchise / brand management",
        "Dedicated account manager",
        "Phone + SLA support",
        "Custom WhatsApp template review",
    ),
    infra_cost_zar=148.00,
    support_cost_zar=148.00,
)

TIERS = (FREE, STARTER, GROWTH, PRO)


@dataclass(frozen=True)
class WalletPricing:
    """
    Wallet top-up for marketing + overage. Markup kept small — the business
    case is POS + costing value, not messaging arbitrage. We match Wati's
    ~20% markup on utility and 18% on marketing.
    """
    markup_utility: float = 0.20
    markup_authentication: float = 0.20
    markup_marketing: float = 0.18
    markup_service_overage: float = 1.0
    service_overage_floor_zar: float = 0.04     # R0.04/msg even when Meta is free
    min_topup_zar: float = 99.00                # R99 — works on mobile money
    payment_fee_pct: float = 0.029              # card processing on top-ups

    def price(self, category: str) -> float:
        base = META_RATES[category]
        if category == "service":
            return max(base, self.service_overage_floor_zar) * (1 + self.markup_service_overage)
        if category == "marketing":
            return base * (1 + self.markup_marketing)
        if category in ("utility", "authentication"):
            return base * (1 + self.markup_utility)
        raise ValueError(f"unknown category: {category}")


WALLET = WalletPricing()


@dataclass(frozen=True)
class CompetitorRef:
    name: str
    entry_zar: float
    mid_zar: float
    top_zar: float
    notes: str


# All competitor prices converted to ZAR for apples-to-apples comparison
COMPETITORS = (
    CompetitorRef("GAAP / Pilot (SA)",   500,  1_100, 2_000, "local SA restaurant POS"),
    CompetitorRef("Petpooja (India)",    185,    370,   740, "restaurant POS, ₹10k/yr"),
    CompetitorRef("Wati",                555,  1_295, 3_330, "India-priced WA ops; 20% msg markup"),
    CompetitorRef("AiSensy",             335,    740, 1_850, "India-priced WA ops"),
    CompetitorRef("Loyverse",            460,    925, 1_850, "POS-only, per-store"),
    CompetitorRef("BeepBite",            149,    499, 1_299, "POS + costing + WhatsApp — SA/IN/Africa"),
)
