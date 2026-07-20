package bizday

// These tests describe the trading day for stores that are NOT in the timezone
// the developer happened to be sitting in.
//
// Africa/Johannesburg appears here, and only here, as a test fixture — it is
// the zone the product used to assume, so it belongs in the tests that prove
// the assumption is gone. Alongside it are zones that break the assumption in
// the other direction (America/Los_Angeles, UTC−8, where a UTC day boundary
// lands at 16:00 — mid-service) and zones with fractional and DST offsets.

import (
	"testing"
	"time"
)

func TestZone(t *testing.T) {
	t.Run("resolves real IANA names", func(t *testing.T) {
		for _, name := range []string{
			"Africa/Johannesburg", "America/New_York", "Asia/Tokyo",
			"Europe/Lisbon", "Australia/Adelaide", "Pacific/Chatham",
		} {
			if got := Zone(name); got == nil || got.String() != name {
				t.Errorf("Zone(%q) = %v, want a location named %q", name, got, name)
			}
		}
	})

	t.Run("empty falls back to UTC", func(t *testing.T) {
		if got := Zone(""); got != time.UTC {
			t.Errorf("Zone(\"\") = %v, want UTC", got)
		}
	})

	t.Run("unknown names fall back to UTC rather than failing", func(t *testing.T) {
		// A store with a typo'd timezone must still be able to take money.
		for _, bad := range []string{"Africa/Johanesburg", "SAST", "+02:00", "nonsense"} {
			if got := Zone(bad); got != time.UTC {
				t.Errorf("Zone(%q) = %v, want UTC fallback", bad, got)
			}
		}
	})

	t.Run("never returns nil", func(t *testing.T) {
		if Zone("garbage") == nil {
			t.Fatal("Zone must never return nil — callers pass it straight to time.Date")
		}
	})

	t.Run("strict form reports the error for settings validation", func(t *testing.T) {
		if _, err := ZoneStrict("Africa/Johanesburg"); err == nil {
			t.Error("ZoneStrict must reject an unknown zone so bad settings fail at write time")
		}
		if _, err := ZoneStrict("Asia/Tokyo"); err != nil {
			t.Errorf("ZoneStrict(Asia/Tokyo) errored: %v", err)
		}
	})
}

// TestBounds_LocalNotUTC is the core regression test: the day boundary must be
// local midnight, not UTC midnight.
func TestBounds_LocalNotUTC(t *testing.T) {
	tests := []struct {
		name string
		zone string
		// instant under test, in UTC
		utc time.Time
		// the local calendar date it should belong to
		wantDate string
	}{
		{
			// 22:30 UTC on the 20th is 00:30 on the 21st in Johannesburg.
			// The old UTC-based code filed this under the 20th.
			name: "Johannesburg after local midnight", zone: "Africa/Johannesburg",
			utc:      time.Date(2026, 7, 20, 22, 30, 0, 0, time.UTC),
			wantDate: "2026-07-21",
		},
		{
			// 02:00 UTC on the 21st is 19:00 on the 20th in Los Angeles —
			// the middle of dinner service. UTC bounds would have already
			// rolled the day over and reset the order counter.
			name: "Los Angeles during evening service", zone: "America/Los_Angeles",
			utc:      time.Date(2026, 7, 21, 2, 0, 0, 0, time.UTC),
			wantDate: "2026-07-20",
		},
		{
			// Tokyo is UTC+9: 16:00 UTC is already the next day.
			name: "Tokyo after local midnight", zone: "Asia/Tokyo",
			utc:      time.Date(2026, 7, 20, 16, 0, 0, 0, time.UTC),
			wantDate: "2026-07-21",
		},
		{
			// A fractional offset (UTC+5:45) — the kind of zone that breaks
			// any "just add hours" shortcut.
			name: "Kathmandu fractional offset", zone: "Asia/Kathmandu",
			utc:      time.Date(2026, 7, 20, 18, 30, 0, 0, time.UTC),
			wantDate: "2026-07-21",
		},
		{
			name: "UTC itself", zone: "UTC",
			utc:      time.Date(2026, 7, 20, 22, 30, 0, 0, time.UTC),
			wantDate: "2026-07-20",
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			loc := Zone(tc.zone)
			start, end := Bounds(tc.utc, loc)

			if got := start.In(loc).Format("2006-01-02"); got != tc.wantDate {
				t.Errorf("day start is %s, want the local day %s", got, tc.wantDate)
			}
			if got := Date(tc.utc, loc); got != tc.wantDate {
				t.Errorf("Date() = %s, want %s", got, tc.wantDate)
			}

			// The boundaries must be local midnight.
			ls := start.In(loc)
			if ls.Hour() != 0 || ls.Minute() != 0 || ls.Second() != 0 {
				t.Errorf("day start %v is not local midnight", ls)
			}

			// The instant must fall inside its own half-open day.
			if tc.utc.Before(start) || !tc.utc.Before(end) {
				t.Errorf("instant %v not within [%v, %v)", tc.utc, start, end)
			}
		})
	}
}

// TestBounds_HalfOpenTiling checks that consecutive days abut exactly, so an
// order at midnight is counted once and never twice.
func TestBounds_HalfOpenTiling(t *testing.T) {
	loc := Zone("America/New_York")
	day1 := time.Date(2026, 3, 10, 12, 0, 0, 0, loc)
	_, end1 := Bounds(day1, loc)

	start2, _ := Bounds(end1, loc)
	if !start2.Equal(end1) {
		t.Errorf("day 2 starts at %v but day 1 ended at %v — days must tile exactly", start2, end1)
	}

	// The boundary instant belongs to the later day, not the earlier one.
	s1, e1 := Bounds(day1, loc)
	if !e1.After(s1) {
		t.Fatal("end must be after start")
	}
	if e1.Before(end1) || e1.After(end1) {
		t.Error("Bounds is not deterministic")
	}
}

