"""
Generate ZAR-denominated charts for the BeepBite billing model.

Writes PNGs to the given output dir. Called by run.py, or standalone:
  python -m billingmodel.charts
"""

from __future__ import annotations

from pathlib import Path
from typing import List

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

from .pricing import TIERS, COMPETITORS, WALLET, META_RATES
from .simulation import Scenario, simulate, SimResult, DEFAULT_USAGE, TierUsage


PALETTE = {
    "Free":    "#94a3b8",
    "Starter": "#22c55e",
    "Growth":  "#0ea5e9",
    "Pro":     "#8b5cf6",
    "revenue": "#16a34a",
    "cost":    "#ef4444",
    "profit":  "#0369a1",
    "us":      "#ef4444",
    "them":    "#64748b",
}


def _fmt_zar(x, _pos=None):
    if abs(x) >= 1_000_000:
        return f"R{x/1_000_000:.1f}M"
    if abs(x) >= 1_000:
        return f"R{x/1_000:.0f}k"
    return f"R{x:.0f}"


def _style(ax, title: str):
    ax.set_title(title, fontsize=13, fontweight="bold", pad=12)
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    ax.grid(axis="y", alpha=0.25, linestyle="--")


# ──────────────────────────────────────────────────────────────
# 1. Competitor price comparison (horizontal grouped bars)
# ──────────────────────────────────────────────────────────────
def chart_competitors(out: Path):
    names = [c.name for c in COMPETITORS]
    entry = [c.entry_zar for c in COMPETITORS]
    mid   = [c.mid_zar for c in COMPETITORS]
    top   = [c.top_zar for c in COMPETITORS]

    y = np.arange(len(names))
    h = 0.26
    colors = [PALETTE["us"] if n == "BeepBite" else PALETTE["them"] for n in names]

    fig, ax = plt.subplots(figsize=(11, 6))
    b1 = ax.barh(y - h, entry, h, label="Entry", color=colors, alpha=0.45)
    b2 = ax.barh(y,     mid,   h, label="Mid",   color=colors, alpha=0.72)
    b3 = ax.barh(y + h, top,   h, label="Top",   color=colors, alpha=1.0)

    for bars in (b1, b2, b3):
        for rect in bars:
            w = rect.get_width()
            ax.text(w + 40, rect.get_y() + rect.get_height()/2,
                    _fmt_zar(w), va="center", fontsize=8, color="#334155")

    ax.set_yticks(y)
    ax.set_yticklabels(names)
    ax.xaxis.set_major_formatter(plt.FuncFormatter(_fmt_zar))
    ax.set_xlabel("ZAR / month")
    ax.legend(loc="lower right", frameon=False)
    _style(ax, "Competitive pricing — BeepBite vs market (ZAR / month)")

    fig.tight_layout()
    fig.savefig(out / "01_competitors.png", dpi=140)
    plt.close(fig)


# ──────────────────────────────────────────────────────────────
# 2. BeepBite tier prices (simple bar)
# ──────────────────────────────────────────────────────────────
def chart_tier_prices(out: Path):
    tiers = [t for t in TIERS]
    names = [t.name for t in tiers]
    prices = [t.price_zar for t in tiers]
    colors = [PALETTE[n] for n in names]

    fig, ax = plt.subplots(figsize=(9, 5))
    bars = ax.bar(names, prices, color=colors, edgecolor="white", linewidth=1.5)
    for rect, p in zip(bars, prices):
        ax.text(rect.get_x() + rect.get_width()/2, rect.get_height() + 20,
                f"R{p:,.0f}", ha="center", fontweight="bold", fontsize=11)

    ax.yaxis.set_major_formatter(plt.FuncFormatter(_fmt_zar))
    ax.set_ylabel("ZAR / month")
    _style(ax, "BeepBite subscription tiers")
    fig.tight_layout()
    fig.savefig(out / "02_tiers.png", dpi=140)
    plt.close(fig)


