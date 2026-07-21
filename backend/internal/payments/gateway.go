package payments

import (
	"os"
	"strings"
)

// OnlineProviderEnvVar names the env var a self-hoster sets to pick ONE
// patala-fiat processor (e.g. "stripe", "paystack", "yoco", "payfast") as
// beepbite's online-payment gateway for this deployment. Its BEEPBITE_<NAME>_*
// credentials are then read by PatalaConfigFromEnv (patala_gateway.go).
//
// This is a single, deployment-wide choice — one gateway for the whole
// instance, matching patala_gateway.go's own env convention — not a
// per-location setting. A self-hoster wanting per-tenant gateways runs
// separate beepbite instances, same as any other single-tenant-per-process
// config in this codebase.
const OnlineProviderEnvVar = "BEEPBITE_ONLINE_PAYMENT_PROVIDER"

// OnlineProviderName returns the configured online-gateway provider name from
// BEEPBITE_ONLINE_PAYMENT_PROVIDER, or "" if unset. Pure env read, no build
// tag needed — both the patala build and the default (non-patala) build use
// this to know WHAT was asked for, even though only the patala build can ever
// actually construct a provider for it (see gateway_patala.go /
// gateway_default.go).
func OnlineProviderName() string {
	return strings.TrimSpace(os.Getenv(OnlineProviderEnvVar))
}

// NewOnlineGatewayProvider builds the online-payment PaymentProvider
// configured for this deployment, or returns a nil provider if none is
// configured (or if this binary was not built with `-tags patala`).
//
// Exactly two implementations exist, selected entirely by build tag:
//
//   - gateway_patala.go  (`//go:build patala`)  — actually constructs a
//     PatalaGatewayProvider when OnlineProviderName() is non-empty.
//   - gateway_default.go (`//go:build !patala`) — always returns a nil
//     provider. This is what every default `go build ./...` /
//     `CGO_ENABLED=0` build (the shipped Docker image) links in, so setting
//     BEEPBITE_ONLINE_PAYMENT_PROVIDER on a non-patala build changes NOTHING
//     about behaviour — checkout stays on-delivery-only, byte for byte,
//     because there is no gateway code compiled in at all to construct one.
//
// The returned name is always OnlineProviderName(), even when provider is
// nil — that lets the caller (cmd/server/main.go) distinguish "nothing
// configured" from "configured, but this build can't honour it", and log the
// latter instead of silently ignoring it.
func NewOnlineGatewayProvider() (provider PaymentProvider, name string, err error) {
	return newOnlineGatewayProvider()
}
