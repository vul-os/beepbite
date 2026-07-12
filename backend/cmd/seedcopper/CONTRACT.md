# seedcopper section contract

You are implementing ONE file of a Go seeder that populates a realistic full-service
restaurant tenant — **"The Copper Table"**, a contemporary South African bistro in
Sea Point, Cape Town — on the local `beepbite` Postgres DB.

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
8. **Realistic data:** ZA names (Nomsa, Thabo, Priya, Marco, Lunga, Aisha…),
   ZAR prices, +27 phone numbers, Cape Town addresses, real-sounding bistro menu items,
   plausible dates relative to `c.Now`. This should look like a real restaurant's data.
9. **Determinism:** if you use randomness, seed it: `rand.New(rand.NewSource(<fixed>))`.
   Do not call `time.Now()` for the "reference now" — use `c.Now` (UTC). Time math with
   the `time` package is fine.
10. **Before finishing:** run `gofmt -w <yourfile>.go` then
    `cd /home/exo/Documents/beepbite-mono/backend && go build ./cmd/seedcopper`.
    It must build. NOTE: other section files may be edited concurrently by other agents;
    if `go build` reports errors ONLY in files other than yours, that is a transient
    race — your file is fine as long as no error references it. **Do NOT run the seeder,
    the server, tests, or touch the database.** Build only.

## Section ordering (already wired in main.go)

menu → floor → foh → staff → orders(+cash) → commerce → inventory

So when your section runs, everything above it has already populated its `Ctx` fields.

## Your function signature (already stubbed in your file)

`func seedX(s *seeder, c *Ctx) error`

Return a wrapped error on failure. Use `log.Printf("  <section>: ...")` for a one-line
summary of what you created (counts) — matches the style in main.go.