# ──────────────────────────────────────────────────────────────
# 3. Revenue / Cost / Profit — side by side for both scales
# ──────────────────────────────────────────────────────────────
def chart_rev_cost_profit(small: SimResult, large: SimResult, out: Path):
    labels = ["Revenue", "Variable cost", "Marketing spend", "Profit"]
    small_vals = [small.revenue, small.variable_cost, small.fixed_overhead, small.profit]
    large_vals = [large.revenue, large.variable_cost, large.fixed_overhead, large.profit]

    x = np.arange(len(labels))
    w = 0.38

    fig, ax = plt.subplots(figsize=(10, 5.5))
    colors_small = [PALETTE["revenue"], PALETTE["cost"], "#f97316", PALETTE["profit"]]
    b1 = ax.bar(x - w/2, small_vals, w, label="Small (1,000 cust.)", color=colors_small, alpha=0.65, edgecolor="white")
    b2 = ax.bar(x + w/2, large_vals, w, label="Large (10,000 cust.)", color=colors_small, alpha=1.0, edgecolor="white")

    for bars in (b1, b2):
        for rect in bars:
            h = rect.get_height()
            ax.text(rect.get_x() + rect.get_width()/2, h + max(large_vals)*0.01,
                    _fmt_zar(h), ha="center", fontsize=8.5, color="#334155")

    ax.set_xticks(x)
    ax.set_xticklabels(labels)
    ax.yaxis.set_major_formatter(plt.FuncFormatter(_fmt_zar))
    ax.legend(frameon=False)
    _style(ax, "Monthly P&L — small vs large scale (ZAR)")

    fig.tight_layout()
    fig.savefig(out / "03_pnl.png", dpi=140)
    plt.close(fig)


# ──────────────────────────────────────────────────────────────
# 4. Customer distribution (free vs paid tiers) — dual donut
# ──────────────────────────────────────────────────────────────
def chart_customer_mix(small: SimResult, large: SimResult, out: Path):
    fig, axes = plt.subplots(1, 2, figsize=(11, 5))
    for ax, res, label in zip(axes, (small, large), ("Small scale (1,000)", "Large scale (10,000)")):
        sizes = [t.customers for t in res.per_tier]
        labels = [f"{t.tier}\n{t.customers:,}" for t in res.per_tier]
        colors = [PALETTE[t.tier] for t in res.per_tier]
        wedges, texts = ax.pie(
            sizes, labels=labels, colors=colors, startangle=90,
            wedgeprops=dict(width=0.40, edgecolor="white", linewidth=2),
            textprops=dict(fontsize=10),
        )
        ax.text(0, 0, f"{res.total_customers:,}\ncustomers",
                ha="center", va="center", fontsize=12, fontweight="bold")
        ax.set_title(label, fontsize=12, fontweight="bold")

    fig.suptitle("Customer mix — Free vs paid tiers", fontsize=14, fontweight="bold", y=1.0)
    fig.tight_layout()
    fig.savefig(out / "04_customer_mix.png", dpi=140)
    plt.close(fig)


# ──────────────────────────────────────────────────────────────
# 5. Per-tier revenue breakdown (stacked: sub vs wallet)
# ──────────────────────────────────────────────────────────────
def chart_tier_revenue(small: SimResult, large: SimResult, out: Path):
    fig, axes = plt.subplots(1, 2, figsize=(12, 5.5), sharey=False)

    for ax, res, label in zip(axes, (small, large), ("Small (1,000)", "Large (10,000)")):
        paid = [t for t in res.per_tier if t.tier != "Free"]
        names = [t.tier for t in paid]
        sub = [t.sub_revenue for t in paid]
        wal = [t.wallet_revenue for t in paid]
        colors = [PALETTE[n] for n in names]

        b1 = ax.bar(names, sub, color=colors, edgecolor="white", linewidth=1.5, label="Subscription")
        b2 = ax.bar(names, wal, bottom=sub, color=colors, edgecolor="white", linewidth=1.5, alpha=0.55, label="Wallet")

        for i, (s, w) in enumerate(zip(sub, wal)):
            ax.text(i, s/2, _fmt_zar(s), ha="center", va="center", fontsize=9, color="white", fontweight="bold")
            ax.text(i, s + w/2, _fmt_zar(w), ha="center", va="center", fontsize=9, color="#0f172a")
            ax.text(i, s + w + (s+w)*0.03, _fmt_zar(s+w), ha="center", fontsize=10, fontweight="bold")

        ax.yaxis.set_major_formatter(plt.FuncFormatter(_fmt_zar))
        ax.legend(frameon=False, loc="upper left")
        _style(ax, f"Revenue by tier — {label}")

    fig.tight_layout()
    fig.savefig(out / "05_tier_revenue.png", dpi=140)
    plt.close(fig)


