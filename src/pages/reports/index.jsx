import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { 
  Clock, 
  TrendingUp, 
  Star, 
  MessageSquare, 
  BarChart3,
  Calendar,
  Download,
  Filter,
  LineChart,
  PieChart
} from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  LineChart as ReLineChart,
  Line,
  AreaChart,
  Area,
  BarChart,
  Bar,
  PieChart as RePieChart,
  Pie,
  Cell,
  ComposedChart,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer
} from 'recharts';
import { formatDistanceToNow, addDays } from 'date-fns';
import analyticsService from '../../services/analytics.js';
import { DateRangePicker } from "@/components/ui/date-range-picker";

const Reports = () => {
  const [timeRange, setTimeRange] = useState('7d');
  const [customDateRange, setCustomDateRange] = useState(null);
  const [useCustomRange, setUseCustomRange] = useState(false);
  const [loading, setLoading] = useState(true);
  const [analyticsData, setAnalyticsData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetchAnalytics();
  }, [timeRange, customDateRange, useCustomRange]);

  const fetchAnalytics = async () => {
    setLoading(true);
    setError(null);
    try {
      console.log('Fetching analytics data for:', useCustomRange ? customDateRange : timeRange);
      
      // Use custom date range if enabled and available, otherwise use predefined period
      const queryParam = useCustomRange && customDateRange ? customDateRange : timeRange;
      const data = await analyticsService.getAnalyticsData(queryParam);
      
      console.log('Analytics data received:', data);
      setAnalyticsData(data);
    } catch (error) {
      console.error('Error fetching analytics:', error);
      setError(error.message);
      
      // Fallback to mock data if real data fails
      const mockAnalytics = {
        averageResponseTime: {
          minutes: 0,
          seconds: 0,
          trend: 'No data',
          trendDirection: 'up'
        },
        totalOrders: {
          count: 0,
          trend: 'No data',
          trendDirection: 'up'
        },
        averageRating: {
          rating: 0,
          trend: 'No data',
          trendDirection: 'up'
        },
        completionRate: {
          percentage: 0,
          trend: 'No data',
          trendDirection: 'up'
        },
        recentOrders: [],
        performanceByHour: [],
        responseTimeTrend: [],
        orderStatusDistribution: [],
        weeklyOrderVolume: []
      };
      setAnalyticsData(mockAnalytics);
    } finally {
      setLoading(false);
    }
  };

  const handleTimeRangeChange = (value) => {
    if (value === 'custom') {
      setUseCustomRange(true);
      setTimeRange('custom'); // Set timeRange to 'custom' so dropdown shows it
      // Set default custom range to last 7 days
      if (!customDateRange) {
        const defaultRange = {
          from: addDays(new Date(), -6),
          to: new Date(),
        };
        setCustomDateRange(defaultRange);
      }
    } else {
      setUseCustomRange(false);
      setTimeRange(value);
    }
  };

  const handleCustomDateRangeChange = (dateRange) => {
    setCustomDateRange(dateRange);
  };

  const getTrendColor = (direction) => {
    return direction === 'up' ? 'text-orange-600' : 'text-gray-600';
  };

  const getTrendIcon = (direction) => {
    return direction === 'up' ? '↗' : '↘';
  };

  const generateInsights = () => {
    if (!analyticsData) return { working: [], improvements: [] };

    const insights = {
      working: [],
      improvements: []
    };

    // Analysis based on real data
    const totalOrders = analyticsData.totalOrders.count;
    const completionRate = analyticsData.completionRate.percentage;
    const avgRating = analyticsData.averageRating.rating;
    const avgResponseTime = analyticsData.averageResponseTime.minutes;

    // What's working well
    if (totalOrders > 0) {
      insights.working.push(`• Processed ${totalOrders} orders in the selected period`);
    }
    
    if (completionRate >= 90) {
      insights.working.push(`• Excellent completion rate of ${completionRate}%`);
    } else if (completionRate >= 80) {
      insights.working.push(`• Good completion rate of ${completionRate}%`);
    }

    if (avgRating >= 8) {
      insights.working.push(`• High customer satisfaction at ${avgRating}/10 stars`);
    } else if (avgRating >= 6) {
      insights.working.push(`• Decent customer satisfaction at ${avgRating}/10 stars`);
    }

    if (avgResponseTime <= 5) {
      insights.working.push(`• Fast response times averaging ${avgResponseTime} minutes`);
    }

    // Areas for improvement
    if (totalOrders === 0) {
      insights.improvements.push('• No orders found for the selected period');
    }

    if (completionRate < 80) {
      insights.improvements.push(`• Completion rate could be improved (currently ${completionRate}%)`);
    }

    if (avgRating < 6) {
      insights.improvements.push(`• Customer satisfaction needs attention (${avgRating}/10)`);
    }

    if (avgResponseTime > 10) {
      insights.improvements.push(`• Response times could be faster (currently ${avgResponseTime} minutes)`);
    }

    if (analyticsData.performanceByHour?.length === 0) {
      insights.improvements.push('• No hourly performance data available');
    }

    // Default messages if no specific insights
    if (insights.working.length === 0) {
      insights.working.push('• System is operational and collecting data');
    }

    if (insights.improvements.length === 0) {
      insights.improvements.push('• Continue monitoring for optimization opportunities');
    }

    return insights;
  };

  if (loading) {
    return (
      <div className="w-full max-w-none">
        <div className="space-y-6 p-4 sm:p-6">
          <div className="h-8 bg-orange-100 rounded w-48 animate-pulse"></div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-32 bg-orange-50 rounded animate-pulse"></div>
            ))}
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-80 bg-gray-200 rounded animate-pulse"></div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (!analyticsData) {
    return (
      <div className="w-full max-w-none">
        <div className="space-y-6 p-4 sm:p-6">
          <div className="text-center py-12">
            <h2 className="text-xl font-semibold text-gray-900 mb-2">No Analytics Data Available</h2>
            <p className="text-gray-600">Please check your data connection and try again.</p>
            <Button onClick={fetchAnalytics} className="mt-4">
              Retry
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const insights = generateInsights();

  return (
    <div className="w-full max-w-none overflow-x-hidden bg-white">
      <div className="space-y-4 sm:space-y-6 p-4 sm:p-6">
        {/* Header */}
        <div className="flex flex-col space-y-3 sm:space-y-0 sm:flex-row sm:items-start sm:justify-between gap-4">
          <div className="space-y-1 min-w-0 flex-1">
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 break-words">Reports & Analytics</h1>
            <p className="text-sm sm:text-base text-gray-600 break-words">Track your restaurant's performance and response times</p>
            {error && (
              <div className="text-sm text-orange-600 bg-orange-50 px-3 py-2 rounded-md">
                ⚠️ Using limited data: {error}
              </div>
            )}
            {loading && (
              <div className="text-sm text-orange-600 bg-orange-50 px-3 py-2 rounded-md">
                📊 Loading analytics data...
              </div>
            )}
          </div>
          
          <div className="flex flex-col space-y-2 sm:space-y-0 sm:flex-row sm:items-center gap-2 sm:gap-3 shrink-0">
            <Select value={useCustomRange ? 'custom' : timeRange} onValueChange={handleTimeRangeChange}>
              <SelectTrigger className="w-full sm:w-40 border-orange-200 focus:ring-orange-500">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1d">Last 24 hours</SelectItem>
                <SelectItem value="7d">Last 7 days</SelectItem>
                <SelectItem value="30d">Last 30 days</SelectItem>
                <SelectItem value="90d">Last 3 months</SelectItem>
                <SelectItem value="custom">Custom Range</SelectItem>
              </SelectContent>
            </Select>
            
            {useCustomRange && (
              <DateRangePicker
                date={customDateRange}
                setDate={handleCustomDateRangeChange}
                className="w-full sm:w-80"
                placeholder="Select date range"
              />
            )}
            
            <Button variant="outline" className="flex items-center gap-2 w-full sm:w-auto whitespace-nowrap border-orange-200 text-orange-600 hover:bg-orange-50">
              <Download className="w-4 h-4 shrink-0" />
              <span className="text-sm sm:text-base">Export</span>
            </Button>
          </div>
        </div>

        {/* Key Metrics */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 lg:gap-6">
          <Card className="min-w-0 border-orange-100">
            <CardContent className="p-3 sm:p-4 lg:p-6">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-xs sm:text-sm font-medium text-gray-600 truncate">Avg Response Time</p>
                  <div className="flex items-baseline gap-1 mt-1">
                    <span className="text-lg sm:text-xl lg:text-2xl font-bold text-gray-900">
                      {analyticsData.averageResponseTime.minutes}m
                    </span>
                    <span className="text-sm sm:text-base lg:text-lg font-semibold text-gray-600">
                      {analyticsData.averageResponseTime.seconds}s
                    </span>
                  </div>
                  <div className={`flex items-center gap-1 text-xs sm:text-sm mt-1 ${getTrendColor(analyticsData.averageResponseTime.trendDirection)}`}>
                    <span>{getTrendIcon(analyticsData.averageResponseTime.trendDirection)}</span>
                    <span className="truncate">{analyticsData.averageResponseTime.trend}</span>
                  </div>
                </div>
                <div className="w-8 h-8 sm:w-10 sm:h-10 lg:w-12 lg:h-12 bg-orange-100 rounded-lg flex items-center justify-center shrink-0">
                  <Clock className="w-4 h-4 sm:w-5 sm:h-5 lg:w-6 lg:h-6 text-orange-600" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="min-w-0 border-orange-100">
            <CardContent className="p-3 sm:p-4 lg:p-6">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-xs sm:text-sm font-medium text-gray-600 truncate">Total Orders</p>
                  <div className="text-lg sm:text-xl lg:text-2xl font-bold text-gray-900 mt-1">
                    {analyticsData.totalOrders.count.toLocaleString()}
                  </div>
                  <div className={`flex items-center gap-1 text-xs sm:text-sm mt-1 ${getTrendColor(analyticsData.totalOrders.trendDirection)}`}>
                    <span>{getTrendIcon(analyticsData.totalOrders.trendDirection)}</span>
                    <span className="truncate">{analyticsData.totalOrders.trend}</span>
                  </div>
                </div>
                <div className="w-8 h-8 sm:w-10 sm:h-10 lg:w-12 lg:h-12 bg-orange-100 rounded-lg flex items-center justify-center shrink-0">
                  <BarChart3 className="w-4 h-4 sm:w-5 sm:h-5 lg:w-6 lg:h-6 text-orange-600" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="min-w-0 border-orange-100">
            <CardContent className="p-3 sm:p-4 lg:p-6">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-xs sm:text-sm font-medium text-gray-600 truncate">Average Rating</p>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-lg sm:text-xl lg:text-2xl font-bold text-gray-900">
                      {analyticsData.averageRating.rating}
                    </span>
                    <div className="flex">
                      {[...Array(5)].map((_, i) => (
                        <Star 
                          key={i} 
                          className={`w-3 h-3 sm:w-4 sm:h-4 ${
                            i < Math.floor(analyticsData.averageRating.rating / 2) 
                              ? 'text-yellow-400 fill-current' 
                              : 'text-gray-300'
                          }`} 
                        />
                      ))}
                    </div>
                  </div>
                  <div className={`flex items-center gap-1 text-xs sm:text-sm mt-1 ${getTrendColor(analyticsData.averageRating.trendDirection)}`}>
                    <span>{getTrendIcon(analyticsData.averageRating.trendDirection)}</span>
                    <span className="truncate">{analyticsData.averageRating.trend}</span>
                  </div>
                </div>
                <div className="w-8 h-8 sm:w-10 sm:h-10 lg:w-12 lg:h-12 bg-orange-100 rounded-lg flex items-center justify-center shrink-0">
                  <Star className="w-4 h-4 sm:w-5 sm:h-5 lg:w-6 lg:h-6 text-orange-600" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="min-w-0 border-orange-100">
            <CardContent className="p-3 sm:p-4 lg:p-6">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-xs sm:text-sm font-medium text-gray-600 truncate">Completion Rate</p>
                  <div className="text-lg sm:text-xl lg:text-2xl font-bold text-gray-900 mt-1">
                    {analyticsData.completionRate.percentage}%
                  </div>
                  <div className={`flex items-center gap-1 text-xs sm:text-sm mt-1 ${getTrendColor(analyticsData.completionRate.trendDirection)}`}>
                    <span>{getTrendIcon(analyticsData.completionRate.trendDirection)}</span>
                    <span className="truncate">{analyticsData.completionRate.trend}</span>
                  </div>
                </div>
                <div className="w-8 h-8 sm:w-10 sm:h-10 lg:w-12 lg:h-12 bg-orange-100 rounded-lg flex items-center justify-center shrink-0">
                  <TrendingUp className="w-4 h-4 sm:w-5 sm:h-5 lg:w-6 lg:h-6 text-orange-600" />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Charts Section */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
          {/* Response Time Trend Line Chart */}
          <Card className="min-w-0 border-orange-100">
            <CardHeader className="pb-3 sm:pb-4">
              <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
                <LineChart className="w-4 sm:w-5 h-4 sm:h-5 shrink-0 text-orange-600" />
                <span className="truncate">Response Time Trends</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-2 sm:p-4 lg:p-6">
              {/* Update chart colors */}
              <div className="w-full h-56 sm:h-64 lg:h-80 min-w-0">
                {analyticsData.responseTimeTrend && analyticsData.responseTimeTrend.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <ReLineChart data={analyticsData.responseTimeTrend} margin={{ top: 5, right: 5, left: 5, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                      <XAxis 
                        dataKey="date" 
                        stroke="#666"
                        fontSize={10}
                        tick={{ fontSize: 10 }}
                      />
                      <YAxis 
                        stroke="#666"
                        fontSize={10}
                        tick={{ fontSize: 10 }}
                        width={40}
                        label={{ value: 'Min', angle: -90, position: 'insideLeft', style: { fontSize: '10px', textAnchor: 'middle' } }}
                      />
                      <Tooltip 
                        contentStyle={{
                          backgroundColor: '#fff',
                          border: '1px solid #fdba74',
                          borderRadius: '6px',
                          boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
                          fontSize: '12px'
                        }}
                        formatter={(value) => [`${value} min`, 'Avg Response Time']}
                      />
                      <Line 
                        type="monotone" 
                        dataKey="avgResponse" 
                        stroke="#f97316" 
                        strokeWidth={2}
                        dot={{ fill: '#f97316', strokeWidth: 2, r: 3 }}
                        activeDot={{ r: 5, fill: '#ea580c' }}
                      />
                    </ReLineChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex items-center justify-center h-full text-gray-500">
                    No response time data available
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Order Status Distribution Pie Chart */}
          <Card className="min-w-0 border-orange-100">
            <CardHeader className="pb-3 sm:pb-4">
              <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
                <PieChart className="w-4 sm:w-5 h-4 sm:h-5 shrink-0 text-orange-600" />
                <span className="truncate">Order Status Distribution</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-2 sm:p-4 lg:p-6">
              <div className="w-full h-56 sm:h-64 lg:h-80 min-w-0">
                {analyticsData.orderStatusDistribution && analyticsData.orderStatusDistribution.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <RePieChart margin={{ top: 5, right: 5, left: 5, bottom: 5 }}>
                      <Pie
                        data={analyticsData.orderStatusDistribution}
                        cx="50%"
                        cy="50%"
                        outerRadius="65%"
                        innerRadius="25%"
                        paddingAngle={5}
                        dataKey="value"
                        label={({name, percent}) => `${name} ${(percent * 100).toFixed(0)}%`}
                        labelLine={false}
                        style={{ fontSize: '10px' }}
                      >
                        {analyticsData.orderStatusDistribution.map((entry, index) => (
                          <Cell 
                            key={`cell-${index}`} 
                            fill={[
                              '#f97316', // orange-500
                              '#fb923c', // orange-400
                              '#fdba74', // orange-300
                              '#fed7aa'  // orange-200
                            ][index % 4]} 
                          />
                        ))}
                      </Pie>
                      <Tooltip 
                        contentStyle={{
                          backgroundColor: '#fff',
                          border: '1px solid #fdba74',
                          borderRadius: '6px',
                          boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
                          fontSize: '12px'
                        }}
                        formatter={(value, name) => [value, `${name} Orders`]}
                      />
                    </RePieChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex items-center justify-center h-full text-gray-500">
                    No order status data available
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Orders by Hour Bar Chart */}
          <Card className="min-w-0 border-orange-100">
            <CardHeader className="pb-3 sm:pb-4">
              <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
                <BarChart3 className="w-4 sm:w-5 h-4 sm:h-5 shrink-0 text-orange-600" />
                <span className="truncate">Orders by Hour</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-2 sm:p-4 lg:p-6">
              <div className="w-full h-56 sm:h-64 lg:h-80 min-w-0">
                {analyticsData.performanceByHour && analyticsData.performanceByHour.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={analyticsData.performanceByHour} margin={{ top: 5, right: 5, left: 5, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                      <XAxis 
                        dataKey="hour" 
                        stroke="#666"
                        fontSize={10}
                        tick={{ fontSize: 10 }}
                      />
                      <YAxis 
                        stroke="#666"
                        fontSize={10}
                        tick={{ fontSize: 10 }}
                        width={40}
                        label={{ value: 'Orders', angle: -90, position: 'insideLeft', style: { fontSize: '10px', textAnchor: 'middle' } }}
                      />
                      <Tooltip 
                        contentStyle={{
                          backgroundColor: '#fff',
                          border: '1px solid #fdba74',
                          borderRadius: '6px',
                          boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
                          fontSize: '12px'
                        }}
                        formatter={(value, name) => [value, name === 'orders' ? 'Orders' : 'Avg Response (min)']}
                      />
                      <Bar 
                        dataKey="orders" 
                        fill="#f59e0b"
                        radius={[2, 2, 0, 0]}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex items-center justify-center h-full text-gray-500">
                    No hourly order data available
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Weekly Order Volume Area Chart */}
          <Card className="min-w-0 border-orange-100">
            <CardHeader className="pb-3 sm:pb-4">
              <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
                <TrendingUp className="w-4 sm:w-5 h-4 sm:h-5 shrink-0 text-orange-600" />
                <span className="truncate">Weekly Order Volume</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-2 sm:p-4 lg:p-6">
              <div className="w-full h-56 sm:h-64 lg:h-80 min-w-0">
                {analyticsData.weeklyOrderVolume && analyticsData.weeklyOrderVolume.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={analyticsData.weeklyOrderVolume} margin={{ top: 5, right: 5, left: 5, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                      <XAxis 
                        dataKey="day" 
                        stroke="#666"
                        fontSize={10}
                        tick={{ fontSize: 10 }}
                      />
                      <YAxis 
                        stroke="#666"
                        fontSize={10}
                        tick={{ fontSize: 10 }}
                        width={40}
                        label={{ value: 'Orders', angle: -90, position: 'insideLeft', style: { fontSize: '10px', textAnchor: 'middle' } }}
                      />
                      <Tooltip 
                        contentStyle={{
                          backgroundColor: '#fff',
                          border: '1px solid #fdba74',
                          borderRadius: '6px',
                          boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
                          fontSize: '12px'
                        }}
                        formatter={(value, name) => [value, name === 'orders' ? 'Orders' : 'Revenue ($)']}
                      />
                      <Area 
                        type="monotone" 
                        dataKey="orders" 
                        stroke="#f59e0b" 
                        strokeWidth={2}
                        fill="url(#orderGradient)"
                      />
                      <defs>
                        <linearGradient id="orderGradient" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#fb923c" stopOpacity={0.3}/>
                          <stop offset="95%" stopColor="#fb923c" stopOpacity={0.1}/>
                        </linearGradient>
                      </defs>
                    </AreaChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex items-center justify-center h-full text-gray-500">
                    No weekly volume data available
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Orders vs Response Time Correlation */}
        <Card className="min-w-0 border-orange-100">
          <CardHeader className="pb-3 sm:pb-4">
            <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
              <BarChart3 className="w-4 sm:w-5 h-4 sm:h-5 shrink-0 text-orange-600" />
              <span className="truncate">Orders vs Response Time by Hour</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-2 sm:p-4 lg:p-6">
            <div className="w-full h-64 sm:h-80 lg:h-96 min-w-0">
              {analyticsData.performanceByHour && analyticsData.performanceByHour.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={analyticsData.performanceByHour} margin={{ top: 5, right: 5, left: 5, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis 
                      dataKey="hour" 
                      stroke="#666"
                      fontSize={10}
                      tick={{ fontSize: 10 }}
                    />
                    <YAxis 
                      yAxisId="left"
                      stroke="#666"
                      fontSize={10}
                      tick={{ fontSize: 10 }}
                      width={40}
                      label={{ value: 'Orders', angle: -90, position: 'insideLeft', style: { fontSize: '10px', textAnchor: 'middle' } }}
                    />
                    <YAxis 
                      yAxisId="right" 
                      orientation="right"
                      stroke="#666"
                      fontSize={10}
                      tick={{ fontSize: 10 }}
                      width={40}
                      label={{ value: 'Time (min)', angle: 90, position: 'insideRight', style: { fontSize: '10px', textAnchor: 'middle' } }}
                    />
                    <Tooltip 
                      contentStyle={{
                        backgroundColor: '#fff',
                        border: '1px solid #fdba74',
                        borderRadius: '6px',
                        boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
                        fontSize: '12px'
                      }}
                      formatter={(value, name) => [
                        name === 'orders' ? value : `${value} min`, 
                        name === 'orders' ? 'Orders' : 'Avg Response Time'
                      ]}
                    />
                    <Legend 
                      wrapperStyle={{ fontSize: '12px' }}
                    />
                    <Bar 
                      yAxisId="left"
                      dataKey="orders" 
                      fill="#3b82f6"
                      radius={[4, 4, 0, 0]}
                      name="Orders"
                    />
                    <Line 
                      yAxisId="right"
                      type="monotone" 
                      dataKey="avgTimeMinutes" 
                      stroke="#ea580c" 
                      strokeWidth={3}
                      dot={{ fill: '#ea580c', strokeWidth: 2, r: 4 }}
                      name="Avg Response Time"
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex items-center justify-center h-full text-gray-500">
                  No correlation data available
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Recent Orders with Response Times */}
        <Card className="min-w-0 border-orange-100">
          <CardHeader className="pb-3 sm:pb-4">
            <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
              <MessageSquare className="w-4 sm:w-5 h-4 sm:h-5 shrink-0 text-orange-600" />
              <span className="truncate">Recent Order Response Times</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-3 sm:p-4 lg:p-6">
            <div className="space-y-3 sm:space-y-4">
              {analyticsData.recentOrders && analyticsData.recentOrders.length > 0 ? (
                analyticsData.recentOrders.map((order) => (
                  <div key={order.id} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-3 sm:p-4 border-orange-100 rounded-lg min-w-0 hover:bg-orange-50 transition-colors">
                    <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 min-w-0">
                      <div className="font-medium text-sm sm:text-base truncate">
                        Order #{order.order_number}
                      </div>
                      <Badge className={`w-fit ${
                        order.status === 'completed' ? 'bg-orange-100 text-orange-800' : 
                        order.status === 'ready' ? 'bg-orange-50 text-orange-600' :
                        order.status === 'preparing' ? 'bg-orange-100 text-orange-700' :
                        'bg-gray-100 text-gray-800'
                      }`}>
                        {order.status}
                      </Badge>
                    </div>
                    
                    <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-6 text-xs sm:text-sm text-gray-600 min-w-0">
                      <div className="truncate">
                        Created: {order.created_at ? formatDistanceToNow(new Date(order.created_at), { addSuffix: true }) : 'Unknown'}
                      </div>
                      <div className="font-medium text-orange-600 truncate">
                        Response: {order.response_time || 'No response'}
                      </div>
                    </div>
                  </div>
                ))
              ) : (
                <div className="text-center py-8 text-gray-500">
                  No recent orders found
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Performance Insights */}
        <Card className="min-w-0 border-orange-100">
          <CardHeader className="pb-3 sm:pb-4">
            <CardTitle className="text-base sm:text-lg">Performance Insights</CardTitle>
          </CardHeader>
          <CardContent className="p-3 sm:p-4 lg:p-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
              <div className="space-y-3 min-w-0">
                <h4 className="font-medium text-gray-900 text-sm sm:text-base">✅ What's Working Well</h4>
                <ul className="space-y-2 text-xs sm:text-sm text-gray-600">
                  {insights.working.map((insight, index) => (
                    <li key={index} className="break-words">{insight}</li>
                  ))}
                </ul>
              </div>
              
              <div className="space-y-3 min-w-0">
                <h4 className="font-medium text-gray-900 text-sm sm:text-base">⚠️ Areas for Improvement</h4>
                <ul className="space-y-2 text-xs sm:text-sm text-gray-600">
                  {insights.improvements.map((insight, index) => (
                    <li key={index} className="break-words">{insight}</li>
                  ))}
                </ul>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default Reports; 