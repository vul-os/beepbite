package mapbox

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"
)

// ErrNoToken is returned by Suggest (and any token-gated method) when the
// client was constructed without a Mapbox API key.
var ErrNoToken = errors.New("mapbox: no API token configured")

// defaultCountry is the ISO-3166-1 alpha-2 country code used when
// MAPBOX_COUNTRY is not set.
const defaultCountry = "za"

// defaultProximity is the "lng,lat" bias point used when MAPBOX_PROXIMITY is
// not set.  Johannesburg city centre.
const defaultProximity = "28.0473,-26.2041"

// Config holds all constructor options.  APIKey is required for live calls;
// Country and Proximity are optional and fall back to the SA defaults.
type Config struct {
	APIKey     string
	HTTPClient *http.Client
	// Country is the ISO-3166-1 alpha-2 code appended as &country=<code> to
	// every geocoding request.  Defaults to MAPBOX_COUNTRY env → "za".
	Country string
	// Proximity is a "lng,lat" string appended as &proximity=<lng,lat> to
	// every geocoding request.  Defaults to MAPBOX_PROXIMITY env →
	// "28.0473,-26.2041" (Johannesburg).
	Proximity string
}

type Client struct {
	apiKey     string
	httpClient *http.Client
	country    string
	proximity  string
}

func NewClient(cfg Config) *Client {
	hc := cfg.HTTPClient
	if hc == nil {
		hc = &http.Client{Timeout: 30 * time.Second}
	}

	country := cfg.Country
	if country == "" {
		if v := os.Getenv("MAPBOX_COUNTRY"); v != "" {
			country = v
		} else {
			country = defaultCountry
		}
	}

	proximity := cfg.Proximity
	if proximity == "" {
		if v := os.Getenv("MAPBOX_PROXIMITY"); v != "" {
			proximity = v
		} else {
			proximity = defaultProximity
		}
	}

	return &Client{
		apiKey:     cfg.APIKey,
		httpClient: hc,
		country:    country,
		proximity:  proximity,
	}
}

type Coordinates struct {
	Longitude float64 `json:"longitude"`
	Latitude  float64 `json:"latitude"`
}

type GeocodeResult struct {
	Success     bool         `json:"success"`
	Error       string       `json:"error,omitempty"`
	Address     string       `json:"address,omitempty"`
	Coordinates *Coordinates `json:"coordinates,omitempty"`
	PlaceName   string       `json:"place_name,omitempty"`
}

type RouteImageResult struct {
	Success     bool   `json:"success"`
	Error       string `json:"error,omitempty"`
	ImageURL    string `json:"imageUrl,omitempty"`
	ImageBuffer []byte `json:"imageBuffer,omitempty"`
}

type RouteImageOptions struct {
	Width        int
	Height       int
	ReturnBuffer bool
	Zoom         int
	Style        string
}

// Suggestion is the structured result returned by Suggest.
type Suggestion struct {
	PlaceName string  `json:"place_name"`
	Street    string  `json:"street,omitempty"`
	Suburb    string  `json:"suburb,omitempty"`
	City      string  `json:"city,omitempty"`
	Postcode  string  `json:"postcode,omitempty"`
	Lat       float64 `json:"lat"`
	Lng       float64 `json:"lng"`
}

// mapboxContext is one entry in the feature.context array returned by the
// Mapbox Geocoding API.  Each entry has an id like "postcode.123456",
// "place.456789", "locality.789" … that encodes the layer type.
type mapboxContext struct {
	ID   string `json:"id"`
	Text string `json:"text"`
}

type mapboxFeature struct {
	Center    []float64       `json:"center"`
	PlaceName string          `json:"place_name"`
	Text      string          `json:"text"`    // short name of this feature
	Context   []mapboxContext `json:"context"` // parent layers (locality, place, postcode, …)
}

type geocodeResponse struct {
	Features []mapboxFeature `json:"features"`
	Message  string          `json:"message"`
}

type routeGeometry struct {
	Type        string        `json:"type"`
	Coordinates []interface{} `json:"coordinates"`
}

type directionsRoute struct {
	Geometry json.RawMessage `json:"geometry"`
}

type directionsResponse struct {
	Routes  []directionsRoute `json:"routes"`
	Message string            `json:"message"`
}

