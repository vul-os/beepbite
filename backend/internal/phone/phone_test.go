package phone

import (
	"errors"
	"testing"
)

// TestNormalize is the contract for this package. The cases are grouped by the
// property they pin down rather than by country, because the countries are
// examples — the rules are what must not regress.
func TestNormalize(t *testing.T) {
	tests := []struct {
		name    string
		raw     string
		cc      string
		want    string
		wantErr error
	}{
		// -------------------------------------------------------------------
		// Already international: the country code is in the input, so the
		// default is irrelevant and must not be applied.
		// -------------------------------------------------------------------
		{name: "e164 passthrough ZA", raw: "+27821234567", cc: "27", want: "+27821234567"},
		{name: "e164 ignores mismatched default", raw: "+27821234567", cc: "1", want: "+27821234567"},
		{name: "e164 with no default at all", raw: "+27821234567", cc: "", want: "+27821234567"},
		{name: "e164 spaced ZA", raw: "+27 82 123 4567", cc: "", want: "+27821234567"},
		{name: "e164 hyphenated US", raw: "+1-212-555-0123", cc: "", want: "+12125550123"},
		{name: "e164 parens US", raw: "+1 (212) 555-0123", cc: "", want: "+12125550123"},
		{name: "e164 spaced UK", raw: "+44 20 7946 0958", cc: "", want: "+442079460958"},
		{name: "e164 dotted PT", raw: "+351.912.345.678", cc: "", want: "+351912345678"},
		{name: "e164 leading and trailing space", raw: "  +27821234567  ", cc: "", want: "+27821234567"},
		{name: "e164 non-breaking space", raw: "+27 82 123 4567", cc: "", want: "+27821234567"},

		// "00" is the ITU international access prefix and carries the same
		// meaning as "+", so the default country must be ignored here too.
		{name: "00 prefix ZA", raw: "0027821234567", cc: "", want: "+27821234567"},
		{name: "00 prefix ignores default", raw: "0027821234567", cc: "44", want: "+27821234567"},
		{name: "00 prefix spaced UK", raw: "00 44 20 7946 0958", cc: "27", want: "+442079460958"},

		// -------------------------------------------------------------------
		// South Africa: national numbers carry a "0" trunk prefix that is not
		// part of the E.164 number and must be dropped, not kept.
		// -------------------------------------------------------------------
		{name: "ZA trunk zero", raw: "0821234567", cc: "27", want: "+27821234567"},
		{name: "ZA trunk zero spaced", raw: "082 123 4567", cc: "27", want: "+27821234567"},
		{name: "ZA trunk zero hyphenated", raw: "082-123-4567", cc: "27", want: "+27821234567"},
		{name: "ZA landline trunk zero", raw: "021 439 1200", cc: "27", want: "+27214391200"},
		{name: "ZA default given with plus", raw: "082 123 4567", cc: "+27", want: "+27821234567"},

		// The four spellings from the package doc must all land on one string —
		// this is the case that stops one customer becoming four customer rows.
		{name: "ZA same customer form 1", raw: "0821234567", cc: "27", want: "+27821234567"},
		{name: "ZA same customer form 2", raw: "082 123 4567", cc: "27", want: "+27821234567"},
		{name: "ZA same customer form 3", raw: "+27 82 123 4567", cc: "27", want: "+27821234567"},
		{name: "ZA same customer form 4", raw: "0027821234567", cc: "27", want: "+27821234567"},

		// -------------------------------------------------------------------
		// United States: the NANP has no trunk prefix, so a 10-digit national
		// number takes the country code directly with nothing stripped.
		// -------------------------------------------------------------------
		{name: "US national plain", raw: "2125550123", cc: "1", want: "+12125550123"},
		{name: "US national parens", raw: "(212) 555-0123", cc: "1", want: "+12125550123"},
		{name: "US national hyphenated", raw: "212-555-0123", cc: "1", want: "+12125550123"},
		{name: "US national dotted", raw: "212.555.0123", cc: "1", want: "+12125550123"},
		{name: "US national spaced", raw: "212 555 0123", cc: "1", want: "+12125550123"},

		// -------------------------------------------------------------------
		// United Kingdom: like ZA, a "0" trunk prefix that must come off.
		// -------------------------------------------------------------------
		{name: "UK london trunk zero", raw: "020 7946 0958", cc: "44", want: "+442079460958"},
		{name: "UK mobile trunk zero", raw: "07700 900123", cc: "44", want: "+447700900123"},
		{name: "UK mobile no spaces", raw: "07700900123", cc: "44", want: "+447700900123"},
		{name: "UK slash separated", raw: "020/7946/0958", cc: "44", want: "+442079460958"},

		// -------------------------------------------------------------------
		// The whole point: no country in the input and none supplied means an
		// error, never a guess. If any of these ever returns a number, this
		// package has started inventing identities.
		// -------------------------------------------------------------------
		{name: "no default trunk zero", raw: "0821234567", cc: "", wantErr: ErrNoCountry},
		{name: "no default plain national", raw: "2125550123", cc: "", wantErr: ErrNoCountry},
		{name: "no default spaced", raw: "082 123 4567", cc: "", wantErr: ErrNoCountry},
		{name: "no default whitespace cc", raw: "0821234567", cc: "   ", wantErr: ErrNoCountry},

		// -------------------------------------------------------------------
		// Rejected input.
		// -------------------------------------------------------------------
		{name: "empty", raw: "", cc: "27", wantErr: ErrEmpty},
		{name: "whitespace only", raw: "   ", cc: "27", wantErr: ErrEmpty},
		{name: "punctuation only", raw: "()- ", cc: "27", wantErr: ErrEmpty},
		{name: "plus only", raw: "+", cc: "27", wantErr: ErrEmpty},
		{name: "letters vanity number", raw: "0800-FLOWERS", cc: "27", wantErr: ErrInvalid},
		{name: "letters mixed in", raw: "+2782123456x", cc: "", wantErr: ErrInvalid},
		{name: "too short international", raw: "+2782", cc: "", wantErr: ErrInvalid},
		{name: "too long international", raw: "+1234567890123456", cc: "", wantErr: ErrInvalid},
		{name: "too short national", raw: "0123", cc: "27", wantErr: ErrInvalid},
		{name: "too long national", raw: "012345678901234", cc: "27", wantErr: ErrInvalid},
		{name: "leading zero after plus", raw: "+0821234567", cc: "", wantErr: ErrInvalid},
		{name: "all zeros national", raw: "0", cc: "27", wantErr: ErrInvalid},
		{name: "country code not numeric", raw: "0821234567", cc: "ZA", wantErr: ErrInvalid},
		{name: "country code too long", raw: "0821234567", cc: "2712", wantErr: ErrInvalid},
		{name: "country code leading zero", raw: "0821234567", cc: "027", wantErr: ErrInvalid},

		// An unprefixed number that already begins with the default country's
		// calling code cannot be read one way or the other, so it is refused
		// rather than resolved. Both readings would produce a well-formed
		// number, which is exactly what makes guessing here dangerous.
		{name: "unprefixed international is ambiguous", raw: "27821234567", cc: "27", wantErr: ErrAmbiguous},
		{name: "unprefixed international ambiguous UK", raw: "442079460958", cc: "44", wantErr: ErrAmbiguous},
		{name: "unprefixed ambiguity needs matching cc", raw: "442079460958", cc: "27", want: "+27442079460958"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := Normalize(tt.raw, tt.cc)

			if tt.wantErr != nil {
				if err == nil {
					t.Fatalf("Normalize(%q, %q) = %q, want error %v", tt.raw, tt.cc, got, tt.wantErr)
				}
				if !errors.Is(err, tt.wantErr) {
					t.Fatalf("Normalize(%q, %q) error = %v, want %v", tt.raw, tt.cc, err, tt.wantErr)
				}
				if got != "" {
					t.Errorf("Normalize(%q, %q) returned %q alongside an error; must return \"\"", tt.raw, tt.cc, got)
				}
				return
			}

			if err != nil {
				t.Fatalf("Normalize(%q, %q) unexpected error: %v", tt.raw, tt.cc, err)
			}
			if got != tt.want {
				t.Fatalf("Normalize(%q, %q) = %q, want %q", tt.raw, tt.cc, got, tt.want)
			}
			if !IsE164(got) {
				t.Errorf("Normalize(%q, %q) = %q which is not valid E.164", tt.raw, tt.cc, got)
			}
		})
	}
}

