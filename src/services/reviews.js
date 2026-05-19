import { api } from '../lib/api-client.js';
import { subDays, format } from 'date-fns';

/**
 * Reviews service — reads from the `reviews` table via the REST data layer.
 *
 * Schema (migration 2 — init_schema):
 *   reviews(id, order_id, rating, comment, created_at)
 *   orders(id, location_id, customer_id, order_number, created_at, …)
 *   customers(id, first_name, last_name, whatsapp_number, …)
 *
 * NOTE: reviews has no reply/replied_at or location_id columns.
 *   – reply / replied_at features are marked TODO below.
 *   – Scoping by location is done by joining through orders.
 */
class ReviewsService {
  constructor() {
    this._locationId = null;
  }

  // ------------------------------------------------------------------
  // Location resolution  (mirrors analytics.js pattern)
  // ------------------------------------------------------------------

  async getLocationId() {
    if (this._locationId) return this._locationId;

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

    const { data, error } = await api.request('GET', '/data/locations?limit=1');
    if (!error && Array.isArray(data) && data.length > 0) {
      this._locationId = data[0].id;
      return this._locationId;
    }

    return null;
  }

  setLocationId(locationId) {
    this._locationId = locationId;
  }

  // ------------------------------------------------------------------
  // Period → date range helper
  // ------------------------------------------------------------------

  _periodToRange(period) {
    const to = new Date();
    let days = 30;
    if (period === '1d')  days = 1;
    else if (period === '7d')  days = 7;
    else if (period === '90d') days = 90;
    else if (period === 'all') return null; // no date filter
    return { from: subDays(to, days - 1), to };
  }

  // ------------------------------------------------------------------
  // Main entry point — mirrors old getReviewsData(timeRange, limit, activeBistroId)
  // The third arg (activeBistroId) is ignored; location is resolved from
  // localStorage / API (same as analytics.js).
  // ------------------------------------------------------------------

  async getReviewsData(timeRange = '30d', limit = 50 /*, _activeBistroId */) {
    try {
      const locationId = await this.getLocationId();
      if (!locationId) throw new Error('No location found for user');

      const range = this._periodToRange(timeRange);

      // 1. Fetch orders scoped to this location (we only need id, customer_id, order_number).
      //    We use these to map review → order → customer.
      let ordersUrl = `/data/orders?eq=location_id,${locationId}&select=id,customer_id,order_number`;
      if (range) {
        ordersUrl += `&gte=created_at,${format(range.from, "yyyy-MM-dd")}&lte=created_at,${format(range.to, "yyyy-MM-dd")}`;
      }

      const ordersRes = await api.request('GET', ordersUrl);
      if (ordersRes.error) throw ordersRes.error;
      const orders = ordersRes.data || [];

      if (orders.length === 0) {
        return this._emptyResult(timeRange);
      }

      const orderIds = orders.map(o => o.id);
      const orderById = new Map(orders.map(o => [o.id, o]));

      // 2. Fetch reviews for those order IDs.
      //    The `in` param format is: in=order_id,id1,id2,...
      const inParam = ['order_id', ...orderIds].join(',');
      let reviewsUrl = `/data/reviews?in=${encodeURIComponent(inParam)}&order=created_at.desc&limit=${limit}`;

      const reviewsRes = await api.request('GET', reviewsUrl);
      if (reviewsRes.error) throw reviewsRes.error;
      const rawReviews = reviewsRes.data || [];

      // 3. Collect unique customer IDs and fetch customer names.
      const customerIds = [...new Set(
        rawReviews
          .map(r => orderById.get(r.order_id)?.customer_id)
          .filter(Boolean)
      )];

      let customerById = new Map();
      if (customerIds.length > 0) {
        const custParam = ['id', ...customerIds].join(',');
        const custRes = await api.request(
          'GET',
          `/data/customers?in=${encodeURIComponent(custParam)}&select=id,first_name,last_name,whatsapp_number`
        );
        if (!custRes.error && Array.isArray(custRes.data)) {
          custRes.data.forEach(c => customerById.set(c.id, c));
        }
      }

      // 4. Stitch everything together.
      return this._transform(rawReviews, orderById, customerById, timeRange);

    } catch (error) {
      console.error('Error fetching reviews data:', error);
      throw error;
    }
  }

  // ------------------------------------------------------------------
  // Transform raw rows into the shape the UI expects
  // ------------------------------------------------------------------

