package tax

// The central test here is TestCompute_InclusiveVsExclusive: the same amount
// and the same rate must produce DIFFERENT totals under the two conventions.
// If that test ever passes with the two branches returning equal results, the
// inclusive/exclusive setting has stopped being wired to anything.

import "testing"

func TestRateFromPercent(t *testing.T) {
	tests := []struct {
		name string
		pct  float64
		want BasisPoints
	}{
		{"South African / Portuguese-style whole percent", 15.00, 1500},
		{"EU standard rate", 23.00, 2300},
		{"a US municipal rate with two decimals", 8.88, 888},
		{"zero is a real rate, not 'unset'", 0.00, 0},
		{"fractional", 7.25, 725},
		{"max", 100.00, 10000},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := RateFromPercent(tc.pct); got != tc.want {
				t.Errorf("RateFromPercent(%v) = %d, want %d", tc.pct, got, tc.want)
			}
		})
	}
}

func TestBasisPoints_PercentRoundTrip(t *testing.T) {
	for _, pct := range []float64{0, 5, 7.25, 8.88, 15, 20, 23, 100} {
		bp := RateFromPercent(pct)
		if got := bp.Percent(); got != pct {
			t.Errorf("round trip %v%% → %d bp → %v%%", pct, bp, got)
		}
	}
}

// TestCompute_InclusiveVsExclusive is the reason this package exists.
//
// At 15% on 115.00:
//   - inclusive, the customer pays 115.00 and 15.00 of it is tax;
//   - exclusive, the customer pays 132.25 and 17.25 of it is tax.
//
// Hardcoding either one silently overcharges customers in half the world or
// under-remits to the revenue service in the other half.
func TestCompute_InclusiveVsExclusive(t *testing.T) {
	const amount int64 = 11500 // 115.00 in a 2-decimal currency
	rate := RateFromPercent(15)

	inc := Compute(amount, rate, true)
	exc := Compute(amount, rate, false)

	t.Run("inclusive extracts tax from the amount", func(t *testing.T) {
		if inc.Gross != 11500 {
			t.Errorf("Gross = %d, want 11500 (the customer pays the shelf price)", inc.Gross)
		}
		if inc.Tax != 1500 {
			t.Errorf("Tax = %d, want 1500 (115 × 15/115)", inc.Tax)
		}
		if inc.Net != 10000 {
			t.Errorf("Net = %d, want 10000", inc.Net)
		}
	})

	t.Run("exclusive adds tax on top", func(t *testing.T) {
		if exc.Net != 11500 {
			t.Errorf("Net = %d, want 11500 (the shelf price is the taxable base)", exc.Net)
		}
		if exc.Tax != 1725 {
			t.Errorf("Tax = %d, want 1725 (115 × 15%%)", exc.Tax)
		}
		if exc.Gross != 13225 {
			t.Errorf("Gross = %d, want 13225", exc.Gross)
		}
	})

	t.Run("the two conventions genuinely differ", func(t *testing.T) {
		if inc.Gross == exc.Gross {
			t.Fatal("inclusive and exclusive produced the same total — " +
				"the tax_inclusive setting is not wired to the calculation")
		}
		if inc.Tax == exc.Tax {
			t.Fatal("inclusive and exclusive produced the same tax")
		}
	})
}

// TestCompute_ComponentsAlwaysReconcile guards the invariant that makes a
// receipt add up: Net + Tax == Gross, exactly, for every input.
func TestCompute_ComponentsAlwaysReconcile(t *testing.T) {
	rates := []BasisPoints{0, 1, 500, 725, 888, 1500, 2000, 2300, 10000}
	amounts := []int64{0, 1, 7, 99, 100, 333, 1250, 11500, 999999, -1250, -11500}

	for _, rate := range rates {
		for _, amt := range amounts {
			for _, inclusive := range []bool{true, false} {
				r := Compute(amt, rate, inclusive)
				if r.Net+r.Tax != r.Gross {
					t.Errorf("amount=%d rate=%d inclusive=%v: Net(%d)+Tax(%d) != Gross(%d)",
						amt, rate, inclusive, r.Net, r.Tax, r.Gross)
				}
			}
		}
	}
}

