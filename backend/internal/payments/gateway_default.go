//go:build !patala

package payments

// newOnlineGatewayProvider is the default (non-patala) build's
// implementation: it NEVER constructs a provider, regardless of
// BEEPBITE_ONLINE_PAYMENT_PROVIDER, because this build has no patala-go
// import at all (that only happens in patala_gateway.go, which carries its
// own `//go:build patala` tag) — there is no gateway code linked into the
// binary to construct one from.
//
// This is what `go build ./...`, `go vet ./...`, plain `go test ./...` and
// the shipped Dockerfile (CGO_ENABLED=0) all compile. Every one of them stays
// completely unaffected by this file's existence: on-delivery checkout is the
// only path, exactly as it was before this seam existed.
//
// name is still reported (not swallowed) so cmd/server/main.go can log "you
// asked for a gateway but this binary can't provide one" instead of quietly
// doing nothing.
func newOnlineGatewayProvider() (PaymentProvider, string, error) {
	return nil, OnlineProviderName(), nil
}
