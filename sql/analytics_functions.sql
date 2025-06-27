-- Analytics Functions for BeepBite Reports Dashboard
-- These functions provide comprehensive data for the reports interface

-- Function to get overall analytics summary for a bistro
CREATE OR REPLACE FUNCTION get_analytics_summary(
    p_bistro_id uuid,
    p_period text DEFAULT '7d' -- '1d', '7d', '30d', '90d'
)
RETURNS TABLE (
    total_orders bigint,
    completed_orders bigint,
    completion_rate numeric,
    average_rating numeric,
    total_reviews bigint,
    avg_response_time_minutes numeric,
    period_start timestamptz,
    period_end timestamptz
) 
LANGUAGE plpgsql
AS $$
DECLARE
    start_date timestamptz;
    end_date timestamptz;
BEGIN
    -- Calculate date range based on period
    end_date := timezone('utc'::text, now());
    CASE p_period
        WHEN '1d' THEN start_date := end_date - INTERVAL '1 day';
        WHEN '7d' THEN start_date := end_date - INTERVAL '7 days';
        WHEN '30d' THEN start_date := end_date - INTERVAL '30 days';
        WHEN '90d' THEN start_date := end_date - INTERVAL '90 days';
        ELSE start_date := end_date - INTERVAL '7 days';
    END CASE;

    RETURN QUERY
    SELECT 
        -- Total orders in period
        COUNT(b.id) as total_orders,
        -- Completed orders
        COUNT(CASE WHEN b.status = 'completed' THEN 1 END) as completed_orders,
        -- Completion rate
        CASE 
            WHEN COUNT(b.id) > 0 THEN 
                ROUND((COUNT(CASE WHEN b.status = 'completed' THEN 1 END)::numeric / COUNT(b.id)::numeric) * 100, 1)
            ELSE 0
        END as completion_rate,
        -- Average rating
        COALESCE(AVG(r.rating), 0) as average_rating,
        -- Total reviews
        COUNT(r.id) as total_reviews,
        -- Average response time (using chat messages)
        COALESCE(
            AVG(
                EXTRACT(EPOCH FROM (
                    SELECT MIN(m2.created_at) 
                    FROM messages m2 
                    WHERE m2.chat_id = c.id 
                    AND m2.direction = 'outbound'
                    AND m2.created_at > (
                        SELECT MAX(m3.created_at) 
                        FROM messages m3 
                        WHERE m3.chat_id = c.id 
                        AND m3.direction = 'inbound'
                        AND m3.created_at < m2.created_at
                    )
                )) / 60
            ), 0
        ) as avg_response_time_minutes,
        start_date as period_start,
        end_date as period_end
    FROM bites b
    LEFT JOIN reviews r ON b.id = r.bite_id
    LEFT JOIN customers cust ON b.customer_id = cust.id
    LEFT JOIN chats c ON c.customer_id = cust.id
    WHERE b.bistro_id = p_bistro_id
    AND b.created_at >= start_date
    AND b.created_at <= end_date;
END;
$$;

-- Function to get order status distribution
CREATE OR REPLACE FUNCTION get_order_status_distribution(
    p_bistro_id uuid,
    p_period text DEFAULT '7d'
)
RETURNS TABLE (
    status text,
    count bigint,
    percentage numeric
) 
LANGUAGE plpgsql
AS $$
DECLARE
    start_date timestamptz;
    end_date timestamptz;
BEGIN
    -- Calculate date range
    end_date := timezone('utc'::text, now());
    CASE p_period
        WHEN '1d' THEN start_date := end_date - INTERVAL '1 day';
        WHEN '7d' THEN start_date := end_date - INTERVAL '7 days';
        WHEN '30d' THEN start_date := end_date - INTERVAL '30 days';
        WHEN '90d' THEN start_date := end_date - INTERVAL '90 days';
        ELSE start_date := end_date - INTERVAL '7 days';
    END CASE;

    RETURN QUERY
    WITH total_count AS (
        SELECT COUNT(*) as total
        FROM bites 
        WHERE bistro_id = p_bistro_id
        AND created_at >= start_date
        AND created_at <= end_date
    )
    SELECT 
        b.status,
        COUNT(b.id) as count,
        CASE 
            WHEN tc.total > 0 THEN ROUND((COUNT(b.id)::numeric / tc.total::numeric) * 100, 1)
            ELSE 0
        END as percentage
    FROM bites b
    CROSS JOIN total_count tc
    WHERE b.bistro_id = p_bistro_id
    AND b.created_at >= start_date
    AND b.created_at <= end_date
    GROUP BY b.status, tc.total
    ORDER BY count DESC;
