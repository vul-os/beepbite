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

## Verifying a release download

Every release attaches a `SHA256SUMS` manifest covering every published asset,
and a [sigstore build-provenance attestation](https://docs.github.com/actions/security-guides/using-artifact-attestations)
signed with a short-lived certificate minted from the release workflow's OIDC
token. There is no long-lived signing key: nothing to leak, nothing to rotate,
nothing whose absence quietly downgrades a check.

Verify before you run the binary:

```sh
curl -fsSLO https://raw.githubusercontent.com/vul-os/beepbite/vX.Y.Z/scripts/verify.sh
bash verify.sh --tag vX.Y.Z --attest beepbite_vX.Y.Z_linux_amd64.tar.gz
```

`scripts/verify.sh` fetches `SHA256SUMS`, looks up the **exact** entry for the
asset you named and compares digests. It has two outcomes: verified, or a
non-zero exit with a diagnostic naming what was wrong. There is deliberately no
`--skip-verify`, and **no path where a missing `SHA256SUMS` means "nothing to
check"** — a verifier that shrugs at a 404 prints a line that looks like
verification while checking nothing, which is worse than no verifier at all.

| Exit | Meaning |
|---|---|
| 0 | verified |
| 2 | usage error |
| 3 | `SHA256SUMS` unfetchable or absent |
| 4 | an HTML page was served where the manifest was expected |
| 5 | manifest empty or with no well-formed digest line |
| 6 | manifest has no entry for that asset |
| 7 | asset unfetchable, or HTML served where bytes were expected |
| 8 | truncated download |
| 9 | digest mismatch |
| 10 | `curl` or a digest tool missing |
| 11 | `--attest` requested and provenance did not verify |
| 12 | plaintext non-loopback origin refused |

Without `--attest` the digests are checked but provenance is **not**, and the
script says so rather than letting a pass imply more than it checked.

Run `bash scripts/verify.sh --selftest` to prove the refusals still fire: 24
synthetic-origin cases asserting both the exit code and that a diagnostic was
printed. CI runs it on every push.

Binaries are **not** signed for macOS Gatekeeper or Windows SmartScreen; the
attestation answers "did these bytes come from this repo's release workflow",
which is a different question from "does this OS trust the publisher".

## Supported versions

Only the latest release (and `main`) receives fixes.