func TestCompute_ZeroRateIsTaxFree(t *testing.T) {
	// A location that has configured no tax must be charged no tax — the code
	// must never fall back to a jurisdiction's rate.
	for _, rate := range []BasisPoints{0, -100} {
		r := Compute(11500, rate, true)
		if r.Tax != 0 || r.Net != 11500 || r.Gross != 11500 {
			t.Errorf("rate=%d gave %+v, want zero tax and amount passed through", rate, r)
		}
		r = Compute(11500, rate, false)
		if r.Tax != 0 || r.Gross != 11500 {
			t.Errorf("rate=%d exclusive gave %+v, want zero tax", rate, r)
		}
	}
}

// TestCompute_RefundMirrorsSale checks that a negative amount produces the
// exact negative of the positive case, so a full refund nets to zero cents.
func TestCompute_RefundMirrorsSale(t *testing.T) {
	rate := RateFromPercent(15)
	for _, amt := range []int64{1, 33, 999, 1250, 11500, 78633} {
		for _, inclusive := range []bool{true, false} {
			sale := Compute(amt, rate, inclusive)
			refund := Compute(-amt, rate, inclusive)
			if sale.Tax != -refund.Tax {
				t.Errorf("amount=%d inclusive=%v: sale tax %d, refund tax %d — refund must mirror",
					amt, inclusive, sale.Tax, refund.Tax)
			}
			if sale.Gross != -refund.Gross {
				t.Errorf("amount=%d inclusive=%v: gross %d vs %d", amt, inclusive, sale.Gross, refund.Gross)
			}
		}
	}
}

func TestCompute_RoundingIsHalfAwayFromZero(t *testing.T) {
	// 10 at 5% exclusive is 0.5 → 1, not 0.
	if got := Compute(10, RateFromPercent(5), false).Tax; got != 1 {
		t.Errorf("Compute(10, 5%%, exclusive).Tax = %d, want 1 (0.5 rounds away from zero)", got)
	}
	// The inclusive mirror of the same edge.
	if got := Compute(-10, RateFromPercent(5), false).Tax; got != -1 {
		t.Errorf("Compute(-10, 5%%, exclusive).Tax = %d, want -1", got)
	}
}

func TestCompute_ZeroDecimalCurrency(t *testing.T) {
	// JPY: 1000 minor units is ¥1000. At 10% inclusive the tax is ¥91
	// (1000 × 1000/11000 = 90.9…), a whole yen — there are no sen to round to.
	r := Compute(1000, RateFromPercent(10), true)
	if r.Tax != 91 {
		t.Errorf("JPY inclusive tax = %d, want 91", r.Tax)
	}
	if r.Net+r.Tax != 1000 {
		t.Errorf("components must reconcile: %+v", r)
	}
}

func TestExtractAndAdd_MatchCompute(t *testing.T) {
	rate := RateFromPercent(20)
	if Extract(12000, rate) != Compute(12000, rate, true) {
		t.Error("Extract must equal Compute(..., true)")
	}
	if Add(12000, rate) != Compute(12000, rate, false) {
		t.Error("Add must equal Compute(..., false)")
	}
}

func TestConfig(t *testing.T) {
	t.Run("zero config charges nothing", func(t *testing.T) {
		var c Config
		r := c.Compute(11500)
		if r.Tax != 0 {
			t.Errorf("an unconfigured location must charge no tax, got %d", r.Tax)
		}
	})

	t.Run("label defaults to the generic word, not VAT", func(t *testing.T) {
		var c Config
		if got := c.EffectiveLabel(); got != "Tax" {
			t.Errorf("EffectiveLabel() = %q, want %q — VAT does not exist in every jurisdiction", got, "Tax")
		}
	})

	t.Run("configured label is used verbatim", func(t *testing.T) {
		for _, label := range []string{"VAT", "GST", "Sales Tax", "Consumption Tax"} {
			c := Config{Label: label}
			if got := c.EffectiveLabel(); got != label {
				t.Errorf("EffectiveLabel() = %q, want %q", got, label)
			}
		}
	})

	t.Run("config drives the convention", func(t *testing.T) {
		incl := Config{Rate: RateFromPercent(15), Inclusive: true}.Compute(11500)
		excl := Config{Rate: RateFromPercent(15), Inclusive: false}.Compute(11500)
		if incl.Gross == excl.Gross {
			t.Error("Config.Inclusive is not affecting the computation")
		}
	})
}