END;
$$;

-- Function to get hourly order distribution
CREATE OR REPLACE FUNCTION get_orders_by_hour(
    p_bistro_id uuid,
    p_period text DEFAULT '7d'
)
RETURNS TABLE (
    hour_of_day int,
    hour_label text,
    order_count bigint,
    avg_response_time_minutes numeric
) 
LANGUAGE plpgsql
AS $$
DECLARE
    start_date timestamptz;
    end_date timestamptz;
BEGIN
    -- Calculate date range
    end_date := timezone('utc'::text, now());
    CASE p_period
        WHEN '1d' THEN start_date := end_date - INTERVAL '1 day';
        WHEN '7d' THEN start_date := end_date - INTERVAL '7 days';
        WHEN '30d' THEN start_date := end_date - INTERVAL '30 days';
        WHEN '90d' THEN start_date := end_date - INTERVAL '90 days';
        ELSE start_date := end_date - INTERVAL '7 days';
    END CASE;

    RETURN QUERY
    SELECT 
        EXTRACT(HOUR FROM b.created_at)::int as hour_of_day,
        CASE 
            WHEN EXTRACT(HOUR FROM b.created_at)::int = 0 THEN '12AM'
            WHEN EXTRACT(HOUR FROM b.created_at)::int < 12 THEN EXTRACT(HOUR FROM b.created_at)::int || 'AM'
            WHEN EXTRACT(HOUR FROM b.created_at)::int = 12 THEN '12PM'
            ELSE (EXTRACT(HOUR FROM b.created_at)::int - 12) || 'PM'
        END as hour_label,
        COUNT(b.id) as order_count,
        COALESCE(
            AVG(
                EXTRACT(EPOCH FROM (
                    SELECT MIN(m2.created_at) 
                    FROM messages m2 
                    INNER JOIN chats c2 ON m2.chat_id = c2.id
                    WHERE c2.customer_id = cust.id
                    AND m2.direction = 'outbound'
                    AND m2.created_at > b.created_at
                    AND m2.created_at <= b.created_at + INTERVAL '1 hour'
                )) / 60
            ), 0
        ) as avg_response_time_minutes
    FROM bites b
    LEFT JOIN customers cust ON b.customer_id = cust.id
    WHERE b.bistro_id = p_bistro_id
    AND b.created_at >= start_date
    AND b.created_at <= end_date
    GROUP BY EXTRACT(HOUR FROM b.created_at)
    ORDER BY hour_of_day;
END;
$$;

-- Function to get daily trends
CREATE OR REPLACE FUNCTION get_daily_trends(
    p_bistro_id uuid,
    p_period text DEFAULT '7d'
)
RETURNS TABLE (
    date_day date,
    day_name text,
    order_count bigint,
    completed_orders bigint,
    avg_response_time_minutes numeric,
    avg_rating numeric
) 
LANGUAGE plpgsql
AS $$
DECLARE
    start_date timestamptz;
    end_date timestamptz;
BEGIN
    -- Calculate date range
    end_date := timezone('utc'::text, now());
    CASE p_period
        WHEN '1d' THEN start_date := end_date - INTERVAL '1 day';
        WHEN '7d' THEN start_date := end_date - INTERVAL '7 days';
        WHEN '30d' THEN start_date := end_date - INTERVAL '30 days';
        WHEN '90d' THEN start_date := end_date - INTERVAL '90 days';
        ELSE start_date := end_date - INTERVAL '7 days';
    END CASE;

    RETURN QUERY
    SELECT 
        DATE(b.created_at) as date_day,
        TO_CHAR(b.created_at, 'Dy') as day_name,
        COUNT(b.id) as order_count,
        COUNT(CASE WHEN b.status = 'completed' THEN 1 END) as completed_orders,
        COALESCE(
            AVG(
                EXTRACT(EPOCH FROM (
                    SELECT MIN(m2.created_at) 
                    FROM messages m2 
                    INNER JOIN chats c2 ON m2.chat_id = c2.id
                    WHERE c2.customer_id = cust.id
                    AND m2.direction = 'outbound'
                    AND m2.created_at > b.created_at
                    AND m2.created_at <= b.created_at + INTERVAL '2 hours'
                )) / 60
            ), 0
        ) as avg_response_time_minutes,
        COALESCE(AVG(r.rating), 0) as avg_rating
    FROM bites b
    LEFT JOIN customers cust ON b.customer_id = cust.id
    LEFT JOIN reviews r ON b.id = r.bite_id
    WHERE b.bistro_id = p_bistro_id
    AND b.created_at >= start_date
    AND b.created_at <= end_date
    GROUP BY DATE(b.created_at), TO_CHAR(b.created_at, 'Dy')
    ORDER BY date_day;
