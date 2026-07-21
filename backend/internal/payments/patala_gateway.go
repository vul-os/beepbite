//go:build patala

// This file is the ONLY place in BeepBite that imports patala-go
// (github.com/vul-os/patala/patala-go/bindings/patala), the cgo Go binding
// over patala's Rust core — see the sibling patala repo's PATALA.md and
// patala-go/README.md. It exists so a shop that DOES want a real online
// gateway (Stripe, Paystack, Adyen, BTCPay, lnbits, and the rest of
// patala-fiat's ~20 adapters) can take one behind BeepBite's own
// PaymentProvider seam, without BeepBite hand-rolling twenty processor
// integrations itself.
//
// # Building this in
//
// The default BeepBite build (`go build ./...`, plain `go test`) never
// compiles this file — no `//go:build patala` file is reachable without
// passing `-tags patala` explicitly, so the POS/manual-tender path (see
// manual.go) and every other pure-Go, CGO_ENABLED=0 build stay completely
// unaffected. Building WITH this file requires all of:
//
//  1. The sibling patala repo checked out next to this one's parent
//     (`../../patala` relative to this module root, i.e. a sibling of the
//     beepbite repo itself — see Makefile's PATALA_DIR) with its Go
//     bindings generated against a cdylib built with every fiat processor
//     compiled in:
//
//     cd ../../patala/patala-go && make FEATURES=fiat-all generate
//
//  2. `CGO_ENABLED=1` and a C toolchain (cc/clang/gcc) — cgo is mandatory
//     for anything that imports patala-go.
//
//  3. `go build -tags patala ./cmd/... ./internal/...` (or `go test`), with
//     `CGO_LDFLAGS`/`DYLD_LIBRARY_PATH`/`LD_LIBRARY_PATH` pointed at the
//     generated `../../patala/patala-go/bindings/patala/` directory — see
//     this repo's Makefile `build-patala`/`test-patala` targets for the
//     whole recipe as one command.
//
// # manual stays native — and untouched
//
// ManualTender (manual.go) is never routed through this file, deliberately:
// it needs no network, no config and no cgo at all, and patala's generic FFI
// surface has no equivalent of "the operator says the counter drawer/card
// machine already settled this" — see PatalaRailInterface's three methods
// below. manual.go is not modified by this adapter's existence, and
// ValidTender's closed vocabulary (cash/card_in_person/eft/...) deliberately
// does NOT include "stripe"/"paystack"/"online" etc (see manual_test.go) —
// this file's provider intentionally lives OUTSIDE that vocabulary; see
// (*PatalaGatewayProvider).Code and Charge below.
//
// # NOT wired into checkout — this wave is adapter-only
//
// This file, its build machinery (Makefile) and its test are the entire
// scope of this change. Nothing here is registered with any handler,
// marketplace/checkout flow, or POS charge path — see
// internal/handlers/pos/charge.go and internal/handlers/marketplace, both
// untouched. Wiring a PatalaGatewayProvider into an actual checkout flow
// (config discovery, hosted-redirect UX, a poll loop that calls GetStatus)
// is deliberately deferred to a later change.
//
// # What this adapter can and cannot do
//
// patala_core::PaymentRail (the trait patala-fiat's ~20 adapters implement,
// and the only thing PatalaRailNewFiat hands back) exposes exactly
// Capabilities/Charge/Id/Quote/Verify through this Go binding
// (PatalaRailInterface) — no refund, no webhook. So:
//
//   - Refund unconditionally fails closed with ErrPatalaRefundUnsupported —
//     never fabricate a successful reversal BeepBite cannot actually drive
//     through this FFI surface. A shop needing a refund on a patala-backed
//     gateway charge must do it directly at the processor's own dashboard.
//   - There is no webhook entry point at all (BeepBite's PaymentProvider
//     interface has none either, by design — see provider.go's own doc
//     comment on outbound-only polling behind CGNAT). GetStatus is the only
//     way this adapter is ever told a charge settled; Charge always returns
//     StatusPending because an online gateway charge is a redirect/hosted
//     flow the buyer has not necessarily completed by the time Charge
//     returns.
//   - Verify (patala's word for GetStatus's job here) returns only a bool,
//     never the amount/currency it actually observed at the provider. See
//     (*PatalaGatewayProvider).GetStatus's own doc comment for how the
//     self-contained charge-token this adapter mints still gets a real
//     amount/currency comparison out of that bool, matching manual.go's own
//     "never trust a bare status flag alone" posture.
//
// # No RecordStore — the charge id IS the record
//
// Cackle's equivalent adapter (internal/payments/patala.go in the sibling
// cackle repo) persists charge state via an injected RecordStore, because
// cackle's own Verify(ctx, reference) takes only a reference string too and
// needed somewhere durable to reconstruct patala's receipt from. BeepBite's
// GetStatus(ctx, chargeID) has the exact same shape — and BeepBite's
// migrations are explicitly off-limits for this change (no new table). So
// this adapter self-encodes everything Verify needs (rail id, amount,
// currency, reference, patala's opaque proof bytes) into Receipt.ID itself,
// base64-encoded JSON — see chargeToken/parseChargeToken. GetStatus decodes
// that token back into exactly the patala.Receipt this rail issued at
// Charge time; nothing is trusted from outside it (a corrupt/foreign
// chargeID fails closed, see GetStatus). A caller that wants durability
// across process restarts is responsible for persisting the returned
// Receipt.ID itself (e.g. in its own order/payment row) — this file adds no
// migration and touches no table.
package payments

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"strings"
	"time"

	patala "github.com/vul-os/patala/patala-go/bindings/patala"
)

