import { api } from '../lib/api-client.js';
import { format, subDays, eachDayOfInterval } from 'date-fns';

/**
 * Analytics service — reads from reporting views via the REST data layer.
 *
 * Views available (migration 22):
 *   daily_sales_summary, hourly_sales_heatmap, menu_engineering,
 *   labor_hours_daily, theoretical_vs_actual_cogs, revenue_by_payment_method
 */
class AnalyticsService {
  constructor() {
    this._locationId = null;
  }

  // ------------------------------------------------------------------
  // Location resolution
  // ------------------------------------------------------------------

  /**
   * Return the active location_id.  Reads from localStorage where auth-context
   * persists the active location, then falls back to the first location the
   * API returns for the authenticated user.
   */
  async getLocationId() {
    if (this._locationId) return this._locationId;

    // 1. Try the value written by auth-context.
    try {
      const stored = localStorage.getItem('activeLocation');
      if (stored) {
        const loc = JSON.parse(stored);
        if (loc?.id) {
          this._locationId = loc.id;
          return this._locationId;
        }
      }
    } catch (_) { /* ignore parse errors */ }

    // 2. Fall back: fetch the first location accessible to this user.
    const { data, error } = await api.request('GET', '/data/locations?limit=1');
    if (!error && Array.isArray(data) && data.length > 0) {
      this._locationId = data[0].id;
      return this._locationId;
    }

    return null;
  }

  /** Allow callers (e.g. auth-context) to push the active location in. */
  setLocationId(locationId) {
    this._locationId = locationId;
  }

  // ------------------------------------------------------------------
  // Public entry points
  // ------------------------------------------------------------------

  /**
   * Main entry: mirrors the old getAnalyticsData(timeRangeOrDates) signature.
   * @param {string|{from:Date,to:Date}} timeRangeOrDates
   */
  async getAnalyticsData(timeRangeOrDates = '7d') {
    try {
      const locationId = await this.getLocationId();
      if (!locationId) throw new Error('No location found for user');

      if (typeof timeRangeOrDates === 'object' && timeRangeOrDates.from && timeRangeOrDates.to) {
        return await this._fetchByDateRange(locationId, timeRangeOrDates);
      }
      return await this._fetchByPeriod(locationId, timeRangeOrDates);
    } catch (error) {
      console.error('Error fetching analytics data:', error);
      throw error;
    }
  }

  // ------------------------------------------------------------------
  // Internal fetch helpers
  // ------------------------------------------------------------------

  /** Convert a period string like '7d' to a {from, to} date range. */
  _periodToRange(period) {
    const to = new Date();
    let days = 7;
    if (period === '1d')  days = 1;
    else if (period === '30d') days = 30;
    else if (period === '90d') days = 90;
    return { from: subDays(to, days - 1), to };
  }

  async _fetchByPeriod(locationId, period) {
    return this._fetchByDateRange(locationId, this._periodToRange(period));
  }

  async _fetchByDateRange(locationId, { from, to }) {
    const startDate = format(from, 'yyyy-MM-dd');
    const endDate   = format(to,   'yyyy-MM-dd');

    // Fetch daily_sales_summary and hourly_sales_heatmap in parallel.
    const [dailyRes, hourlyRes] = await Promise.all([
      api.request(
        'GET',
        `/data/daily_sales_summary?eq=location_id,${locationId}&gte=sale_date,${startDate}&lte=sale_date,${endDate}&order=sale_date.asc`
      ),
      api.request(
        'GET',
        `/data/hourly_sales_heatmap?eq=location_id,${locationId}`
      ),
    ]);

    if (dailyRes.error)  throw dailyRes.error;
    if (hourlyRes.error) throw hourlyRes.error;

    const dailyRows  = dailyRes.data  || [];
    const hourlyRows = hourlyRes.data || [];

    return this._transform(dailyRows, hourlyRows, { from, to });
  }

  // ------------------------------------------------------------------
  // Data transformation — produces the same shape the UI expects
  // ------------------------------------------------------------------

