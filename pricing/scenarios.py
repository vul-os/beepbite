"""Run every pricing model x every profile. Print plain-text tables.

Usage:
    python3 scenarios.py
"""

from typing import List

from costs import COSTS, WHATSAPP_UTILITY_BY_COUNTRY
from pricing import MODELS, TieredSubscription
from usage import PROFILES, Profile


# ── helpers ──────────────────────────────────────────────────────────────────

def our_cost(p: Profile) -> float:
    """What it costs us per month to serve this profile, using the profile's country
    for WhatsApp pricing (Meta charges per-country)."""
    wa_rate = WHATSAPP_UTILITY_BY_COUNTRY.get(p.country, COSTS.whatsapp_utility_usd)
    # LLM: 70% customer-chat messages, 30% owner-chat (heavier system prompt)
    llm_avg = 0.7 * COSTS.llm_customer_msg_usd + 0.3 * COSTS.llm_owner_msg_usd
    return (
        p.llm_msgs_per_month * llm_avg
        + p.whatsapp_msgs_per_month * wa_rate
        + p.bulk_imports_per_month * COSTS.llm_bulk_import_usd
        + p.storage_gb * COSTS.storage_per_gb_usd
        + p.locations * COSTS.hosting_per_tenant_usd
    )


def fmt_usd(x: float) -> str:
    if x == 0:
        return "$0"
    if x < 10:
        return f"${x:.2f}"
    if x < 100:
        return f"${x:.1f}"
    return f"${x:,.0f}"


def fmt_pct(x: float) -> str:
    return f"{x*100:.0f}%"


def render_table(rows: List[List[str]], title: str) -> str:
    if not rows:
        return ""
    widths = [max(len(str(r[i])) for r in rows) for i in range(len(rows[0]))]
    sep = "+-" + "-+-".join("-" * w for w in widths) + "-+"
    lines = [f"\n{title}", sep]
    for i, row in enumerate(rows):
        line = "| " + " | ".join(str(c).ljust(widths[j]) for j, c in enumerate(row)) + " |"
        lines.append(line)
        if i == 0:
            lines.append(sep)
    lines.append(sep)
    return "\n".join(lines)


# ── tables ───────────────────────────────────────────────────────────────────

def table_customer_cost():
    header = ["Profile", "Orders/mo", "GMV/mo"] + list(MODELS.keys())
    rows = [header]
    for p in PROFILES:
        row = [p.name, f"{p.orders_per_month:,}", fmt_usd(p.gmv_usd)]
        for model in MODELS.values():
            row.append(fmt_usd(model.monthly_charge(p)))
        rows.append(row)
    return render_table(rows, "TABLE 1 — Customer monthly cost (USD) per model")


def table_margin_dollars():
    """How many dollars we keep after our metered costs."""
    header = ["Profile", "Our cost/mo"] + list(MODELS.keys())
    rows = [header]
    for p in PROFILES:
        cost = our_cost(p)
        row = [p.name, fmt_usd(cost)]
        for model in MODELS.values():
            margin = model.monthly_charge(p) - cost
            row.append(fmt_usd(margin))
        rows.append(row)
    return render_table(rows, "TABLE 2 — Our gross margin USD (charge − our cost)")


def table_margin_pct():
    """Margin as % of charge — guards against negative-margin tiers."""
    header = ["Profile"] + list(MODELS.keys())
    rows = [header]
    for p in PROFILES:
        cost = our_cost(p)
        row = [p.name]
        for model in MODELS.values():
            charge = model.monthly_charge(p)
            if charge == 0:
                row.append("n/a")
            else:
                margin_pct = (charge - cost) / charge
                row.append(fmt_pct(margin_pct))
        rows.append(row)
    return render_table(rows, "TABLE 3 — Our margin as % of charge (negative = we lose money)")


def table_pct_of_gmv():
    """What share of GMV the merchant pays — the most readable comparison for them."""
    header = ["Profile"] + list(MODELS.keys())
    rows = [header]
    for p in PROFILES:
        row = [p.name]
        for model in MODELS.values():
            charge = model.monthly_charge(p)
            if p.gmv_usd == 0:
                row.append("n/a")
            else:
                row.append(fmt_pct(charge / p.gmv_usd))
        rows.append(row)
    return render_table(rows, "TABLE 4 — Cost as % of merchant's GMV")


def table_tier_pick():
    """For the tiered model, which tier each profile lands on."""
    tiered = MODELS["Tiered (Free→Scale)"]
    assert isinstance(tiered, TieredSubscription)
    rows = [["Profile", "Tier", "Monthly cost"]]
    for p in PROFILES:
        t = tiered.pick_tier(p)
        rows.append([p.name, t.name, fmt_usd(tiered.monthly_charge(p))])
    return render_table(rows, "TABLE 5 — Tier-model: which tier each profile ends up in")


# ── recommendation surface ───────────────────────────────────────────────────

def evaluate_models() -> List[str]:
    """One-line pros/cons per model, evaluated against our four goals."""
    lines = ["", "EVALUATION — against the four goals:", "  G1. Real free tier  G2. No-sticker-shock growth  G3. Always positive margin  G4. One-sentence pitch"]
    out = []
    for name, model in MODELS.items():
        # G1: does any profile pay $0?
        free_tier = any(model.monthly_charge(p) == 0 for p in PROFILES)
        # G3: does any profile produce a negative margin?
        margins = [model.monthly_charge(p) - our_cost(p) for p in PROFILES]
        always_positive = all(m >= 0 for m in margins)
        out.append((name, free_tier, always_positive, model.tagline))

    lines.append("")
    header = ["Model", "Free tier?", "+ margin all profiles?", "Pitch"]
    widths = [max(len(name) for name, _, _, _ in out + [("Model",)*4]), 11, 22, 60]
    sep = "+-" + "-+-".join("-" * w for w in widths) + "-+"
    lines.append(sep)
    lines.append("| " + " | ".join(h.ljust(widths[i]) for i, h in enumerate(header)) + " |")
    lines.append(sep)
    for name, free, pos, pitch in out:
        cells = [
            name,
            "yes" if free else "no",
            "yes" if pos else "NO",
            pitch[:widths[3]],
        ]
        lines.append("| " + " | ".join(cells[i].ljust(widths[i]) for i in range(4)) + " |")
    lines.append(sep)
    return lines


# ── entrypoint ───────────────────────────────────────────────────────────────

def main():
    print("=" * 110)
    print("BeepBite — pricing model exploration")
    print("=" * 110)
    print(table_customer_cost())
    print(table_pct_of_gmv())
    print(table_margin_dollars())
    print(table_margin_pct())
    print(table_tier_pick())
    print("\n".join(evaluate_models()))
    print()


if __name__ == "__main__":
    main()
