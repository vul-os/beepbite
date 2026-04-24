package chatbot

import (
	"strconv"
	"strings"
)

// parseLocationMessage parses "LOCATION:lat,lng" or the legacy
// "LOCATION:lat:lng:name:address" variant. It returns lat, lng, ok.
func parseLocationMessage(input string) (float64, float64, bool) {
	if !strings.HasPrefix(input, "LOCATION:") {
		return 0, 0, false
	}
	data := input[len("LOCATION:"):]
	parts := strings.Split(data, ":")
	var latStr, lngStr string
	if len(parts) == 1 {
		// "lat,lng"
		coords := strings.Split(parts[0], ",")
		if len(coords) < 2 {
			return 0, 0, false
		}
		latStr = coords[0]
		lngStr = coords[1]
	} else {
		latStr = parts[0]
		lngStr = parts[1]
	}
	lat, err := strconv.ParseFloat(strings.TrimSpace(latStr), 64)
	if err != nil {
		return 0, 0, false
	}
	lng, err := strconv.ParseFloat(strings.TrimSpace(lngStr), 64)
	if err != nil {
		return 0, 0, false
	}
	return lat, lng, true
}

// geocodeResult mirrors the TS { success, address?, coordinates? } shape.
type geocodeResult struct {
	Success     bool
	Address     string
	Coordinates *Coordinates
}

// geocodeAddress is a stub that always fails. The original TS calls mapbox;
// that integration is not yet ported. Callers treat "no success" as a prompt
// for the user to share a location instead of typing.
func geocodeAddress(address string) geocodeResult {
	_ = address
	return geocodeResult{Success: false}
}

// reverseGeocode is a stub; returns failure so the fallback suggestions path
// in getNearbyAddressSuggestions is used.
func reverseGeocode(lat, lng float64) geocodeResult {
	_ = lat
	_ = lng
	return geocodeResult{Success: false}
}

// canUseWhatsApp is a stub for utility/communication.ts. We always return true
// so messages are sent via WhatsApp (matching the only transport available in
// this port).
func canUseWhatsApp(whatsappNumber string) bool {
	_ = whatsappNumber
	return true
}