# ──────────────────────────────────────────────────────────────
# 6. Per-tier profit contribution (waterfall-ish bar)
# ──────────────────────────────────────────────────────────────
def chart_tier_profit(small: SimResult, large: SimResult, out: Path):
    fig, axes = plt.subplots(1, 2, figsize=(12, 5.5))

    for ax, res, label in zip(axes, (small, large), ("Small (1,000)", "Large (10,000)")):
        names = [t.tier for t in res.per_tier]
        profits = [t.profit for t in res.per_tier]
        colors = [PALETTE[n] if p >= 0 else "#dc2626" for n, p in zip(names, profits)]

        bars = ax.bar(names, profits, color=colors, edgecolor="white", linewidth=1.5)
        for rect, p in zip(bars, profits):
            y = rect.get_height()
            va = "bottom" if p >= 0 else "top"
            off = abs(max(profits))*0.02 * (1 if p >= 0 else -1)
            ax.text(rect.get_x() + rect.get_width()/2, y + off, _fmt_zar(p),
                    ha="center", va=va, fontsize=10, fontweight="bold")

        ax.axhline(0, color="#64748b", linewidth=0.8)
        ax.yaxis.set_major_formatter(plt.FuncFormatter(_fmt_zar))
        _style(ax, f"Profit contribution by tier — {label}")

    fig.tight_layout()
    fig.savefig(out / "06_tier_profit.png", dpi=140)
    plt.close(fig)


# ──────────────────────────────────────────────────────────────
# 7. WhatsApp per-message cost (Meta vs BeepBite wallet)
# ──────────────────────────────────────────────────────────────
def chart_message_prices(out: Path):
    cats = ["service\n(overage)", "utility", "authentication", "marketing"]
    meta = [META_RATES["service"], META_RATES["utility"], META_RATES["authentication"], META_RATES["marketing"]]
    wlt  = [WALLET.price("service"), WALLET.price("utility"),
            WALLET.price("authentication"), WALLET.price("marketing")]

    x = np.arange(len(cats))
    w = 0.38
    fig, ax = plt.subplots(figsize=(10, 5))
    b1 = ax.bar(x - w/2, meta, w, label="Meta base", color="#64748b")
    b2 = ax.bar(x + w/2, wlt,  w, label="BeepBite wallet", color=PALETTE["Growth"])

    for bars in (b1, b2):
        for rect in bars:
            h = rect.get_height()
            ax.text(rect.get_x() + rect.get_width()/2, h + 0.02,
                    f"R{h:.3f}", ha="center", fontsize=9)

    ax.set_xticks(x)
    ax.set_xticklabels(cats)
    ax.set_ylabel("ZAR per message")
    ax.legend(frameon=False)
    _style(ax, "WhatsApp message price — Meta vs BeepBite wallet")
    fig.tight_layout()
    fig.savefig(out / "07_message_prices.png", dpi=140)
    plt.close(fig)


# ──────────────────────────────────────────────────────────────
# 8. Sensitivity: profit vs paid conversion rate
# ──────────────────────────────────────────────────────────────
def chart_conversion_sensitivity(base: Scenario, out: Path, title: str, fname: str):
    paid_shares = np.linspace(0.10, 0.60, 21)
    profits = []
    for share in paid_shares:
        sc = Scenario(
            name=base.name,
            total_customers=base.total_customers,
            free_fraction=1 - share,
            paid_mix=base.paid_mix,
            usage=base.usage,
            fixed_overhead_zar=base.fixed_overhead_zar,
            churn_monthly_pct=base.churn_monthly_pct,
            sub_payment_fee_pct=base.sub_payment_fee_pct,
        )
        profits.append(simulate(sc).profit)

    fig, ax = plt.subplots(figsize=(10, 5))
    ax.plot(paid_shares * 100, profits, color=PALETTE["profit"], linewidth=2.2, marker="o", markersize=4)
    ax.axhline(0, color="#dc2626", linestyle="--", linewidth=1, alpha=0.7, label="Break-even")

    # Mark base-case conversion
    base_share = 1 - base.free_fraction
    base_profit = simulate(base).profit
    ax.plot(base_share * 100, base_profit, marker="*", markersize=18,
            color=PALETTE["us"], label=f"Base case: {base_share*100:.0f}% paid")

    ax.yaxis.set_major_formatter(plt.FuncFormatter(_fmt_zar))
    ax.set_xlabel("Paid customer share (%)")
    ax.set_ylabel("Monthly profit (ZAR)")
    ax.legend(frameon=False)
    _style(ax, title)

    fig.tight_layout()
    fig.savefig(out / fname, dpi=140)
    plt.close(fig)