func (c *Client) GeocodeAddress(address string) GeocodeResult {
	if c.apiKey == "" {
		return GeocodeResult{Success: false, Error: "Mapbox API key not found in environment variables"}
	}
	if strings.TrimSpace(address) == "" {
		return GeocodeResult{Success: false, Error: "Address string is required"}
	}

	encoded := url.PathEscape(strings.TrimSpace(address))
	geocodeURL := fmt.Sprintf(
		"https://api.mapbox.com/geocoding/v5/mapbox.places/%s.json?access_token=%s&limit=1&country=%s&proximity=%s",
		encoded, url.QueryEscape(c.apiKey), url.QueryEscape(c.country), url.QueryEscape(c.proximity),
	)

	resp, err := c.httpClient.Get(geocodeURL)
	if err != nil {
		return GeocodeResult{Success: false, Error: fmt.Sprintf("Mapbox Geocoding network error: %v", err)}
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		var errData geocodeResponse
		msg := ""
		if err := json.Unmarshal(body, &errData); err == nil {
			msg = errData.Message
		}
		if msg == "" {
			msg = fmt.Sprintf("Mapbox Geocoding API error: %d", resp.StatusCode)
		}
		return GeocodeResult{Success: false, Error: msg}
	}

	var result geocodeResponse
	if err := json.Unmarshal(body, &result); err != nil {
		return GeocodeResult{Success: false, Error: fmt.Sprintf("Mapbox Geocoding network error: %v", err)}
	}

	if len(result.Features) == 0 {
		return GeocodeResult{Success: false, Error: "No geocoding results found for the provided address"}
	}

	feat := result.Features[0]
	if len(feat.Center) < 2 {
		return GeocodeResult{Success: false, Error: "Invalid feature center from Mapbox"}
	}

	return GeocodeResult{
		Success:   true,
		Address:   feat.PlaceName,
		PlaceName: feat.PlaceName,
		Coordinates: &Coordinates{
			Longitude: feat.Center[0],
			Latitude:  feat.Center[1],
		},
	}
}

func (c *Client) ReverseGeocode(latitude, longitude float64) GeocodeResult {
	if c.apiKey == "" {
		return GeocodeResult{Success: false, Error: "Mapbox API key not found in environment variables"}
	}

	reverseURL := fmt.Sprintf(
		"https://api.mapbox.com/geocoding/v5/mapbox.places/%v,%v.json?access_token=%s&limit=1&country=%s&proximity=%s",
		longitude, latitude, url.QueryEscape(c.apiKey), url.QueryEscape(c.country), url.QueryEscape(c.proximity),
	)

	resp, err := c.httpClient.Get(reverseURL)
	if err != nil {
		return GeocodeResult{Success: false, Error: fmt.Sprintf("Mapbox Reverse Geocoding network error: %v", err)}
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		var errData geocodeResponse
		msg := ""
		if err := json.Unmarshal(body, &errData); err == nil {
			msg = errData.Message
		}
		if msg == "" {
			msg = fmt.Sprintf("Mapbox Reverse Geocoding API error: %d", resp.StatusCode)
		}
		return GeocodeResult{Success: false, Error: msg}
	}

	var result geocodeResponse
	if err := json.Unmarshal(body, &result); err != nil {
		return GeocodeResult{Success: false, Error: fmt.Sprintf("Mapbox Reverse Geocoding network error: %v", err)}
	}

	if len(result.Features) == 0 {
		return GeocodeResult{Success: false, Error: "No reverse geocoding results found for the provided coordinates"}
	}

	feat := result.Features[0]

	return GeocodeResult{
		Success:   true,
		Address:   feat.PlaceName,
		PlaceName: feat.PlaceName,
		Coordinates: &Coordinates{
			Longitude: longitude,
			Latitude:  latitude,
		},
	}
}

// Suggest performs an autocomplete forward-geocode biased to c.country /
// c.proximity and returns up to 6 structured Suggestion values.
//
// It returns (nil, ErrNoToken) when no API key is configured — callers should
// treat this as an empty result rather than a fatal error.
func (c *Client) Suggest(query string) ([]Suggestion, error) {
	if c.apiKey == "" {
		return nil, ErrNoToken
	}

	q := strings.TrimSpace(query)
	if q == "" {
		return nil, nil
	}

	suggestURL := fmt.Sprintf(
		"https://api.mapbox.com/geocoding/v5/mapbox.places/%s.json"+
			"?access_token=%s"+
			"&autocomplete=true"+
			"&country=%s"+
			"&proximity=%s"+
			"&limit=6"+
			"&types=address,place,locality,neighborhood,postcode",
		url.PathEscape(q),
		url.QueryEscape(c.apiKey),
		url.QueryEscape(c.country),
		url.QueryEscape(c.proximity),
	)

	resp, err := c.httpClient.Get(suggestURL)
	if err != nil {
		return nil, fmt.Errorf("mapbox suggest: network error: %w", err)
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		var errData geocodeResponse
		msg := fmt.Sprintf("mapbox suggest: API error %d", resp.StatusCode)
		if json.Unmarshal(body, &errData) == nil && errData.Message != "" {
			msg = fmt.Sprintf("mapbox suggest: %s", errData.Message)
		}
		return nil, errors.New(msg)
	}

	var result geocodeResponse
	if err := json.Unmarshal(body, &result); err != nil {
		return nil, fmt.Errorf("mapbox suggest: decode error: %w", err)
	}

	suggestions := make([]Suggestion, 0, len(result.Features))
	for _, feat := range result.Features {
		if len(feat.Center) < 2 {
			continue
		}

		s := Suggestion{
			PlaceName: feat.PlaceName,
			Street:    feat.Text,
			Lng:       feat.Center[0],
			Lat:       feat.Center[1],
		}

		// Walk the context array to extract suburb, city, postcode.
		// Mapbox context IDs look like "locality.12345", "place.67890",
		// "postcode.11111", "neighborhood.222", "region.333" etc.
		for _, ctx := range feat.Context {
			switch {
			case strings.HasPrefix(ctx.ID, "neighborhood.") || strings.HasPrefix(ctx.ID, "locality."):
				if s.Suburb == "" {
					s.Suburb = ctx.Text
				}
			case strings.HasPrefix(ctx.ID, "place."):
				s.City = ctx.Text
			case strings.HasPrefix(ctx.ID, "postcode."):
				s.Postcode = ctx.Text
			}
		}

		suggestions = append(suggestions, s)
	}

	return suggestions, nil
}