// TestNormalizeIsIdempotent guards the property every caller relies on: it is
// always safe to normalise again. A store that normalises on write and a
// migration that normalises existing rows must not disagree.
func TestNormalizeIdempotent(t *testing.T) {
	inputs := []struct{ raw, cc string }{
		{"082 123 4567", "27"},
		{"(212) 555-0123", "1"},
		{"07700 900123", "44"},
		{"00351912345678", ""},
	}

	for _, in := range inputs {
		once, err := Normalize(in.raw, in.cc)
		if err != nil {
			t.Fatalf("Normalize(%q, %q): %v", in.raw, in.cc, err)
		}
		// Re-normalising with no country at all must still work: an E.164
		// string carries its own country, so the second pass needs no context.
		twice, err := Normalize(once, "")
		if err != nil {
			t.Fatalf("re-Normalize(%q, \"\"): %v", once, err)
		}
		if twice != once {
			t.Errorf("Normalize not idempotent: %q → %q → %q", in.raw, once, twice)
		}
	}
}

func TestIsE164(t *testing.T) {
	tests := []struct {
		name string
		in   string
		want bool
	}{
		{name: "ZA mobile", in: "+27821234567", want: true},
		{name: "US", in: "+12125550123", want: true},
		{name: "UK", in: "+442079460958", want: true},
		{name: "PT", in: "+351912345678", want: true},
		{name: "JP", in: "+81312345678", want: true},
		{name: "shortest allowed", in: "+2901234", want: true},
		{name: "longest allowed", in: "+123456789012345", want: true},

		{name: "empty", in: "", want: false},
		{name: "plus only", in: "+", want: false},
		{name: "no plus", in: "27821234567", want: false},
		{name: "spaces inside", in: "+27 82 123 4567", want: false},
		{name: "hyphens inside", in: "+27-82-123-4567", want: false},
		{name: "leading space", in: " +27821234567", want: false},
		{name: "trailing space", in: "+27821234567 ", want: false},
		{name: "letters", in: "+2782123456a", want: false},
		{name: "zero country code", in: "+0821234567", want: false},
		{name: "too short", in: "+271234", want: false},
		{name: "too long", in: "+1234567890123456", want: false},
		{name: "double plus", in: "++27821234567", want: false},
		{name: "00 prefix is not e164", in: "0027821234567", want: false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := IsE164(tt.in); got != tt.want {
				t.Errorf("IsE164(%q) = %v, want %v", tt.in, got, tt.want)
			}
		})
	}
}