// ErrPatalaRefundUnsupported is returned unconditionally by
// (*PatalaGatewayProvider).Refund — see this file's module doc comment
// ("What this adapter can and cannot do").
var ErrPatalaRefundUnsupported = errors.New("payments: patala gateway rails expose no refund operation through this Go binding -- reverse it directly at the processor, then record that out of band")

// ErrPatalaChargeIDInvalid is returned by GetStatus when chargeID was not
// produced by this adapter's own Charge (corrupt, truncated, or from a
// different provider/build entirely). Fails closed: an unreadable token is
// never treated as "pending" or "settled", only as an error.
var ErrPatalaChargeIDInvalid = errors.New("payments: patala gateway charge id is not a valid token from this adapter")

// patalaKeyOverrides documents the small number of cases where BeepBite's
// BEEPBITE_<PROVIDER>_<SUFFIX> environment variable name does not literally
// lower-case into patala-fiat's own config map key for that provider (see
// patala-py/src/fiat.rs's build_<provider> functions, the authoritative key
// list this must match). This mirrors cackle's own patalaKeyOverrides
// (internal/payments/patala.go in the sibling cackle repo) verbatim — the
// mapping is a property of patala-fiat's config keys, not of either
// consuming app.
var patalaKeyOverrides = map[string]map[string]string{
	"adyen":  {"HMAC_KEY": "hmac_key_hex"},
	"lnbits": {"QUOTE_TTL_SECONDS": "quote_ttl_secs"},
}

// PatalaConfigFromEnv builds patala-fiat's map[string]string config for
// provider from this deployment's BEEPBITE_<PROVIDER>_* environment
// variables. An empty return value means "no BEEPBITE_<PROVIDER>_*
// variable is set at all" — a future registration call site (not part of
// this change) can treat that as "not configured", the same convention
// cackle's own cmd/cackle/patala_register.go uses.
//
// Fields patala-fiat also accepts but this has no env var for
// (requires_kyc, currencies, settlement_days/settlement_seconds,
// timeout_secs) are simply left unset here — every build_<provider>
// function in patala-py/src/fiat.rs applies the same sane default
// patala-fiat's own from_env() would, so omitting them is correct, not a
// gap.
func PatalaConfigFromEnv(provider string) map[string]string {
	prefix := "BEEPBITE_" + strings.ToUpper(strings.TrimSpace(provider)) + "_"
	overrides := patalaKeyOverrides[strings.ToLower(strings.TrimSpace(provider))]
	cfg := make(map[string]string)
	for _, kv := range os.Environ() {
		name, value, ok := strings.Cut(kv, "=")
		if !ok || !strings.HasPrefix(name, prefix) {
			continue
		}
		if strings.TrimSpace(value) == "" {
			continue
		}
		suffix := strings.TrimPrefix(name, prefix)
		key := strings.ToLower(suffix)
		if overrides != nil {
			if mapped, ok := overrides[suffix]; ok {
				key = mapped
			}
		}
		cfg[key] = value
	}
	return cfg
}

