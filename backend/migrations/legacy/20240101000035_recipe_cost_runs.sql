-- RECIPE COST RUNS
-- Tracking table for the background job that recomputes item costs
-- whenever ingredient_price_history rows are inserted.

CREATE TABLE recipe_cost_runs (
    id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    started_at            TIMESTAMPTZ NOT NULL    DEFAULT now(),
    completed_at          TIMESTAMPTZ,
    last_price_history_id UUID,          -- watermark: newest ingredient_price_history.id processed
    items_updated_count   INT         NOT NULL    DEFAULT 0,
    error_message         TEXT
);

CREATE INDEX idx_recipe_cost_runs_started_at ON recipe_cost_runs(started_at DESC);