// TestBounds_DST covers the two nights a year when a local day is not 24 hours
// long. Computing the end with AddDate on the local date gets this right;
// adding a fixed 24h does not.
func TestBounds_DST(t *testing.T) {
	tests := []struct {
		name      string
		zone      string
		local     time.Time
		wantHours float64
	}{
		{
			// US spring forward, 2026-03-08: 23-hour day.
			name: "spring forward loses an hour", zone: "America/New_York",
			local: time.Date(2026, 3, 8, 12, 0, 0, 0, time.UTC), wantHours: 23,
		},
		{
			// US fall back, 2026-11-01: 25-hour day.
			name: "fall back gains an hour", zone: "America/New_York",
			local: time.Date(2026, 11, 1, 12, 0, 0, 0, time.UTC), wantHours: 25,
		},
		{
			// A zone with no DST at all is always 24 hours.
			name: "no-DST zone is always 24h", zone: "Africa/Johannesburg",
			local: time.Date(2026, 3, 8, 12, 0, 0, 0, time.UTC), wantHours: 24,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			loc := Zone(tc.zone)
			start, end := Bounds(tc.local, loc)
			if got := end.Sub(start).Hours(); got != tc.wantHours {
				t.Errorf("day length = %.0fh, want %.0fh — a fixed 24h AddDate would have given 24",
					got, tc.wantHours)
			}
			// Both ends must still be local midnight despite the shift.
			if h := start.In(loc).Hour(); h != 0 {
				t.Errorf("start hour = %d, want 0", h)
			}
			if h := end.In(loc).Hour(); h != 0 {
				t.Errorf("end hour = %d, want 0", h)
			}
		})
	}
}

func TestBoundsFor_ExplicitDate(t *testing.T) {
	loc := Zone("Europe/Lisbon")
	start, end := BoundsFor(2026, time.July, 20, loc)

	if got := start.In(loc).Format("2006-01-02 15:04"); got != "2026-07-20 00:00" {
		t.Errorf("start = %s, want 2026-07-20 00:00", got)
	}
	if got := end.In(loc).Format("2006-01-02 15:04"); got != "2026-07-21 00:00" {
		t.Errorf("end = %s, want 2026-07-21 00:00", got)
	}
}

func TestRangeBounds(t *testing.T) {
	loc := Zone("Asia/Tokyo")
	from := time.Date(2026, 7, 20, 15, 0, 0, 0, loc)
	to := time.Date(2026, 7, 22, 9, 0, 0, 0, loc)

	start, end := RangeBounds(from, to, loc)

	if got := start.In(loc).Format("2006-01-02 15:04"); got != "2026-07-20 00:00" {
		t.Errorf("range start = %s, want the 20th at local midnight", got)
	}
	// `to` is inclusive as a day, so the range ends at the start of the 23rd.
	if got := end.In(loc).Format("2006-01-02 15:04"); got != "2026-07-23 00:00" {
		t.Errorf("range end = %s, want the 23rd at local midnight (the 22nd is included)", got)
	}

	t.Run("a single day", func(t *testing.T) {
		s, e := RangeBounds(from, from, loc)
		if e.Sub(s).Hours() != 24 {
			t.Errorf("same-day range = %v, want 24h", e.Sub(s))
		}
	})

	t.Run("reversed inputs are normalised", func(t *testing.T) {
		s, e := RangeBounds(to, from, loc)
		if !e.After(s) {
			t.Error("RangeBounds must return start before end even for reversed input")
		}
	})
}

func TestSameDay(t *testing.T) {
	jhb := Zone("Africa/Johannesburg")
	la := Zone("America/Los_Angeles")

	// 22:00 and 23:00 UTC on the 20th: the same UTC day, but in Johannesburg
	// they are 00:00 and 01:00 on the 21st — still the same local day.
	a := time.Date(2026, 7, 20, 22, 0, 0, 0, time.UTC)
	b := time.Date(2026, 7, 20, 23, 0, 0, 0, time.UTC)
	if !SameDay(a, b, jhb) {
		t.Error("22:00 and 23:00 UTC are the same day in Johannesburg")
	}

	// 21:00 UTC on the 20th and 01:00 UTC on the 21st: different UTC days,
	// but 14:00 and 18:00 on the SAME day in Los Angeles.
	c := time.Date(2026, 7, 20, 21, 0, 0, 0, time.UTC)
	d := time.Date(2026, 7, 21, 1, 0, 0, 0, time.UTC)
	if !SameDay(c, d, la) {
		t.Error("these straddle a UTC midnight but are one trading day in Los Angeles — " +
			"this is exactly the case UTC-based day logic got wrong")
	}
	if SameDay(c, d, time.UTC) {
		t.Error("...and they are correctly different days in UTC")
	}

	t.Run("nil location degrades to UTC", func(t *testing.T) {
		if !SameDay(a, b, nil) {
			t.Error("nil location must behave as UTC, not panic")
		}
	})
}

func TestBounds_NilLocationDoesNotPanic(t *testing.T) {
	start, end := Bounds(time.Now(), nil)
	if !end.After(start) {
		t.Error("nil location must degrade to a valid UTC day")
	}
}