END;
$$;

-- Function to get recent orders with response times
CREATE OR REPLACE FUNCTION get_recent_orders_with_response_times(
    p_bistro_id uuid,
    p_limit int DEFAULT 10
)
RETURNS TABLE (
    bite_id uuid,
    order_number text,
    status text,
    created_at timestamptz,
    customer_name text,
    whatsapp_number text,
    response_time_minutes numeric,
    response_time_formatted text
) 
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        b.id as bite_id,
        b.order_number,
        b.status,
        b.created_at,
        COALESCE(
            NULLIF(cust.display_name, ''),
            NULLIF(CONCAT(cust.first_name, ' ', cust.last_name), ' '),
            'Customer'
        ) as customer_name,
        cust.whatsapp_number,
        COALESCE(
            EXTRACT(EPOCH FROM (
                SELECT MIN(m2.created_at) 
                FROM messages m2 
                INNER JOIN chats c2 ON m2.chat_id = c2.id
                WHERE c2.customer_id = cust.id
                AND m2.direction = 'outbound'
                AND m2.created_at > b.created_at
                AND m2.created_at <= b.created_at + INTERVAL '2 hours'
            )) / 60, 0
        ) as response_time_minutes,
        CASE 
            WHEN COALESCE(
                EXTRACT(EPOCH FROM (
                    SELECT MIN(m2.created_at) 
                    FROM messages m2 
                    INNER JOIN chats c2 ON m2.chat_id = c2.id
                    WHERE c2.customer_id = cust.id
                    AND m2.direction = 'outbound'
                    AND m2.created_at > b.created_at
                    AND m2.created_at <= b.created_at + INTERVAL '2 hours'
                )) / 60, 0
            ) > 0 THEN
                FLOOR(COALESCE(
                    EXTRACT(EPOCH FROM (
                        SELECT MIN(m2.created_at) 
                        FROM messages m2 
                        INNER JOIN chats c2 ON m2.chat_id = c2.id
                        WHERE c2.customer_id = cust.id
                        AND m2.direction = 'outbound'
                        AND m2.created_at > b.created_at
                        AND m2.created_at <= b.created_at + INTERVAL '2 hours'
                    )) / 60, 0
                ))::text || 'm ' || 
                FLOOR(MOD(COALESCE(
                    EXTRACT(EPOCH FROM (
                        SELECT MIN(m2.created_at) 
                        FROM messages m2 
                        INNER JOIN chats c2 ON m2.chat_id = c2.id
                        WHERE c2.customer_id = cust.id
                        AND m2.direction = 'outbound'
                        AND m2.created_at > b.created_at
                        AND m2.created_at <= b.created_at + INTERVAL '2 hours'
                    )), 0
                ), 60))::text || 's'
            ELSE 'No response'
        END as response_time_formatted
    FROM bites b
    LEFT JOIN customers cust ON b.customer_id = cust.id
    WHERE b.bistro_id = p_bistro_id
    ORDER BY b.created_at DESC
    LIMIT p_limit;
END;
$$;

-- Function to get customer analytics
CREATE OR REPLACE FUNCTION get_customer_analytics(
    p_bistro_id uuid,
    p_period text DEFAULT '30d'
)
RETURNS TABLE (
    total_customers bigint,
    new_customers bigint,
    returning_customers bigint,
    avg_orders_per_customer numeric,
    customer_retention_rate numeric
) 
LANGUAGE plpgsql
AS $$
DECLARE
    start_date timestamptz;
    end_date timestamptz;
    previous_period_start timestamptz;
