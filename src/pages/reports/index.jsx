import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StatCard } from "@/components/ui/stat-card";
import { PageHeader, PageContainer } from "@/components/ui/page-header";
import { Reveal, Stagger, StaggerItem } from "@/components/ui/motion";
import {
  Clock,
  TrendingUp,
  Star,
  MessageSquare,
  BarChart3,
  Calendar,
  Download,
  LineChart,
  PieChart,
  CheckCircle2,
  AlertTriangle,
  Activity,
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
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { formatDistanceToNow, addDays } from 'date-fns';
import analyticsService from '../../services/analytics.js';
import { DateRangePicker } from "@/components/ui/date-range-picker";

// Shared recharts tooltip style
const tooltipStyle = {
  backgroundColor: 'hsl(var(--card))',
  border: '1px solid hsl(var(--border))',
  borderRadius: '12px',
  boxShadow: '0 8px 24px -4px rgba(0,0,0,0.12)',
  fontSize: '12px',
  color: 'hsl(var(--foreground))',
};

const axisStyle = { fontSize: 11, fill: 'hsl(var(--muted-foreground))' };
const gridStroke = 'hsl(var(--border))';
const ORANGE_PALETTE = ['hsl(var(--chart-1))', 'hsl(var(--chart-2))', 'hsl(var(--chart-3))', 'hsl(var(--chart-3) / 0.6)'];

// Empty state shown inside a chart area
function ChartEmpty({ message }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
      <Activity className="h-8 w-8 opacity-30" />
      <p className="text-sm">{message}</p>
    </div>
  );
}

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

      const queryParam = useCustomRange && customDateRange ? customDateRange : timeRange;
      const data = await analyticsService.getAnalyticsData(queryParam);

      console.log('Analytics data received:', data);
      setAnalyticsData(data);
    } catch (error) {
      console.error('Error fetching analytics:', error);
      setError(error.message);

      const mockAnalytics = {
        averageResponseTime: { minutes: 0, seconds: 0, trend: 'No data', trendDirection: 'up' },
        totalOrders: { count: 0, trend: 'No data', trendDirection: 'up' },
        averageRating: { rating: 0, trend: 'No data', trendDirection: 'up' },
        completionRate: { percentage: 0, trend: 'No data', trendDirection: 'up' },
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
      setTimeRange('custom');
      if (!customDateRange) {
        const defaultRange = { from: addDays(new Date(), -6), to: new Date() };
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

  const generateInsights = () => {
    if (!analyticsData) return { working: [], improvements: [] };

    const insights = { working: [], improvements: [] };
    const totalOrders = analyticsData.totalOrders.count;
    const completionRate = analyticsData.completionRate.percentage;
    const avgRating = analyticsData.averageRating.rating;
    const avgResponseTime = analyticsData.averageResponseTime.minutes;

    if (totalOrders > 0) {
      insights.working.push(`Processed ${totalOrders} orders in the selected period`);
    }
    if (completionRate >= 90) {
      insights.working.push(`Excellent completion rate of ${completionRate}%`);
    } else if (completionRate >= 80) {
      insights.working.push(`Good completion rate of ${completionRate}%`);
    }
    if (avgRating >= 8) {
      insights.working.push(`High customer satisfaction at ${avgRating}/10 stars`);
    } else if (avgRating >= 6) {
      insights.working.push(`Decent customer satisfaction at ${avgRating}/10 stars`);
    }
    if (avgResponseTime <= 5) {
      insights.working.push(`Fast response times averaging ${avgResponseTime} minutes`);
    }
    if (totalOrders === 0) {
      insights.improvements.push('No orders found for the selected period');
    }
    if (completionRate < 80) {
      insights.improvements.push(`Completion rate could be improved (currently ${completionRate}%)`);
    }
    if (avgRating < 6) {
      insights.improvements.push(`Customer satisfaction needs attention (${avgRating}/10)`);
    }
    if (avgResponseTime > 10) {
      insights.improvements.push(`Response times could be faster (currently ${avgResponseTime} minutes)`);
    }
    if (analyticsData.performanceByHour?.length === 0) {
      insights.improvements.push('No hourly performance data available');
    }
    if (insights.working.length === 0) {
      insights.working.push('System is operational and collecting data');
    }
    if (insights.improvements.length === 0) {
      insights.improvements.push('Continue monitoring for optimization opportunities');
    }

    return insights;
  };

  // ─── Controls rendered in PageHeader actions ───────────────────────────────
  const headerActions = (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
      <Select value={useCustomRange ? 'custom' : timeRange} onValueChange={handleTimeRangeChange}>
        <SelectTrigger className="w-full sm:w-44">
          <Calendar className="mr-2 h-3.5 w-3.5 text-muted-foreground shrink-0" />
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

      <Button variant="outline" className="flex items-center gap-2 whitespace-nowrap">
        <Download className="h-4 w-4 shrink-0" />
        Export
      </Button>
    </div>
  );

  // ─── Loading skeleton ──────────────────────────────────────────────────────
  if (loading) {
    return (
      <PageContainer>
        <PageHeader
          icon={BarChart3}
          title="Reports"
          description="Track your restaurant's performance and response times"
          actions={headerActions}
        />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
          {[...Array(4)].map((_, i) => (
            <Card key={i} className="p-5">
              <Skeleton className="h-4 w-28 mb-4" />
              <Skeleton className="h-8 w-20 mb-3" />
              <Skeleton className="h-4 w-16" />
            </Card>
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
          {[...Array(4)].map((_, i) => (
            <Card key={i} className="overflow-hidden rounded-2xl">
              <CardHeader className="p-6">
                <Skeleton className="h-5 w-40" />
              </CardHeader>
              <CardContent className="p-6 pt-0">
                <Skeleton className="h-64 w-full rounded-xl" />
              </CardContent>
            </Card>
          ))}
        </div>
      </PageContainer>
    );
  }

  if (!analyticsData) {
    return (
      <PageContainer>
        <PageHeader
          icon={BarChart3}
          title="Reports"
          description="Track your restaurant's performance and response times"
          actions={headerActions}
        />
        <Card className="rounded-2xl shadow-card">
          <CardContent className="p-12 text-center">
            <Activity className="mx-auto mb-4 h-12 w-12 text-muted-foreground/40" />
            <h2 className="font-display text-xl font-semibold text-foreground mb-2">
              No Analytics Data Available
            </h2>
            <p className="text-sm text-muted-foreground mb-6">
              Please check your data connection and try again.
            </p>
            <Button onClick={fetchAnalytics}>Retry</Button>
          </CardContent>
        </Card>
      </PageContainer>
    );
  }

  const insights = generateInsights();

  return (
    <PageContainer>
      {/* ── Page Header ─────────────────────────────────────── */}
      <Reveal delay={0}>
        <PageHeader
          icon={BarChart3}
          title="Reports"
          description="Track your restaurant's performance and response times"
          actions={headerActions}
        />
        {error && (
          <div className="mt-3 flex items-center gap-2 rounded-xl border border-warning/30 bg-warning/10 px-4 py-2.5 text-sm text-warning">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            Using limited data: {error}
          </div>
        )}
      </Reveal>

      {/* ── Key Metrics ─────────────────────────────────────── */}
      <Stagger className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
        <StaggerItem>
          <StatCard
            label="Avg Response Time"
            value={
              <span>
                {analyticsData.averageResponseTime.minutes}
                <span className="text-xl font-medium text-muted-foreground">m </span>
                {analyticsData.averageResponseTime.seconds}
                <span className="text-xl font-medium text-muted-foreground">s</span>
              </span>
            }
            icon={Clock}
            hint={analyticsData.averageResponseTime.trend}
          />
        </StaggerItem>

        <StaggerItem>
          <StatCard
            label="Total Orders"
            value={analyticsData.totalOrders.count.toLocaleString()}
            icon={BarChart3}
            hint={analyticsData.totalOrders.trend}
          />
        </StaggerItem>

        <StaggerItem>
          <StatCard
            label="Average Rating"
            value={
              <span className="flex items-baseline gap-2">
                {analyticsData.averageRating.rating}
                <span className="flex">
                  {[...Array(5)].map((_, i) => (
                    <Star
                      key={i}
                      className={`h-4 w-4 ${
                        i < Math.floor(analyticsData.averageRating.rating / 2)
                          ? 'fill-amber-400 text-amber-400'
                          : 'text-muted-foreground/30'
                      }`}
                    />
                  ))}
                </span>
              </span>
            }
            icon={Star}
            hint={analyticsData.averageRating.trend}
          />
        </StaggerItem>

        <StaggerItem>
          <StatCard
            label="Completion Rate"
            value={`${analyticsData.completionRate.percentage}%`}
            icon={TrendingUp}
            hint={analyticsData.completionRate.trend}
          />
        </StaggerItem>
      </Stagger>

      {/* ── Charts 2-col grid ────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
        {/* Response Time Trend */}
        <Reveal delay={0.05}>
          <Card className="rounded-2xl shadow-card border-border/60 overflow-hidden">
            <CardHeader className="p-5 sm:p-6 pb-0">
              <CardTitle className="flex items-center gap-2 text-base">
                <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <LineChart className="h-4 w-4" />
                </span>
                Response Time Trends
              </CardTitle>
            </CardHeader>
            <CardContent className="p-5 sm:p-6 pt-4">
              <div className="h-64 sm:h-72 w-full">
                {analyticsData.responseTimeTrend?.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <ReLineChart
                      data={analyticsData.responseTimeTrend}
                      margin={{ top: 5, right: 10, left: -10, bottom: 5 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} strokeOpacity={0.5} />
                      <XAxis dataKey="date" tick={axisStyle} axisLine={false} tickLine={false} />
                      <YAxis tick={axisStyle} axisLine={false} tickLine={false} width={36}
                        label={{ value: 'Min', angle: -90, position: 'insideLeft', style: { fontSize: 10, fill: 'hsl(var(--muted-foreground))' } }}
                      />
                      <Tooltip contentStyle={tooltipStyle} formatter={(v) => [`${v} min`, 'Avg Response Time']} />
                      <Line
                        type="monotone"
                        dataKey="avgResponse"
                        stroke="hsl(var(--chart-1))"
                        strokeWidth={2.5}
                        dot={{ fill: 'hsl(var(--chart-1))', strokeWidth: 0, r: 3 }}
                        activeDot={{ r: 5, fill: 'hsl(var(--chart-1))', strokeWidth: 0 }}
                      />
                    </ReLineChart>
                  </ResponsiveContainer>
                ) : (
                  <ChartEmpty message="No response time data available" />
                )}
              </div>
            </CardContent>
          </Card>
        </Reveal>

        {/* Order Status Distribution */}
        <Reveal delay={0.1}>
          <Card className="rounded-2xl shadow-card border-border/60 overflow-hidden">
            <CardHeader className="p-5 sm:p-6 pb-0">
              <CardTitle className="flex items-center gap-2 text-base">
                <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <PieChart className="h-4 w-4" />
                </span>
                Order Status Distribution
              </CardTitle>
            </CardHeader>
            <CardContent className="p-5 sm:p-6 pt-4">
              <div className="h-64 sm:h-72 w-full">
                {analyticsData.orderStatusDistribution?.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <RePieChart margin={{ top: 5, right: 5, left: 5, bottom: 5 }}>
                      <Pie
                        data={analyticsData.orderStatusDistribution}
                        cx="50%"
                        cy="50%"
                        outerRadius="65%"
                        innerRadius="28%"
                        paddingAngle={4}
                        dataKey="value"
                        label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                        labelLine={false}
                        style={{ fontSize: 11 }}
                      >
                        {analyticsData.orderStatusDistribution.map((_, index) => (
                          <Cell key={`cell-${index}`} fill={ORANGE_PALETTE[index % 4]} />
                        ))}
                      </Pie>
                      <Tooltip contentStyle={tooltipStyle} formatter={(v, n) => [v, `${n} Orders`]} />
                    </RePieChart>
                  </ResponsiveContainer>
                ) : (
                  <ChartEmpty message="No order status data available" />
                )}
              </div>
            </CardContent>
          </Card>
        </Reveal>

        {/* Orders by Hour */}
        <Reveal delay={0.12}>
          <Card className="rounded-2xl shadow-card border-border/60 overflow-hidden">
            <CardHeader className="p-5 sm:p-6 pb-0">
              <CardTitle className="flex items-center gap-2 text-base">
                <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <BarChart3 className="h-4 w-4" />
                </span>
                Orders by Hour
              </CardTitle>
            </CardHeader>
            <CardContent className="p-5 sm:p-6 pt-4">
              <div className="h-64 sm:h-72 w-full">
                {analyticsData.performanceByHour?.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={analyticsData.performanceByHour}
                      margin={{ top: 5, right: 10, left: -10, bottom: 5 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} strokeOpacity={0.5} />
                      <XAxis dataKey="hour" tick={axisStyle} axisLine={false} tickLine={false} />
                      <YAxis tick={axisStyle} axisLine={false} tickLine={false} width={36}
                        label={{ value: 'Orders', angle: -90, position: 'insideLeft', style: { fontSize: 10, fill: 'hsl(var(--muted-foreground))' } }}
                      />
                      <Tooltip contentStyle={tooltipStyle} formatter={(v, n) => [v, n === 'orders' ? 'Orders' : 'Avg Response (min)']} />
                      <Bar dataKey="orders" fill="hsl(var(--chart-1))" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <ChartEmpty message="No hourly order data available" />
                )}
              </div>
            </CardContent>
          </Card>
        </Reveal>

        {/* Weekly Order Volume */}
        <Reveal delay={0.15}>
          <Card className="rounded-2xl shadow-card border-border/60 overflow-hidden">
            <CardHeader className="p-5 sm:p-6 pb-0">
              <CardTitle className="flex items-center gap-2 text-base">
                <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <TrendingUp className="h-4 w-4" />
                </span>
                Weekly Order Volume
              </CardTitle>
            </CardHeader>
            <CardContent className="p-5 sm:p-6 pt-4">
              <div className="h-64 sm:h-72 w-full">
                {analyticsData.weeklyOrderVolume?.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart
                      data={analyticsData.weeklyOrderVolume}
                      margin={{ top: 5, right: 10, left: -10, bottom: 5 }}
                    >
                      <defs>
                        <linearGradient id="orderGradient" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="hsl(var(--chart-1))" stopOpacity={0.25} />
                          <stop offset="95%" stopColor="hsl(var(--chart-1))" stopOpacity={0.02} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} strokeOpacity={0.5} />
                      <XAxis dataKey="day" tick={axisStyle} axisLine={false} tickLine={false} />
                      <YAxis tick={axisStyle} axisLine={false} tickLine={false} width={36}
                        label={{ value: 'Orders', angle: -90, position: 'insideLeft', style: { fontSize: 10, fill: 'hsl(var(--muted-foreground))' } }}
                      />
                      <Tooltip contentStyle={tooltipStyle} formatter={(v, n) => [v, n === 'orders' ? 'Orders' : 'Revenue']} />
                      <Area
                        type="monotone"
                        dataKey="orders"
                        stroke="hsl(var(--chart-1))"
                        strokeWidth={2.5}
                        fill="url(#orderGradient)"
                        dot={{ fill: 'hsl(var(--chart-1))', strokeWidth: 0, r: 3 }}
                        activeDot={{ r: 5, fill: 'hsl(var(--chart-1))', strokeWidth: 0 }}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                ) : (
                  <ChartEmpty message="No weekly volume data available" />
                )}
              </div>
            </CardContent>
          </Card>
        </Reveal>
      </div>

      {/* ── Orders vs Response Time Correlation (full-width) ─── */}
      <Reveal delay={0.08}>
        <Card className="rounded-2xl shadow-card border-border/60 overflow-hidden">
          <CardHeader className="p-5 sm:p-6 pb-0">
            <CardTitle className="flex items-center gap-2 text-base">
              <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <BarChart3 className="h-4 w-4" />
              </span>
              Orders vs Response Time by Hour
            </CardTitle>
          </CardHeader>
          <CardContent className="p-5 sm:p-6 pt-4">
            <div className="h-72 sm:h-80 lg:h-96 w-full">
              {analyticsData.performanceByHour?.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart
                    data={analyticsData.performanceByHour}
                    margin={{ top: 5, right: 20, left: -10, bottom: 5 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} strokeOpacity={0.5} />
                    <XAxis dataKey="hour" tick={axisStyle} axisLine={false} tickLine={false} />
                    <YAxis
                      yAxisId="left"
                      tick={axisStyle}
                      axisLine={false}
                      tickLine={false}
                      width={36}
                      label={{ value: 'Orders', angle: -90, position: 'insideLeft', style: { fontSize: 10, fill: 'hsl(var(--muted-foreground))' } }}
                    />
                    <YAxis
                      yAxisId="right"
                      orientation="right"
                      tick={axisStyle}
                      axisLine={false}
                      tickLine={false}
                      width={40}
                      label={{ value: 'Time (min)', angle: 90, position: 'insideRight', style: { fontSize: 10, fill: 'hsl(var(--muted-foreground))' } }}
                    />
                    <Tooltip
                      contentStyle={tooltipStyle}
                      formatter={(v, n) => [
                        n === 'orders' ? v : `${v} min`,
                        n === 'orders' ? 'Orders' : 'Avg Response Time',
                      ]}
                    />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar yAxisId="left" dataKey="orders" fill="hsl(var(--chart-4))" radius={[4, 4, 0, 0]} name="Orders" />
                    <Line
                      yAxisId="right"
                      type="monotone"
                      dataKey="avgTimeMinutes"
                      stroke="hsl(var(--chart-1))"
                      strokeWidth={2.5}
                      dot={{ fill: 'hsl(var(--chart-1))', strokeWidth: 0, r: 4 }}
                      activeDot={{ r: 6, fill: 'hsl(var(--chart-1))', strokeWidth: 0 }}
                      name="Avg Response Time"
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              ) : (
                <ChartEmpty message="No correlation data available" />
              )}
            </div>
          </CardContent>
        </Card>
      </Reveal>

      {/* ── Recent Orders Table ──────────────────────────────── */}
      <Reveal delay={0.1}>
        <Card className="rounded-2xl shadow-card border-border/60 overflow-hidden">
          <CardHeader className="p-5 sm:p-6 pb-4">
            <CardTitle className="flex items-center gap-2 text-base">
              <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <MessageSquare className="h-4 w-4" />
              </span>
              Recent Order Response Times
            </CardTitle>
          </CardHeader>

          <div className="overflow-x-auto">
            {analyticsData.recentOrders?.length > 0 ? (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-y border-border/60 bg-muted/40">
                    <th className="px-5 sm:px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Order
                    </th>
                    <th className="px-5 sm:px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Status
                    </th>
                    <th className="px-5 sm:px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Created
                    </th>
                    <th className="px-5 sm:px-6 py-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Response Time
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {analyticsData.recentOrders.map((order) => (
                    <tr key={order.id} className="transition-colors hover:bg-muted/30">
                      <td className="px-5 sm:px-6 py-3.5 font-medium text-foreground">
                        #{order.order_number}
                      </td>
                      <td className="px-5 sm:px-6 py-3.5">
                        <Badge
                          className={
                            order.status === 'completed'
                              ? 'bg-emerald-50 text-emerald-700 border-emerald-100'
                              : order.status === 'ready'
                              ? 'bg-primary/10 text-primary border-primary/10'
                              : order.status === 'preparing'
                              ? 'bg-amber-50 text-amber-700 border-amber-100'
                              : 'bg-muted text-muted-foreground border-border'
                          }
                        >
                          {order.status}
                        </Badge>
                      </td>
                      <td className="px-5 sm:px-6 py-3.5 text-muted-foreground">
                        {order.created_at
                          ? formatDistanceToNow(new Date(order.created_at), { addSuffix: true })
                          : 'Unknown'}
                      </td>
                      <td className="px-5 sm:px-6 py-3.5 text-right font-semibold text-primary tabular-nums">
                        {order.response_time || '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="flex flex-col items-center justify-center gap-2 py-14 text-muted-foreground">
                <MessageSquare className="h-8 w-8 opacity-25" />
                <p className="text-sm">No recent orders found</p>
              </div>
            )}
          </div>
        </Card>
      </Reveal>

      {/* ── Performance Insights ─────────────────────────────── */}
      <Reveal delay={0.12}>
        <Card className="rounded-2xl shadow-card border-border/60 overflow-hidden">
          <CardHeader className="p-5 sm:p-6 pb-4">
            <CardTitle className="flex items-center gap-2 text-base">
              <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <Activity className="h-4 w-4" />
              </span>
              Performance Insights
            </CardTitle>
          </CardHeader>
          <CardContent className="p-5 sm:p-6 pt-0">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* What's working */}
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                  <h4 className="font-semibold text-sm text-foreground">What's Working Well</h4>
                </div>
                <ul className="space-y-2">
                  {insights.working.map((insight, index) => (
                    <li
                      key={index}
                      className="flex gap-2 text-sm text-muted-foreground leading-relaxed"
                    >
                      <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-emerald-400" />
                      {insight}
                    </li>
                  ))}
                </ul>
              </div>

              <Separator className="md:hidden" />

              {/* Improvements */}
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />
                  <h4 className="font-semibold text-sm text-foreground">Areas for Improvement</h4>
                </div>
                <ul className="space-y-2">
                  {insights.improvements.map((insight, index) => (
                    <li
                      key={index}
                      className="flex gap-2 text-sm text-muted-foreground leading-relaxed"
                    >
                      <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-amber-400" />
                      {insight}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </CardContent>
        </Card>
      </Reveal>
    </PageContainer>
  );
};

export default Reports;