  _transform(rawReviews, orderById, customerById, timeRange) {
    const reviews = rawReviews.map(r => {
      const order    = orderById.get(r.order_id) || {};
      const customer = customerById.get(order.customer_id) || {};
      const firstName = customer.first_name || '';
      const lastName  = customer.last_name  || '';
      const customerName = [firstName, lastName].filter(Boolean).join(' ') || 'Anonymous';

      return {
        id:               r.id,
        order_number:     order.order_number || null,
        customer_name:    customerName,
        customer_whatsapp: customer.whatsapp_number || null,
        rating:           r.rating,
        comment:          r.comment || '',
        created_at:       r.created_at,
        has_reply:        !!r.reply,
        reply:            r.reply || null,
        replied_at:       r.replied_at || null,
        verified:         true, // all reviews from WhatsApp are verified
        // TODO: requires new column — reviews table has no anonymous column
        anonymous:        false,
      };
    });

    // Rating distribution (1–10)
    const total = reviews.length;
    const avg   = total > 0
      ? (reviews.reduce((s, r) => s + r.rating, 0) / total)
      : 0;

    const distribution = [10, 9, 8, 7, 6, 5, 4, 3, 2, 1].map(rating => {
      const count = reviews.filter(r => r.rating === rating).length;
      return {
        rating,
        count,
        percentage: total > 0 ? Math.round((count / total) * 100) : 0,
      };
    });

    // Trends: group by date
    const trendMap = new Map();
    for (const r of reviews) {
      const day = r.created_at ? r.created_at.slice(0, 10) : 'unknown';
      const cur = trendMap.get(day) || { count: 0, ratingSum: 0, high: 0, low: 0 };
      cur.count++;
      cur.ratingSum += r.rating;
      if (r.rating >= 8) cur.high++;
      else if (r.rating <= 5) cur.low++;
      trendMap.set(day, cur);
    }
    const trends = [...trendMap.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([day, v]) => ({
        date:        day,
        count:       v.count,
        avgRating:   v.count > 0 ? Math.round((v.ratingSum / v.count) * 10) / 10 : 0,
        highRatings: v.high,
        lowRatings:  v.low,
      }));

    return {
      reviews,
      summary: {
        totalReviews:         total,
        averageRating:        Math.round(avg * 10) / 10,
        // TODO: requires new column — reviews table has no anonymous column
        anonymousReviews:     0,
        publicReviews:        total,
        reviewsWithComments:  reviews.filter(r => r.comment).length,
        periodStart:          null,
        periodEnd:            null,
      },
      ratingStats: {
        average:      Math.round(avg * 10) / 10,
        distribution,
      },
      trends,
      timeRange,
    };
  }

  _emptyResult(timeRange) {
    return {
      reviews: [],
      summary: {
        totalReviews: 0,
        averageRating: 0,
        anonymousReviews: 0,
        publicReviews: 0,
        reviewsWithComments: 0,
        periodStart: null,
        periodEnd: null,
      },
      ratingStats: {
        average: 0,
        distribution: [10, 9, 8, 7, 6, 5, 4, 3, 2, 1].map(rating => ({
          rating, count: 0, percentage: 0,
        })),
      },
      trends: [],
      timeRange,
    };
  }

  // ------------------------------------------------------------------
  // Individual helpers kept for any direct callers
  // (previously called deleted RPCs; now delegate to getReviewsData)
  // ------------------------------------------------------------------

  async getReviewsAnalytics(/* bistroId */ _id, timeRange = '30d', limit = 50) {
    const result = await this.getReviewsData(timeRange, limit);
    return result.reviews;
  }

  async getReviewsSummary(/* bistroId */ _id, timeRange = '30d') {
    const result = await this.getReviewsData(timeRange, 200);
    return result.summary;
  }

  async getRatingDistribution(/* bistroId */ _id, timeRange = '30d') {
    const result = await this.getReviewsData(timeRange, 200);
    return result.ratingStats.distribution;
  }

  async getRecentReviews(/* bistroId */ _id, limit = 5) {
    const result = await this.getReviewsData('all', limit);
    return result.reviews.slice(0, limit);
  }

  async getReviewTrends(/* bistroId */ _id, timeRange = '30d') {
    const result = await this.getReviewsData(timeRange, 200);
    return result.trends;
  }

  // ------------------------------------------------------------------
  // Save / update a reply for a single review
  // ------------------------------------------------------------------

  async saveReviewReply(reviewId, replyText) {
    const { data, error } = await api.request(
      'PATCH',
      `/data/reviews?eq=id,${reviewId}`,
      { body: { reply: replyText, replied_at: new Date().toISOString() } },
    );
    if (error) throw error;
    return data;
  }
}

const reviewsService = new ReviewsService();
export default reviewsService;
