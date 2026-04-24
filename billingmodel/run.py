"""
Run: python -m billingmodel.run

Prints pricing tables and simulation results (ZAR-native), and writes
chart PNGs to billingmodel/results/.
"""

from __future__ import annotations

from pathlib import Path

from .pricing import TIERS, WALLET, META_RATES, COMPETITORS
from .simulation import Scenario, simulate, DEFAULT_USAGE, SimResult


# ───────────────────────── formatting helpers ─────────────────────────

def zar(x: float) -> str:
    if abs(x) >= 1_000_000:
        return f"R{x/1_000_000:>6.2f}M"
    if abs(x) >= 1_000:
        return f"R{x/1_000:>7.2f}k"
    return f"R{x:>9,.2f}"


def rule(ch: str = "─", n: int = 82) -> str:
    return ch * n


# ───────────────────────── print sections ─────────────────────────

def print_competitive():
    print(rule("═"))
    print("COMPETITIVE LANDSCAPE (ZAR / month) — 2026 research")
    print(rule())
    print(f"{'Provider':<22} {'Entry':>9} {'Mid':>9} {'Top':>9}  Notes")
    print(rule())
    for c in COMPETITORS:
        mark = "   ← us" if c.name == "BeepBite" else ""
        print(
            f"{c.name:<22} "
            f"R{c.entry_zar:>7,.0f}  "
            f"R{c.mid_zar:>7,.0f}  "
            f"R{c.top_zar:>7,.0f}  "
            f"{c.notes}{mark}"
        )
    print()


def print_tiers():
    print(rule("═"))
    print("BEEPBITE PRICING TIERS — for South Africa, Africa & India")
    print(rule())
    print(f"{'Tier':<9} {'ZAR/mo':>10} {'Service':>9} {'Util':>6} {'Mkt':>5} {'Stores':>7} {'Staff':>6}")
    print(rule())
    for t in TIERS:
        stores = "∞" if t.included_stores >= 999 else str(t.included_stores)
        print(
            f"{t.name:<9} R{t.price_zar:>8,.0f}  "
            f"{t.included_service:>9,} "
            f"{t.included_utility:>6,} "
            f"{t.included_marketing:>5,} "
            f"{stores:>7} "
            f"{t.included_staff:>6}"
        )
    print()
    for t in TIERS:
        print(f"  {t.name} — R{t.price_zar:,.0f} / month:")
        for f in t.features:
            print(f"    • {f}")
        print()


def print_wallet():
    print(rule("═"))
    print("WALLET / PAY-AS-YOU-GO (top-up, used for overage + marketing)")
    print(rule())
    print(f"Minimum top-up : R{WALLET.min_topup_zar:,.2f}")
    print(f"Payment fee    : {WALLET.payment_fee_pct*100:.1f}% (card processing)")
    print()
    print(f"{'Category':<18} {'Meta base':>12} {'BeepBite':>12} {'Markup':>10}")
    print(rule())
    rows = [
        ("service overage",  META_RATES["service"],        WALLET.price("service"),        WALLET.markup_service_overage),
        ("utility",          META_RATES["utility"],        WALLET.price("utility"),        WALLET.markup_utility),
        ("authentication",   META_RATES["authentication"], WALLET.price("authentication"), WALLET.markup_utility),
        ("marketing",        META_RATES["marketing"],      WALLET.price("marketing"),      WALLET.markup_marketing),
    ]
    for name, base, price, markup in rows:
        print(f"{name:<18} R{base:>10.4f}  R{price:>10.4f}   +{markup*100:>6.0f}%")
    print()


def print_sim(res: SimResult):
    print(rule("═"))
    print(f"SCENARIO: {res.scenario}")
    print(rule())
    print(f"Total customers : {res.total_customers:>7,}")
    print(f"  Free          : {res.free_customers:>7,}  ({res.free_customers/res.total_customers*100:.0f}%)")
    print(f"  Paid          : {res.paid_customers:>7,}  ({res.paid_customers/res.total_customers*100:.0f}%)")
    print()

    print(f"{'Tier':<8} {'#cust':>6} {'Sub MRR':>11} {'Wallet':>11} {'WA COGS':>11} {'Infra':>10} {'Support':>10} {'Fees':>9} {'Profit':>11}")
    print(rule())
    for t in res.per_tier:
        print(
            f"{t.tier:<8} {t.customers:>6,} "
            f"{zar(t.sub_revenue):>11} "
            f"{zar(t.wallet_revenue):>11} "
            f"{zar(t.wa_cogs):>11} "
            f"{zar(t.infra_cost):>10} "
            f"{zar(t.support_cost):>10} "
            f"{zar(t.payment_fees):>9} "
            f"{zar(t.profit):>11}"
        )
    print(rule())
    print(f"Variable revenue    : {zar(res.revenue)}")
    print(f"Variable cost       : {zar(res.variable_cost)}")
    print(f"Fixed overhead      : {zar(res.fixed_overhead)}")
    print(f"Total cost          : {zar(res.total_cost)}")
    print(f"NET PROFIT (month)  : {zar(res.profit)}    margin {res.margin_pct:>5.1f}%")
    print(f"Annual run-rate     : {zar(res.profit * 12)}")
    print(f"ARPU (paid only)    : R{res.arpu_paid:,.2f}")
    print()


# ───────────────────────── scenarios ─────────────────────────

SMALL_SCALE = Scenario(
    name="SMALL SCALE — 1,000 customers (SA/India/Africa SMB restaurants)",
    total_customers=1_000,
    free_fraction=0.65,
    paid_mix={
        "Starter": 0.72,
        "Growth":  0.23,
        "Pro":     0.05,
    },
    # No human labor — marketing spend only (organic + light paid acquisition)
    fixed_overhead_zar=15_000.0,
)

LARGE_SCALE = Scenario(
    name="LARGE SCALE — 10,000 customers (SA/India/Africa SMB restaurants)",
    total_customers=10_000,
    free_fraction=0.55,
    paid_mix={
        "Starter": 0.65,
        "Growth":  0.28,
        "Pro":     0.07,
    },
    # No human labor — marketing spend only (paid acquisition at scale)
    fixed_overhead_zar=200_000.0,
)


def main():
    print_competitive()
    print_tiers()
    print_wallet()

    small = simulate(SMALL_SCALE)
    large = simulate(LARGE_SCALE)
    print_sim(small)
    print_sim(large)

    # Generate charts
    from . import charts
    out_dir = Path(__file__).parent / "results"
    out_dir.mkdir(exist_ok=True)
    charts.generate_all(small, large, out_dir)
    print(rule("═"))
    print(f"Charts written to: {out_dir}/")
    for p in sorted(out_dir.glob("*.png")):
        print(f"  • {p.name}")


if __name__ == "__main__":
    main()
