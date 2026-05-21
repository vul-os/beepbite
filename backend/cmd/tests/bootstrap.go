package main

// ensureSession makes sure the runner has a live session + a known org/location
// so that feature suites can be run without requiring --auth to precede them.
//
// Signup no longer auto-creates an organization (the auto-owner trigger was
// dropped in migration 017; onboarding now creates the org + membership
// explicitly), so this delegates to bootstrapOrgAndLocation, which signs up a
// fresh burner user and creates its org, owner membership, and location.
func (r *Runner) ensureSession() bool {
	if r.token != "" && r.orgID != "" && r.locationID != "" {
		return true
	}
	return bootstrapOrgAndLocation(r)
}
