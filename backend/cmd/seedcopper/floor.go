package main

import (
	"fmt"
	"log"

	"github.com/jackc/pgx/v5"
)

// seedFloor builds the front-of-house floor plan for The Copper Table:
// four sections (Main Dining, Terrace, Bar, Private Room) and ~20 tables
// laid out on a 1200x720 floor-plan canvas.
func seedFloor(s *seeder, c *Ctx) error {
	// Idempotency: if sections already exist for this location, load them
	// (plus their tables) into Ctx and return without writing anything.
	var existing int
	if err := s.pool.QueryRow(s.ctx, `SELECT count(*) FROM sections WHERE location_id=$1`, c.LocID).Scan(&existing); err != nil {
		return fmt.Errorf("seedFloor: count sections: %w", err)
	}
	if existing > 0 {
		rows, err := s.pool.Query(s.ctx, `SELECT id, name FROM sections WHERE location_id=$1`, c.LocID)
		if err != nil {
			return fmt.Errorf("seedFloor: load sections: %w", err)
		}
		for rows.Next() {
			var id, name string
			if err := rows.Scan(&id, &name); err != nil {
				rows.Close()
				return fmt.Errorf("seedFloor: scan section: %w", err)
			}
			c.Sections[name] = id
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return fmt.Errorf("seedFloor: sections rows: %w", err)
		}

		trows, err := s.pool.Query(s.ctx, `
			SELECT t.id, t.label, COALESCE(sec.name, '')
			FROM tables t
			LEFT JOIN sections sec ON sec.id = t.section_id
			WHERE t.location_id=$1
			ORDER BY t.label
		`, c.LocID)
		if err != nil {
			return fmt.Errorf("seedFloor: load tables: %w", err)
		}
		for trows.Next() {
			var tr TableRef
			if err := trows.Scan(&tr.ID, &tr.Label, &tr.Section); err != nil {
				trows.Close()
				return fmt.Errorf("seedFloor: scan table: %w", err)
			}
			c.Tables = append(c.Tables, tr)
		}
		trows.Close()
		if err := trows.Err(); err != nil {
			return fmt.Errorf("seedFloor: tables rows: %w", err)
		}
		log.Printf("  floor: already seeded — %d sections, %d tables", len(c.Sections), len(c.Tables))
		return nil
	}

	// tableSpec describes one table to create.
	type tableSpec struct {
		label    string
		capacity int
		status   string
		x, y     float64
	}

	// sectionSpec groups tables under a named section with a sort order.
	type sectionSpec struct {
		name   string
		sort   int
		tables []tableSpec
	}

	sections := []sectionSpec{
		{
			name: "Main Dining",
			sort: 1,
			tables: []tableSpec{
				// Front row — 2- and 4-tops.
				{"T1", 2, "available", 120, 100},
				{"T2", 2, "available", 270, 100},
				{"T3", 4, "occupied", 420, 100},
				{"T4", 4, "available", 570, 100},
				{"T5", 4, "available", 720, 100},
				{"T6", 6, "reserved", 870, 100},
				{"T7", 2, "available", 1020, 100},
				// Back row.
				{"T8", 4, "available", 195, 200},
				{"T9", 4, "occupied", 345, 200},
				{"T10", 6, "available", 495, 200},
				{"T11", 8, "available", 660, 200},
				{"T12", 4, "available", 810, 200},
			},
		},
		{
			name: "Terrace",
			sort: 2,
			tables: []tableSpec{
				{"T13", 2, "available", 120, 300},
				{"T14", 4, "available", 270, 300},
				{"T15", 4, "reserved", 420, 300},
				{"T16", 2, "available", 570, 300},
				{"T17", 6, "available", 720, 300},
			},
		},
		{
			name: "Bar",
			sort: 3,
			tables: []tableSpec{
				{"B1", 2, "available", 120, 480},
				{"B2", 2, "occupied", 270, 480},
				{"B3", 2, "available", 420, 480},
				{"B4", 2, "available", 570, 480},
			},
		},
		{
			name: "Private Room",
			sort: 4,
			tables: []tableSpec{
				{"P1", 8, "available", 120, 620},
				{"P2", 6, "reserved", 270, 620},
			},
		},
	}

	err := s.tx(func(tx pgx.Tx) error {
		for _, sec := range sections {
			var secID string
			if err := tx.QueryRow(s.ctx, `
				INSERT INTO sections (location_id, name, sort_order, is_active)
				VALUES ($1,$2,$3,true)
				RETURNING id
			`, c.LocID, sec.name, sec.sort).Scan(&secID); err != nil {
				return fmt.Errorf("insert section %q: %w", sec.name, err)
			}
			c.Sections[sec.name] = secID

			for _, t := range sec.tables {
				var tblID string
				if err := tx.QueryRow(s.ctx, `
					INSERT INTO tables (location_id, section_id, label, capacity, status, pos_x, pos_y, is_active)
					VALUES ($1,$2,$3,$4,$5,$6,$7,true)
					RETURNING id
				`, c.LocID, secID, t.label, t.capacity, t.status, t.x, t.y).Scan(&tblID); err != nil {
					return fmt.Errorf("insert table %q: %w", t.label, err)
				}
				c.Tables = append(c.Tables, TableRef{ID: tblID, Label: t.label, Section: sec.name})
			}
		}
		return nil
	})
	if err != nil {
		return fmt.Errorf("seedFloor: %w", err)
	}

	log.Printf("  floor: %d sections, %d tables", len(c.Sections), len(c.Tables))
	return nil
}
