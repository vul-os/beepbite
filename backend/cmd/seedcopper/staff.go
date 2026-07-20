package main

import (
	"fmt"
	"log"
	"math/rand"
	"time"

	"github.com/jackc/pgx/v5"
	"golang.org/x/crypto/bcrypt"
)

// seedStaff builds the POS staff roster + scheduling for The Copper Table:
// ~9 POS staff (with 4-digit PIN logins), pay rates, ~2 weeks of past shifts
// plus a week of upcoming shifts, time clock entries for recent completed
// shifts, and a couple of pos_shifts (cash drawer) sessions.
func seedStaff(s *seeder, c *Ctx) error {
	// Idempotency: if staff already exist for this location, load them into
	// Ctx and return without writing anything.
	var existing int
	if err := s.pool.QueryRow(s.ctx, `SELECT count(*) FROM staff WHERE location_id=$1`, c.LocID).Scan(&existing); err != nil {
		return fmt.Errorf("seedStaff: count staff: %w", err)
	}
	if existing > 0 {
		rows, err := s.pool.Query(s.ctx, `
			SELECT id, COALESCE(display_name, first_name || ' ' || last_name), role
			FROM staff WHERE location_id=$1 ORDER BY employee_id
		`, c.LocID)
		if err != nil {
			return fmt.Errorf("seedStaff: load staff: %w", err)
		}
		for rows.Next() {
			var sr StaffRef
			if err := rows.Scan(&sr.ID, &sr.Name, &sr.Role); err != nil {
				rows.Close()
				return fmt.Errorf("seedStaff: scan staff: %w", err)
			}
			c.Staff = append(c.Staff, sr)
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return fmt.Errorf("seedStaff: staff rows: %w", err)
		}
		log.Printf("  staff: already seeded — %d staff", len(c.Staff))
		return nil
	}

	rng := rand.New(rand.NewSource(20260709))

	// staffSpec describes one POS staff member to create.
	type staffSpec struct {
		first, last string
		email       string
		// phoneSeq indexes into the shared phone allocation (see shared.go);
		// the number itself is built by cfg.Phone from the configured dial code.
		phoneSeq int
		role     string // staff.role CHECK: owner, manager, cashier, kitchen, admin
		empID    string
		username string
		pin      string
		hireDate time.Time
		notes    string
		rateType string
		// rateAmount is authored in the 2-decimal reference scale and rescaled
		// by cfg.Price, so a monthly salary of 3800000 reads as "thirty-eight
		// thousand" in whatever currency the run is configured for.
		rateAmount int64
	}

	specs := []staffSpec{
		{"Nomsa", "Dlamini", "nomsa.pos@coppertable.test", staffPhoneSeq + 0, "manager", "CT-001", "nomsa_pos", "1928",
			c.Now.AddDate(-2, -3, 0), "Front of house general manager; opens and closes most shifts.",
			"salary_monthly", 3800000},
		{"Marco", "Ferreira", "marco.pos@coppertable.test", staffPhoneSeq + 1, "admin", "CT-002", "marco_pos", "4471",
			c.Now.AddDate(-2, -1, 0), "Head chef; back-office admin access for menu & inventory.",
			"salary_monthly", 4200000},
		{"Aisha", "Patel", "aisha.pos@coppertable.test", staffPhoneSeq + 2, "cashier", "CT-003", "aisha_pos", "5502",
			c.Now.AddDate(-1, -4, 0), "Front-of-house cashier, weekday lunch & dinner shifts.",
			"hourly", 8500},
		{"Lunga", "Mbeki", "lunga.pos@coppertable.test", staffPhoneSeq + 3, "cashier", "CT-004", "lunga_pos", "3319",
			c.Now.AddDate(-1, 0, 0), "Weekend cashier & host.",
			"hourly", 7800},
		{"Thabo", "Nkosi", "thabo.pos@coppertable.test", staffPhoneSeq + 4, "kitchen", "CT-005", "thabo_nkosi", "6640",
			c.Now.AddDate(-1, -8, 0), "Line cook, grill station.",
			"hourly", 9200},
		{"Priya", "Naidoo", "priya.pos@coppertable.test", staffPhoneSeq + 5, "kitchen", "CT-006", "priya_naidoo", "2087",
			c.Now.AddDate(0, -10, 0), "Line cook, pastry & desserts.",
			"hourly", 8800},
		{"Sipho", "Zulu", "sipho.pos@coppertable.test", staffPhoneSeq + 6, "kitchen", "CT-007", "sipho_zulu", "9153",
			c.Now.AddDate(0, -6, 0), "Commis chef, prep & sauces.",
			"hourly", 7200},
		{"Bongani", "Khumalo", "bongani.pos@coppertable.test", staffPhoneSeq + 7, "kitchen", "CT-008", "bongani_khumalo", "1476",
			c.Now.AddDate(0, -3, 0), "Kitchen porter / dishwasher, evening shifts.",
			"hourly", 6500},
		{"Chantelle", "Adams", "chantelle.pos@coppertable.test", staffPhoneSeq + 8, "cashier", "CT-009", "chantelle_adams", "8264",
			c.Now.AddDate(0, -2, 0), "Weekend & holiday relief cashier.",
			"hourly", 7500},
	}

	staffIDs := make([]string, 0, len(specs))
	staffRole := map[string]string{}

	err := s.tx(func(tx pgx.Tx) error {
		for _, sp := range specs {
			pinHash, err := bcrypt.GenerateFromPassword([]byte(sp.pin), bcrypt.DefaultCost)
			if err != nil {
				return fmt.Errorf("hash pin for %s: %w", sp.first, err)
			}
			displayName := sp.first + " " + sp.last

			var staffID string
			// password_hash is intentionally left NULL for every staff row: there's a
			// UNIQUE(location_id, password_hash) constraint and NULLs never collide.
			if err := tx.QueryRow(s.ctx, `
				INSERT INTO staff (
					location_id, first_name, last_name, display_name, email, phone,
					role, employee_id, username, pin_hash, password_hash,
					hire_date, is_active, notes
				) VALUES (
					$1,$2,$3,$4,$5,$6,
					$7,$8,$9,$10,NULL,
					$11,true,$12
				) RETURNING id
			`, c.LocID, sp.first, sp.last, displayName, sp.email, s.cfg.Phone(sp.phoneSeq),
				sp.role, sp.empID, sp.username, string(pinHash),
				sp.hireDate.Format("2006-01-02"), sp.notes).Scan(&staffID); err != nil {
				return fmt.Errorf("insert staff %q: %w", displayName, err)
			}
			c.Staff = append(c.Staff, StaffRef{ID: staffID, Name: displayName, Role: sp.role})
			staffIDs = append(staffIDs, staffID)
			staffRole[staffID] = sp.role

			// Pay rate — one active rate per staff member, effective since hire.
			effFrom := sp.hireDate.Format("2006-01-02")
			if _, err := tx.Exec(s.ctx, `
				INSERT INTO staff_pay_rates (
					staff_id, rate_type, amount_cents, currency,
					overtime_multiplier, overtime_threshold_hours_per_week,
					effective_from, notes
				) VALUES ($1,$2,$3,$4,1.5,45,$5,$6)
			`, staffID, sp.rateType, s.cfg.Price(sp.rateAmount), s.cfg.Currency, effFrom,
				fmt.Sprintf("Standard %s rate on hire.", sp.rateType)); err != nil {
				return fmt.Errorf("insert pay rate for %q: %w", displayName, err)
			}
		}
		return nil
	})
	if err != nil {
		return fmt.Errorf("seedStaff: %w", err)
	}

	// ------------------------------------------------------------------
	// Shifts: for each staff member, ~10 shifts spanning the past 2 weeks
	// through the upcoming week. One shift per staff per calendar date.
	// ------------------------------------------------------------------
	type shiftPlan struct {
		staffID    string
		date       time.Time
		schedStart string
		schedEnd   string
		isKitchen  bool
	}

	today := c.Now.Truncate(24 * time.Hour)
	var plans []shiftPlan

	// Offsets relative to today: 9 in the past (some today), 1 today+, and a
	// handful in the coming week — ~10 shifts per staff total.
	dayOffsets := []int{-14, -12, -10, -8, -6, -4, -2, -1, 0, 2, 4, 6}

	for _, staffID := range staffIDs {
		role := staffRole[staffID]
		isKitchen := role == "kitchen" || role == "admin"
		// Slight per-staff jitter so not every roster member works the exact
		// same days.
		skip := rng.Intn(3)
		count := 0
		for i, off := range dayOffsets {
			if count >= 10 {
				break
			}
			if i%3 == skip%3 && off != 0 {
				continue // give this staffer an occasional day off
			}
			date := today.AddDate(0, 0, off)
			var start, end string
			if isKitchen {
				// Kitchen: lunch/dinner split shift.
				if rng.Intn(2) == 0 {
					start, end = "09:00", "17:00"
				} else {
					start, end = "14:00", "22:30"
				}
			} else {
				if rng.Intn(2) == 0 {
					start, end = "10:00", "18:00"
				} else {
					start, end = "16:00", "23:30"
				}
			}
			plans = append(plans, shiftPlan{staffID, date, start, end, isKitchen})
			count++
		}
	}

	type timeEntryPlan struct {
		staffID string
		date    time.Time
		start   string
		end     string
	}
	var recentClockEntries []timeEntryPlan

	err = s.tx(func(tx pgx.Tx) error {
		for _, p := range plans {
			status := "scheduled"
			var actualStart, actualEnd *string
			var totalHours *float64
			breakMinutes := 30
			if p.isKitchen {
				breakMinutes = 45
			}

			if p.date.Before(today) {
				// Past shift: mostly completed, occasionally partial/no_show.
				roll := rng.Intn(20)
				switch {
				case roll == 0:
					status = "no_show"
				case roll <= 2:
					status = "partial"
				default:
					status = "completed"
				}
				if status == "completed" || status == "partial" {
					as := p.schedStart
					ae := p.schedEnd
					if status == "partial" {
						ae = "13:00" // left early
					}
					actualStart = &as
					actualEnd = &ae
					hrs := shiftHours(p.schedStart, ae, breakMinutes)
					totalHours = &hrs
				}
			} else if p.date.Equal(today) {
				// Today's shifts: half already clocked in as "completed" (earlier
				// shift), half still "scheduled" for later today.
				if rng.Intn(2) == 0 {
					status = "completed"
					as := p.schedStart
					ae := p.schedEnd
					actualStart = &as
					actualEnd = &ae
					hrs := shiftHours(p.schedStart, p.schedEnd, breakMinutes)
					totalHours = &hrs
				} else {
					status = "scheduled"
				}
			} else {
				status = "scheduled"
			}

			var notes *string
			if status == "no_show" {
				n := "Did not show — followed up by manager."
				notes = &n
			}

			if _, err := tx.Exec(s.ctx, `
				INSERT INTO staff_shifts (
					staff_id, location_id, shift_date,
					scheduled_start, scheduled_end,
					actual_start, actual_end, total_hours,
					break_duration_minutes, status, notes
				) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
			`, p.staffID, c.LocID, p.date.Format("2006-01-02"),
				p.schedStart, p.schedEnd,
				actualStart, actualEnd, totalHours,
				breakMinutes, status, notes); err != nil {
				return fmt.Errorf("insert shift for staff %s on %s: %w", p.staffID, p.date.Format("2006-01-02"), err)
			}

			if status == "completed" {
				recentClockEntries = append(recentClockEntries, timeEntryPlan{p.staffID, p.date, p.schedStart, p.schedEnd})
			}
		}
		return nil
	})
	if err != nil {
		return fmt.Errorf("seedStaff: shifts: %w", err)
	}

	// ------------------------------------------------------------------
	// Time clock entries: clock_in/clock_out pairs for the most recent
	// handful of completed shifts (last 5 calendar days worth).
	// ------------------------------------------------------------------
	var clockEntries int
	err = s.tx(func(tx pgx.Tx) error {
		cutoff := today.AddDate(0, 0, -5)
		for _, te := range recentClockEntries {
			if te.date.Before(cutoff) {
				continue
			}
			inTS, err := combineDateTime(te.date, te.start)
			if err != nil {
				return fmt.Errorf("parse clock-in time: %w", err)
			}
			outTS, err := combineDateTime(te.date, te.end)
			if err != nil {
				return fmt.Errorf("parse clock-out time: %w", err)
			}
			if _, err := tx.Exec(s.ctx, `
				INSERT INTO staff_time_entries (staff_id, location_id, entry_type, "timestamp")
				VALUES ($1,$2,'clock_in',$3)
			`, te.staffID, c.LocID, inTS); err != nil {
				return fmt.Errorf("insert clock_in: %w", err)
			}
			if _, err := tx.Exec(s.ctx, `
				INSERT INTO staff_time_entries (staff_id, location_id, entry_type, "timestamp")
				VALUES ($1,$2,'clock_out',$3)
			`, te.staffID, c.LocID, outTS); err != nil {
				return fmt.Errorf("insert clock_out: %w", err)
			}
			clockEntries += 2
		}
		return nil
	})
	if err != nil {
		return fmt.Errorf("seedStaff: time entries: %w", err)
	}

	// ------------------------------------------------------------------
	// pos_shifts: one open (today) and one closed (yesterday) cash-drawer
	// shift, opened by the manager.
	// ------------------------------------------------------------------
	var managerID string
	for _, sr := range c.Staff {
		if sr.Role == "manager" {
			managerID = sr.ID
			break
		}
	}

	err = s.tx(func(tx pgx.Tx) error {
		openedAt, err := combineDateTime(today, "09:00")
		if err != nil {
			return err
		}
		if _, err := tx.Exec(s.ctx, `
			INSERT INTO pos_shifts (location_id, opened_by, opened_at, status, notes)
			VALUES ($1,$2,$3,'open','Morning shift — cash drawer opened for service.')
		`, c.LocID, managerID, openedAt); err != nil {
			return fmt.Errorf("insert open pos_shift: %w", err)
		}

		yesterday := today.AddDate(0, 0, -1)
		yOpen, err := combineDateTime(yesterday, "09:00")
		if err != nil {
			return err
		}
		yClose, err := combineDateTime(yesterday, "23:00")
		if err != nil {
			return err
		}
		if _, err := tx.Exec(s.ctx, `
			INSERT INTO pos_shifts (location_id, opened_by, opened_at, closed_at, status, notes)
			VALUES ($1,$2,$3,$4,'closed','Full day service, reconciled and closed out.')
		`, c.LocID, managerID, yOpen, yClose); err != nil {
			return fmt.Errorf("insert closed pos_shift: %w", err)
		}
		return nil
	})
	if err != nil {
		return fmt.Errorf("seedStaff: pos_shifts: %w", err)
	}

	log.Printf("  staff: %d staff, %d shifts, %d time entries, 2 pos_shifts", len(c.Staff), len(plans), clockEntries)
	return nil
}

// combineDateTime combines a date (time-of-day truncated) with a "HH:MM"
// clock string into a UTC timestamp.
func combineDateTime(date time.Time, clock string) (time.Time, error) {
	t, err := time.Parse("2006-01-02 15:04", date.Format("2006-01-02")+" "+clock)
	if err != nil {
		return time.Time{}, err
	}
	return t.UTC(), nil
}

// shiftHours computes worked hours between two "HH:MM" clock strings minus a
// break, rounded to two decimal places.
func shiftHours(start, end string, breakMinutes int) float64 {
	st, err1 := time.Parse("15:04", start)
	et, err2 := time.Parse("15:04", end)
	if err1 != nil || err2 != nil {
		return 0
	}
	mins := et.Sub(st).Minutes()
	if mins < 0 {
		mins += 24 * 60
	}
	mins -= float64(breakMinutes)
	if mins < 0 {
		mins = 0
	}
	hrs := mins / 60.0
	// round to 2 decimals
	return float64(int(hrs*100+0.5)) / 100
}
