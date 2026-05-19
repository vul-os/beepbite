"""Pricing model classes.

Each model implements `monthly_charge(profile) -> float` returning USD billed to the customer.
"""

from dataclasses import dataclass, field
from typing import Dict, List

from usage import Profile


@dataclass(frozen=True)
class Model:
    name: str
    tagline: str

    def monthly_charge(self, p: Profile) -> float:
        raise NotImplementedError


# ─────────────────────────────────────────────────────────────────────────────
# 1. Flat subscription per location
# ─────────────────────────────────────────────────────────────────────────────

@dataclass(frozen=True)
class FlatSubscription(Model):
    per_location_usd: float = 49.0

    def monthly_charge(self, p: Profile) -> float:
        return self.per_location_usd * p.locations


# ─────────────────────────────────────────────────────────────────────────────
# 2. Per-transaction fee (no base)
# ─────────────────────────────────────────────────────────────────────────────

@dataclass(frozen=True)
class PerTransactionFee(Model):
    percent: float = 0.015        # 1.5% of ticket
    fixed_cents: int = 25         # plus $0.25 per order

    def monthly_charge(self, p: Profile) -> float:
        per_order = (p.avg_ticket_usd * self.percent) + (self.fixed_cents / 100)
        return per_order * p.orders_per_month


# ─────────────────────────────────────────────────────────────────────────────
# 3. Wallet pay-as-you-go (no free tier, no subscription)
# ─────────────────────────────────────────────────────────────────────────────

@dataclass(frozen=True)
class WalletPayAsYouGo(Model):
    per_order_usd: float = 0.10
    per_whatsapp_usd: float = 0.03   # marked up from our $0.02 cost
    per_llm_msg_usd: float = 0.02    # marked up from our $0.005 cost
    per_location_usd: float = 5.0    # tiny baseline so multi-location is fair

    def monthly_charge(self, p: Profile) -> float:
        return (
            self.per_location_usd * p.locations
            + self.per_order_usd * p.orders_per_month
            + self.per_whatsapp_usd * p.whatsapp_msgs_per_month
            + self.per_llm_msg_usd * p.llm_msgs_per_month
        )


# ─────────────────────────────────────────────────────────────────────────────
# 4. Freemium + wallet overage
# ─────────────────────────────────────────────────────────────────────────────

@dataclass(frozen=True)
class FreemiumWallet(Model):
    free_orders: int = 100
    free_whatsapp: int = 500
    free_llm: int = 100
    over_per_order_usd: float = 0.15
    over_per_whatsapp_usd: float = 0.04
    over_per_llm_usd: float = 0.03

    def monthly_charge(self, p: Profile) -> float:
        # Per location, not per org — free tier scales with locations
        free_o = self.free_orders * p.locations
        free_w = self.free_whatsapp * p.locations
        free_l = self.free_llm * p.locations

        over_o = max(0, p.orders_per_month - free_o)
        over_w = max(0, p.whatsapp_msgs_per_month - free_w)
        over_l = max(0, p.llm_msgs_per_month - free_l)

        return (
            over_o * self.over_per_order_usd
            + over_w * self.over_per_whatsapp_usd
            + over_l * self.over_per_llm_usd
        )


# ─────────────────────────────────────────────────────────────────────────────
# 5. Tiered subscription (Toast / Square-style)
# ─────────────────────────────────────────────────────────────────────────────

@dataclass(frozen=True)
class Tier:
    name: str
    monthly_usd: float
    included_orders: int
    included_whatsapp: int
    included_llm: int
    included_email: int = 0
    over_order_usd: float = 0.20
    over_whatsapp_usd: float = 0.05
    over_llm_usd: float = 0.05
    over_email_usd: float = 0.002


