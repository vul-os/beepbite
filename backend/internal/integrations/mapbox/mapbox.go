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

// Bias narrows a geocoding request to a part of the world.
//
// Both fields are optional and independent. An empty Bias means *no* bias: the
// request goes to Mapbox without `country` or `proximity` and results come back
// from the whole world, ranked only by Mapbox's own relevance.
//
// That empty default is deliberate. The obvious alternative — pick some country
// to fall back to — is not a neutral choice, it is a wrong answer for every
// operator outside that country, and a silent one: their customers simply never
// see their own street in the autocomplete list and have no way to tell why.
// Worldwide results are at worst noisy, and noise is visible.
type Bias struct {
	// Country is a comma-separated list of ISO-3166-1 alpha-2 codes ("gb",
	// "za,na,bw"). Sent as &country=.
	Country string
	// Proximity is a "lng,lat" point that pulls nearby results up the ranking.
	// Sent as &proximity=.
	Proximity string
}

// orDefault returns b, or d for whichever fields b leaves blank. A per-request
// bias therefore overrides the deployment default field-by-field rather than
// all-or-nothing: a caller can narrow the country for one location while still
// inheriting the configured proximity.
func (b Bias) orDefault(d Bias) Bias {
	if b.Country == "" {
		b.Country = d.Country
	}
	if b.Proximity == "" {
		b.Proximity = d.Proximity
	}
	return b
}

// apply writes the non-empty bias parameters into v. Blank fields are omitted
// entirely — Mapbox treats an absent `country` as "anywhere", but an empty
// `country=` as a malformed filter.
func (b Bias) apply(v url.Values) {
	if c := strings.TrimSpace(b.Country); c != "" {
		v.Set("country", c)
	}
	if p := strings.TrimSpace(b.Proximity); p != "" {
		v.Set("proximity", p)
	}
}

// Config holds all constructor options. APIKey is required for live calls;
// Country and Proximity are optional and default to unset, i.e. worldwide
// results.
type Config struct {
	APIKey     string
	HTTPClient *http.Client
	// Country is the ISO-3166-1 alpha-2 code (or comma-separated list) applied
	// as the deployment-wide default bias. Falls back to the MAPBOX_COUNTRY
	// env var, then to no country filter at all.
	Country string
	// Proximity is a "lng,lat" bias point applied as the deployment-wide
	// default. Falls back to MAPBOX_PROXIMITY, then to no proximity bias.
	Proximity string
}

type Client struct {
	apiKey      string
	httpClient  *http.Client
	defaultBias Bias
}

func NewClient(cfg Config) *Client {
	hc := cfg.HTTPClient
	if hc == nil {
		hc = &http.Client{Timeout: 30 * time.Second}
	}

	// Config wins over env so a caller that has already read configuration
	// (internal/config exposes MapboxCountry / MapboxProximity) is authoritative;
	// the env lookup is only here for the direct-construction path. Neither
	// having a value is a valid, fully-supported state.
	bias := Bias{Country: cfg.Country, Proximity: cfg.Proximity}.
		orDefault(Bias{
			Country:   os.Getenv("MAPBOX_COUNTRY"),
			Proximity: os.Getenv("MAPBOX_PROXIMITY"),
		})

	return &Client{
		apiKey:      cfg.APIKey,
		httpClient:  hc,
		defaultBias: bias,
	}
}

// DefaultBias reports the deployment-wide bias this client applies when a
// request supplies none. A zero value means worldwide.
func (c *Client) DefaultBias() Bias { return c.defaultBias }

// geocodeURL builds a Geocoding v5 request URL for an already-escaped path
// segment (a query string for forward geocoding, "lng,lat" for reverse),
// merging the request bias over the client default.
func (c *Client) geocodeURL(pathSegment string, bias Bias, extra url.Values) string {
	v := url.Values{}
	for key, vals := range extra {
		v[key] = vals
	}
	v.Set("access_token", c.apiKey)
	bias.orDefault(c.defaultBias).apply(v)

	return "https://api.mapbox.com/geocoding/v5/mapbox.places/" +
		pathSegment + ".json?" + v.Encode()
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

// GeocodeAddress forward-geocodes an address using the client's default bias.
func (c *Client) GeocodeAddress(address string) GeocodeResult {
	return c.GeocodeAddressBiased(address, Bias{})
}

// GeocodeAddressBiased is GeocodeAddress with a per-request bias, for a
// multi-region operator resolving an address that belongs to a known location.
// A zero Bias falls back to the client default, which may itself be worldwide.
func (c *Client) GeocodeAddressBiased(address string, bias Bias) GeocodeResult {
	if c.apiKey == "" {
		return GeocodeResult{Success: false, Error: "Mapbox API key not found in environment variables"}
	}
	if strings.TrimSpace(address) == "" {
		return GeocodeResult{Success: false, Error: "Address string is required"}
	}

	encoded := url.PathEscape(strings.TrimSpace(address))
	geocodeURL := c.geocodeURL(encoded, bias, url.Values{"limit": {"1"}})

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

// ReverseGeocode resolves coordinates to an address using the client's default
// bias.
func (c *Client) ReverseGeocode(latitude, longitude float64) GeocodeResult {
	return c.ReverseGeocodeBiased(latitude, longitude, Bias{})
}

// ReverseGeocodeBiased is ReverseGeocode with a per-request bias.
//
// Note that a country filter on a reverse geocode is a hard constraint, not a
// ranking hint: coordinates outside the named country return no result at all.
// Callers resolving a customer-shared pin should usually leave Bias.Country
// empty even when they know the location's country, because the pin is the
// authoritative fact and the country is the assumption.
func (c *Client) ReverseGeocodeBiased(latitude, longitude float64, bias Bias) GeocodeResult {
	if c.apiKey == "" {
		return GeocodeResult{Success: false, Error: "Mapbox API key not found in environment variables"}
	}

	reverseURL := c.geocodeURL(
		fmt.Sprintf("%v,%v", longitude, latitude), bias, url.Values{"limit": {"1"}},
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

// Suggest performs an autocomplete forward-geocode using the client's default
// bias and returns up to 6 structured Suggestion values.
//
// It returns (nil, ErrNoToken) when no API key is configured — callers should
// treat this as an empty result rather than a fatal error.
func (c *Client) Suggest(query string) ([]Suggestion, error) {
	return c.SuggestBiased(query, Bias{})
}

// SuggestBiased is Suggest with a per-request bias.
//
// This is the call an address-entry form should make once it knows which
// location the customer is ordering from: biasing to that location's country
// and coordinates puts the customer's own suburb at the top of the list, which
// is the difference between autocomplete being useful and being ignored.
// Passing a zero Bias is always valid and yields worldwide results.
func (c *Client) SuggestBiased(query string, bias Bias) ([]Suggestion, error) {
	if c.apiKey == "" {
		return nil, ErrNoToken
	}

	q := strings.TrimSpace(query)
	if q == "" {
		return nil, nil
	}

	suggestURL := c.geocodeURL(url.PathEscape(q), bias, url.Values{
		"autocomplete": {"true"},
		"limit":        {"6"},
		"types":        {"address,place,locality,neighborhood,postcode"},
	})

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
