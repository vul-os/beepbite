# seedcopper section contract

You are implementing ONE file of a Go seeder that populates a realistic full-service
restaurant tenant — **"The Copper Table"**, a contemporary bistro in the fictional
Harbour Quarter of **Example City** — on the local `beepbite` Postgres DB.

**The restaurant has no country.** Every country-dependent value comes from
configuration, never from a literal in your file. See "Locale is configuration" below;
it is the rule most likely to make a review reject your section.

## Ground rules (ALL agents)

1. **Package `main`.** Edit ONLY your assigned file. Do not touch other files.
2. **Read first:** `shared.go` (the `seeder`, `Ctx`, `CustomerRef`, `StaffRef`,
   `TableRef` types + `slugify`), `main.go` (bootstrap — what's already in `Ctx`),
   and `../../../scratchpad/schema.txt` **NO** — the schema file is at
   `/tmp/claude-1000/-home-exo-Documents-beepbite-mono/db58e1c3-a12a-44bb-b260-fada495e5926/scratchpad/schema.txt`.
   It lists exact columns + CHECK/UNIQUE constraints for every table. **Match it exactly** —
   wrong column names/enum values will fail at runtime.
3. **All writes go through** `s.tx(func(tx pgx.Tx) error { ... })`, which opens a
   service-role scoped transaction (bypasses FORCE RLS). Use `s.ctx` as the query
   context. You may open multiple `s.tx` calls (batch large loops into a few tx).
4. **Idempotency:** at the top of your function, check whether your section is already
   seeded (e.g. `SELECT count(*)` for your main table scoped to `c.LocID`/`c.OrgID`)
   and return early if so. Re-running the seeder must not duplicate rows.
5. **Read from `Ctx`** the IDs you need; **populate** the `Ctx` fields your section owns
   (see your task). `c.OrgID`, `c.LocID`, `c.LocSlug`, `c.RegionZA`, `c.OwnerProfileID`,
   `c.YourProfileID`, `c.Now` are already set by bootstrap.
6. **Money:** columns ending `_cents` are `bigint` cents. `items.price`,
   `locations.delivery_fee`, `staff_pay_rates` numerics vary — check the schema. When in
   doubt, read the column type in schema.txt.
7. **Enums:** `orders.status` (pending,confirmed,preparing,ready,out_for_delivery,
   delivered,completed,cancelled,pending_on_delivery), `orders.fulfillment_type`
   (collection,delivery,dine_in), `order_payments.payment_status` (pending,completed,
   failed,refunded,partially_refunded). Pass the label as a Go string; pgx handles it.
8. **Realistic data:** a broad, international mix of person names, plausible bistro menu
   items, and dates relative to `c.Now`. This should look like a real restaurant's
   data — but not like a real restaurant in a real place. Invented, country-neutral
   place names ("Harbour Quarter", "Riverside", "Example City"), addresses on
   Example/Sample/Placeholder streets, and coordinates in small offsets around
   Null Island (0, 0). No real business, street, suburb, or landmark.
9. **Determinism:** if you use randomness, seed it: `rand.New(rand.NewSource(<fixed>))`.
   Do not call `time.Now()` for the "reference now" — use `c.Now` (UTC). Time math with
   the `time` package is fine.
10. **Before finishing:** run `gofmt -w <yourfile>.go` then
    `cd /home/exo/Documents/beepbite-mono/backend && go build ./cmd/seedcopper`.
    It must build. NOTE: other section files may be edited concurrently by other agents;
    if `go build` reports errors ONLY in files other than yours, that is a transient
    race — your file is fine as long as no error references it. **Do NOT run the seeder,
    the server, tests, or touch the database.** Build only.

## Locale is configuration (READ THIS)

`s.cfg` is a `seedlocale.Config` resolved once in `main.go` and available to every
section through the `seeder`. It is the ONLY source for anything country-dependent.

**Never write any of these into your file:**

| Bug | Instead |
|---|---|
| `'ZAR'` (or any currency code) | `s.cfg.Currency` |
| `'+27...'` phone literals | `s.cfg.Phone(seq)` — seq from the allocation block in `shared.go` |
| `@gmail.com`, `@something.co.za` | `s.cfg.Email("local.part")` → reserved `example.com` |
| `'ZA'` country literal | `s.cfg.Country` |
| `15.00` tax rate, `tax_inclusive` true | `s.cfg.TaxRatePercent()`, `s.cfg.TaxInclusive()` |
| `total * 15 / 115`, `subtotal * 0.15` | `s.cfg.TaxOn(amount)` / `tax.Add(net, s.cfg.Tax.Rate)` |
| a bare price literal like `3500` | `s.cfg.Price(3500)` |
| `/ 100` or `* 100` | `money.Scale(s.cfg.Decimals)`, or `money.Decimal` / `money.Parse` |
| a currency symbol inside a string (`"over R350"`) | `s.cfg.Format(s.cfg.Price(35000))` |

### Money rules (strict)

- Money is **`int64` minor units**. Never `float64` — not in a struct field, not in an
  intermediate. `int64(float64(x) * 0.15)` is a bug even when the answer looks right.
- **Price literals are authored in a 2-decimal reference scale** and passed through
  `s.cfg.Price()`, which rescales to the configured currency's exponent. Write `14500`
  for "one hundred and forty-five"; it becomes ¥145 under JPY and KD 14.500 under KWD.
- **The exponent is never 100.** Use `money.Scale(s.cfg.Decimals)` if you genuinely need
  the scale, `money.DivRound(n, d)` to apportion, and `money.Rescale` to convert.
- **`_cents` columns take minor units directly.** Columns typed `numeric` hold MAJOR
  units — render them with `money.Decimal(minor, s.cfg.Decimals)`, and read them back
  with `money.Parse(text, s.cfg.Decimals)` (select the column as `::text`; do not scan
  a numeric into a float64).

### Tax: inclusive vs exclusive is a real difference

`s.cfg.TaxOn(amount)` applies the **configured** convention and returns `{Net, Tax,
Gross}`. Under an inclusive locale `amount` is the gross and the tax is extracted;
under an exclusive one it is the net and the tax is added — so **always read the total
back from `.Gross`**, never assume the amount you passed in is the total.

Two conventions coexist in this seeder on purpose:

- **Retail orders** (`orders.go`, `liveorders.go`) → `s.cfg.TaxOn(...)`. Whether a menu
  price already contains tax is exactly what the locale configures.
- **Trade documents** — supplier invoices, purchase orders, house-account statements,
  tenant invoices (`inventory.go`, `commerce.go`) → `tax.Add(net, s.cfg.Tax.Rate)`.
  A business-to-business invoice quotes a net figure and shows tax as its own line
  regardless of the retail shelf-price convention. The **rate** is configuration; the
  **convention** is a property of the document type. Comment it where you rely on it.

`auto_gratuity_percent` is a **service charge, not tax** — keep it out of the tax config.

### Currency columns are now required

Migration 056 dropped the `DEFAULT 'ZAR'` from `organizations`, `locations`, `orders`,
`staff_pay_rates`, `suppliers`, `purchase_orders`, `supplier_invoices`, `gift_cards`,
`store_credits` and `house_accounts`. If you INSERT into any of those, you **must** pass
the currency column explicitly (`s.cfg.Currency`) — omitting it now fails loudly instead
of silently denominating the row in rand.

`main.go` runs `cfg.EnsureCurrencySQL()` before any section, so the FK always resolves.

### Env knobs

| Variable | Default | Meaning |
|---|---|---|
| `SEED_COUNTRY` | `ZZ` | ISO 3166-1 alpha-2; `ZZ` is the user-assigned "unknown" code |
| `SEED_CURRENCY` | `XTS` | ISO 4217 code; `XTS` is reserved for testing — never real money |
| `SEED_CURRENCY_DECIMALS` | per-currency | minor-unit exponent override |
| `SEED_TIMEZONE` | `UTC` | IANA name; defines the trading day |
| `SEED_LOCALE` | *(empty)* | BCP-47 tag; empty = CLDR root, which belongs to no country |
| `SEED_TAX_RATE` | `10.00` | percentage, as the `decimal(5,2)` columns store it |
| `SEED_TAX_INCLUSIVE` | `true` | whether prices already contain the tax |
| `SEED_TAX_LABEL` | `Tax` | receipt wording — "VAT", "GST", "Sales Tax" |
| `SEED_PHONE_CC` | `999` | E.164 dial code without `+`; `999` is ITU-reserved and unroutable |

The defaults are deliberately reserved placeholders, not a country. `XTS` and `+999`
are the load-bearing ones: an XTS amount can never be mistaken for real takings, and a
`+999` number can never be dialled — so demo data loaded into a staging environment
wired to live WhatsApp credentials cannot message a real stranger. Seed a real country
only when you mean to:

```sh
SEED_COUNTRY=PT SEED_CURRENCY=EUR SEED_TIMEZONE=Europe/Lisbon SEED_LOCALE=pt-PT \
SEED_TAX_RATE=23 SEED_TAX_LABEL=IVA SEED_PHONE_CC=351 \
  go run ./cmd/seedcopper --env=local --clean
```

## Section ordering (already wired in main.go)

menu → floor → foh → staff → orders(+cash) → commerce → inventory

So when your section runs, everything above it has already populated its `Ctx` fields.

## Your function signature (already stubbed in your file)

`func seedX(s *seeder, c *Ctx) error`

Return a wrapped error on failure. Use `log.Printf("  <section>: ...")` for a one-line
summary of what you created (counts) — matches the style in main.go.
