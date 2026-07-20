package money

// These tests exist to stop one specific regression: the reappearance of a
// hardcoded /100.
//
// The codebase this package replaced divided every amount by 100 and printed
// two decimal places, which is right for USD/EUR/ZAR and wrong for the ~25
// currencies that have 0 or 3 minor digits. The bug is invisible in a
// single-currency deployment, so it needs a test that is explicit about JPY
// (0 decimals), KWD (3) and USD (2) side by side.

import (
	"errors"
	"strings"
	"testing"
)

// ---------------------------------------------------------------------------
// Minor-unit exponent
// ---------------------------------------------------------------------------

func TestScale_PerCurrencyExponent(t *testing.T) {
	tests := []struct {
		name     string
		decimals int
		want     int64
	}{
		{"JPY and the other 0-decimal currencies", 0, 1},
		{"most of ISO 4217", 2, 100},
		{"KWD/BHD/OMR/JOD/TND", 3, 1000},
		{"single-digit exponent", 1, 10},
		{"negative exponent degrades to whole units", -1, 1},
		{"beyond ISO clamps instead of overflowing", 99, 10000},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := Scale(tc.decimals); got != tc.want {
				t.Errorf("Scale(%d) = %d, want %d", tc.decimals, got, tc.want)
			}
		})
	}
}

// TestDecimal_ExponentDrivesFractionDigits is the direct anti-/100 test: the
// same integer 1000 is three different amounts depending on the currency.
func TestDecimal_ExponentDrivesFractionDigits(t *testing.T) {
	const minor int64 = 1000

	tests := []struct {
		currency string
		decimals int
		want     string
		reason   string
	}{
		{"JPY", 0, "1000", "¥1000 — a /100 here would show ¥10"},
		{"USD", 2, "10.00", "$10.00"},
		{"KWD", 3, "1.000", "KD 1.000 — a /100 here would show KD 10.00"},
	}
	for _, tc := range tests {
		t.Run(tc.currency, func(t *testing.T) {
			if got := Decimal(minor, tc.decimals); got != tc.want {
				t.Errorf("Decimal(%d, %d) = %q, want %q (%s)",
					minor, tc.decimals, got, tc.want, tc.reason)
			}
		})
	}
}

func TestDecimal_NegativeAndSubUnit(t *testing.T) {
	tests := []struct {
		minor    int64
		decimals int
		want     string
	}{
		{-1234, 2, "-12.34"},
		{-50, 2, "-0.50"},   // sign survives integer division to a zero major part
		{-5, 3, "-0.005"},   // KWD half-fils
		{-1000, 0, "-1000"}, // JPY
		{0, 2, "0.00"},
		{5, 2, "0.05"},
	}
	for _, tc := range tests {
		if got := Decimal(tc.minor, tc.decimals); got != tc.want {
			t.Errorf("Decimal(%d, %d) = %q, want %q", tc.minor, tc.decimals, got, tc.want)
		}
	}
}

func TestSplit(t *testing.T) {
	tests := []struct {
		minor       int64
		decimals    int
		major, frac int64
	}{
		{1234, 2, 12, 34},
		{-1234, 2, -12, 34}, // sign lives on major only
		{1000, 0, 1000, 0},
		{1234, 3, 1, 234},
	}
	for _, tc := range tests {
		major, frac := Split(tc.minor, tc.decimals)
		if major != tc.major || frac != tc.frac {
			t.Errorf("Split(%d, %d) = (%d, %d), want (%d, %d)",
				tc.minor, tc.decimals, major, frac, tc.major, tc.frac)
		}
	}
}

// ---------------------------------------------------------------------------
// Locale-aware formatting
// ---------------------------------------------------------------------------