BEGIN
    -- Calculate date range
    end_date := timezone('utc'::text, now());
    CASE p_period
        WHEN '1d' THEN 
            start_date := end_date - INTERVAL '1 day';
            previous_period_start := start_date - INTERVAL '1 day';
        WHEN '7d' THEN 
            start_date := end_date - INTERVAL '7 days';
            previous_period_start := start_date - INTERVAL '7 days';
        WHEN '30d' THEN 
            start_date := end_date - INTERVAL '30 days';
            previous_period_start := start_date - INTERVAL '30 days';
        WHEN '90d' THEN 
            start_date := end_date - INTERVAL '90 days';
            previous_period_start := start_date - INTERVAL '90 days';
        ELSE 
            start_date := end_date - INTERVAL '30 days';
            previous_period_start := start_date - INTERVAL '30 days';
    END CASE;

    RETURN QUERY
    WITH period_customers AS (
        SELECT DISTINCT b.customer_id
        FROM bites b
        WHERE b.bistro_id = p_bistro_id
        AND b.created_at >= start_date
        AND b.created_at <= end_date
    ),
    previous_period_customers AS (
        SELECT DISTINCT b.customer_id
        FROM bites b
        WHERE b.bistro_id = p_bistro_id
        AND b.created_at >= previous_period_start
        AND b.created_at < start_date
    ),
    customer_orders AS (
        SELECT 
            b.customer_id,
            COUNT(*) as order_count
        FROM bites b
        WHERE b.bistro_id = p_bistro_id
        AND b.created_at >= start_date
        AND b.created_at <= end_date
        GROUP BY b.customer_id
    )
    SELECT 
        -- Total unique customers in period
        (SELECT COUNT(*) FROM period_customers) as total_customers,
        -- New customers (not in previous period)
        (SELECT COUNT(*) 
         FROM period_customers pc 
         WHERE pc.customer_id NOT IN (SELECT customer_id FROM previous_period_customers)
        ) as new_customers,
        -- Returning customers (also in previous period)
        (SELECT COUNT(*) 
         FROM period_customers pc 
         WHERE pc.customer_id IN (SELECT customer_id FROM previous_period_customers)
        ) as returning_customers,
        -- Average orders per customer
        COALESCE((SELECT AVG(order_count) FROM customer_orders), 0) as avg_orders_per_customer,
        -- Customer retention rate
        CASE 
            WHEN (SELECT COUNT(*) FROM previous_period_customers) > 0 THEN
                ROUND(((SELECT COUNT(*) 
                       FROM period_customers pc 
                       WHERE pc.customer_id IN (SELECT customer_id FROM previous_period_customers))::numeric / 
                      (SELECT COUNT(*) FROM previous_period_customers)::numeric) * 100, 1)
            ELSE 0
        END as customer_retention_rate;
END;
$$;

-- Create indexes to improve analytics performance
CREATE INDEX IF NOT EXISTS idx_bites_created_at ON bites(created_at);
CREATE INDEX IF NOT EXISTS idx_bites_bistro_created ON bites(bistro_id, created_at);
CREATE INDEX IF NOT EXISTS idx_reviews_created_at ON reviews(created_at);
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at);
CREATE INDEX IF NOT EXISTS idx_messages_direction ON messages(direction);
CREATE INDEX IF NOT EXISTS idx_chats_customer_id ON chats(customer_id);

-- =============================================================================
-- REVIEWS ANALYTICS FUNCTIONS
-- =============================================================================

-- Function to get comprehensive reviews data for a bistro
CREATE OR REPLACE FUNCTION get_reviews_analytics(
    p_bistro_id uuid,
    p_period text DEFAULT '30d', -- '1d', '7d', '30d', '90d', 'all'
    p_limit int DEFAULT 50
)
RETURNS TABLE (
    review_id uuid,
    bite_id uuid,
    order_number text,
    rating integer,
    comment text,
    anonymous boolean,
    review_created_at timestamptz,
    customer_id uuid,
    customer_name text,
    customer_whatsapp text,
    customer_display_name text,
    bistro_name text,
    order_created_at timestamptz
) 
LANGUAGE plpgsql
AS $$
DECLARE
    start_date timestamptz;
    end_date timestamptz;