// PatalaFiatProviderNames returns every processor name reachable via
// patala.PatalaRailNewFiat IN THIS SPECIFIC BUILD of the patala cdylib
// (i.e. whatever `FEATURES=...` it was generated with — see this file's
// build comment). Includes "manual" (patala-fiat's own offline round-trip
// rail, unrelated to BeepBite's ManualTender in manual.go).
func PatalaFiatProviderNames() []string {
	return patala.PatalaFiatProviders()
}

// patalaChargeToken is everything (*PatalaGatewayProvider).GetStatus needs
// to reconstruct the patala_core::Receipt this rail issued at Charge time,
// so it round-trips through Receipt.ID with no external store — see this
// file's module doc comment ("No RecordStore — the charge id IS the
// record"). ProofB64 stays opaque (base64 of patala's own opaque proof
// bytes); this adapter never interprets it, exactly like patala_core
// itself never does.
type patalaChargeToken struct {
	RailID        string `json:"rail_id"`
	AmountCents   int64  `json:"amount_cents"`
	CurrencyCode  string `json:"currency_code"`
	Reference     string `json:"reference"`
	ProofB64      string `json:"proof_b64"`
	CreatedAtUnix int64  `json:"created_at_unix"`
}

func encodeChargeToken(t patalaChargeToken) string {
	raw, err := json.Marshal(t)
	if err != nil {
		// json.Marshal on this struct (plain strings/ints) cannot fail.
		panic(fmt.Sprintf("payments: patala gateway: marshal charge token: %v", err))
	}
	return base64.RawURLEncoding.EncodeToString(raw)
}

func decodeChargeToken(chargeID string) (patalaChargeToken, error) {
	var tok patalaChargeToken
	raw, err := base64.RawURLEncoding.DecodeString(strings.TrimSpace(chargeID))
	if err != nil {
		return tok, ErrPatalaChargeIDInvalid
	}
	if err := json.Unmarshal(raw, &tok); err != nil {
		return tok, ErrPatalaChargeIDInvalid
	}
	if tok.RailID == "" || tok.Reference == "" {
		return tok, ErrPatalaChargeIDInvalid
	}
	return tok, nil
}

// patalaChargeProof is the JSON shape every hosted-checkout rail in
// patala-fiat embeds in Receipt.proof for its redirect URL (see e.g.
// patala-fiat/src/stripe/proof.rs's ChargeProof, which this mirrors
// field-for-field for the one field this generic adapter cares about).
// patala_core documents `proof` as fully opaque, so this is a best-effort,
// convention-based read: a provider whose proof has no such key, or isn't
// JSON at all, simply leaves the redirect URL empty in Receipt.Reference —
// see Charge below.
type patalaChargeProof struct {
	RedirectURL string `json:"redirect_url"`
}

// PatalaGatewayProvider adapts ANY ONE of patala-fiat's processor rails
// (Stripe, Paystack, Adyen, BTCPay, lnbits, ...) to BeepBite's
// PaymentProvider interface, via patala-go's single by-name constructor
// (patala.PatalaRailNewFiat). One Go type serves every provider
// patala-fiat ships.
type PatalaGatewayProvider struct {
	name string
	rail *patala.PatalaRail
}

// NewPatalaGatewayProvider builds a BeepBite PaymentProvider for name (must
// be one of PatalaFiatProviderNames(), e.g. "stripe", "paystack", "yoco",
// "payfast") from this deployment's BEEPBITE_<NAME>_* environment
// variables (see PatalaConfigFromEnv).
func NewPatalaGatewayProvider(name string) (*PatalaGatewayProvider, error) {
	name = strings.ToLower(strings.TrimSpace(name))
	if name == "" {
		return nil, errors.New("payments: patala gateway: provider name must not be empty")
	}
	cfg := PatalaConfigFromEnv(name)
	rail, err := patala.PatalaRailNewFiat(name, cfg)
	if err != nil {
		return nil, fmt.Errorf("payments: patala gateway %q: %w", name, err)
	}
	return &PatalaGatewayProvider{name: name, rail: rail}, nil
}

