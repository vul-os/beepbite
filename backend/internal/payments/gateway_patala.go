//go:build patala

package payments

// newOnlineGatewayProvider is the `-tags patala` build's implementation: it
// constructs the ONE patala-fiat rail named by BEEPBITE_ONLINE_PAYMENT_PROVIDER
// (see gateway.go's OnlineProviderName), using that rail's own
// BEEPBITE_<NAME>_* credentials (PatalaConfigFromEnv, patala_gateway.go).
//
// Returns (nil, "", nil) when BEEPBITE_ONLINE_PAYMENT_PROVIDER is unset —
// "not configured" is not an error, it just means on-delivery-only, same as
// the non-patala build's default. A non-empty name that patala-fiat rejects
// (unknown provider, or this cdylib wasn't built with that processor's
// `fiat-*` feature — see NewPatalaGatewayProvider) DOES return an error: a
// self-hoster who typo'd the provider name should see that at startup, not
// have it silently disable online payments.
func newOnlineGatewayProvider() (PaymentProvider, string, error) {
	name := OnlineProviderName()
	if name == "" {
		return nil, "", nil
	}
	p, err := NewPatalaGatewayProvider(name)
	if err != nil {
		return nil, name, err
	}
	return p, name, nil
}