// TestFormat_CurrencyAndLocaleAreIndependent verifies the two axes do not leak
// into each other: the currency decides the symbol and the digits, the locale
// decides the separators and the symbol's position.
func TestFormat_CurrencyAndLocaleAreIndependent(t *testing.T) {
	tests := []struct {
		name     string
		minor    int64
		currency string
		decimals int
		locale   string
		contains []string
		excludes []string
	}{
		{
			name: "USD in en-US", minor: 123456, currency: "USD", decimals: 2, locale: "en-US",
			contains: []string{"1,234.56", "$"},
		},
		{
			name: "EUR in de-DE uses German separators", minor: 123456, currency: "EUR", decimals: 2, locale: "de-DE",
			contains: []string{"1.234,56", "€"},
		},
		{
			name: "JPY prints no fraction digits", minor: 1000, currency: "JPY", decimals: 0, locale: "ja-JP",
			contains: []string{"1,000"},
			excludes: []string{"1,000.00", "10.00"},
		},
		{
			name: "KWD prints three fraction digits", minor: 1234, currency: "KWD", decimals: 3, locale: "en-US",
			contains: []string{"1.234"},
			excludes: []string{"12.34"},
		},
		{
			// The point of the seam: a German-locale reader of a Japanese
			// store's report still sees yen, formatted German-style.
			name: "currency does not follow the locale", minor: 1000, currency: "JPY", decimals: 0, locale: "de-DE",
			contains: []string{"1.000"},
			excludes: []string{"€"},
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := Format(tc.minor, tc.currency, tc.decimals, tc.locale)
			for _, want := range tc.contains {
				if !strings.Contains(got, want) {
					t.Errorf("Format(%d, %q, %d, %q) = %q, want it to contain %q",
						tc.minor, tc.currency, tc.decimals, tc.locale, got, want)
				}
			}
			for _, bad := range tc.excludes {
				if strings.Contains(got, bad) {
					t.Errorf("Format(...) = %q, must NOT contain %q", got, bad)
				}
			}
		})
	}
}

// TestFormat_NoCountryDefaults is the regression guard for the whole exercise:
// nothing in the formatting path may fall back to South Africa.
func TestFormat_NoCountryDefaults(t *testing.T) {
	t.Run("empty currency yields a bare number, not a guessed symbol", func(t *testing.T) {
		got := Format(1250, "", 2, "")
		if got != "12.50" {
			t.Errorf("Format(1250, \"\", 2, \"\") = %q, want %q", got, "12.50")
		}
		if strings.Contains(got, "R") {
			t.Errorf("empty currency must not render as rand; got %q", got)
		}
	})

	t.Run("empty locale uses CLDR root, not en-ZA", func(t *testing.T) {
		// en-ZA groups with a space and separates decimals with a comma
		// ("R 1 234,56"). Root uses comma/period. If the fallback were ever
		// changed back to en-ZA this test fails.
		got := Format(123456, "USD", 2, "")
		if !strings.Contains(got, "1,234.56") {
			t.Errorf("Format with empty locale = %q, want root formatting (1,234.56)", got)
		}
	})

	t.Run("unparseable locale falls back to root rather than erroring", func(t *testing.T) {
		got := Format(123456, "USD", 2, "not-a-locale!!")
		if !strings.Contains(got, "1,234.56") {
			t.Errorf("Format with bad locale = %q, want root formatting", got)
		}
	})

	t.Run("unknown currency code stays visible", func(t *testing.T) {
		got := Format(1250, "XYZ", 2, "en-US")
		if !strings.Contains(got, "XYZ") || !strings.Contains(got, "12.50") {
			t.Errorf("Format with unknown code = %q, want it to show both code and amount", got)
		}
	})
}