# ──────────────────────────────────────────────────────────────
# 9. Growth curve: profit across customer counts
# ──────────────────────────────────────────────────────────────
def chart_scale_curve(small: Scenario, large: Scenario, out: Path):
    counts = [50, 100, 250, 500, 1_000, 2_500, 5_000, 7_500, 10_000]
    profits_small = []
    profits_large = []

    for n in counts:
        s = Scenario(
            name="x", total_customers=n,
            free_fraction=small.free_fraction, paid_mix=small.paid_mix,
            usage=small.usage, fixed_overhead_zar=small.fixed_overhead_zar,
        )
        l = Scenario(
            name="x", total_customers=n,
            free_fraction=large.free_fraction, paid_mix=large.paid_mix,
            usage=large.usage, fixed_overhead_zar=large.fixed_overhead_zar,
        )
        profits_small.append(simulate(s).profit)
        profits_large.append(simulate(l).profit)

    fig, ax = plt.subplots(figsize=(11, 5.5))
    ax.plot(counts, profits_small, color=PALETTE["Starter"], linewidth=2.2, marker="o",
            label=f"Low marketing (R{small.fixed_overhead_zar/1000:.0f}k / mo)")
    ax.plot(counts, profits_large, color=PALETTE["Pro"],    linewidth=2.2, marker="s",
            label=f"High marketing (R{large.fixed_overhead_zar/1000:.0f}k / mo)")
    ax.axhline(0, color="#dc2626", linestyle="--", linewidth=1, alpha=0.7)

    ax.yaxis.set_major_formatter(plt.FuncFormatter(_fmt_zar))
    ax.set_xlabel("Total customers")
    ax.set_ylabel("Monthly profit (ZAR)")
    ax.set_xscale("log")
    ax.legend(frameon=False, loc="upper left")
    _style(ax, "Profit curve — break-even and scaling behaviour")

    fig.tight_layout()
    fig.savefig(out / "09_scale_curve.png", dpi=140)
    plt.close(fig)


# ──────────────────────────────────────────────────────────────
# Helper — sweep a scenario across customer counts and collect metrics.
# ──────────────────────────────────────────────────────────────
_COUNTS = [50, 100, 250, 500, 1_000, 2_000, 3_500, 5_000, 7_500, 10_000]


def _sweep(base: Scenario, counts=_COUNTS):
    revenue, total_cost, profit, margin, arpu, sub, wallet = [], [], [], [], [], [], []
    for n in counts:
        sc = Scenario(
            name="x", total_customers=n,
            free_fraction=base.free_fraction, paid_mix=base.paid_mix,
            usage=base.usage, fixed_overhead_zar=base.fixed_overhead_zar,
        )
        r = simulate(sc)
        revenue.append(r.revenue)
        total_cost.append(r.total_cost)
        profit.append(r.profit)
        margin.append(r.margin_pct)
        arpu.append(r.arpu_paid)
        sub.append(sum(t.sub_revenue for t in r.per_tier))
        wallet.append(sum(t.wallet_revenue for t in r.per_tier))
    return {
        "counts": counts, "revenue": revenue, "total_cost": total_cost,
        "profit": profit, "margin": margin, "arpu": arpu,
        "sub": sub, "wallet": wallet,
    }


def _twoline(out: Path, fname: str, title: str, ylabel: str,
             small_data, large_data, counts,
             *, zar_axis=True, zero_line=False):
    fig, ax = plt.subplots(figsize=(11, 5.8))
    ax.plot(counts, small_data, color=PALETTE["Starter"], linewidth=2.6,
            marker="o", markersize=6, label="Small scale (low marketing spend)")
    ax.plot(counts, large_data, color=PALETTE["Pro"], linewidth=2.6,
            marker="s", markersize=6, label="Large scale (high marketing spend)")
    if zero_line:
        ax.axhline(0, color="#dc2626", linestyle="--", linewidth=1, alpha=0.6, label="Break-even")
    ax.set_xscale("log")
    if zar_axis:
        ax.yaxis.set_major_formatter(plt.FuncFormatter(_fmt_zar))
    ax.set_xlabel("Total customers (log scale)")
    ax.set_ylabel(ylabel)
    ax.legend(frameon=False, loc="upper left")
    _style(ax, title)
    fig.tight_layout()
    fig.savefig(out / fname, dpi=140)
    plt.close(fig)


# 10. Revenue — small vs large line
def chart_revenue_lines(small: Scenario, large: Scenario, out: Path):
    s = _sweep(small); l = _sweep(large)
    _twoline(out, "10_revenue_lines.png",
             "Monthly revenue — small vs large scale",
             "Revenue (ZAR / mo)",
             s["revenue"], l["revenue"], s["counts"])


# 11. Total cost — small vs large line
def chart_cost_lines(small: Scenario, large: Scenario, out: Path):
    s = _sweep(small); l = _sweep(large)
    _twoline(out, "11_cost_lines.png",
             "Total monthly cost — small vs large scale",
             "Total cost (ZAR / mo)",
             s["total_cost"], l["total_cost"], s["counts"])