@dataclass(frozen=True)
class TieredSubscription(Model):
    """Anthropic-style tiers: monthly base with included quotas, overage drains wallet."""
    tiers: List[Tier] = field(default_factory=lambda: [
        # Free: hard cap. WhatsApp ceiling tightened (it dominates our cost on free).
        # Inactive >90 days auto-pauses (policy, not pricing).
        Tier("Free",     0.0,    100,    200,    20,    included_email=300,
             over_order_usd=0.0, over_whatsapp_usd=0.0, over_llm_usd=0.0, over_email_usd=0.0),
        # Starter: tighter than typical small-bistro usage so a real bistro spills.
        Tier("Starter",  39.0,   500,    1_500,  150,   included_email=2_000,
             over_order_usd=0.10, over_whatsapp_usd=0.04, over_llm_usd=0.03, over_email_usd=0.002),
        # Growth: priced and quota'd so busy NG-style restaurants spill into overage.
        Tier("Growth",   249.0,  3_000,  10_000, 1_200, included_email=15_000,
             over_order_usd=0.08, over_whatsapp_usd=0.03, over_llm_usd=0.025, over_email_usd=0.0015),
        # Scale: for chains. Per-loc usage typically fits; overage above that.
        Tier("Scale",    799.0,  12_000, 35_000, 4_500, included_email=50_000,
             over_order_usd=0.06, over_whatsapp_usd=0.025, over_llm_usd=0.02, over_email_usd=0.001),
    ])

    def pick_tier(self, p: Profile) -> Tier:
        """Pick the cheapest tier that covers (or has positive overage for) the usage.

        Free tier is hard-capped: a user is only eligible for Free if usage fits
        entirely within Free's included quotas; otherwise Free is skipped.
        """
        best = self.tiers[-1]  # default to top tier
        best_cost = float("inf")
        for t in self.tiers:
            inc_o = t.included_orders * p.locations
            inc_w = t.included_whatsapp * p.locations
            inc_l = t.included_llm * p.locations
            inc_e = t.included_email * p.locations
            over_o = max(0, p.orders_per_month - inc_o)
            over_w = max(0, p.whatsapp_msgs_per_month - inc_w)
            over_l = max(0, p.llm_msgs_per_month - inc_l)
            over_e = max(0, p.emails_per_month - inc_e)
            # Hard cap: zero-overage tier (Free) is only eligible if usage fits.
            if (t.over_order_usd == 0 and t.over_whatsapp_usd == 0
                    and t.over_llm_usd == 0 and t.over_email_usd == 0):
                if over_o > 0 or over_w > 0 or over_l > 0 or over_e > 0:
                    continue
            cost = (
                t.monthly_usd * p.locations
                + over_o * t.over_order_usd
                + over_w * t.over_whatsapp_usd
                + over_l * t.over_llm_usd
                + over_e * t.over_email_usd
            )
            if cost < best_cost:
                best_cost = cost
                best = t
        return best

    def monthly_charge(self, p: Profile) -> float:
        t = self.pick_tier(p)
        inc_o = t.included_orders * p.locations
        inc_w = t.included_whatsapp * p.locations
        inc_l = t.included_llm * p.locations
        inc_e = t.included_email * p.locations
        over_o = max(0, p.orders_per_month - inc_o)
        over_w = max(0, p.whatsapp_msgs_per_month - inc_w)
        over_l = max(0, p.llm_msgs_per_month - inc_l)
        over_e = max(0, p.emails_per_month - inc_e)
        return (
            t.monthly_usd * p.locations
            + over_o * t.over_order_usd
            + over_w * t.over_whatsapp_usd
            + over_l * t.over_llm_usd
            + over_e * t.over_email_usd
        )


# ─────────────────────────────────────────────────────────────────────────────
# 6. Hybrid: low base + tiny per-transaction
# ─────────────────────────────────────────────────────────────────────────────

@dataclass(frozen=True)
class HybridLowBasePlusTxn(Model):
    per_location_usd: float = 15.0
    percent: float = 0.005           # 0.5%
    fixed_cents: int = 10            # $0.10 per order
    per_whatsapp_overage_usd: float = 0.03
    per_llm_overage_usd: float = 0.02
    free_whatsapp_per_location: int = 500
    free_llm_per_location: int = 100

    def monthly_charge(self, p: Profile) -> float:
        base = self.per_location_usd * p.locations
        per_order = (p.avg_ticket_usd * self.percent) + (self.fixed_cents / 100)
        tx = per_order * p.orders_per_month
        over_w = max(0, p.whatsapp_msgs_per_month - self.free_whatsapp_per_location * p.locations)
        over_l = max(0, p.llm_msgs_per_month - self.free_llm_per_location * p.locations)
        return base + tx + over_w * self.per_whatsapp_overage_usd + over_l * self.per_llm_overage_usd


# ─────────────────────────────────────────────────────────────────────────────
# Default registry — instances used by scenarios.py
# ─────────────────────────────────────────────────────────────────────────────

MODELS: Dict[str, Model] = {
    "Flat $49/loc":      FlatSubscription("Flat", "$49/location/month flat",
                                          per_location_usd=49.0),
    "Per-Tx 1.5%+$0.25": PerTransactionFee("Per-Tx", "1.5% + $0.25 per order",
                                           percent=0.015, fixed_cents=25),
    "Wallet PAYG":       WalletPayAsYouGo("Wallet", "Top up; drained per action",
                                          per_order_usd=0.10,
                                          per_whatsapp_usd=0.03,
                                          per_llm_msg_usd=0.02,
                                          per_location_usd=5.0),
    "Freemium+Wallet":   FreemiumWallet("Freemium+Wallet",
                                        "Free 100 orders/500 WA/50 LLM per loc; overage from wallet",
                                        free_orders=100, free_whatsapp=500, free_llm=50,
                                        over_per_order_usd=0.10,
                                        over_per_whatsapp_usd=0.04,
                                        over_per_llm_usd=0.03),
    "Tiered (Free→Scale)": TieredSubscription("Tiered",
                                              "Free / Starter / Growth / Scale tiers with overage"),
    "Hybrid base+0.5%":  HybridLowBasePlusTxn("Hybrid",
                                              "$15/loc + 0.5%/$0.10 per order + WA/LLM overage",
                                              per_location_usd=15.0,
                                              percent=0.005, fixed_cents=10),
}