// TestNoImplicitDefaultCountry is the regression guard for the bug this package
// was written to prevent. If someone ever adds a fallback country constant,
// these calls start succeeding and this test starts failing.
func TestNoImplicitDefaultCountry(t *testing.T) {
	nationalForms := []string{
		"0821234567",     // reads as ZA under a ZA default
		"2125550123",     // reads as US under a US default
		"07700900123",    // reads as UK under a UK default
		"912345678",      // reads as PT under a PT default
		"06 12 34 56 78", // reads as FR under a FR default
	}

	for _, raw := range nationalForms {
		got, err := Normalize(raw, "")
		if err == nil {
			t.Errorf("Normalize(%q, \"\") = %q — a country was guessed; it must error instead", raw, got)
			continue
		}
		if !errors.Is(err, ErrNoCountry) {
			t.Errorf("Normalize(%q, \"\") error = %v, want ErrNoCountry", raw, err)
		}
	}
}

func TestMustNormalize(t *testing.T) {
	if got := MustNormalize("082 123 4567", "27"); got != "+27821234567" {
		t.Errorf("MustNormalize = %q, want %q", got, "+27821234567")
	}

	defer func() {
		if recover() == nil {
			t.Error("MustNormalize did not panic on invalid input")
		}
	}()
	MustNormalize("0821234567", "")
}
