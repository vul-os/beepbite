package chatbot

// geocodeAddress attempts to geocode the given address string.
// When the service has a Mapbox client wired in it performs a live API call;
// otherwise it falls back to the stub behaviour (returns Success: false) so
// the caller can prompt the user to share their location instead.
func (s *Service) geocodeAddress(address string) geocodeResult {
	if s.mapbox == nil {
		return geocodeResult{Success: false}
	}
	r := s.mapbox.GeocodeAddress(address)
	if !r.Success {
		return geocodeResult{Success: false}
	}
	var coords *Coordinates
	if r.Coordinates != nil {
		coords = &Coordinates{
			Latitude:  r.Coordinates.Latitude,
			Longitude: r.Coordinates.Longitude,
		}
	}
	return geocodeResult{
		Success:     true,
		Address:     r.Address,
		Coordinates: coords,
	}
}

// reverseGeocode attempts to reverse-geocode lat/lng.
// Falls back to stub (Success: false) when no Mapbox client is available.
func (s *Service) reverseGeocode(lat, lng float64) geocodeResult {
	if s.mapbox == nil {
		return geocodeResult{Success: false}
	}
	r := s.mapbox.ReverseGeocode(lat, lng)
	if !r.Success {
		return geocodeResult{Success: false}
	}
	var coords *Coordinates
	if r.Coordinates != nil {
		coords = &Coordinates{
			Latitude:  r.Coordinates.Latitude,
			Longitude: r.Coordinates.Longitude,
		}
	}
	return geocodeResult{
		Success:     true,
		Address:     r.Address,
		Coordinates: coords,
	}
}
