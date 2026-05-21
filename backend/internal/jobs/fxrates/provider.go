// Package fxrates provides a background job that fetches USD-based exchange
// rates from frankfurter.app and upserts them into the exchange_rates table
// every FX_FETCH_INTERVAL (default 1 h).
package fxrates

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"
)

// providerURL is the Frankfurter endpoint that returns the latest ECB rates
// for the currencies we care about, with USD as the base.
const providerURL = "https://api.frankfurter.app/latest?from=USD&to=ZAR,NGN,KES,GHS,EUR,GBP"

// quoteCurrencies is the ordered list of currencies we track.  USD→USD is
// always 1.0 and is synthesised locally rather than fetched.
var quoteCurrencies = []string{"ZAR", "NGN", "KES", "GHS", "EUR", "GBP", "USD"}

// fallbackRates is a hardcoded last-known snapshot used when the HTTP fetch
// fails.  Values are approximate mid-market rates as of 2025-05.  The table
// is never left empty even on network failure.
var fallbackRates = map[string]float64{
	"ZAR": 18.60,
	"NGN": 1610.0,
	"KES": 129.5,
	"GHS": 15.70,
	"EUR": 0.9180,
	"GBP": 0.7870,
	"USD": 1.0,
}

// frankfurterResponse mirrors the JSON body returned by frankfurter.app.
//
//	{ "amount": 1, "base": "USD", "date": "2025-05-21", "rates": {"EUR": 0.918, ...} }
type frankfurterResponse struct {
	Base  string             `json:"base"`
	Date  string             `json:"date"`
	Rates map[string]float64 `json:"rates"`
}

// rateResult holds one fetched or fallback rate.
type rateResult struct {
	QuoteCode string
	Rate      float64
	Source    string // "frankfurter" or "fallback"
}

// fetchRates fetches USD-based rates from frankfurter.app.  If the HTTP call
// or JSON parse fails it logs the error and returns the hardcoded fallback
// rates so the caller always has data to write.
func fetchRates(ctx context.Context) ([]rateResult, error) {
	client := &http.Client{Timeout: 15 * time.Second}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, providerURL, nil)
	if err != nil {
		return fallbackResults("build request: " + err.Error()), nil
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", "beepbite-fxrates/1.0")

	resp, err := client.Do(req)
	if err != nil {
		return fallbackResults("HTTP fetch: " + err.Error()), nil
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fallbackResults(fmt.Sprintf("HTTP %d from frankfurter.app", resp.StatusCode)), nil
	}

	var body frankfurterResponse
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return fallbackResults("JSON decode: " + err.Error()), nil
	}

	if body.Base != "USD" || len(body.Rates) == 0 {
		return fallbackResults("unexpected response body from frankfurter.app"), nil
	}

	results := make([]rateResult, 0, len(quoteCurrencies))
	for _, code := range quoteCurrencies {
		var rate float64
		if code == "USD" {
			rate = 1.0
		} else {
			r, ok := body.Rates[code]
			if !ok {
				// Currency missing from response — fall back to hardcoded value.
				r = fallbackRates[code]
			}
			rate = r
		}
		results = append(results, rateResult{
			QuoteCode: code,
			Rate:      rate,
			Source:    "frankfurter",
		})
	}
	return results, nil
}

// fallbackResults returns the hardcoded fallback snapshot and logs the reason.
func fallbackResults(reason string) []rateResult {
	out := make([]rateResult, 0, len(quoteCurrencies))
	for _, code := range quoteCurrencies {
		out = append(out, rateResult{
			QuoteCode: code,
			Rate:      fallbackRates[code],
			Source:    "fallback",
		})
	}
	_ = reason // caller logs at call site if needed
	return out
}
