"""
BeepBite billing simulator — ZAR-native.

Inputs  : a Scenario (customer count + tier mix + per-tier usage profile).
Outputs : monthly revenue, cost, profit, and customer split — all in ZAR.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List, Tuple

from .pricing import TIERS, FREE, STARTER, GROWTH, PRO, WALLET, META_RATES


@dataclass
class TierUsage:
    """Average monthly WhatsApp send volumes for one customer on this tier."""
    service: int
    utility: int
    marketing: int


# Tuned for SA / India / Africa SMB restaurants
DEFAULT_USAGE: Dict[str, TierUsage] = {
    "Free":    TierUsage(service=40,     utility=0,     marketing=0),
    "Starter": TierUsage(service=900,    utility=200,   marketing=60),
    "Growth":  TierUsage(service=4_200,  utility=900,   marketing=250),
    "Pro":     TierUsage(service=18_000, utility=3_500, marketing=800),
}


@dataclass
class Scenario:
    name: str
    total_customers: int
    free_fraction: float
    paid_mix: Dict[str, float]
    usage: Dict[str, TierUsage] = field(default_factory=lambda: DEFAULT_USAGE)
    fixed_overhead_zar: float = 0.0
    churn_monthly_pct: float = 0.04
    sub_payment_fee_pct: float = 0.029


@dataclass
class TierResult:
    tier: str
    customers: int
    sub_revenue: float
    wallet_revenue: float
    wa_cogs: float
    infra_cost: float
    support_cost: float
    payment_fees: float

    @property
    def revenue(self) -> float:
        return self.sub_revenue + self.wallet_revenue

    @property
    def cost(self) -> float:
        return self.wa_cogs + self.infra_cost + self.support_cost + self.payment_fees

    @property
    def profit(self) -> float:
        return self.revenue - self.cost


@dataclass
class SimResult:
    scenario: str
    total_customers: int
    free_customers: int
    paid_customers: int
    per_tier: List[TierResult]
    fixed_overhead: float

    @property
    def revenue(self) -> float:
        return sum(t.revenue for t in self.per_tier)

    @property
    def variable_cost(self) -> float:
        return sum(t.cost for t in self.per_tier)

    @property
    def total_cost(self) -> float:
        return self.variable_cost + self.fixed_overhead

    @property
    def profit(self) -> float:
        return self.revenue - self.total_cost

    @property
    def margin_pct(self) -> float:
        return (self.profit / self.revenue * 100) if self.revenue else 0.0

    @property
    def arpu_paid(self) -> float:
        return (self.revenue / self.paid_customers) if self.paid_customers else 0.0


def _tier_by_name(name: str):
    for t in TIERS:
        if t.name == name:
            return t
    raise KeyError(name)


def _wallet_revenue_and_cogs(tier, usage: TierUsage) -> Tuple[float, float]:
    overage_service   = max(0, usage.service   - tier.included_service)
    overage_utility   = max(0, usage.utility   - tier.included_utility)
    overage_marketing = max(0, usage.marketing - tier.included_marketing)

    wallet_rev = (
        overage_service   * WALLET.price("service")   +
        overage_utility   * WALLET.price("utility")   +
        overage_marketing * WALLET.price("marketing")
    )

    wa_cogs = (
        usage.service   * META_RATES["service"] +
        usage.utility   * META_RATES["utility"] +
        usage.marketing * META_RATES["marketing"]
    )

    return wallet_rev, wa_cogs


def simulate(sc: Scenario) -> SimResult:
    free_n = int(round(sc.total_customers * sc.free_fraction))
    paid_n = sc.total_customers - free_n

    mix_sum = sum(sc.paid_mix.values())
    assert abs(mix_sum - 1.0) < 1e-6, f"paid_mix must sum to 1, got {mix_sum}"

    per_tier: List[TierResult] = []

    free_usage = sc.usage["Free"]
    f_wallet_rev, f_wa_cogs = _wallet_revenue_and_cogs(FREE, free_usage)
    per_tier.append(TierResult(
        tier="Free",
        customers=free_n,
        sub_revenue=0.0,
        wallet_revenue=f_wallet_rev * free_n,
        wa_cogs=f_wa_cogs * free_n,
        infra_cost=FREE.infra_cost_zar * free_n,
        support_cost=FREE.support_cost_zar * free_n,
        payment_fees=0.0,
    ))

    for tier_name, share in sc.paid_mix.items():
        tier = _tier_by_name(tier_name)
        n = int(round(paid_n * share))
        if n == 0:
            continue
        usage = sc.usage[tier_name]
        wallet_rev_pc, wa_cogs_pc = _wallet_revenue_and_cogs(tier, usage)

        sub_rev = tier.price_zar * n
        wallet_rev = wallet_rev_pc * n
        wa_cogs = wa_cogs_pc * n
        infra = tier.infra_cost_zar * n
        support = tier.support_cost_zar * n
        payment_fees = (sub_rev + wallet_rev) * sc.sub_payment_fee_pct

        per_tier.append(TierResult(
            tier=tier_name,
            customers=n,
            sub_revenue=sub_rev,
            wallet_revenue=wallet_rev,
            wa_cogs=wa_cogs,
            infra_cost=infra,
            support_cost=support,
            payment_fees=payment_fees,
        ))

    return SimResult(
        scenario=sc.name,
        total_customers=sc.total_customers,
        free_customers=free_n,
        paid_customers=paid_n,
        per_tier=per_tier,
        fixed_overhead=sc.fixed_overhead_zar,
    )
