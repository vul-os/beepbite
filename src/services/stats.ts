// stats.js — owner analytics service
//
// Wraps the two stats endpoints:
//   GET /stats/summary?location_id&period=day|week|month|year
//   GET /stats/heatmap?location_id&weeks=12
//
// Both functions return { data, error } in the same style as api.request().

import { api } from '../lib/api-client.js';

export interface StatsKPIs {
  gross_sales_cents: number;
  net_sales_cents: number;
  order_count: number;
  avg_order_value_cents: number;
  new_customers: number;
}

export interface StatsSeriesPoint {
  bucket: string;
  sales_cents: number;
  order_count: number;
}

export interface SummaryResponse {
  period: string;
  range: { from: string; to: string };
  kpis: StatsKPIs;
  previous: StatsKPIs;
  series: StatsSeriesPoint[];
}

export interface HeatmapCell {
  /** 0=Sun..6=Sat */
  dow: number;
  /** 0-23 */
  hour: number;
  order_count: number;
  sales_cents: number;
}

export interface HeatmapResponse {
  cells: HeatmapCell[];
}

/**
 * Fetch KPI summary + series trend for a given period.
 */
export async function fetchStatsSummary(locationId: string, period: 'day' | 'week' | 'month' | 'year' = 'week') {
  if (!locationId) return { data: null, error: { message: 'locationId required' } };
  const params = new URLSearchParams({ location_id: locationId, period });
  return api.request<SummaryResponse>('GET', `/stats/summary?${params.toString()}`);
}

/**
 * Fetch heatmap cells (dow × hour) for the trailing N weeks.
 *
 * @param weeks - how many trailing weeks to aggregate (default 12)
 */
export async function fetchStatsHeatmap(locationId: string, weeks = 12) {
  if (!locationId) return { data: null, error: { message: 'locationId required' } };
  const params = new URLSearchParams({ location_id: locationId, weeks: String(weeks) });
  return api.request<HeatmapResponse>('GET', `/stats/heatmap?${params.toString()}`);
}