func TestFormatCode_UsesISOCodeNotSymbol(t *testing.T) {
	// $ is ambiguous across USD, CAD, AUD, SGD and more — a consolidated report
	// must disambiguate.
	got := FormatCode(123456, "USD", 2, "en-US")
	if !strings.Contains(got, "USD") {
		t.Errorf("FormatCode = %q, want it to contain the ISO code", got)
	}
	if !strings.Contains(got, "1,234.56") {
		t.Errorf("FormatCode = %q, want the formatted amount", got)
	}
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

func TestParse_ExponentAware(t *testing.T) {
	tests := []struct {
		in       string
		decimals int
		want     int64
	}{
		{"12.50", 2, 1250},
		{"12,50", 2, 1250},      // comma as decimal separator (de/fr/pt)
		{"1,234.50", 2, 123450}, // last separator wins
		{"1.234,50", 2, 123450}, // same rule, European spelling
		{"1 000,50", 2, 100050}, // space grouping
		{"1'000.50", 2, 100050}, // apostrophe grouping (de-CH)
		{"1000", 0, 1000},       // JPY: 1000 yen, not 10
		{"1.234", 3, 1234},      // KWD: 1.234 dinar
		{"0.29", 2, 29},         // the classic float-rounding victim
		{"-12.50", 2, -1250},
		{"+12.50", 2, 1250},
		{"R 12.50", 2, 1250}, // stray symbols are ignored, not rejected
		{"$12.50", 2, 1250},
		{"1234", 2, 123400},
	}
	for _, tc := range tests {
		t.Run(tc.in, func(t *testing.T) {
			got, err := Parse(tc.in, tc.decimals)
			if err != nil {
				t.Fatalf("Parse(%q, %d) errored: %v", tc.in, tc.decimals, err)
			}
			if got != tc.want {
				t.Errorf("Parse(%q, %d) = %d, want %d", tc.in, tc.decimals, got, tc.want)
			}
		})
	}
}

func TestParse_RejectsRatherThanTruncates(t *testing.T) {
	// Silently truncating "12.345" to 1234 would charge a customer the wrong
	// price with no signal anywhere.
	for _, in := range []string{"12.345", "1.2345", ""} {
		if _, err := Parse(in, 2); !errors.Is(err, ErrInvalidAmount) {
			t.Errorf("Parse(%q, 2) err = %v, want ErrInvalidAmount", in, err)
		}
	}
	// A 0-decimal currency accepts no fraction at all.
	if _, err := Parse("1000.5", 0); !errors.Is(err, ErrInvalidAmount) {
		t.Errorf("Parse(\"1000.5\", 0) should reject a fraction in a 0-decimal currency")
	}
}

func TestParse_RoundTripsWithDecimal(t *testing.T) {
	for _, decimals := range []int{0, 2, 3} {
		for _, minor := range []int64{0, 1, 999, 1000, 123456789, -4207} {
			s := Decimal(minor, decimals)
			got, err := Parse(s, decimals)
			if err != nil {
				t.Fatalf("Parse(Decimal(%d, %d)=%q) errored: %v", minor, decimals, s, err)
			}
			if got != minor {
				t.Errorf("round trip at %d decimals: %d → %q → %d", decimals, minor, s, got)
			}
		}
	}
}

// ---------------------------------------------------------------------------
// Rescale and rounding
// ---------------------------------------------------------------------------

func TestRescale_BetweenExponents(t *testing.T) {
	tests := []struct {
		name     string
		minor    int64
		from, to int
		want     int64
	}{
		// A legacy decimal(10,2) column holding 150.00 for a JPY location is
		// ¥150, not ¥15000.
		{"2dp column read as JPY", 15000, 2, 0, 150},
		{"2dp column read as KWD", 15000, 2, 3, 150000},
		{"no-op", 1234, 2, 2, 1234},
		{"coarsening rounds half away from zero", 1250, 2, 1, 125},
		{"coarsening rounds up at the half", 15, 2, 1, 2},
		{"coarsening rounds down below the half", 14, 2, 1, 1},
		{"negative rounds away from zero too", -15, 2, 1, -2},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := Rescale(tc.minor, tc.from, tc.to); got != tc.want {
				t.Errorf("Rescale(%d, %d, %d) = %d, want %d", tc.minor, tc.from, tc.to, got, tc.want)
			}
		})
	}
}

// TestDivRound_HalfAwayFromZero pins the rounding rule that makes a refund the
// exact mirror of the sale it reverses.
func TestDivRound_HalfAwayFromZero(t *testing.T) {
	tests := []struct {
		n, d, want int64
	}{
		{5, 2, 3},   // 2.5 → 3, not 2
		{-5, 2, -3}, // -2.5 → -3, the mirror
		{4, 2, 2},
		{3, 2, 2},
		{-3, 2, -2},
		{1, 3, 0},
		{2, 3, 1},
		{0, 5, 0},
		{7, 0, 0}, // division by zero degrades rather than panicking
	}
	for _, tc := range tests {
		if got := DivRound(tc.n, tc.d); got != tc.want {
			t.Errorf("DivRound(%d, %d) = %d, want %d", tc.n, tc.d, got, tc.want)
		}
	}
}

func TestDivRound_RefundMirrorsSale(t *testing.T) {
	// Property: whatever rounding a sale gets, the refund gets the negative of
	// exactly the same number, so the pair nets to zero.
	for n := int64(-1000); n <= 1000; n += 7 {
		for _, d := range []int64{3, 7, 100, 11500} {
			if DivRound(n, d) != -DivRound(-n, d) {
				t.Fatalf("asymmetric rounding at n=%d d=%d: %d vs %d",
					n, d, DivRound(n, d), -DivRound(-n, d))
			}
		}
	}
}
