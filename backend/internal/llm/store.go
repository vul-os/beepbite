package llm

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
)

// modelPricing holds a single row from llm_model_pricing.
type modelPricing struct {
	Provider         string
	Model            string
	InputCostPer1k   float64
	OutputCostPer1k  float64
	SupportsVision   bool
	SupportsTools    bool
	ContextLength    int
}

// store wraps a pgxpool and provides typed reads of llm_model_pricing.
type store struct {
	pool *pgxpool.Pool
}

// listPricing returns all rows from llm_model_pricing.
// Models not present in the table are treated as disabled by the router.
func (s *store) listPricing(ctx context.Context) ([]modelPricing, error) {
	if s.pool == nil {
		return nil, fmt.Errorf("llm store: pgx pool not configured")
	}

	rows, err := s.pool.Query(ctx, `
SELECT provider, model,
       input_cost_per_1k::float8,
       output_cost_per_1k::float8,
       supports_vision,
       supports_tools,
       context_length
FROM llm_model_pricing
ORDER BY provider, model
`)
	if err != nil {
		return nil, fmt.Errorf("llm store: listPricing: %w", err)
	}
	defer rows.Close()

	var out []modelPricing
	for rows.Next() {
		var p modelPricing
		if err := rows.Scan(
			&p.Provider,
			&p.Model,
			&p.InputCostPer1k,
			&p.OutputCostPer1k,
			&p.SupportsVision,
			&p.SupportsTools,
			&p.ContextLength,
		); err != nil {
			return nil, fmt.Errorf("llm store: listPricing: scan: %w", err)
		}
		out = append(out, p)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("llm store: listPricing: rows: %w", err)
	}
	return out, nil
}
