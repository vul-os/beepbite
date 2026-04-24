package mapbox

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

type Config struct {
	APIKey     string
	HTTPClient *http.Client
}

type Client struct {
	apiKey     string
	httpClient *http.Client
}

func NewClient(cfg Config) *Client {
	hc := cfg.HTTPClient
	if hc == nil {
		hc = &http.Client{Timeout: 30 * time.Second}
	}
	return &Client{apiKey: cfg.APIKey, httpClient: hc}
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

type mapboxFeature struct {
	Center    []float64 `json:"center"`
	PlaceName string    `json:"place_name"`
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
	geocodeURL := fmt.Sprintf("https://api.mapbox.com/geocoding/v5/mapbox.places/%s.json?access_token=%s&limit=1", encoded, url.QueryEscape(c.apiKey))

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

	reverseURL := fmt.Sprintf("https://api.mapbox.com/geocoding/v5/mapbox.places/%v,%v.json?access_token=%s&limit=1", longitude, latitude, url.QueryEscape(c.apiKey))

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
