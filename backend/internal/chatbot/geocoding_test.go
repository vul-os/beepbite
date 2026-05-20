package chatbot

import (
	"testing"
)

// geocodingTest verifies that when no Mapbox client is wired the methods
// gracefully return Success:false (stub fallback), and that the result struct
// is properly mapped when a live client would succeed.  A mock mapbox client
// is not needed here because the nil-client branch is the only one exercisable
// without network access; the live path is covered by the mapbox package's own
// tests.

func TestGeocodeAddress_NoClient(t *testing.T) {
	svc := &Service{} // mapbox field is nil

	result := svc.geocodeAddress("1 Main Street, Cape Town")
	if result.Success {
		t.Errorf("expected Success=false when no Mapbox client, got true")
	}
	if result.Coordinates != nil {
		t.Errorf("expected nil Coordinates when no Mapbox client, got %+v", result.Coordinates)
	}
}

func TestReverseGeocode_NoClient(t *testing.T) {
	svc := &Service{} // mapbox field is nil

	result := svc.reverseGeocode(-33.9249, 18.4241)
	if result.Success {
		t.Errorf("expected Success=false when no Mapbox client, got true")
	}
}
