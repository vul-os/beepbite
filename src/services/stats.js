// stats.js — owner analytics service
//
// Wraps the two stats endpoints:
//   GET /stats/summary?location_id&period=day|week|month|year
//   GET /stats/heatmap?location_id&weeks=12
//
// Both functions return { data, error } in the same style as api.request().

import { api } from '../lib/api-client.js';

/**
 * Fetch KPI summary + series trend for a given period.
 *
 * @param {string} locationId
 * @param {'day'|'week'|'month'|'year'} period
 * @returns {Promise<{data: SummaryResponse|null, error: object|null}>}
 *
 * Response shape (data):
 * {
 *   period, range: { from, to },
 *   kpis: {
 *     gross_sales_cents, net_sales_cents, order_count,
 *     avg_order_value_cents, new_customers
 *   },
 *   previous: { ...same as kpis... },
 *   series: [ { bucket, sales_cents, order_count } ]
 * }
 */
export async function fetchStatsSummary(locationId, period = 'week') {
  if (!locationId) return { data: null, error: { message: 'locationId required' } };
  const params = new URLSearchParams({ location_id: locationId, period });
  return api.request('GET', `/stats/summary?${params.toString()}`);
}

/**
 * Fetch heatmap cells (dow × hour) for the trailing N weeks.
 *
 * @param {string} locationId
 * @param {number} weeks - how many trailing weeks to aggregate (default 12)
 * @returns {Promise<{data: HeatmapResponse|null, error: object|null}>}
 *
 * Response shape (data):
 * {
 *   cells: [ { dow, hour, order_count, sales_cents } ]
 *   // dow 0=Sun..6=Sat, hour 0-23
 * }
 */
export async function fetchStatsHeatmap(locationId, weeks = 12) {
  if (!locationId) return { data: null, error: { message: 'locationId required' } };
  const params = new URLSearchParams({ location_id: locationId, weeks: String(weeks) });
  return api.request('GET', `/stats/heatmap?${params.toString()}`);
}
