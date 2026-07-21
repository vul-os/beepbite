# Security Policy

BeepBite is a self-hosted restaurant point-of-sale: front of house, kitchen,
delivery and ordering, running on the operator's own hardware with no cloud
account. It handles orders, payments and staff access. Security reports are
taken seriously and handled with priority.

## Reporting a vulnerability

**Please do not open a public issue for security problems.**

- Preferred: [GitHub private vulnerability reporting](https://github.com/vul-os/beepbite/security/advisories/new) on `vul-os/beepbite`.
- Alternatively, email **vulosorg@gmail.com** with `[beepbite security]` in the subject.

Include what you can: affected area (staff auth/roles, an ordering or payment
path, a terminal/session), reproduction steps, and impact as you understand it.
You'll get an acknowledgement within **72 hours** and a status update at least
every **14 days** until resolution. Please give a reasonable window to ship a
fix before public disclosure — we'll credit you in the release notes unless
you'd rather stay anonymous.

## Scope

Especially interested in:

- **Staff authentication & roles** — any path that lets a terminal or user act
  outside its role (e.g. voids, discounts, cash-drawer or refund actions
  without the required authority), or that bypasses login/PIN.
- **Payment handling** — order totals or payment records altered without an
  audit trace, or any mishandling of card/terminal integration data.
- **Order & till integrity** — creating, voiding or re-pricing orders in a way
  the audit trail does not reflect.
- **Multi-terminal / multi-tenant isolation** — one venue's data reachable from
  another, or one terminal affecting another it should not.

Out of scope: vulnerabilities requiring an already-compromised host or an
operator with direct database access (inherent to self-hosting), and issues in
third-party services the operator configures (their payment processor, their
delivery integration).

## Supported versions

Only the latest release (and `main`) receives fixes.
