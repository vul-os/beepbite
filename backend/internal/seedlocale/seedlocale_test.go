package seedlocale

import (
	"testing"
)

// TestDefaultsAreReserved is the guard on the thing that makes seeded data safe
// to run against a staging environment with live credentials: the defaults must
// stay reserved codes, not a real country's.
func TestDefaultsAreReserved(t *testing.T) {
	t.Setenv("SEED_COUNTRY", "")
	c := mustLoadClean(t)

	if c.Currency != "XTS" {
		t.Errorf("default currency = %q, want XTS (ISO 4217 test code)", c.Currency)
	}
	if c.PhoneCC != "999" {
		t.Errorf("default phone cc = %q, want 999 (ITU-reserved)", c.PhoneCC)
	}
	if c.Country != "ZZ" {
		t.Errorf("default country = %q, want ZZ (ISO 3166 user-assigned)", c.Country)
	}
	if c.Timezone != "UTC" {
		t.Errorf("default timezone = %q, want UTC", c.Timezone)
	}
	if c.Locale != "" {
		t.Errorf("default locale = %q, want empty (CLDR root)", c.Locale)
	}

	// A seeded number must not be dialable. +999 is unassigned, so this holds
	// by construction — but only while the default dial code stays reserved.
	if got := c.Phone(1); got != "+9995550000001" {
		t.Errorf("Phone(1) = %q, want +9995550000001", got)
	}
	if got := c.Email("owner"); got != "owner@example.com" {
		t.Errorf("Email = %q, want owner@example.com (RFC 2606 reserved)", got)
	}
}

// TestPriceRespectsCurrencyExponent is the regression guard for the /100 bug.
// The same authored literal must mean the same amount of money in every
// currency, which means a different integer in each.
func TestPriceRespectsCurrencyExponent(t *testing.T) {
	tests := []struct {
		currency  string
		decimals  int
		reference int64 // authored in 2-decimal cents: 4500 == "45.00"
		want      int64
	}{
		{currency: "USD", decimals: 2, reference: 4500, want: 4500},
		{currency: "JPY", decimals: 0, reference: 4500, want: 45},    // ¥45, not ¥4500
		{currency: "KWD", decimals: 3, reference: 4500, want: 45000}, // KD 45.000
		{currency: "XTS", decimals: 2, reference: 12345, want: 12345},
		// Rounds half away from zero, matching the tax engine.
		{currency: "JPY", decimals: 0, reference: 4550, want: 46},
		{currency: "JPY", decimals: 0, reference: 4549, want: 45},
	}

	for _, tt := range tests {
		c := Config{Currency: tt.currency, Decimals: tt.decimals}
		if got := c.Price(tt.reference); got != tt.want {
			t.Errorf("%s Price(%d) = %d, want %d", tt.currency, tt.reference, got, tt.want)
		}
	}
}

// TestTaxFollowsConvention proves both directions work, since the seeders
// previously only ever computed the inclusive one.
func TestTaxFollowsConvention(t *testing.T) {
	t.Setenv("SEED_TAX_RATE", "10")
	t.Setenv("SEED_TAX_INCLUSIVE", "true")
	inc := mustLoadClean(t)

	// 1100 gross at 10% inclusive → 1000 net + 100 tax.
	r := inc.TaxOn(1100)
	if r.Net != 1000 || r.Tax != 100 || r.Gross != 1100 {
		t.Errorf("inclusive TaxOn(1100) = net %d tax %d gross %d, want 1000/100/1100", r.Net, r.Tax, r.Gross)
	}

	t.Setenv("SEED_TAX_INCLUSIVE", "false")
	exc := mustLoadClean(t)

	// 1000 net at 10% exclusive → 1000 net + 100 tax = 1100 gross.
	r = exc.TaxOn(1000)
	if r.Net != 1000 || r.Tax != 100 || r.Gross != 1100 {
		t.Errorf("exclusive TaxOn(1000) = net %d tax %d gross %d, want 1000/100/1100", r.Net, r.Tax, r.Gross)
	}
}

// TestPhoneLikeMatchesPhone is the property the SQL self-checks depend on. If
// these ever drift apart, seed.sql counts zero rows and reports success.
func TestPhoneLikeMatchesPhone(t *testing.T) {
	for _, cc := range []string{"999", "27", "1", "351"} {
		c := Config{PhoneCC: cc}
		prefix := c.PhoneLike()
		if prefix == "" || prefix[len(prefix)-1] != '%' {
			t.Fatalf("PhoneLike(%s) = %q, want a trailing %%", cc, prefix)
		}
		stem := prefix[:len(prefix)-1]
		for _, seq := range []int{0, 1, 42, 999999} {
			got := c.Phone(seq)
			if len(got) < len(stem) || got[:len(stem)] != stem {
				t.Errorf("Phone(%d)=%q does not match PhoneLike pattern %q", seq, got, prefix)
			}
		}
	}
}

// TestPhoneIsDeterministic — re-running a seeder must produce the same numbers,
// or ON CONFLICT clauses keyed on the phone stop being idempotent.
func TestPhoneIsDeterministic(t *testing.T) {
	c := Config{PhoneCC: "999"}
	if c.Phone(7) != c.Phone(7) {
		t.Error("Phone is not deterministic")
	}
	if c.Phone(7) == c.Phone(8) {
		t.Error("Phone collides across distinct seq values")
	}
}

func TestLoadRejectsBadInput(t *testing.T) {
	cases := []struct{ key, val string }{
		{"SEED_TAX_RATE", "fifteen"},
		{"SEED_TAX_INCLUSIVE", "maybe"},
		{"SEED_CURRENCY_DECIMALS", "two"},
		{"SEED_CURRENCY_DECIMALS", "9"},
		{"SEED_COUNTRY", "ZAF"},
	}
	for _, tc := range cases {
		t.Run(tc.key+"="+tc.val, func(t *testing.T) {
			t.Setenv(tc.key, tc.val)
			if _, err := Load(); err == nil {
				t.Errorf("Load() with %s=%q succeeded; want an error rather than a silent fallback", tc.key, tc.val)
			}
		})
	}
}

func TestDecimalsDerivedFromCurrency(t *testing.T) {
	for currency, want := range map[string]int{
		"JPY": 0, "KRW": 0, "XOF": 0,
		"KWD": 3, "BHD": 3,
		"USD": 2, "ZAR": 2, "XTS": 2, "ZZZ": 2,
	} {
		t.Setenv("SEED_CURRENCY", currency)
		c := mustLoadClean(t)
		if c.Decimals != want {
			t.Errorf("%s decimals = %d, want %d", currency, c.Decimals, want)
		}
	}
}

// mustLoadClean loads a Config, failing the test on error.
func mustLoadClean(t *testing.T) Config {
	t.Helper()
	c, err := Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	return c
}
