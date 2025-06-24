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
  Filter
} from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
      { hour: '9AM', orders: 12, avgTime: '3m 45s' },
      { hour: '10AM', orders: 18, avgTime: '4m 12s' },
      { hour: '11AM', orders: 24, avgTime: '3m 23s' },
      { hour: '12PM', orders: 45, avgTime: '5m 34s' },
      { hour: '1PM', orders: 52, avgTime: '6m 12s' },
      { hour: '2PM', orders: 38, avgTime: '4m 45s' },
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
      <div className="container mx-auto p-6">
        <div className="space-y-6">
          <div className="h-8 bg-gray-200 rounded w-48 animate-pulse"></div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-32 bg-gray-200 rounded animate-pulse"></div>
            ))}
          </div>
          <div className="h-64 bg-gray-200 rounded animate-pulse"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Reports & Analytics</h1>
          <p className="text-gray-600">Track your restaurant's performance and response times</p>
        </div>
        
        <div className="flex items-center gap-3">
          <Select value={timeRange} onValueChange={setTimeRange}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="1d">Last 24 hours</SelectItem>
              <SelectItem value="7d">Last 7 days</SelectItem>
              <SelectItem value="30d">Last 30 days</SelectItem>
              <SelectItem value="90d">Last 3 months</SelectItem>
            </SelectContent>
          </Select>
          
          <Button variant="outline" className="flex items-center gap-2">
            <Download className="w-4 h-4" />
            Export
          </Button>
        </div>
      </div>

      {/* Key Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Avg Response Time</p>
                <div className="flex items-baseline gap-1">
                  <span className="text-2xl font-bold text-gray-900">
                    {analyticsData.averageResponseTime.minutes}m
                  </span>
                  <span className="text-lg font-semibold text-gray-600">
                    {analyticsData.averageResponseTime.seconds}s
                  </span>
                </div>
                <div className={`flex items-center gap-1 text-sm ${getTrendColor(analyticsData.averageResponseTime.trendDirection)}`}>
                  <span>{getTrendIcon(analyticsData.averageResponseTime.trendDirection)}</span>
                  <span>{analyticsData.averageResponseTime.trend} from last period</span>
                </div>
              </div>
              <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center">
                <Clock className="w-6 h-6 text-blue-600" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Total Orders</p>
                <div className="text-2xl font-bold text-gray-900">
                  {analyticsData.totalOrders.count.toLocaleString()}
                </div>
                <div className={`flex items-center gap-1 text-sm ${getTrendColor(analyticsData.totalOrders.trendDirection)}`}>
                  <span>{getTrendIcon(analyticsData.totalOrders.trendDirection)}</span>
                  <span>{analyticsData.totalOrders.trend} from last period</span>
                </div>
              </div>
              <div className="w-12 h-12 bg-orange-100 rounded-lg flex items-center justify-center">
                <BarChart3 className="w-6 h-6 text-orange-600" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Average Rating</p>
                <div className="flex items-center gap-2">
                  <span className="text-2xl font-bold text-gray-900">
                    {analyticsData.averageRating.rating}
                  </span>
                  <div className="flex">
                    {[...Array(5)].map((_, i) => (
                      <Star 
                        key={i} 
                        className={`w-4 h-4 ${
                          i < Math.floor(analyticsData.averageRating.rating) 
                            ? 'text-yellow-400 fill-current' 
                            : 'text-gray-300'
                        }`} 
                      />
                    ))}
                  </div>
                </div>
                <div className={`flex items-center gap-1 text-sm ${getTrendColor(analyticsData.averageRating.trendDirection)}`}>
                  <span>{getTrendIcon(analyticsData.averageRating.trendDirection)}</span>
                  <span>{analyticsData.averageRating.trend} from last period</span>
                </div>
              </div>
              <div className="w-12 h-12 bg-yellow-100 rounded-lg flex items-center justify-center">
                <Star className="w-6 h-6 text-yellow-600" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Completion Rate</p>
                <div className="text-2xl font-bold text-gray-900">
                  {analyticsData.completionRate.percentage}%
                </div>
                <div className={`flex items-center gap-1 text-sm ${getTrendColor(analyticsData.completionRate.trendDirection)}`}>
                  <span>{getTrendIcon(analyticsData.completionRate.trendDirection)}</span>
                  <span>{analyticsData.completionRate.trend} from last period</span>
                </div>
              </div>
              <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center">
                <TrendingUp className="w-6 h-6 text-green-600" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Performance by Hour */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BarChart3 className="w-5 h-5" />
            Performance by Hour
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {analyticsData.performanceByHour.map((hour, index) => (
              <div key={index} className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                <div className="flex items-center gap-4">
                  <div className="w-16 text-sm font-medium text-gray-600">
                    {hour.hour}
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary" className="px-2 py-1">
                      {hour.orders} orders
                    </Badge>
                  </div>
                </div>
                <div className="text-sm font-medium text-gray-900">
                  Avg: {hour.avgTime}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Recent Orders with Response Times */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MessageSquare className="w-5 h-5" />
            Recent Order Response Times
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {analyticsData.recentOrders.map((order) => (
              <div key={order.id} className="flex items-center justify-between p-4 border rounded-lg">
                <div className="flex items-center gap-4">
                  <div className="font-medium">
                    Order #{order.order_number}
                  </div>
                  <Badge className={`${
                    order.status === 'completed' ? 'bg-green-100 text-green-800' : 'bg-blue-100 text-blue-800'
                  }`}>
                    {order.status}
                  </Badge>
                </div>
                
                <div className="flex items-center gap-6 text-sm text-gray-600">
                  <div>
                    Created: {formatDistanceToNow(new Date(order.created_at), { addSuffix: true })}
                  </div>
                  <div className="font-medium text-gray-900">
                    Response: {order.response_time}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Performance Insights */}
      <Card>
        <CardHeader>
          <CardTitle>Performance Insights</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid md:grid-cols-2 gap-6">
            <div className="space-y-3">
              <h4 className="font-medium text-gray-900">✅ What's Working Well</h4>
              <ul className="space-y-2 text-sm text-gray-600">
                <li>• Response times are 12% faster than last period</li>
                <li>• Peak lunch hours (12-2PM) show consistent performance</li>
                <li>• Customer satisfaction remains high at 4.6/5 stars</li>
                <li>• 94% order completion rate exceeds industry average</li>
              </ul>
            </div>
            
            <div className="space-y-3">
              <h4 className="font-medium text-gray-900">⚠️ Areas for Improvement</h4>
              <ul className="space-y-2 text-sm text-gray-600">
                <li>• Consider adding staff during 1PM peak (6m avg response)</li>
                <li>• Weekend response times could be optimized</li>
                <li>• Set up auto-responses for common order confirmations</li>
                <li>• Review messaging templates for faster responses</li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default Reports; 