// Code implements PaymentProvider. It deliberately returns the underlying
// processor's own id ("stripe", "paystack", ...) rather than one of the
// TenderXxx constants in provider.go: those are a closed vocabulary tied to
// the payment_methods table ManualTender writes against (see
// manual_test.go's TestValidTender, which asserts "stripe"/"paystack"/
// "online" are explicitly NOT valid manual tenders) and this adapter is
// deliberately kept outside it — a future checkout-wiring change is
// responsible for deciding how (and whether) an online-gateway tender gets
// its own payment_methods row and migration.
func (p *PatalaGatewayProvider) Code() string { return p.name }

// Charge starts a payment on the underlying gateway rail and always
// returns StatusPending. An online gateway charge is a hosted/redirect
// flow (or, for a handful of rails, an
// async webhookless capture) that has not necessarily been completed by the
// buyer by the time this call returns, unlike ManualTender's Charge, which
// only ever runs after the operator says the money already moved (see
// manual.go). Receipt.ID carries this adapter's own self-contained charge
// token (see patalaChargeToken); Receipt.Reference carries a best-effort
// hosted-payment redirect URL if the rail's proof contains one, otherwise
// the order reference patala was given.
//
// req.Tender is intentionally not validated against ValidTender/TenderXxx
// here (see Code's doc comment) — this provider is not part of that closed
// vocabulary. req.Reference is used as-is if supplied; otherwise req.OrderID
// is used as patala's dedup reference (patala-fiat rails de-duplicate a
// charge by this string, same convention cackle's own patala adapter
// relies on for its Order.Reference).
func (p *PatalaGatewayProvider) Charge(ctx context.Context, req ChargeRequest) (Receipt, error) {
	if strings.TrimSpace(req.OrderID) == "" {
		return Receipt{}, errors.New("payments: order_id is required")
	}
	if req.Amount.Cents <= 0 {
		return Receipt{}, errors.New("payments: amount must be > 0")
	}
	currency := strings.ToUpper(strings.TrimSpace(req.Amount.CurrencyCode))
	if currency == "" {
		return Receipt{}, errors.New("payments: currency_code is required")
	}
	reference := strings.TrimSpace(req.Reference)
	if reference == "" {
		reference = req.OrderID
	}

	// destination is patala_core::PayRequest's one opaque per-request string
	// slot (patala-core/src/rail.rs). patala_core's own validation rejects it
	// empty on EVERY rail — a base-level required field, not optional
	// per-provider metadata — so this always sends a non-empty value.
	//
	// What a specific patala-fiat rail actually DOES with that string is
	// rail-specific and, critically, NOT the same thing across rails:
	//
	//   - stripe, yoco and payfast's own module docs (patala-fiat/src/
	//     {stripe,yoco,payfast}/rail.rs) say plainly that they reinterpret
	//     `destination` AS the post-checkout return/callback URL (Stripe's
	//     success_url AND cancel_url both, verbatim) — for exactly these
	//     rails, req.ReturnURL (checkout.go's verify-on-return URL, see
	//     ChargeRequest.ReturnURL's doc comment) belongs here, and this
	//     adapter sends it when the caller supplied one.
	//   - paystack's own module doc (patala-fiat/src/paystack/rail.rs)
	//     reinterprets the SAME field as the BUYER'S EMAIL instead — sending
	//     req.ReturnURL there would silently corrupt the charge (Paystack
	//     would receive a URL where it expects an email address). This
	//     adapter has no per-rail knowledge to special-case that here (one
	//     Go type serves all ~20 rails via one by-name constructor — see
	//     this file's own module doc comment), so it is a real, UNVERIFIED-
	//     AGAINST-LIVE gap: a self-hoster picking paystack (or any other rail
	//     that isn't confirmed hosted-checkout-with-a-return-slot) must not
	//     assume the customer's browser will actually be redirected back to
	//     ReturnURL — see docs/ONLINE-PAYMENTS.md.
	//   - a rail with no redirect leg at all (invoice/QR-style) does not
	//     care either way.
	//
	// Falling back to `reference` when ReturnURL is empty preserves this
	// adapter's pre-existing behaviour (patala_core's non-empty requirement,
	// a stable per-rail dedup key) for any caller that has not adopted the
	// return-URL flow yet.
	destination := reference
	if rt := strings.TrimSpace(req.ReturnURL); rt != "" {
		destination = rt
	}

	payReq := patala.PayRequest{
		AmountMinor: uint64(req.Amount.Cents),
		Currency:    currency,
		Destination: destination,
		Reference:   reference,
	}
	receipt, err := p.rail.Charge(payReq)
	if err != nil {
		return Receipt{}, fmt.Errorf("payments: patala gateway %s: charge: %w", p.name, err)
	}

	now := time.Now()
	tok := patalaChargeToken{
		RailID: p.name,
		// Persist the REQUEST's real amount/currency, not receipt.AmountMinor
		// (always 0 here — patala_core::Receipt's honest pending-lifecycle
		// contract: nothing has settled yet at charge time). This is exactly
		// what makes GetStatus's re-verify a real amount/currency check
		// rather than trusting a bare bool — see GetStatus's doc comment.
		AmountCents:   req.Amount.Cents,
		CurrencyCode:  currency,
		Reference:     reference,
		ProofB64:      base64.StdEncoding.EncodeToString(receipt.Proof),
		CreatedAtUnix: now.Unix(),
	}
	chargeID := encodeChargeToken(tok)

	redirectOrReference := reference
	var proof patalaChargeProof
	if json.Unmarshal(receipt.Proof, &proof) == nil && proof.RedirectURL != "" {
		redirectOrReference = proof.RedirectURL
	}

	return Receipt{
		ID:         chargeID,
		Tender:     p.name,
		Amount:     req.Amount,
		Status:     StatusPending,
		Reference:  redirectOrReference,
		OccurredAt: now,
	}, nil
}