BEGIN
    -- Calculate date range based on period
    end_date := timezone('utc'::text, now());
    
    IF p_period = 'all' THEN
        start_date := '1970-01-01'::timestamptz;
    ELSE
        CASE p_period
            WHEN '1d' THEN start_date := end_date - INTERVAL '1 day';
            WHEN '7d' THEN start_date := end_date - INTERVAL '7 days';
            WHEN '30d' THEN start_date := end_date - INTERVAL '30 days';
            WHEN '90d' THEN start_date := end_date - INTERVAL '90 days';
            ELSE start_date := end_date - INTERVAL '30 days';
        END CASE;
    END IF;

    RETURN QUERY
    SELECT 
        r.id as review_id,
        r.bite_id,
        b.order_number,
        r.rating,
        r.comment,
        r.anon as anonymous,
        r.created_at as review_created_at,
        c.id as customer_id,
        CASE 
            WHEN r.anon THEN 'Anonymous Customer'
            ELSE COALESCE(
                NULLIF(c.display_name, ''),
                NULLIF(CONCAT(NULLIF(c.first_name, ''), ' ', NULLIF(c.last_name, '')), ' '),
                NULLIF(c.first_name, ''),
                NULLIF(c.last_name, ''),
                'Customer'
            )
        END as customer_name,
        c.whatsapp_number as customer_whatsapp,
        c.display_name as customer_display_name,
        bistros.name as bistro_name,
        b.created_at as order_created_at
    FROM reviews r
    INNER JOIN bites b ON r.bite_id = b.id
    INNER JOIN customers c ON b.customer_id = c.id
    INNER JOIN bistros ON b.bistro_id = bistros.id
    WHERE b.bistro_id = p_bistro_id
    AND r.created_at >= start_date
    AND r.created_at <= end_date
    ORDER BY r.created_at DESC
    LIMIT p_limit;
END;
$$;

-- Function to get review statistics summary
CREATE OR REPLACE FUNCTION get_reviews_summary(
    p_bistro_id uuid,
    p_period text DEFAULT '30d'
)
RETURNS TABLE (
    total_reviews bigint,
    average_rating numeric,
    rating_distribution jsonb,
    anonymous_reviews bigint,
    public_reviews bigint,
    reviews_with_comments bigint,
    period_start timestamptz,
    period_end timestamptz
) 
LANGUAGE plpgsql
AS $$
DECLARE
    start_date timestamptz;
    end_date timestamptz;
BEGIN
    -- Calculate date range based on period
    end_date := timezone('utc'::text, now());
    
    IF p_period = 'all' THEN
        start_date := '1970-01-01'::timestamptz;
    ELSE
        CASE p_period
            WHEN '1d' THEN start_date := end_date - INTERVAL '1 day';
            WHEN '7d' THEN start_date := end_date - INTERVAL '7 days';
            WHEN '30d' THEN start_date := end_date - INTERVAL '30 days';
            WHEN '90d' THEN start_date := end_date - INTERVAL '90 days';
            ELSE start_date := end_date - INTERVAL '30 days';
        END CASE;
    END IF;

    RETURN QUERY
    WITH review_stats AS (
        SELECT 
            r.rating,
            r.anon,
            r.comment
        FROM reviews r
        INNER JOIN bites b ON r.bite_id = b.id
        WHERE b.bistro_id = p_bistro_id
        AND r.created_at >= start_date
        AND r.created_at <= end_date
    )
    SELECT 
        COUNT(*)::bigint as total_reviews,
        COALESCE(ROUND(AVG(rating), 1), 0) as average_rating,
        COALESCE(
            (SELECT jsonb_object_agg(rating::text, count::text)
             FROM (
                 SELECT rating, COUNT(*) as count
                 FROM review_stats
                 GROUP BY rating
                 ORDER BY rating DESC
             ) rating_counts),
            '{}'::jsonb
        ) as rating_distribution,
        COUNT(CASE WHEN anon = true THEN 1 END)::bigint as anonymous_reviews,
        COUNT(CASE WHEN anon = false THEN 1 END)::bigint as public_reviews,
        COUNT(CASE WHEN comment IS NOT NULL AND comment != '' THEN 1 END)::bigint as reviews_with_comments,
        start_date as period_start,
        end_date as period_end
    FROM review_stats;
END;
$$;

-- Function to get reviews by rating distribution (for charts)
CREATE OR REPLACE FUNCTION get_reviews_rating_distribution(
    p_bistro_id uuid,
    p_period text DEFAULT '30d'
)
RETURNS TABLE (
    rating integer,
    count bigint,
    percentage numeric
) 
LANGUAGE plpgsql
AS $$
DECLARE
    start_date timestamptz;
    end_date timestamptz;