  _transform(dailyRows, hourlyRows, { from, to }) {
    // ---- summary metrics from daily_sales_summary ----
    const totalOrders = dailyRows.reduce((s, r) => s + Number(r.order_count || 0), 0);
    const totalNetSales = dailyRows.reduce((s, r) => s + Number(r.net_sales || 0), 0);
    // Use net_sales as a proxy for "revenue"; avg ticket approximated.
    const avgTicket = totalOrders > 0 ? (totalNetSales / totalOrders) : 0;

    // ---- responseTimeTrend: one entry per day in the range ----
    // daily_sales_summary has no response-time column — we produce order counts
    // per day and set avgResponse = 0.
    // TODO: requires new view (response_time per day not in reporting views)
    const days = eachDayOfInterval({ start: from, end: to });
    const dailyByDate = new Map();
    for (const r of dailyRows) {
      const key = r.sale_date;
      const cur = dailyByDate.get(key) || { orders: 0, net: 0 };
      cur.orders += Number(r.order_count || 0);
      cur.net    += Number(r.net_sales   || 0);
      dailyByDate.set(key, cur);
    }

    const responseTimeTrend = days.map(d => {
      const key = format(d, 'yyyy-MM-dd');
      const row = dailyByDate.get(key) || { orders: 0, net: 0 };
      return {
        date: format(d, 'MMM d'),
        avgResponse: 0, // TODO: requires new view
        orders: row.orders,
      };
    });

    // ---- weeklyOrderVolume: same daily rows, labelled as the date ----
    const weeklyOrderVolume = days.map(d => {
      const key = format(d, 'yyyy-MM-dd');
      const row = dailyByDate.get(key) || { orders: 0, net: 0 };
      return {
        day:     format(d, 'MMM d'),
        orders:  row.orders,
        revenue: Math.round(row.net * 100) / 100,
      };
    });

    // ---- performanceByHour from hourly_sales_heatmap ----
    // Aggregate across all days_of_week — view is trailing 90d, not date-filtered.
    const hourMap = new Map(); // hour_of_day -> { orders, revenue }
    for (const r of hourlyRows) {
      const h = Number(r.hour_of_day);
      const cur = hourMap.get(h) || { orders: 0, revenue: 0 };
      cur.orders  += Number(r.order_count   || 0);
      cur.revenue += Number(r.total_revenue || 0);
      hourMap.set(h, cur);
    }
    const performanceByHour = Array.from({ length: 24 }, (_, h) => {
      const cur = hourMap.get(h) || { orders: 0, revenue: 0 };
      const hourLabel = h === 0 ? '12am' : h < 12 ? `${h}am` : h === 12 ? '12pm' : `${h - 12}pm`;
      return {
        hour:           hourLabel,
        orders:         cur.orders,
        avgTimeMinutes: 0, // TODO: requires new view (no response_time in heatmap)
        avgTime:        '0m 0s',
        responseTime:   0,
      };
    }).filter(r => r.orders > 0);

    // ---- orderStatusDistribution ----
    // TODO: requires new view (no order status breakdown in reporting views)
    const orderStatusDistribution = [];

    // ---- recentOrders ----
    // TODO: requires new view (no per-order detail in reporting views)
    const recentOrders = [];

    // ---- averageRating, completionRate ----
    // TODO: requires new view (not in reporting views)
    const averageRating   = { rating: 0, trend: 'N/A', trendDirection: 'up' };
    const completionRate  = { percentage: 0, trend: 'N/A', trendDirection: 'up' };

    return {
      averageResponseTime: {
        minutes:        0,   // TODO: requires new view
        seconds:        0,
        trend:          'N/A',
        trendDirection: 'up',
      },
      totalOrders: {
        count:          totalOrders,
        trend:          'N/A',
        trendDirection: 'up',
      },
      averageRating,
      completionRate,
      recentOrders,
      performanceByHour,
      responseTimeTrend,
      orderStatusDistribution,
      weeklyOrderVolume,
      customerAnalytics: {
        // TODO: requires new view
        totalCustomers:        0,
        newCustomers:          0,
        returningCustomers:    0,
        avgOrdersPerCustomer:  0,
        retentionRate:         0,
      },
    };
  }

  // ------------------------------------------------------------------
  // Individual named fetchers kept for any direct callers
  // ------------------------------------------------------------------

  async getAnalyticsSummary(timeRange = '7d') {
    const locationId = await this.getLocationId();
    if (!locationId) throw new Error('No location found for user');
    const { from, to } = this._periodToRange(timeRange);
    const startDate = format(from, 'yyyy-MM-dd');
    const endDate   = format(to,   'yyyy-MM-dd');
    const { data, error } = await api.request(
      'GET',
      `/data/daily_sales_summary?eq=location_id,${locationId}&gte=sale_date,${startDate}&lte=sale_date,${endDate}`
    );
    if (error) throw error;
    return data || [];
  }

  async getOrdersByHour() {
    const locationId = await this.getLocationId();
    if (!locationId) throw new Error('No location found for user');
    const { data, error } = await api.request(
      'GET',
      `/data/hourly_sales_heatmap?eq=location_id,${locationId}`
    );
    if (error) throw error;
    return data || [];
  }

  async getDailyTrends(timeRange = '7d') {
    const locationId = await this.getLocationId();
    if (!locationId) throw new Error('No location found for user');
    const { from, to } = this._periodToRange(timeRange);
    const startDate = format(from, 'yyyy-MM-dd');
    const endDate   = format(to,   'yyyy-MM-dd');
    const { data, error } = await api.request(
      'GET',
      `/data/daily_sales_summary?eq=location_id,${locationId}&gte=sale_date,${startDate}&lte=sale_date,${endDate}&order=sale_date.asc`
    );
    if (error) throw error;
    return data || [];
  }

  // TODO: requires new view — no order status distribution in reporting views
  async getOrderStatusDistribution(_timeRange = '7d') {
    return [];
  }

  // TODO: requires new view — no per-order response-time detail in reporting views
  async getRecentOrdersWithResponseTimes(_limit = 10) {
    return [];
  }

  // TODO: requires new view — no customer analytics in reporting views
  async getCustomerAnalytics(_timeRange = '30d') {
    return {};
  }
}

// Singleton instance
const analyticsService = new AnalyticsService();
export default analyticsService;
