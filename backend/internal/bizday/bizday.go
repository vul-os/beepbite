// Package bizday answers one question correctly: which trading day does this
// instant belong to?
//
// A restaurant's day is not a UTC day. It is the day in the wall-clock time of
// the room the till is standing in. Get this wrong and the damage is quiet but
// real:
//
//   - the daily order-number counter resets mid-service instead of overnight;
//   - the cash-drawer close and the Z-report cover different sets of orders;
//   - a shift that starts at 18:00 and ends at 02:00 gets split across two
//     payroll days, or merged into one;
//   - "today's sales" on the dashboard disagrees with the paper in the drawer.
//
// BeepBite previously computed every boundary in UTC. For a store in
// Johannesburg (UTC+2) that reset the counters at 02:00 — annoying but nearly
// invisible, which is why it survived. For a store in Los Angeles (UTC−8) it
// puts the boundary at 16:00, right in the middle of dinner service.
//
// Timestamps stay stored in UTC (timestamptz). Only the *boundaries* are
// computed in the location's zone, which is the correct division of labour:
// instants are absolute, days are local.
package bizday

import (
	"sync"
	"time"
)

// UTC is the neutral fallback zone, used when a location has no timezone
// configured yet.
//
// It is deliberately not a real business timezone: UTC is visibly "unset" to an
// operator looking at their reports, whereas defaulting to any populated zone
// would produce boundaries that look plausible and are wrong.
const UTC = "UTC"

// zoneCache memoises time.LoadLocation, which reads and parses the tzdata file
// on every call. Day boundaries are computed on hot paths (every order number,
// every dashboard tile), and the zone set per deployment is tiny.
var zoneCache sync.Map // string → *time.Location

// Zone resolves an IANA timezone name ("America/New_York", "Asia/Tokyo") to a
// *time.Location, falling back to UTC for an empty or unknown name.
//
// It never returns nil and never returns an error: a store with a typo'd
// timezone must still be able to take money. The fallback is silent by design
// at this layer — callers that want to alert on it should use ZoneStrict.
func Zone(name string) *time.Location {
	if name == "" {
		return time.UTC
	}
	if v, ok := zoneCache.Load(name); ok {
		return v.(*time.Location)
	}
	loc, err := time.LoadLocation(name)
	if err != nil {
		zoneCache.Store(name, time.UTC)
		return time.UTC
	}
	zoneCache.Store(name, loc)
	return loc
}

// ZoneStrict is Zone but reports whether the name was actually recognised, for
// the settings-validation path where a bad timezone should be rejected at write
// time rather than discovered at midnight.
func ZoneStrict(name string) (*time.Location, error) {
	if name == "" {
		return time.UTC, nil
	}
	return time.LoadLocation(name)
}

// Bounds returns the half-open interval [start, end) of the local calendar day
// containing t, expressed as absolute instants.
//
// The interval is half-open so that consecutive days tile the timeline exactly
// once — an order at precisely midnight belongs to the day starting then, and
// to no other. SQL callers should therefore use `created_at >= $start AND
// created_at < $end`, never BETWEEN, which is inclusive at both ends and would
// double-count that order.
//
// DST is handled by construction rather than by arithmetic: the end is computed
// with AddDate on the local date, so a 23- or 25-hour day comes out with the
// right length. Adding 24h instead would land an hour early or late twice a
// year, silently moving orders between days on exactly the two nights an
// operator is least likely to be checking.
func Bounds(t time.Time, loc *time.Location) (start, end time.Time) {
	if loc == nil {
		loc = time.UTC
	}
	local := t.In(loc)
	y, m, d := local.Date()
	start = time.Date(y, m, d, 0, 0, 0, 0, loc)
	end = time.Date(y, m, d+1, 0, 0, 0, 0, loc)
	return start, end
}

// BoundsFor is Bounds for a calendar date given as year/month/day in `loc`,
// for callers that already hold a date (a report's "2026-07-20") rather than an
// instant.
func BoundsFor(y int, m time.Month, d int, loc *time.Location) (start, end time.Time) {
	if loc == nil {
		loc = time.UTC
	}
	start = time.Date(y, m, d, 0, 0, 0, 0, loc)
	end = time.Date(y, m, d+1, 0, 0, 0, 0, loc)
	return start, end
}

// Date returns the local calendar date of t as "2006-01-02".
//
// This is the string to store in a bare `date` column (tip_pools.shift_date,
// timeclock work_date) and to compare daily counters against. Deriving it from
// t.UTC() instead — the pattern this package replaces — labels the evening of
// the 20th in Los Angeles as the 21st.
func Date(t time.Time, loc *time.Location) string {
	if loc == nil {
		loc = time.UTC
	}
	return t.In(loc).Format("2006-01-02")
}

// RangeBounds returns [start, end) spanning the local days from `from` through
// `to` inclusive, for report windows given as two dates.
//
// `to` is inclusive as a *day* — passing the same date twice yields that single
// day — while the returned instant interval remains half-open.
func RangeBounds(from, to time.Time, loc *time.Location) (start, end time.Time) {
	start, _ = Bounds(from, loc)
	_, end = Bounds(to, loc)
	if end.Before(start) {
		start, end = end, start
	}
	return start, end
}

// SameDay reports whether two instants fall on the same local calendar day in
// loc — the check behind "has this counter already been reset today?".
func SameDay(a, b time.Time, loc *time.Location) bool {
	if loc == nil {
		loc = time.UTC
	}
	ay, am, ad := a.In(loc).Date()
	by, bm, bd := b.In(loc).Date()
	return ay == by && am == bm && ad == bd
}
