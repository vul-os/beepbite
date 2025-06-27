import { supabase } from '../services/supabase-client.jsx';

/**
 * Analytics service to fetch real data for reports dashboard
 */
class AnalyticsService {
  constructor() {
    this.defaultBistroId = null;
  }

  /**
   * Set the default bistro ID for queries
   */
  setBistroId(bistroId) {
    this.defaultBistroId = bistroId;
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
   * Get comprehensive analytics data for the dashboard
   */
  async getAnalyticsData(timeRange = '7d') {
    try {
      const bistroId = await this.getUserBistroId();
      if (!bistroId) {
        throw new Error('No bistro found for user');
      }

      // Execute all analytics queries in parallel
      const [
        summaryResult,
        statusDistResult,
        hourlyResult,
        dailyTrendsResult,
        recentOrdersResult,
        customerAnalyticsResult
      ] = await Promise.all([
        supabase.rpc('get_analytics_summary', { p_bistro_id: bistroId, p_period: timeRange }),
        supabase.rpc('get_order_status_distribution', { p_bistro_id: bistroId, p_period: timeRange }),
        supabase.rpc('get_orders_by_hour', { p_bistro_id: bistroId, p_period: timeRange }),
        supabase.rpc('get_daily_trends', { p_bistro_id: bistroId, p_period: timeRange }),
        supabase.rpc('get_recent_orders_with_response_times', { p_bistro_id: bistroId, p_limit: 10 }),
        supabase.rpc('get_customer_analytics', { p_bistro_id: bistroId, p_period: timeRange })
      ]);

      // Check for errors
      if (summaryResult.error) throw summaryResult.error;
      if (statusDistResult.error) throw statusDistResult.error;
      if (hourlyResult.error) throw hourlyResult.error;
      if (dailyTrendsResult.error) throw dailyTrendsResult.error;
      if (recentOrdersResult.error) throw recentOrdersResult.error;
      if (customerAnalyticsResult.error) throw customerAnalyticsResult.error;

      const summary = summaryResult.data[0] || {};
      const statusDistribution = statusDistResult.data || [];
      const hourlyData = hourlyResult.data || [];
      const dailyTrends = dailyTrendsResult.data || [];
      const recentOrders = recentOrdersResult.data || [];
      const customerStats = customerAnalyticsResult.data[0] || {};

      // Transform the data to match the expected format
      return this.transformAnalyticsData({
        summary,
        statusDistribution,
        hourlyData,
        dailyTrends,
        recentOrders,
        customerStats,
        timeRange
      });

    } catch (error) {
      console.error('Error fetching analytics data:', error);
      throw error;
    }
  }

  /**
   * Transform raw database data into the format expected by the UI
   */
  transformAnalyticsData({ summary, statusDistribution, hourlyData, dailyTrends, recentOrders, customerStats, timeRange }) {
    // Calculate previous period for trend comparison (simplified)
    const currentOrders = Number(summary.total_orders) || 0;
    const currentRating = Number(summary.average_rating) || 0;
    const currentCompletionRate = Number(summary.completion_rate) || 0;
    const currentResponseTime = Number(summary.avg_response_time_minutes) || 0;

    // Format response time
    const responseMinutes = Math.floor(currentResponseTime);
    const responseSeconds = Math.floor((currentResponseTime - responseMinutes) * 60);

    // Transform status distribution for pie chart
    const orderStatusDistribution = statusDistribution.map(status => ({
      name: this.capitalizeStatus(status.status),
      value: Number(status.count),
      color: this.getStatusColor(status.status)
    }));

    // Transform hourly data for bar chart
    const performanceByHour = hourlyData.map(hour => ({
      hour: hour.hour_label,
      orders: Number(hour.order_count),
      avgTimeMinutes: Number(hour.avg_response_time_minutes) || 0,
      avgTime: this.formatResponseTime(Number(hour.avg_response_time_minutes) || 0),
      responseTime: Math.floor((Number(hour.avg_response_time_minutes) || 0) * 60) // in seconds
    }));

    // Transform daily trends for line chart
    const responseTimeTrend = dailyTrends.map(day => ({
      date: day.day_name,
      avgResponse: Number(day.avg_response_time_minutes) || 0,
      orders: Number(day.order_count)
    }));

    // Transform weekly order volume (using daily trends)
    const weeklyOrderVolume = dailyTrends.map(day => ({
      day: day.day_name,
      orders: Number(day.order_count),
      revenue: Number(day.order_count) * 25 // Estimated revenue per order
    }));

    // Transform recent orders
    const recentOrdersTransformed = recentOrders.map((order, index) => ({
      id: String(index + 1),
      order_number: order.order_number,
      created_at: order.created_at,
      response_time: order.response_time_formatted || 'No response',
      status: order.status,
      customer_name: order.customer_name
    }));

    return {
      averageResponseTime: {
        minutes: responseMinutes,
        seconds: responseSeconds,
        trend: '+12%', // TODO: Calculate actual trend
        trendDirection: 'up'
      },
      totalOrders: {
        count: currentOrders,
        trend: '+23%', // TODO: Calculate actual trend
        trendDirection: 'up'
      },
      averageRating: {
        rating: currentRating,
        trend: '+0.2', // TODO: Calculate actual trend
        trendDirection: 'up'
      },
      completionRate: {
        percentage: currentCompletionRate,
        trend: '+1.5%', // TODO: Calculate actual trend
        trendDirection: 'up'
      },
      recentOrders: recentOrdersTransformed,
      performanceByHour,
      responseTimeTrend,
      orderStatusDistribution,
      weeklyOrderVolume,
      customerAnalytics: {
        totalCustomers: Number(customerStats.total_customers) || 0,
        newCustomers: Number(customerStats.new_customers) || 0,
        returningCustomers: Number(customerStats.returning_customers) || 0,
        avgOrdersPerCustomer: Number(customerStats.avg_orders_per_customer) || 0,
        retentionRate: Number(customerStats.customer_retention_rate) || 0
      }
    };
  }

  /**
   * Helper method to capitalize status text
   */
  capitalizeStatus(status) {
    const statusMap = {
      'pending': 'Pending',
      'preparing': 'Preparing',
      'ready': 'Ready',
      'completed': 'Completed',
      'cancelled': 'Cancelled'
    };
    return statusMap[status] || status;
  }

  /**
   * Helper method to get status colors for charts
   */
  getStatusColor(status) {
    const colorMap = {
      'completed': '#10b981',
      'preparing': '#3b82f6',
      'pending': '#f59e0b',
      'ready': '#f59e0b',
      'cancelled': '#ef4444'
    };
    return colorMap[status] || '#6b7280';
  }

  /**
   * Helper method to format response time
   */
  formatResponseTime(minutes) {
    if (minutes === 0) return '0m 0s';
    const mins = Math.floor(minutes);
    const secs = Math.floor((minutes - mins) * 60);
    return `${mins}m ${secs}s`;
  }

  /**
   * Get analytics summary for a specific period
   */
  async getAnalyticsSummary(timeRange = '7d') {
    try {
      const bistroId = await this.getUserBistroId();
      if (!bistroId) {
        throw new Error('No bistro found for user');
      }

      const { data, error } = await supabase.rpc('get_analytics_summary', {
        p_bistro_id: bistroId,
        p_period: timeRange
      });

      if (error) throw error;
      return data[0] || {};
    } catch (error) {
      console.error('Error fetching analytics summary:', error);
      throw error;
    }
  }

  /**
   * Get order status distribution
   */
  async getOrderStatusDistribution(timeRange = '7d') {
    try {
      const bistroId = await this.getUserBistroId();
      if (!bistroId) {
        throw new Error('No bistro found for user');
      }

      const { data, error } = await supabase.rpc('get_order_status_distribution', {
        p_bistro_id: bistroId,
        p_period: timeRange
      });

      if (error) throw error;
      return data || [];
    } catch (error) {
      console.error('Error fetching order status distribution:', error);
      throw error;
    }
  }

  /**
   * Get hourly order data
   */
  async getOrdersByHour(timeRange = '7d') {
    try {
      const bistroId = await this.getUserBistroId();
      if (!bistroId) {
        throw new Error('No bistro found for user');
      }

      const { data, error } = await supabase.rpc('get_orders_by_hour', {
        p_bistro_id: bistroId,
        p_period: timeRange
      });

      if (error) throw error;
      return data || [];
    } catch (error) {
      console.error('Error fetching orders by hour:', error);
      throw error;
    }
  }

  /**
   * Get daily trends
   */
  async getDailyTrends(timeRange = '7d') {
    try {
      const bistroId = await this.getUserBistroId();
      if (!bistroId) {
        throw new Error('No bistro found for user');
      }

      const { data, error } = await supabase.rpc('get_daily_trends', {
        p_bistro_id: bistroId,
        p_period: timeRange
      });

      if (error) throw error;
      return data || [];
    } catch (error) {
      console.error('Error fetching daily trends:', error);
      throw error;
    }
  }

  /**
   * Get recent orders with response times
   */
  async getRecentOrdersWithResponseTimes(limit = 10) {
    try {
      const bistroId = await this.getUserBistroId();
      if (!bistroId) {
        throw new Error('No bistro found for user');
      }

      const { data, error } = await supabase.rpc('get_recent_orders_with_response_times', {
        p_bistro_id: bistroId,
        p_limit: limit
      });

      if (error) throw error;
      return data || [];
    } catch (error) {
      console.error('Error fetching recent orders:', error);
      throw error;
    }
  }

  /**
   * Get customer analytics
   */
  async getCustomerAnalytics(timeRange = '30d') {
    try {
      const bistroId = await this.getUserBistroId();
      if (!bistroId) {
        throw new Error('No bistro found for user');
      }

      const { data, error } = await supabase.rpc('get_customer_analytics', {
        p_bistro_id: bistroId,
        p_period: timeRange
      });

      if (error) throw error;
      return data[0] || {};
    } catch (error) {
      console.error('Error fetching customer analytics:', error);
      throw error;
    }
  }
}

// Create and export a singleton instance
const analyticsService = new AnalyticsService();
export default analyticsService; 