BEGIN
    -- Calculate date range based on period
    end_date := timezone('utc'::text, now());
    
    IF p_period = 'all' THEN
        start_date := '1970-01-01'::timestamptz;
    ELSE
        CASE p_period
            WHEN '1d' THEN start_date := end_date - INTERVAL '1 day';
            WHEN '7d' THEN start_date := end_date - INTERVAL '7 days';
            WHEN '30d' THEN start_date := end_date - INTERVAL '30 days';
            WHEN '90d' THEN start_date := end_date - INTERVAL '90 days';
            ELSE start_date := end_date - INTERVAL '30 days';
        END CASE;
    END IF;

    RETURN QUERY
    WITH total_reviews AS (
        SELECT COUNT(*) as total
        FROM reviews r
        INNER JOIN bites b ON r.bite_id = b.id
        WHERE b.bistro_id = p_bistro_id
        AND r.created_at >= start_date
        AND r.created_at <= end_date
    )
    SELECT 
        r.rating,
        COUNT(r.id)::bigint as count,
        CASE 
            WHEN tr.total > 0 THEN ROUND((COUNT(r.id)::numeric / tr.total::numeric) * 100, 1)
            ELSE 0
        END as percentage
    FROM reviews r
    INNER JOIN bites b ON r.bite_id = b.id
    CROSS JOIN total_reviews tr
    WHERE b.bistro_id = p_bistro_id
    AND r.created_at >= start_date
    AND r.created_at <= end_date
    GROUP BY r.rating, tr.total
    ORDER BY r.rating DESC;
END;
$$;

-- Function to get recent reviews for dashboard widgets
CREATE OR REPLACE FUNCTION get_recent_reviews(
    p_bistro_id uuid,
    p_limit int DEFAULT 5
)
RETURNS TABLE (
    review_id uuid,
    rating integer,
    comment text,
    customer_name text,
    order_number text,
    created_at timestamptz,
    anonymous boolean
) 
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        r.id as review_id,
        r.rating,
        r.comment,
        CASE 
            WHEN r.anon THEN 'Anonymous Customer'
            ELSE COALESCE(
                NULLIF(c.display_name, ''),
                NULLIF(CONCAT(NULLIF(c.first_name, ''), ' ', NULLIF(c.last_name, '')), ' '),
                NULLIF(c.first_name, ''),
                NULLIF(c.last_name, ''),
                'Customer'
            )
        END as customer_name,
        b.order_number,
        r.created_at,
        r.anon as anonymous
    FROM reviews r
    INNER JOIN bites b ON r.bite_id = b.id
    INNER JOIN customers c ON b.customer_id = c.id
    WHERE b.bistro_id = p_bistro_id
    ORDER BY r.created_at DESC
    LIMIT p_limit;
END;
$$;

-- Function to get review trends over time
CREATE OR REPLACE FUNCTION get_review_trends(
    p_bistro_id uuid,
    p_period text DEFAULT '30d'
)
RETURNS TABLE (
    date_day date,
    day_name text,
    review_count bigint,
    avg_rating numeric,
    high_ratings bigint,
    low_ratings bigint
) 
LANGUAGE plpgsql
AS $$
DECLARE
    start_date timestamptz;
    end_date timestamptz;
BEGIN
    -- Calculate date range based on period
    end_date := timezone('utc'::text, now());
    CASE p_period
        WHEN '1d' THEN start_date := end_date - INTERVAL '1 day';
        WHEN '7d' THEN start_date := end_date - INTERVAL '7 days';
        WHEN '30d' THEN start_date := end_date - INTERVAL '30 days';
        WHEN '90d' THEN start_date := end_date - INTERVAL '90 days';
        ELSE start_date := end_date - INTERVAL '30 days';
    END CASE;

    RETURN QUERY
    SELECT 
        DATE(r.created_at) as date_day,
        TO_CHAR(r.created_at, 'Dy') as day_name,
        COUNT(r.id)::bigint as review_count,
        COALESCE(ROUND(AVG(r.rating), 1), 0) as avg_rating,
        COUNT(CASE WHEN r.rating >= 8 THEN 1 END)::bigint as high_ratings,
        COUNT(CASE WHEN r.rating <= 5 THEN 1 END)::bigint as low_ratings
    FROM reviews r
    INNER JOIN bites b ON r.bite_id = b.id
    WHERE b.bistro_id = p_bistro_id
    AND r.created_at >= start_date
    AND r.created_at <= end_date
    GROUP BY DATE(r.created_at), TO_CHAR(r.created_at, 'Dy')
    ORDER BY date_day;
END;
$$; 