package paystack

import "fmt"

// ClientForAnyRegion returns a Client and Credentials for the first region
// that has loaded credentials.  It is used by the transfer reconciler which
// needs a valid Paystack client but does not have a region stored on the
// payout row.
//
// If the deployment runs multiple regions, callers should prefer ClientFor
// with an explicit region code to avoid cross-region mismatches.
func (m *Manager) ClientForAnyRegion() (*Client, *Credentials, error) {
	if m == nil || len(m.creds) == 0 {
		return nil, nil, fmt.Errorf("paystack: no regions configured")
	}
	for _, creds := range m.creds {
		return NewClient(Config{
			SecretKey:   creds.SecretKey,
			FrontendURL: m.frontendURL,
			HTTPClient:  m.httpClient,
		}), creds, nil
	}
	return nil, nil, fmt.Errorf("paystack: no regions configured")
}