// Refund always fails closed — see ErrPatalaRefundUnsupported and this
// file's module doc comment ("What this adapter can and cannot do").
func (p *PatalaGatewayProvider) Refund(ctx context.Context, req RefundRequest) (Receipt, error) {
	return Receipt{}, ErrPatalaRefundUnsupported
}

// GetStatus decodes chargeID back into the patala_core::Receipt this rail
// issued at Charge time and asks patala to re-verify it against the real
// processor — this is the ONLY way a patala-backed gateway charge is ever
// confirmed (see this file's module doc comment: no webhook surface exists
// through this binding). Fails CLOSED in every ambiguous case:
//
//   - an unreadable/foreign chargeID returns ErrPatalaChargeIDInvalid, never
//     a status;
//   - Verify returning false (or erroring) reports StatusPending, never
//     StatusFailed — patala's verify() cannot distinguish "still waiting" from
//     "the processor doesn't have it", so this adapter does not guess either;
//   - Verify returning true reports StatusSettled with the AmountCents/
//     CurrencyCode this adapter itself persisted in the token at Charge time
//     (the REQUEST's real total), not anything patala's bool-only verify()
//     could have fabricated a bigger number into — the same "pay 10, claim
//     1000" anti-fraud posture cackle's own patala adapter documents for the
//     identical reason: verify() never returns the amount it actually
//     observed, so the caller-supplied expected amount is what gets checked
//     server-side and what gets echoed back here.
func (p *PatalaGatewayProvider) GetStatus(ctx context.Context, chargeID string) (Receipt, error) {
	tok, err := decodeChargeToken(chargeID)
	if err != nil {
		return Receipt{}, err
	}

	proof, err := base64.StdEncoding.DecodeString(tok.ProofB64)
	if err != nil {
		return Receipt{}, ErrPatalaChargeIDInvalid
	}

	receipt := patala.Receipt{
		RailId:        tok.RailID,
		AmountMinor:   uint64(tok.AmountCents),
		Currency:      tok.CurrencyCode,
		Reference:     tok.Reference,
		Proof:         proof,
		SettledAtUnix: 0,
	}
	settled, err := p.rail.Verify(receipt)
	if err != nil {
		return Receipt{}, fmt.Errorf("payments: patala gateway %s: verify: %w", p.name, err)
	}

	amount := Amount{Cents: tok.AmountCents, CurrencyCode: tok.CurrencyCode}
	if !settled {
		return Receipt{
			ID:         chargeID,
			Tender:     p.name,
			Amount:     amount,
			Status:     StatusPending,
			Reference:  tok.Reference,
			OccurredAt: time.Unix(tok.CreatedAtUnix, 0).UTC(),
		}, nil
	}

	return Receipt{
		ID:         chargeID,
		Tender:     p.name,
		Amount:     amount,
		Status:     StatusSettled,
		Reference:  tok.Reference,
		OccurredAt: time.Now(),
	}, nil
}

// compile-time assertion: PatalaGatewayProvider is a PaymentProvider.
var _ PaymentProvider = (*PatalaGatewayProvider)(nil)
