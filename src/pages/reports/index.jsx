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
import { formatDistanceToNow } from 'date-fns';

const Reports = () => {
  const [timeRange, setTimeRange] = useState('7d');
  const [loading, setLoading] = useState(true);
  const [analyticsData, setAnalyticsData] = useState(null);

  // Mock analytics data - replace with real API
  const mockAnalytics = {
    averageResponseTime: {
      minutes: 4,
      seconds: 23,
      trend: '+12%',
      trendDirection: 'up'
    },
    totalOrders: {
      count: 847,
      trend: '+23%', 
      trendDirection: 'up'
    },
    averageRating: {
      rating: 4.6,
      trend: '+0.2',
      trendDirection: 'up'
    },
    completionRate: {
      percentage: 94.2,
      trend: '+1.5%',
      trendDirection: 'up'
    },
    recentOrders: [
      {
        id: '1',
        order_number: '2547',
        created_at: new Date(Date.now() - 5 * 60000).toISOString(),
        message_sent_at: new Date(Date.now() - 2 * 60000).toISOString(),
        response_time: '3m 12s',
        status: 'completed'
      },
      {
        id: '2',
        order_number: '2548',
        created_at: new Date(Date.now() - 15 * 60000).toISOString(),
        message_sent_at: new Date(Date.now() - 10 * 60000).toISOString(),
        response_time: '5m 45s',
        status: 'ready'
      },
      {
        id: '3',
        order_number: '2549',
        created_at: new Date(Date.now() - 25 * 60000).toISOString(),
        message_sent_at: new Date(Date.now() - 22 * 60000).toISOString(),
        response_time: '2m 58s',
        status: 'completed'
      }
    ],
    performanceByHour: [
      { hour: '9AM', orders: 12, avgTime: '3m 45s', avgTimeMinutes: 3.75, responseTime: 225 },
      { hour: '10AM', orders: 18, avgTime: '4m 12s', avgTimeMinutes: 4.2, responseTime: 252 },
      { hour: '11AM', orders: 24, avgTime: '3m 23s', avgTimeMinutes: 3.38, responseTime: 203 },
      { hour: '12PM', orders: 45, avgTime: '5m 34s', avgTimeMinutes: 5.57, responseTime: 334 },
      { hour: '1PM', orders: 52, avgTime: '6m 12s', avgTimeMinutes: 6.2, responseTime: 372 },
      { hour: '2PM', orders: 38, avgTime: '4m 45s', avgTimeMinutes: 4.75, responseTime: 285 },
      { hour: '3PM', orders: 28, avgTime: '3m 56s', avgTimeMinutes: 3.93, responseTime: 236 },
      { hour: '4PM', orders: 22, avgTime: '3m 12s', avgTimeMinutes: 3.2, responseTime: 192 },
      { hour: '5PM', orders: 35, avgTime: '4m 28s', avgTimeMinutes: 4.47, responseTime: 268 },
      { hour: '6PM', orders: 41, avgTime: '5m 15s', avgTimeMinutes: 5.25, responseTime: 315 }
    ],
    responseTimeTrend: [
      { date: 'Mon', avgResponse: 4.2, orders: 156 },
      { date: 'Tue', avgResponse: 3.8, orders: 142 },
      { date: 'Wed', avgResponse: 4.5, orders: 178 },
      { date: 'Thu', avgResponse: 3.9, orders: 165 },
      { date: 'Fri', avgResponse: 5.1, orders: 203 },
      { date: 'Sat', avgResponse: 4.8, orders: 189 },
      { date: 'Sun', avgResponse: 4.3, orders: 171 }
    ],
    orderStatusDistribution: [
      { name: 'Completed', value: 756, color: '#10b981' },
      { name: 'In Progress', value: 68, color: '#3b82f6' },
      { name: 'Ready', value: 23, color: '#f59e0b' }
    ],
    weeklyOrderVolume: [
      { day: 'Mon', orders: 156, revenue: 3420 },
      { day: 'Tue', orders: 142, revenue: 3180 },
      { day: 'Wed', orders: 178, revenue: 4230 },
      { day: 'Thu', orders: 165, revenue: 3890 },
      { day: 'Fri', orders: 203, revenue: 5120 },
      { day: 'Sat', orders: 189, revenue: 4680 },
      { day: 'Sun', orders: 171, revenue: 4050 }
    ]
  };

  useEffect(() => {
    fetchAnalytics();
  }, [timeRange]);

  const fetchAnalytics = async () => {
    setLoading(true);
    try {
      // TODO: Replace with actual API call
      // const response = await fetch(`/api/analytics?range=${timeRange}`);
      // const data = await response.json();
      
      // Simulate API delay
      setTimeout(() => {
        setAnalyticsData(mockAnalytics);
        setLoading(false);
      }, 500);
    } catch (error) {
      console.error('Error fetching analytics:', error);
      setLoading(false);
    }
  };

  const getTrendColor = (direction) => {
    return direction === 'up' ? 'text-green-600' : 'text-red-600';
  };

  const getTrendIcon = (direction) => {
    return direction === 'up' ? '↗' : '↘';
  };

  if (loading) {
    return (
      <div className="w-full max-w-none">
        <div className="space-y-6 p-4 sm:p-6">
          <div className="h-8 bg-gray-200 rounded w-48 animate-pulse"></div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-32 bg-gray-200 rounded animate-pulse"></div>
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

  return (
    <div className="w-full max-w-none overflow-x-hidden">
      <div className="space-y-4 sm:space-y-6 p-4 sm:p-6">
        {/* Header */}
        <div className="flex flex-col space-y-3 sm:space-y-0 sm:flex-row sm:items-start sm:justify-between gap-4">
          <div className="space-y-1 min-w-0 flex-1">
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 break-words">Reports & Analytics</h1>
            <p className="text-sm sm:text-base text-gray-600 break-words">Track your restaurant's performance and response times</p>
          </div>
          
          <div className="flex flex-col space-y-2 sm:space-y-0 sm:flex-row sm:items-center gap-2 sm:gap-3 shrink-0">
            <Select value={timeRange} onValueChange={setTimeRange}>
              <SelectTrigger className="w-full sm:w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1d">Last 24 hours</SelectItem>
                <SelectItem value="7d">Last 7 days</SelectItem>
                <SelectItem value="30d">Last 30 days</SelectItem>
                <SelectItem value="90d">Last 3 months</SelectItem>
              </SelectContent>
            </Select>
            
            <Button variant="outline" className="flex items-center gap-2 w-full sm:w-auto whitespace-nowrap">
              <Download className="w-4 h-4 shrink-0" />
              <span className="text-sm sm:text-base">Export</span>
            </Button>
          </div>
        </div>

        {/* Key Metrics */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 lg:gap-6">
          <Card className="min-w-0">
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
                    <span className="truncate">{analyticsData.averageResponseTime.trend} from last period</span>
                  </div>
                </div>
                <div className="w-8 h-8 sm:w-10 sm:h-10 lg:w-12 lg:h-12 bg-blue-100 rounded-lg flex items-center justify-center shrink-0">
                  <Clock className="w-4 h-4 sm:w-5 sm:h-5 lg:w-6 lg:h-6 text-blue-600" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="min-w-0">
            <CardContent className="p-3 sm:p-4 lg:p-6">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-xs sm:text-sm font-medium text-gray-600 truncate">Total Orders</p>
                  <div className="text-lg sm:text-xl lg:text-2xl font-bold text-gray-900 mt-1">
                    {analyticsData.totalOrders.count.toLocaleString()}
                  </div>
                  <div className={`flex items-center gap-1 text-xs sm:text-sm mt-1 ${getTrendColor(analyticsData.totalOrders.trendDirection)}`}>
                    <span>{getTrendIcon(analyticsData.totalOrders.trendDirection)}</span>
                    <span className="truncate">{analyticsData.totalOrders.trend} from last period</span>
                  </div>
                </div>
                <div className="w-8 h-8 sm:w-10 sm:h-10 lg:w-12 lg:h-12 bg-orange-100 rounded-lg flex items-center justify-center shrink-0">
                  <BarChart3 className="w-4 h-4 sm:w-5 sm:h-5 lg:w-6 lg:h-6 text-orange-600" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="min-w-0">
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
                            i < Math.floor(analyticsData.averageRating.rating) 
                              ? 'text-yellow-400 fill-current' 
                              : 'text-gray-300'
                          }`} 
                        />
                      ))}
                    </div>
                  </div>
                  <div className={`flex items-center gap-1 text-xs sm:text-sm mt-1 ${getTrendColor(analyticsData.averageRating.trendDirection)}`}>
                    <span>{getTrendIcon(analyticsData.averageRating.trendDirection)}</span>
                    <span className="truncate">{analyticsData.averageRating.trend} from last period</span>
                  </div>
                </div>
                <div className="w-8 h-8 sm:w-10 sm:h-10 lg:w-12 lg:h-12 bg-yellow-100 rounded-lg flex items-center justify-center shrink-0">
                  <Star className="w-4 h-4 sm:w-5 sm:h-5 lg:w-6 lg:h-6 text-yellow-600" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="min-w-0">
            <CardContent className="p-3 sm:p-4 lg:p-6">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-xs sm:text-sm font-medium text-gray-600 truncate">Completion Rate</p>
                  <div className="text-lg sm:text-xl lg:text-2xl font-bold text-gray-900 mt-1">
                    {analyticsData.completionRate.percentage}%
                  </div>
                  <div className={`flex items-center gap-1 text-xs sm:text-sm mt-1 ${getTrendColor(analyticsData.completionRate.trendDirection)}`}>
                    <span>{getTrendIcon(analyticsData.completionRate.trendDirection)}</span>
                    <span className="truncate">{analyticsData.completionRate.trend} from last period</span>
                  </div>
                </div>
                <div className="w-8 h-8 sm:w-10 sm:h-10 lg:w-12 lg:h-12 bg-green-100 rounded-lg flex items-center justify-center shrink-0">
                  <TrendingUp className="w-4 h-4 sm:w-5 sm:h-5 lg:w-6 lg:h-6 text-green-600" />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Charts Section */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
          {/* Response Time Trend Line Chart */}
          <Card className="min-w-0">
            <CardHeader className="pb-3 sm:pb-4">
              <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
                <LineChart className="w-4 sm:w-5 h-4 sm:h-5 shrink-0" />
                <span className="truncate">Response Time Trends</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-2 sm:p-4 lg:p-6">
              <div className="w-full h-56 sm:h-64 lg:h-80 min-w-0">
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
                        border: '1px solid #e2e8f0',
                        borderRadius: '6px',
                        boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
                        fontSize: '12px'
                      }}
                      formatter={(value) => [`${value} min`, 'Avg Response Time']}
                    />
                    <Line 
                      type="monotone" 
                      dataKey="avgResponse" 
                      stroke="#3b82f6" 
                      strokeWidth={2}
                      dot={{ fill: '#3b82f6', strokeWidth: 2, r: 3 }}
                      activeDot={{ r: 5, fill: '#1d4ed8' }}
                    />
                  </ReLineChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          {/* Order Status Distribution Pie Chart */}
          <Card className="min-w-0">
            <CardHeader className="pb-3 sm:pb-4">
              <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
                <PieChart className="w-4 sm:w-5 h-4 sm:h-5 shrink-0" />
                <span className="truncate">Order Status Distribution</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-2 sm:p-4 lg:p-6">
              <div className="w-full h-56 sm:h-64 lg:h-80 min-w-0">
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
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip 
                      contentStyle={{
                        backgroundColor: '#fff',
                        border: '1px solid #e2e8f0',
                        borderRadius: '6px',
                        boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
                        fontSize: '12px'
                      }}
                      formatter={(value, name) => [value, `${name} Orders`]}
                    />
                  </RePieChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          {/* Orders by Hour Bar Chart */}
          <Card className="min-w-0">
            <CardHeader className="pb-3 sm:pb-4">
              <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
                <BarChart3 className="w-4 sm:w-5 h-4 sm:h-5 shrink-0" />
                <span className="truncate">Orders by Hour</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-2 sm:p-4 lg:p-6">
              <div className="w-full h-56 sm:h-64 lg:h-80 min-w-0">
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
                        border: '1px solid #e2e8f0',
                        borderRadius: '6px',
                        boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
                        fontSize: '12px'
                      }}
                      formatter={(value, name) => [value, name === 'orders' ? 'Orders' : 'Avg Response (min)']}
                    />
                    <Bar 
                      dataKey="orders" 
                      fill="#10b981"
                      radius={[2, 2, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          {/* Weekly Order Volume Area Chart */}
          <Card className="min-w-0">
            <CardHeader className="pb-3 sm:pb-4">
              <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
                <TrendingUp className="w-4 sm:w-5 h-4 sm:h-5 shrink-0" />
                <span className="truncate">Weekly Order Volume</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-2 sm:p-4 lg:p-6">
              <div className="w-full h-56 sm:h-64 lg:h-80 min-w-0">
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
                        border: '1px solid #e2e8f0',
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
                        <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.3}/>
                        <stop offset="95%" stopColor="#f59e0b" stopOpacity={0.1}/>
                      </linearGradient>
                    </defs>
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Orders vs Response Time Correlation */}
        <Card className="min-w-0">
          <CardHeader className="pb-3 sm:pb-4">
            <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
              <BarChart3 className="w-4 sm:w-5 h-4 sm:h-5 shrink-0" />
              <span className="truncate">Orders vs Response Time by Hour</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-2 sm:p-4 lg:p-6">
            <div className="w-full h-64 sm:h-80 lg:h-96 min-w-0">
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
                      border: '1px solid #e2e8f0',
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
                    stroke="#ef4444" 
                    strokeWidth={3}
                    dot={{ fill: '#ef4444', strokeWidth: 2, r: 4 }}
                    name="Avg Response Time"
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Recent Orders with Response Times */}
        <Card className="min-w-0">
          <CardHeader className="pb-3 sm:pb-4">
            <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
              <MessageSquare className="w-4 sm:w-5 h-4 sm:h-5 shrink-0" />
              <span className="truncate">Recent Order Response Times</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-3 sm:p-4 lg:p-6">
            <div className="space-y-3 sm:space-y-4">
              {analyticsData.recentOrders.map((order) => (
                <div key={order.id} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-3 sm:p-4 border rounded-lg min-w-0">
                  <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 min-w-0">
                    <div className="font-medium text-sm sm:text-base truncate">
                      Order #{order.order_number}
                    </div>
                    <Badge className={`w-fit ${
                      order.status === 'completed' ? 'bg-green-100 text-green-800' : 'bg-blue-100 text-blue-800'
                    }`}>
                      {order.status}
                    </Badge>
                  </div>
                  
                  <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-6 text-xs sm:text-sm text-gray-600 min-w-0">
                    <div className="truncate">
                      Created: {formatDistanceToNow(new Date(order.created_at), { addSuffix: true })}
                    </div>
                    <div className="font-medium text-gray-900 truncate">
                      Response: {order.response_time}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Performance Insights */}
        <Card className="min-w-0">
          <CardHeader className="pb-3 sm:pb-4">
            <CardTitle className="text-base sm:text-lg">Performance Insights</CardTitle>
          </CardHeader>
          <CardContent className="p-3 sm:p-4 lg:p-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
              <div className="space-y-3 min-w-0">
                <h4 className="font-medium text-gray-900 text-sm sm:text-base">✅ What's Working Well</h4>
                <ul className="space-y-2 text-xs sm:text-sm text-gray-600">
                  <li className="break-words">• Response times are 12% faster than last period</li>
                  <li className="break-words">• Peak lunch hours (12-2PM) show consistent performance</li>
                  <li className="break-words">• Customer satisfaction remains high at 4.6/5 stars</li>
                  <li className="break-words">• 94% order completion rate exceeds industry average</li>
                </ul>
              </div>
              
              <div className="space-y-3 min-w-0">
                <h4 className="font-medium text-gray-900 text-sm sm:text-base">⚠️ Areas for Improvement</h4>
                <ul className="space-y-2 text-xs sm:text-sm text-gray-600">
                  <li className="break-words">• Consider adding staff during 1PM peak (6m avg response)</li>
                  <li className="break-words">• Weekend response times could be optimized</li>
                  <li className="break-words">• Set up auto-responses for common order confirmations</li>
                  <li className="break-words">• Review messaging templates for faster responses</li>
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