func (c *Client) GenerateRouteImage(source, destination Coordinates, opts RouteImageOptions) RouteImageResult {
	if c.apiKey == "" {
		return RouteImageResult{Success: false, Error: "Mapbox API key not found in environment variables"}
	}

	width := opts.Width
	if width == 0 {
		width = 600
	}
	height := opts.Height
	if height == 0 {
		height = 400
	}
	style := opts.Style
	if style == "" {
		style = "streets-v11"
	}

	sourceMarker := fmt.Sprintf("pin-s-a+00ff00(%v,%v)", source.Longitude, source.Latitude)
	destMarker := fmt.Sprintf("pin-s-b+ff0000(%v,%v)", destination.Longitude, destination.Latitude)

	directionsURL := fmt.Sprintf("https://api.mapbox.com/directions/v5/mapbox/driving/%v,%v;%v,%v?access_token=%s&geometries=geojson",
		source.Longitude, source.Latitude, destination.Longitude, destination.Latitude, url.QueryEscape(c.apiKey))

	dResp, err := c.httpClient.Get(directionsURL)
	if err != nil {
		return RouteImageResult{Success: false, Error: fmt.Sprintf("Mapbox route image generation error: %v", err)}
	}
	defer dResp.Body.Close()

	dBody, _ := io.ReadAll(dResp.Body)

	if dResp.StatusCode < 200 || dResp.StatusCode >= 300 {
		var errData directionsResponse
		msg := ""
		if err := json.Unmarshal(dBody, &errData); err == nil {
			msg = errData.Message
		}
		if msg == "" {
			msg = fmt.Sprintf("Mapbox Directions API error: %d", dResp.StatusCode)
		}
		return RouteImageResult{Success: false, Error: msg}
	}

	var directionsResult directionsResponse
	if err := json.Unmarshal(dBody, &directionsResult); err != nil {
		return RouteImageResult{Success: false, Error: fmt.Sprintf("Mapbox route image generation error: %v", err)}
	}

	if len(directionsResult.Routes) == 0 {
		return RouteImageResult{Success: false, Error: "No route found between the provided coordinates"}
	}

	routePath := url.QueryEscape(string(directionsResult.Routes[0].Geometry))

	imageURL := fmt.Sprintf("https://api.mapbox.com/styles/v1/mapbox/%s/static/path-5+0074D9-0.8(%s)/%s,%s/auto/%dx%d?access_token=%s",
		style, routePath, sourceMarker, destMarker, width, height, url.QueryEscape(c.apiKey))

	if !opts.ReturnBuffer {
		return RouteImageResult{Success: true, ImageURL: imageURL}
	}

	iResp, err := c.httpClient.Get(imageURL)
	if err != nil {
		return RouteImageResult{Success: false, Error: fmt.Sprintf("Mapbox route image generation error: %v", err)}
	}
	defer iResp.Body.Close()

	if iResp.StatusCode < 200 || iResp.StatusCode >= 300 {
		return RouteImageResult{Success: false, Error: fmt.Sprintf("Failed to fetch route image: %d", iResp.StatusCode)}
	}

	buf, err := io.ReadAll(iResp.Body)
	if err != nil {
		return RouteImageResult{Success: false, Error: fmt.Sprintf("Mapbox route image generation error: %v", err)}
	}

	return RouteImageResult{Success: true, ImageURL: imageURL, ImageBuffer: buf}
}

func (c *Client) GenerateRouteFromAddresses(sourceAddress, destinationAddress string, opts RouteImageOptions) RouteImageResult {
	sourceResult := c.GeocodeAddress(sourceAddress)
	if !sourceResult.Success {
		return RouteImageResult{Success: false, Error: fmt.Sprintf("Failed to geocode source address: %s", sourceResult.Error)}
	}

	destResult := c.GeocodeAddress(destinationAddress)
	if !destResult.Success {
		return RouteImageResult{Success: false, Error: fmt.Sprintf("Failed to geocode destination address: %s", destResult.Error)}
	}

	return c.GenerateRouteImage(*sourceResult.Coordinates, *destResult.Coordinates, opts)
}
