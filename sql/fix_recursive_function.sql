-- FIX FOR RECURSIVE FUNCTION ERROR
-- This fixes the column name mismatch in get_item_components function

CREATE OR REPLACE FUNCTION get_item_components(item_uuid uuid, current_level integer DEFAULT 1)
RETURNS TABLE (
    component_item_id uuid,
    component_name text,
    total_quantity decimal(10,3),
    unit text,
    level_depth integer,
    cost_contribution decimal(10,2)
) AS $$
BEGIN
    RETURN QUERY
    WITH RECURSIVE item_tree AS (
        -- Base case: direct children
        SELECT 
            ir.child_item_id as component_item_id,
            i.name as component_name,
            ir.quantity_needed as total_quantity,
            ir.unit,
            current_level as level_depth,
            (ir.quantity_needed * COALESCE(ir.cost_per_unit, i.cost_price, 0)) as cost_contribution
        FROM item_recipes ir
        JOIN items i ON ir.child_item_id = i.id
        WHERE ir.parent_item_id = item_uuid
        
        UNION ALL
        
        -- Recursive case: children of children
        SELECT 
            ir.child_item_id as component_item_id,
            i.name as component_name,
            (it.total_quantity * ir.quantity_needed) as total_quantity,
            ir.unit,
            (it.level_depth + 1) as level_depth,
            (it.total_quantity * ir.quantity_needed * COALESCE(ir.cost_per_unit, i.cost_price, 0)) as cost_contribution
        FROM item_tree it
        JOIN item_recipes ir ON it.component_item_id = ir.parent_item_id
        JOIN items i ON ir.child_item_id = i.id
        WHERE it.level_depth < 10 -- Prevent infinite recursion
    )
    SELECT 
        it.component_item_id,
        it.component_name,
        it.total_quantity,
        it.unit,
        it.level_depth,
        it.cost_contribution
    FROM item_tree it 
    ORDER BY it.level_depth, it.component_name;
END;
$$ LANGUAGE plpgsql; 