-- ======================
-- ITEM PREP STEPS
-- Ordered, per-station cooking instructions for menu items.
-- Used by the KDS ticket-detail endpoint to guide kitchen staff.
-- ======================

CREATE TABLE IF NOT EXISTS item_prep_steps (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    item_id uuid NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    step_number int NOT NULL CHECK (step_number > 0),
    instruction text NOT NULL,
    station_id uuid REFERENCES kitchen_stations(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (item_id, step_number)
);

CREATE INDEX IF NOT EXISTS item_prep_steps_item_idx ON item_prep_steps(item_id, step_number);

-- ======================
-- SEED EXAMPLE PREP STEPS
-- Wrapped in DO $$ ... $$ so missing demo items are silently skipped.
-- ======================

DO $$
DECLARE
    v_item_id uuid;
BEGIN
    -- Burger
    SELECT id INTO v_item_id FROM items WHERE name ILIKE '%burger%' LIMIT 1;
    IF v_item_id IS NOT NULL THEN
        INSERT INTO item_prep_steps (item_id, step_number, instruction) VALUES
            (v_item_id, 1, 'Heat grill to 200°C'),
            (v_item_id, 2, 'Season patty with salt and pepper'),
            (v_item_id, 3, 'Sear patty 3 min per side'),
            (v_item_id, 4, 'Toast bun on flat-top until golden'),
            (v_item_id, 5, 'Assemble with lettuce, tomato, and house sauce')
        ON CONFLICT (item_id, step_number) DO NOTHING;
    END IF;

    -- Fries
    SELECT id INTO v_item_id FROM items WHERE name ILIKE '%fries%' OR name ILIKE '%fry%' LIMIT 1;
    IF v_item_id IS NOT NULL THEN
        INSERT INTO item_prep_steps (item_id, step_number, instruction) VALUES
            (v_item_id, 1, 'Heat fryer oil to 180°C'),
            (v_item_id, 2, 'Blanch cut potatoes 3 min, remove and drain'),
            (v_item_id, 3, 'Final fry 2–3 min until golden and crispy'),
            (v_item_id, 4, 'Season immediately with salt')
        ON CONFLICT (item_id, step_number) DO NOTHING;
    END IF;

    -- Pizza
    SELECT id INTO v_item_id FROM items WHERE name ILIKE '%pizza%' LIMIT 1;
    IF v_item_id IS NOT NULL THEN
        INSERT INTO item_prep_steps (item_id, step_number, instruction) VALUES
            (v_item_id, 1, 'Preheat oven to 250°C with stone/tray inside'),
            (v_item_id, 2, 'Stretch dough to requested size'),
            (v_item_id, 3, 'Spread tomato base evenly, leaving 1 cm border'),
            (v_item_id, 4, 'Add toppings and mozzarella'),
            (v_item_id, 5, 'Bake 8–10 min until crust is blistered and cheese is bubbling')
        ON CONFLICT (item_id, step_number) DO NOTHING;
    END IF;
END $$;