# 12. Profit — small vs large line (break-even annotated)
def chart_profit_lines(small: Scenario, large: Scenario, out: Path):
    s = _sweep(small); l = _sweep(large)
    _twoline(out, "12_profit_lines.png",
             "Monthly profit — small vs large scale",
             "Profit (ZAR / mo)",
             s["profit"], l["profit"], s["counts"],
             zero_line=True)


# 13. Margin % — small vs large line
def chart_margin_lines(small: Scenario, large: Scenario, out: Path):
    s = _sweep(small); l = _sweep(large)
    _twoline(out, "13_margin_lines.png",
             "Net margin (%) — small vs large scale",
             "Net margin (%)",
             s["margin"], l["margin"], s["counts"],
             zar_axis=False, zero_line=True)


# 14. ARPU — small vs large line
def chart_arpu_lines(small: Scenario, large: Scenario, out: Path):
    s = _sweep(small); l = _sweep(large)
    _twoline(out, "14_arpu_lines.png",
             "ARPU (paid customers) — small vs large scale",
             "ARPU (ZAR / paid customer / mo)",
             s["arpu"], l["arpu"], s["counts"])


# 15. Subscription vs wallet — 4 lines (sub/wallet × small/large)
def chart_sub_wallet_lines(small: Scenario, large: Scenario, out: Path):
    s = _sweep(small); l = _sweep(large)
    counts = s["counts"]

    fig, ax = plt.subplots(figsize=(11, 6))
    ax.plot(counts, s["sub"],    color=PALETTE["Starter"], linewidth=2.4,
            marker="o", label="Subscription — small scale")
    ax.plot(counts, l["sub"],    color=PALETTE["Starter"], linewidth=2.4,
            marker="s", linestyle="--", label="Subscription — large scale")
    ax.plot(counts, s["wallet"], color=PALETTE["Pro"], linewidth=2.4,
            marker="o", label="Wallet — small scale")
    ax.plot(counts, l["wallet"], color=PALETTE["Pro"], linewidth=2.4,
            marker="s", linestyle="--", label="Wallet — large scale")

    ax.set_xscale("log")
    ax.yaxis.set_major_formatter(plt.FuncFormatter(_fmt_zar))
    ax.set_xlabel("Total customers (log scale)")
    ax.set_ylabel("Monthly revenue (ZAR)")
    ax.legend(frameon=False, loc="upper left")
    _style(ax, "Subscription vs wallet revenue — small vs large scale")
    fig.tight_layout()
    fig.savefig(out / "15_sub_vs_wallet_lines.png", dpi=140)
    plt.close(fig)


# ──────────────────────────────────────────────────────────────
def generate_all(small: SimResult, large: SimResult, out: Path):
    out.mkdir(exist_ok=True)
    from .run import SMALL_SCALE, LARGE_SCALE

    chart_competitors(out)
    chart_tier_prices(out)
    chart_rev_cost_profit(small, large, out)
    chart_customer_mix(small, large, out)
    chart_tier_revenue(small, large, out)
    chart_tier_profit(small, large, out)
    chart_message_prices(out)
    chart_conversion_sensitivity(SMALL_SCALE, out,
        "Sensitivity: conversion rate vs monthly profit — small scale (1,000)",
        "08a_sensitivity_small.png")
    chart_conversion_sensitivity(LARGE_SCALE, out,
        "Sensitivity: conversion rate vs monthly profit — large scale (10,000)",
        "08b_sensitivity_large.png")
    chart_scale_curve(SMALL_SCALE, LARGE_SCALE, out)

    # Multi-line trend charts — one line for small scale, one for large.
    chart_revenue_lines(SMALL_SCALE, LARGE_SCALE, out)
    chart_cost_lines(SMALL_SCALE, LARGE_SCALE, out)
    chart_profit_lines(SMALL_SCALE, LARGE_SCALE, out)
    chart_margin_lines(SMALL_SCALE, LARGE_SCALE, out)
    chart_arpu_lines(SMALL_SCALE, LARGE_SCALE, out)
    chart_sub_wallet_lines(SMALL_SCALE, LARGE_SCALE, out)


if __name__ == "__main__":
    from .run import SMALL_SCALE, LARGE_SCALE
    out_dir = Path(__file__).parent / "results"
    generate_all(simulate(SMALL_SCALE), simulate(LARGE_SCALE), out_dir)
    print(f"wrote charts to {out_dir}/")
