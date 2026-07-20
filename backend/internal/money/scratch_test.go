package money

import "testing"

func TestScratch(t *testing.T) {
	cases := []struct{ minor int64; code string; dec int; loc string }{
		{1250, "USD", 2, "en-US"},
		{1250, "ZAR", 2, "en-ZA"},
		{1000, "JPY", 0, "ja-JP"},
		{1234, "KWD", 3, "ar-KW"},
		{1250, "EUR", 2, "de-DE"},
		{1250, "USD", 2, ""},
		{123456789, "USD", 2, "en-US"},
		{-50, "USD", 2, "en-US"},
	}
	for _, c := range cases {
		t.Logf("%d %s dec=%d loc=%q => Format=%q FormatCode=%q Decimal=%q",
			c.minor, c.code, c.dec, c.loc,
			Format(c.minor, c.code, c.dec, c.loc),
			FormatCode(c.minor, c.code, c.dec, c.loc),
			Decimal(c.minor, c.dec))
	}
	for _, s := range []string{"12.50", "1,234.50", "1 000,50", "1234", "R 12.50", "12.345"} {
		v, err := Parse(s, 2)
		t.Logf("Parse(%q,2) = %d, %v", s, v, err)
	}
	v, err := Parse("1000", 0); t.Logf("JPY Parse(1000,0)=%d %v", v, err)
	v, err = Parse("1.234", 3); t.Logf("KWD Parse(1.234,3)=%d %v", v, err)
}
