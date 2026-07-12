// reviews.js — marketplace reviews service.
//
// Public endpoint (no auth):
//   GET /stores/{slug}/reviews?limit=N
//     → [{ id, stars, text, photos[], created_at, owner_reply, owner_replied_at }]
//
// Authenticated endpoints:
//   POST /reviews           body: { order_id, stars, text?, photos? }
//   POST /reviews/{id}/reply body: { reply }

import { api } from '@/lib/api-client';

/**
 * Fetch public reviews for a store.
 *
 * @param {string} slug    — store URL slug
 * @param {number} [limit] — maximum reviews to return
 * @returns {Promise<{ data: Review[] | null, error: any }>}
 */
export async function fetchStoreReviews(slug, limit) {
  if (!slug) {
    return { data: null, error: { message: 'slug is required' } };
  }
  const qs = new URLSearchParams();
  if (limit != null) qs.set('limit', String(limit));
  const query = qs.toString() ? `?${qs.toString()}` : '';
  return api.request('GET', `/stores/${encodeURIComponent(slug)}/reviews${query}`, { auth: false });
}

/**
 * Submit a review for an order.  Requires the user to be authenticated.
 * Returns { data, error } — on 409 (already reviewed) `error.status === 409`.
 *
 * @param {{ orderId: string, stars: number, text?: string, photos?: string[] }} opts
 * @returns {Promise<{ data: any, error: any }>}
 */
export async function submitReview({ orderId, stars, text, photos }) {
  const body = { order_id: orderId, stars };
  if (text)   body.text   = text;
  if (photos) body.photos = photos;
  return api.request('POST', '/reviews', { body });
}

/**
 * Add or update an owner reply on a review.  Requires owner authentication.
 *
 * @param {string} reviewId — UUID of the review
 * @param {string} reply    — reply text
 * @returns {Promise<{ data: any, error: any }>}
 */
export async function replyToReview(reviewId, reply) {
  return api.request('POST', `/reviews/${encodeURIComponent(reviewId)}/reply`, { body: { reply } });
}

// ---------------------------------------------------------------------------
// Legacy default-export service object (used by src/pages/reviews/index.jsx).
// Provides an instance-style API wrapping the named functions above.
// ---------------------------------------------------------------------------

let _locationId = null;

const reviewsService = {
  setLocationId(id) { _locationId = id; },

  async getReviewsData(timeRange, limit = 100) {
    const slug = _locationId ?? '';
    const { data, error } = await fetchStoreReviews(slug, limit);
    // A store that isn't published to the marketplace yet (or has no slug)
    // returns 404 "store not found" — that's an empty state, not an error.
    // Only surface genuine failures.
    if (error && error.status !== 404) {
      throw new Error(error.message || 'Failed to fetch reviews');
    }
    const reviews = Array.isArray(data) ? data : [];
    const totalReviews = reviews.length;
    const averageRating = totalReviews > 0
      ? (reviews.reduce((s, r) => s + (r.stars ?? r.rating ?? 0), 0) / totalReviews)
      : 0;
    return {
      reviews,
      summary: { totalReviews, averageRating, anonymousReviews: 0, publicReviews: totalReviews, reviewsWithComments: reviews.filter(r => r.text).length },
      ratingStats: { average: averageRating.toFixed(1), distribution: [] },
      trends: [],
    };
  },

  async saveReviewReply(reviewId, reply) {
    const { data, error } = await replyToReview(reviewId, reply);
    if (error) throw new Error(error.message || 'Failed to save reply');
    return data;
  },
};

export default reviewsService;
