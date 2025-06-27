import { supabase } from '../services/supabase-client';

/**
 * Reviews service to fetch real data for reviews dashboard
 */
class ReviewsService {
  constructor() {
    this.defaultBistroId = null;
  }

  /**
   * Get the user's bistro ID from their profile
   */
  async getUserBistroId() {
    if (this.defaultBistroId) {
      return this.defaultBistroId;
    }

    try {
      const { data: user } = await supabase.auth.getUser();
      if (!user?.user?.id) {
        throw new Error('No authenticated user');
      }

      // Get the user's bistro from bistro_members
      const { data: membership, error } = await supabase
        .from('bistro_members')
        .select('bistro_id')
        .eq('profile_id', user.user.id)
        .single();

      if (error) {
        console.error('Error fetching user bistro:', error);
        return null;
      }

      this.defaultBistroId = membership?.bistro_id;
      return this.defaultBistroId;
    } catch (error) {
      console.error('Error getting user bistro ID:', error);
      return null;
    }
  }

  /**
   * Get comprehensive reviews data for the reviews page
   */
  async getReviewsData(timeRange = '30d', limit = 50, activeBistroId = null) {
    try {
      const bistroId = activeBistroId || await this.getUserBistroId();
      if (!bistroId) {
        throw new Error('No bistro found for user');
      }

      // Execute all review queries in parallel
      const [
        reviewsResult,
        summaryResult,
        distributionResult,
        trendsResult
      ] = await Promise.all([
        supabase.rpc('get_reviews_analytics', { 
          p_bistro_id: bistroId, 
          p_period: timeRange, 
          p_limit: limit 
        }),
        supabase.rpc('get_reviews_summary', { 
          p_bistro_id: bistroId, 
          p_period: timeRange 
        }),
        supabase.rpc('get_reviews_rating_distribution', { 
          p_bistro_id: bistroId, 
          p_period: timeRange 
        }),
        supabase.rpc('get_review_trends', { 
          p_bistro_id: bistroId, 
          p_period: timeRange 
        })
      ]);

      // Check for errors
      if (reviewsResult.error) throw reviewsResult.error;
      if (summaryResult.error) throw summaryResult.error;
      if (distributionResult.error) throw distributionResult.error;
      if (trendsResult.error) throw trendsResult.error;

      const reviews = reviewsResult.data || [];
      const summary = summaryResult.data[0] || {};
      const distribution = distributionResult.data || [];
      const trends = trendsResult.data || [];

      // Transform the data to match the expected format
      return this.transformReviewsData({
        reviews,
        summary,
        distribution,
        trends,
        timeRange
      });

    } catch (error) {
      console.error('Error fetching reviews data:', error);
      throw error;
    }
  }

  /**
   * Transform raw database data into the format expected by the UI
   */
  transformReviewsData({ reviews, summary, distribution, trends, timeRange }) {
    // Transform reviews data
    const transformedReviews = reviews.map(review => ({
      id: review.review_id,
      order_number: review.order_number,
      customer_name: review.customer_name,
      customer_whatsapp: review.customer_whatsapp,
      rating: review.rating,
      comment: review.comment,
      created_at: review.review_created_at,
      has_reply: false, // TODO: Implement reply functionality
      reply: null, // TODO: Implement reply functionality
      verified: true, // All reviews from WhatsApp are verified
      anonymous: review.anonymous,
      bite_id: review.bite_id,
      bistro_name: review.bistro_name
    }));

    // Transform rating distribution
    const ratingStats = {
      average: Number(summary.average_rating) || 0,
      distribution: distribution.map(stat => ({
        rating: stat.rating,
        count: Number(stat.count),
        percentage: Number(stat.percentage)
      }))
    };

    // Transform trends data
    const reviewTrends = trends.map(trend => ({
      date: trend.day_name,
      count: Number(trend.review_count),
      avgRating: Number(trend.avg_rating),
      highRatings: Number(trend.high_ratings),
      lowRatings: Number(trend.low_ratings)
    }));

    return {
      reviews: transformedReviews,
      summary: {
        totalReviews: Number(summary.total_reviews) || 0,
        averageRating: Number(summary.average_rating) || 0,
        anonymousReviews: Number(summary.anonymous_reviews) || 0,
        publicReviews: Number(summary.public_reviews) || 0,
        reviewsWithComments: Number(summary.reviews_with_comments) || 0,
        periodStart: summary.period_start,
        periodEnd: summary.period_end
      },
      ratingStats,
      trends: reviewTrends,
      timeRange
    };
  }

  /**
   * Get reviews analytics using direct bistro ID (for auth context)
   */
  async getReviewsAnalytics(bistroId, timeRange = '30d', limit = 50) {
    try {
      if (!bistroId) {
        throw new Error('No bistro ID provided');
      }

      const { data, error } = await supabase.rpc('get_reviews_analytics', {
        p_bistro_id: bistroId,
        p_period: timeRange,
        p_limit: limit
      });

      if (error) throw error;
      return data || [];
    } catch (error) {
      console.error('Error fetching reviews analytics:', error);
      throw error;
    }
  }

  /**
   * Get reviews summary
   */
  async getReviewsSummary(bistroId, timeRange = '30d') {
    try {
      if (!bistroId) {
        throw new Error('No bistro ID provided');
      }

      const { data, error } = await supabase.rpc('get_reviews_summary', {
        p_bistro_id: bistroId,
        p_period: timeRange
      });

      if (error) throw error;
      return data[0] || {};
    } catch (error) {
      console.error('Error fetching reviews summary:', error);
      throw error;
    }
  }

  /**
   * Get rating distribution
   */
  async getRatingDistribution(bistroId, timeRange = '30d') {
    try {
      if (!bistroId) {
        throw new Error('No bistro ID provided');
      }

      const { data, error } = await supabase.rpc('get_reviews_rating_distribution', {
        p_bistro_id: bistroId,
        p_period: timeRange
      });

      if (error) throw error;
      return data || [];
    } catch (error) {
      console.error('Error fetching rating distribution:', error);
      throw error;
    }
  }

  /**
   * Get recent reviews (for dashboard widgets)
   */
  async getRecentReviews(bistroId, limit = 5) {
    try {
      if (!bistroId) {
        throw new Error('No bistro ID provided');
      }

      const { data, error } = await supabase.rpc('get_recent_reviews', {
        p_bistro_id: bistroId,
        p_limit: limit
      });

      if (error) throw error;
      return data || [];
    } catch (error) {
      console.error('Error fetching recent reviews:', error);
      throw error;
    }
  }

  /**
   * Get review trends
   */
  async getReviewTrends(bistroId, timeRange = '30d') {
    try {
      if (!bistroId) {
        throw new Error('No bistro ID provided');
      }

      const { data, error } = await supabase.rpc('get_review_trends', {
        p_bistro_id: bistroId,
        p_period: timeRange
      });

      if (error) throw error;
      return data || [];
    } catch (error) {
      console.error('Error fetching review trends:', error);
      throw error;
    }
  }
}

// Create and export a single instance
const reviewsService = new ReviewsService();
export default reviewsService; 