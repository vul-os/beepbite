// Package deliveryzones — geo.go implements a pure-Go ray-casting point-in-polygon
// check. No PostGIS or external GIS library is required.
package deliveryzones

// GeoPolygon is a minimal GeoJSON Polygon representation.
// Only the first ring (exterior ring) is used for point-in-polygon.
type GeoPolygon struct {
	Type        string         `json:"type"`
	Coordinates [][][2]float64 `json:"coordinates"` // [ring][point][lng,lat]
}

// containsPoint returns true when the point (lng, lat) lies inside the
// polygon's exterior ring using the ray-casting (even-odd) algorithm.
// Points exactly on an edge are considered inside.
func containsPoint(poly GeoPolygon, lng, lat float64) bool {
	if len(poly.Coordinates) == 0 {
		return false
	}
	ring := poly.Coordinates[0]
	n := len(ring)
	if n < 3 {
		return false
	}

	inside := false
	j := n - 1
	for i := 0; i < n; i++ {
		xi, yi := ring[i][0], ring[i][1] // lng, lat
		xj, yj := ring[j][0], ring[j][1]

		// Ray from (lng,lat) going right (positive x direction).
		// Crosses edge if the edge straddles the y=lat line and the
		// x-intersection of the edge is to the right of lng.
		if ((yi > lat) != (yj > lat)) &&
			(lng < (xj-xi)*(lat-yi)/(yj-yi)+xi) {
			inside = !inside
		}
		j = i
	}
	return inside
}
