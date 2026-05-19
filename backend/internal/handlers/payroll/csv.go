package payroll

import (
	"encoding/csv"
	"fmt"
	"net/http"
	"strconv"
)

// writePayrollCSV streams rows as a CSV attachment. All cent amounts are
// written as plain integers (no decimal point); downstream tools convert.
func writePayrollCSV(w http.ResponseWriter, period string, rows []PayrollRow) error {
	filename := fmt.Sprintf("payroll_%s.csv", period)
	w.Header().Set("Content-Type", "text/csv")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, filename))
	w.WriteHeader(http.StatusOK)

	cw := csv.NewWriter(w)

	// Header row.
	if err := cw.Write([]string{
		"staff_id",
		"staff_name",
		"role",
		"hours_worked",
		"rate_type",
		"rate_cents",
		"base_pay_cents",
		"overtime_pay_cents",
		"tips_cents",
		"total_pay_cents",
	}); err != nil {
		return err
	}

	for _, r := range rows {
		rec := []string{
			r.StaffID,
			r.StaffName,
			r.Role,
			strconv.FormatFloat(r.HoursWorked, 'f', 4, 64),
			r.RateType,
			strconv.FormatInt(r.RateCents, 10),
			strconv.FormatInt(r.BasePayCents, 10),
			strconv.FormatInt(r.OvertimePayCents, 10),
			strconv.FormatInt(r.TipsCents, 10),
			strconv.FormatInt(r.TotalPayCents, 10),
		}
		if err := cw.Write(rec); err != nil {
			return err
		}
	}

	cw.Flush()
	return cw.Error()
}
