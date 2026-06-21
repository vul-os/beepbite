// Package llmsync provides background jobs that keep llm_model_pricing
// up-to-date via two independent sweeps:
//
//   - Pricing sync (nightly): fetches the BerriAI/litellm model price manifest
//     and UPSERTs every supported provider into llm_model_pricing.
//   - Discovery (every 6 h): calls each enabled provider's GET /v1/models
//     endpoint and ensures every enumerated model has a row in the table
//     (inserting with zero cost + source='discovery' if no priced row exists).
//
// The table schema (migration 024):
//
//	CREATE TABLE llm_model_pricing (
//	  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
//	  provider            text NOT NULL,
//	  model               text NOT NULL,
//	  input_cost_per_1k   numeric NOT NULL,
//	  output_cost_per_1k  numeric NOT NULL,
//	  supports_vision     bool NOT NULL DEFAULT false,
//	  supports_tools      bool NOT NULL DEFAULT false,
//	  context_length      int,
//	  source              text NOT NULL,
//	  updated_at          timestamptz NOT NULL DEFAULT now(),
//	  UNIQUE (provider, model)
//	);
package llmsync

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
)

// modelRow is the internal representation passed to the UPSERT helper.
type modelRow struct {
	Provider        string
	Model           string
	InputCostPer1k  float64
	OutputCostPer1k float64
	SupportsVision  bool
	SupportsTools   bool
	ContextLength   *int
	Source          string
}

// upsertModels performs an INSERT … ON CONFLICT (provider, model) DO UPDATE
// for each row in models. It runs inside the already-open transaction tx.
func upsertModels(ctx context.Context, tx pgx.Tx, models []modelRow) error {
	for _, m := range models {
		_, err := tx.Exec(ctx, `
INSERT INTO llm_model_pricing
    (provider, model,
     input_cost_per_1k, output_cost_per_1k,
     supports_vision, supports_tools,
     context_length, source, updated_at)
VALUES
    ($1, $2,
     $3, $4,
     $5, $6,
     $7, $8, now())
ON CONFLICT (provider, model) DO UPDATE SET
    input_cost_per_1k  = EXCLUDED.input_cost_per_1k,
    output_cost_per_1k = EXCLUDED.output_cost_per_1k,
    supports_vision    = EXCLUDED.supports_vision,
    supports_tools     = EXCLUDED.supports_tools,
    context_length     = EXCLUDED.context_length,
    source             = EXCLUDED.source,
    updated_at         = now()
`,
			m.Provider, m.Model,
			m.InputCostPer1k, m.OutputCostPer1k,
			m.SupportsVision, m.SupportsTools,
			m.ContextLength, m.Source,
		)
		if err != nil {
			return fmt.Errorf("llmsync: upsert %s/%s: %w", m.Provider, m.Model, err)
		}
	}
	return nil
}

// insertIfMissing inserts a zero-cost discovery row for (provider, model)
// only when no row already exists (ON CONFLICT DO NOTHING).
func insertIfMissing(ctx context.Context, tx pgx.Tx, provider, model string) error {
	_, err := tx.Exec(ctx, `
INSERT INTO llm_model_pricing
    (provider, model,
     input_cost_per_1k, output_cost_per_1k,
     supports_vision, supports_tools,
     context_length, source, updated_at)
VALUES
    ($1, $2,
     0, 0,
     false, false,
     NULL, 'discovery', now())
ON CONFLICT (provider, model) DO NOTHING
`, provider, model)
	if err != nil {
		return fmt.Errorf("llmsync: insertIfMissing %s/%s: %w", provider, model, err)
	}
	return nil
}
