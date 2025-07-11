import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { 
  BarChart3,
  TrendingUp,
  TrendingDown,
  DollarSign,
  Users,
  ShoppingCart,
  Clock,
  MessageSquare,
  Package,
  Calendar,
  Filter,
  Download
} from 'lucide-react';
import { cn } from "@/lib/utils";

// WhatsApp SVG Icon Component
const WhatsAppIcon = ({ className = "w-4 h-4" }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor">
    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893A11.821 11.821 0 0020.465 3.488"/>
  </svg>
);

const DashboardPreview = ({ className }) => {
  const [animateValues, setAnimateValues] = useState(false);

  useEffect(() => {
    // Animate counters on mount
    setTimeout(() => setAnimateValues(true), 500);
  }, []);

  // Sample analytics data
  const analyticsData = {
    revenue: {
      total: 15247.50,
      change: +12.3,
      trend: 'up'
    },
    orders: {
      total: 342,
      change: +8.7,
      trend: 'up'
    },
    customers: {
      total: 198,
      change: +15.2,
      trend: 'up'
    },
    avgOrder: {
      total: 44.60,
      change: -2.1,
      trend: 'down'
    }
  };

  const recentOrders = [
    {
      id: 'ORD001',
      customer: '+27123456789',
      total: 85.50,
      status: 'completed',
      type: 'whatsapp',
      time: '14:30'
    },
    {
      id: 'ORD002',
      customer: 'Walk-in',
      total: 42.00,
      status: 'completed',
      type: 'pos',
      time: '14:25'
    },
    {
      id: 'ORD003',
      customer: '+27987654321',
      total: 127.25,
      status: 'preparing',
      type: 'whatsapp',
      time: '14:20'
    },
    {
      id: 'ORD004',
      customer: 'Table 5',
      total: 95.00,
      status: 'ready',
      type: 'pos',
      time: '14:15'
    }
  ];

  const topItems = [
    { name: 'Chicken Burger', sold: 45, revenue: 2025.00 },
    { name: 'Pizza Margherita', sold: 32, revenue: 2400.00 },
    { name: 'Fries (Large)', sold: 67, revenue: 1675.00 },
    { name: 'Coca Cola', sold: 89, revenue: 1335.00 }
  ];

  const getStatusColor = (status) => {
    switch (status) {
      case 'completed': return 'bg-green-100 text-green-800 border-green-200';
      case 'preparing': return 'bg-orange-100 text-orange-800 border-orange-200';
      case 'ready': return 'bg-blue-100 text-blue-800 border-blue-200';
      default: return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  const AnimatedNumber = ({ value, prefix = "", suffix = "" }) => {
    const [displayValue, setDisplayValue] = useState(0);

    useEffect(() => {
      if (animateValues) {
        let start = 0;
        const increment = value / 30;
        const timer = setInterval(() => {
          start += increment;
          if (start >= value) {
            setDisplayValue(value);
            clearInterval(timer);
          } else {
            setDisplayValue(Math.floor(start));
          }
        }, 50);
        return () => clearInterval(timer);
      }
    }, [animateValues, value]);

    return (
      <span>
        {prefix}{typeof value === 'number' && value % 1 !== 0 ? displayValue.toFixed(2) : displayValue}{suffix}
      </span>
    );
  };

  return (
    <div className={cn("bg-gradient-to-br from-orange-50 to-orange-100 rounded-xl p-4 sm:p-6 border border-orange-200", className)}>
      <div className="space-y-4 sm:space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg sm:text-xl font-semibold text-orange-800">Analytics Dashboard</h3>
            <p className="text-xs sm:text-sm text-gray-600">Real-time insights for your restaurant</p>
          </div>
          <div className="flex gap-1 sm:gap-2">
            <Button variant="outline" size="sm" className="border-orange-200 text-orange-600 hover:bg-orange-50 text-xs h-6 sm:h-8 px-2 sm:px-3">
              <Calendar className="w-3 h-3 sm:w-4 sm:h-4 mr-1" />
              <span className="hidden sm:inline">Today</span>
            </Button>
            <Button variant="outline" size="sm" className="border-orange-200 text-orange-600 hover:bg-orange-50 text-xs h-6 sm:h-8 px-2 sm:px-3">
              <Download className="w-3 h-3 sm:w-4 sm:h-4 mr-1" />
              <span className="hidden sm:inline">Export</span>
            </Button>
          </div>
        </div>

        {/* Key Metrics */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-4">
          <Card className="border-orange-200 bg-white">
            <CardContent className="p-3 sm:p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs sm:text-sm text-gray-600">Revenue</p>
                  <p className="text-lg sm:text-xl font-bold text-gray-900">
                    <AnimatedNumber value={analyticsData.revenue.total} prefix="R" />
                  </p>
                  <div className="flex items-center gap-1 mt-1">
                    <TrendingUp className="w-3 h-3 text-green-500" />
                    <span className="text-xs text-green-600">+{analyticsData.revenue.change}%</span>
                  </div>
                </div>
                <div className="w-8 h-8 sm:w-10 sm:h-10 bg-green-100 rounded-lg flex items-center justify-center">
                  <DollarSign className="w-4 h-4 sm:w-5 sm:h-5 text-green-600" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-orange-200 bg-white">
            <CardContent className="p-3 sm:p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs sm:text-sm text-gray-600">Orders</p>
                  <p className="text-lg sm:text-xl font-bold text-gray-900">
                    <AnimatedNumber value={analyticsData.orders.total} />
                  </p>
                  <div className="flex items-center gap-1 mt-1">
                    <TrendingUp className="w-3 h-3 text-green-500" />
                    <span className="text-xs text-green-600">+{analyticsData.orders.change}%</span>
                  </div>
                </div>
                <div className="w-8 h-8 sm:w-10 sm:h-10 bg-blue-100 rounded-lg flex items-center justify-center">
                  <ShoppingCart className="w-4 h-4 sm:w-5 sm:h-5 text-blue-600" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-orange-200 bg-white">
            <CardContent className="p-3 sm:p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs sm:text-sm text-gray-600">Customers</p>
                  <p className="text-lg sm:text-xl font-bold text-gray-900">
                    <AnimatedNumber value={analyticsData.customers.total} />
                  </p>
                  <div className="flex items-center gap-1 mt-1">
                    <TrendingUp className="w-3 h-3 text-green-500" />
                    <span className="text-xs text-green-600">+{analyticsData.customers.change}%</span>
                  </div>
                </div>
                <div className="w-8 h-8 sm:w-10 sm:h-10 bg-purple-100 rounded-lg flex items-center justify-center">
                  <Users className="w-4 h-4 sm:w-5 sm:h-5 text-purple-600" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-orange-200 bg-white">
            <CardContent className="p-3 sm:p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs sm:text-sm text-gray-600">Avg Order</p>
                  <p className="text-lg sm:text-xl font-bold text-gray-900">
                    <AnimatedNumber value={analyticsData.avgOrder.total} prefix="R" />
                  </p>
                  <div className="flex items-center gap-1 mt-1">
                    <TrendingDown className="w-3 h-3 text-red-500" />
                    <span className="text-xs text-red-600">{analyticsData.avgOrder.change}%</span>
                  </div>
                </div>
                <div className="w-8 h-8 sm:w-10 sm:h-10 bg-orange-100 rounded-lg flex items-center justify-center">
                  <BarChart3 className="w-4 h-4 sm:w-5 sm:h-5 text-orange-600" />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="grid lg:grid-cols-2 gap-4 sm:gap-6">
          {/* Recent Orders */}
          <Card className="border-orange-200 bg-white">
            <CardHeader className="pb-2 sm:pb-3">
              <CardTitle className="text-sm sm:text-lg flex items-center gap-2">
                <Clock className="w-4 h-4 sm:w-5 sm:h-5 text-orange-500" />
                Recent Orders
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="space-y-1 sm:space-y-2 px-3 sm:px-4 pb-3 sm:pb-4">
                {recentOrders.slice(0, 3).map((order) => (
                  <div key={order.id} className="flex items-center justify-between p-2 sm:p-3 bg-gray-50 rounded-lg">
                    <div className="flex items-center gap-2 sm:gap-3">
                      <div className="w-6 h-6 sm:w-8 sm:h-8 bg-orange-100 rounded-lg flex items-center justify-center">
                        {order.type === 'whatsapp' ? (
                          <WhatsAppIcon className="w-3 h-3 sm:w-4 sm:h-4 text-green-600" />
                        ) : (
                          <Package className="w-3 h-3 sm:w-4 sm:h-4 text-orange-600" />
                        )}
                      </div>
                      <div>
                        <p className="font-medium text-xs sm:text-sm">{order.id}</p>
                        <p className="text-xs text-gray-600 truncate max-w-[100px] sm:max-w-none">{order.customer}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="font-bold text-xs sm:text-sm">R{order.total.toFixed(2)}</p>
                      <div className="flex items-center gap-1 sm:gap-2">
                        <Badge className={cn("text-xs px-1 sm:px-2 py-1", getStatusColor(order.status))}>
                          {order.status}
                        </Badge>
                        <span className="text-xs text-gray-500">{order.time}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Top Items */}
          <Card className="border-orange-200 bg-white">
            <CardHeader className="pb-2 sm:pb-3">
              <CardTitle className="text-sm sm:text-lg flex items-center gap-2">
                <TrendingUp className="w-4 h-4 sm:w-5 sm:h-5 text-orange-500" />
                Top Selling Items
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 sm:space-y-3">
              {topItems.slice(0, 3).map((item, index) => (
                <div key={item.name} className="flex items-center justify-between">
                  <div className="flex items-center gap-2 sm:gap-3">
                    <div className="w-5 h-5 sm:w-6 sm:h-6 bg-orange-100 rounded-full flex items-center justify-center text-xs font-bold text-orange-600">
                      {index + 1}
                    </div>
                    <div>
                      <p className="font-medium text-xs sm:text-sm truncate max-w-[120px] sm:max-w-none">{item.name}</p>
                      <p className="text-xs text-gray-600">{item.sold} sold</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="font-bold text-xs sm:text-sm text-orange-600">R{item.revenue.toFixed(2)}</p>
                    <div className="w-12 sm:w-16 h-1 bg-gray-200 rounded-full mt-1">
                      <div 
                        className="h-1 bg-orange-500 rounded-full transition-all duration-1000"
                        style={{ 
                          width: animateValues ? `${(item.revenue / 2400) * 100}%` : '0%' 
                        }}
                      ></div>
                    </div>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        {/* Channel Performance */}
        <Card className="border-orange-200 bg-white">
          <CardHeader className="pb-2 sm:pb-3">
            <CardTitle className="text-sm sm:text-lg flex items-center gap-2">
              <MessageSquare className="w-4 h-4 sm:w-5 sm:h-5 text-orange-500" />
              Order Channels Performance
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3 sm:gap-4">
              <div className="text-center p-3 sm:p-4 bg-green-50 rounded-lg border border-green-200">
                <div className="w-10 h-10 sm:w-12 sm:h-12 bg-green-100 rounded-lg flex items-center justify-center mx-auto mb-2">
                  <WhatsAppIcon className="w-5 h-5 sm:w-6 sm:h-6 text-green-600" />
                </div>
                <h4 className="font-semibold text-xs sm:text-sm text-green-800">WhatsApp Orders</h4>
                <p className="text-lg sm:text-2xl font-bold text-green-600 mt-1">
                  <AnimatedNumber value={156} />
                </p>
                <p className="text-xs sm:text-sm text-green-600">R6,847.20 revenue</p>
                <div className="w-full h-2 bg-green-200 rounded-full mt-2">
                  <div 
                    className="h-2 bg-green-500 rounded-full transition-all duration-1000"
                    style={{ width: animateValues ? '46%' : '0%' }}
                  ></div>
                </div>
              </div>

              <div className="text-center p-3 sm:p-4 bg-orange-50 rounded-lg border border-orange-200">
                <div className="w-10 h-10 sm:w-12 sm:h-12 bg-orange-100 rounded-lg flex items-center justify-center mx-auto mb-2">
                  <Package className="w-5 h-5 sm:w-6 sm:h-6 text-orange-600" />
                </div>
                <h4 className="font-semibold text-xs sm:text-sm text-orange-800">POS Orders</h4>
                <p className="text-lg sm:text-2xl font-bold text-orange-600 mt-1">
                  <AnimatedNumber value={186} />
                </p>
                <p className="text-xs sm:text-sm text-orange-600">R8,400.30 revenue</p>
                <div className="w-full h-2 bg-orange-200 rounded-full mt-2">
                  <div 
                    className="h-2 bg-orange-500 rounded-full transition-all duration-1000"
                    style={{ width: animateValues ? '54%' : '0%' }}
                  ></div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default DashboardPreview; 