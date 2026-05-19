"""Customer profiles. All monthly figures, all USD-equivalent."""

from dataclasses import dataclass


@dataclass(frozen=True)
class Profile:
    name: str
    locations: int
    orders_per_month: int
    avg_ticket_usd: float
    whatsapp_msgs_per_month: int   # outbound from BeepBite (customer + owner combined)
    llm_msgs_per_month: int        # customer chat + owner chat combined
    storage_gb: float              # menu images, receipts, PDFs
    bulk_imports_per_month: int    # PDF/image/CSV menu imports
    country: str = "ZA"            # primary country for WhatsApp cost lookup
    emails_per_order: float = 3.0  # receipt + order confirmation + review prompt avg

    @property
    def emails_per_month(self) -> int:
        return int(self.orders_per_month * self.emails_per_order)

    @property
    def gmv_usd(self) -> float:
        """Gross merchandise value processed through BeepBite per month."""
        return self.orders_per_month * self.avg_ticket_usd


PROFILES = [
    # Township braai / market stall in Soweto. Orders trickle through WhatsApp.
    Profile(
        name="Side Hustle (ZA)",
        locations=1,
        orders_per_month=50,
        avg_ticket_usd=8.0,           # R150 avg in ZAR ≈ $8
        whatsapp_msgs_per_month=200,  # 4 msgs per order (confirm, ready, on-way, delivered)
        llm_msgs_per_month=30,
        storage_gb=0.1,
        bulk_imports_per_month=1,
        country="ZA",
    ),
    # Independent bistro in Cape Town suburb. Real menu, takeaway + dine-in.
    Profile(
        name="Small Bistro (ZA)",
        locations=1,
        orders_per_month=600,
        avg_ticket_usd=12.0,           # R220 avg
        whatsapp_msgs_per_month=2_400,
        llm_msgs_per_month=400,        # includes some owner chat for menu mgmt
        storage_gb=0.5,
        bulk_imports_per_month=3,
        country="ZA",
    ),
    # Busy Lagos eatery. Heavy WhatsApp; many delivery updates.
    Profile(
        name="Busy Restaurant (NG)",
        locations=1,
        orders_per_month=4_000,
        avg_ticket_usd=15.0,
        whatsapp_msgs_per_month=16_000,  # 4 per order
        llm_msgs_per_month=1_800,
        storage_gb=2.0,
        bulk_imports_per_month=5,
        country="NG",
    ),
    # 3-location chain across Joburg.
    Profile(
        name="Multi-Location (3, ZA)",
        locations=3,
        orders_per_month=15_000,
        avg_ticket_usd=14.0,
        whatsapp_msgs_per_month=60_000,
        llm_msgs_per_month=6_000,
        storage_gb=8.0,
        bulk_imports_per_month=15,
        country="ZA",
    ),
    # 15-location quick-service chain spanning Kenya + Tanzania.
    Profile(
        name="Chain (15, KE)",
        locations=15,
        orders_per_month=75_000,
        avg_ticket_usd=11.0,
        whatsapp_msgs_per_month=300_000,
        llm_msgs_per_month=30_000,
        storage_gb=30.0,
        bulk_imports_per_month=50,
        country="KE",
    ),
    # US ghost-kitchen on Square-replacement evaluation.
    Profile(
        name="US Ghost Kitchen",
        locations=1,
        orders_per_month=3_000,
        avg_ticket_usd=28.0,
        whatsapp_msgs_per_month=12_000,
        llm_msgs_per_month=1_500,
        storage_gb=1.5,
        bulk_imports_per_month=4,
        country="US",
    ),
    # India dark store, very price-sensitive.
    Profile(
        name="India Dark Store",
        locations=2,
        orders_per_month=10_000,
        avg_ticket_usd=4.5,
        whatsapp_msgs_per_month=40_000,
        llm_msgs_per_month=3_000,
        storage_gb=2.0,
        bulk_imports_per_month=6,
        country="IN",
    ),
]
