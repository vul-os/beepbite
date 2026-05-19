// Package tippools — distribution engine.
// All arithmetic is done in int64 cents. Fractional shares are floored; any
// remainder (due to rounding) is credited to the highest-weight recipient.
package tippools

import (
	"errors"
	"math"
	"sort"
)

// Recipient describes one staff member that will receive a share of the pool.
type Recipient struct {
	StaffID     string
	Role        string  // populated by store for role_weighted
	HoursWorked float64 // used by hours_weighted
	WeightPts   float64 // used by points_weighted / role_weighted
}

// Share is the computed payout for one recipient.
type Share struct {
	StaffID     string
	AmountCents int64
	HoursWorked float64
	WeightPts   float64
}

// Distribute computes how totalCents should be split among recipients
// according to ruleType and the pool's config (used by role_weighted).
// It always returns exactly len(recipients) shares that sum to totalCents.
func Distribute(
	ruleType string,
	config map[string]any,
	totalCents int64,
	recipients []Recipient,
) ([]Share, error) {
	if len(recipients) == 0 {
		return nil, errors.New("at least one recipient is required")
	}
	if totalCents <= 0 {
		return nil, errors.New("total_cents must be positive")
	}

	switch ruleType {
	case "equal_split":
		return equalSplit(totalCents, recipients)
	case "hours_weighted":
		return hoursWeighted(totalCents, recipients)
	case "points_weighted":
		return pointsWeighted(totalCents, recipients)
	case "role_weighted":
		return roleWeighted(totalCents, recipients, config)
	default:
		return nil, errors.New("unknown rule_type: " + ruleType)
	}
}

// equalSplit divides totalCents as evenly as possible. Remainder cents are
// given one each to the first recipients in the list.
func equalSplit(totalCents int64, rs []Recipient) ([]Share, error) {
	n := int64(len(rs))
	base := totalCents / n
	remainder := totalCents - base*n

	shares := make([]Share, len(rs))
	for i, r := range rs {
		extra := int64(0)
		if int64(i) < remainder {
			extra = 1
		}
		shares[i] = Share{
			StaffID:     r.StaffID,
			AmountCents: base + extra,
			HoursWorked: r.HoursWorked,
			WeightPts:   r.WeightPts,
		}
	}
	return shares, nil
}

// hoursWeighted splits by fraction of total hours worked.
// The recipient with the most hours absorbs any rounding remainder.
func hoursWeighted(totalCents int64, rs []Recipient) ([]Share, error) {
	sumHours := 0.0
	for _, r := range rs {
		sumHours += r.HoursWorked
	}
	if sumHours <= 0 {
		return nil, errors.New("sum of hours_worked must be > 0 for hours_weighted")
	}

	shares := make([]Share, len(rs))
	var allocated int64
	highIdx := 0
	highHours := -1.0

	for i, r := range rs {
		amt := int64(math.Floor(float64(totalCents) * r.HoursWorked / sumHours))
		shares[i] = Share{
			StaffID:     r.StaffID,
			AmountCents: amt,
			HoursWorked: r.HoursWorked,
			WeightPts:   r.WeightPts,
		}
		allocated += amt
		if r.HoursWorked > highHours {
			highHours = r.HoursWorked
			highIdx = i
		}
	}
	shares[highIdx].AmountCents += totalCents - allocated
	return shares, nil
}

// pointsWeighted splits by fraction of total weight points.
// Remainder goes to the highest-weight recipient.
func pointsWeighted(totalCents int64, rs []Recipient) ([]Share, error) {
	sumPts := 0.0
	for _, r := range rs {
		sumPts += r.WeightPts
	}
	if sumPts <= 0 {
		return nil, errors.New("sum of weight_points must be > 0 for points_weighted")
	}

	shares := make([]Share, len(rs))
	var allocated int64
	highIdx := 0
	highPts := -1.0

	for i, r := range rs {
		amt := int64(math.Floor(float64(totalCents) * r.WeightPts / sumPts))
		shares[i] = Share{
			StaffID:     r.StaffID,
			AmountCents: amt,
			HoursWorked: r.HoursWorked,
			WeightPts:   r.WeightPts,
		}
		allocated += amt
		if r.WeightPts > highPts {
			highPts = r.WeightPts
			highIdx = i
		}
	}
	shares[highIdx].AmountCents += totalCents - allocated
	return shares, nil
}

// roleWeighted looks up each recipient's weight from
// config["role_weights"][role] (a JSON sub-object keyed by role name) and
// then applies points_weighted logic. Remainder goes to the highest-weight
// recipient. Unknown roles receive weight 0.
func roleWeighted(totalCents int64, rs []Recipient, config map[string]any) ([]Share, error) {
	rawWeights, _ := config["role_weights"].(map[string]any)

	// Build a copy of recipients with WeightPts filled from config.
	enriched := make([]Recipient, len(rs))
	copy(enriched, rs)
	for i, r := range enriched {
		if rawWeights != nil {
			if v, ok := rawWeights[r.Role]; ok {
				switch w := v.(type) {
				case float64:
					enriched[i].WeightPts = w
				case int:
					enriched[i].WeightPts = float64(w)
				}
			}
		}
	}

	// Sort descending by weight so tiebreaks favour higher-weight roles.
	sort.SliceStable(enriched, func(a, b int) bool {
		return enriched[a].WeightPts > enriched[b].WeightPts
	})

	return pointsWeighted(totalCents, enriched)
}
