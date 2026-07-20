import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
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
  Download,
  Wifi,
  Activity
} from 'lucide-react';
import { cn } from "@/lib/utils";
import { formatMoney, currencyScale } from "@/lib/currency";

// WhatsApp SVG Icon Component
const WhatsAppIcon = ({ className = "w-4 h-4" }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor">
    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893A11.821 11.821 0 0020.465 3.488"/>
  </svg>
);

// This preview's revenue figures are illustrative sample data, not tied to any
// real store — no currency is assumed (see src/lib/currency.js), so amounts
// render as plain localised numbers instead of asserting a market nobody
// chose. Mock values below stay major-unit floats and are scaled to minor
// units right before formatMoney renders them, the same convention real money
// uses elsewhere in the app.
const DEMO_MONEY_SCALE = currencyScale();
const money = (major) => formatMoney(Math.round((major || 0) * DEMO_MONEY_SCALE));

const DashboardPreview = ({ className }) => {
  const [currentTime, setCurrentTime] = useState(new Date());
  const [animationPhase, setAnimationPhase] = useState(0);
  const [metrics, setMetrics] = useState({
    revenue: 0,
    orders: 0,
    customers: 0,
    avgOrder: 0
  });

  // Dynamic data that cycles through different scenarios
  const scenarios = [
    {
      revenue: 15247.50,
      orders: 342,
      customers: 198,
      avgOrder: 44.60,
      recentOrders: [
        { id: 'ORD001', customer: 'Maria G.', total: 85.50, status: 'completed', type: 'whatsapp', time: '14:30' },
        { id: 'ORD002', customer: 'Walk-in', total: 42.00, status: 'preparing', type: 'pos', time: '14:25' },
        { id: 'ORD003', customer: 'John D.', total: 67.25, status: 'ready', type: 'whatsapp', time: '14:20' }
      ]
    },
    {
      revenue: 16890.75,
      orders: 378,
      customers: 215,
      avgOrder: 47.20,
      recentOrders: [
        { id: 'ORD004', customer: 'Sarah L.', total: 95.00, status: 'confirmed', type: 'whatsapp', time: '14:45' },
        { id: 'ORD005', customer: 'Table 3', total: 135.50, status: 'preparing', type: 'pos', time: '14:42' },
        { id: 'ORD006', customer: 'Mike K.', total: 28.75, status: 'completed', type: 'whatsapp', time: '14:38' }
      ]
    },
    {
      revenue: 18234.25,
      orders: 401,
      customers: 239,
      avgOrder: 45.80,
      recentOrders: [
        { id: 'ORD007', customer: 'Lisa P.', total: 78.50, status: 'ready', type: 'whatsapp', time: '15:10' },
        { id: 'ORD008', customer: 'Drive-thru', total: 156.00, status: 'completed', type: 'pos', time: '15:05' },
        { id: 'ORD009', customer: 'David M.', total: 89.25, status: 'preparing', type: 'whatsapp', time: '15:02' }
      ]
    }
  ];

  // Cycle through scenarios
  useEffect(() => {
    const interval = setInterval(() => {
      setAnimationPhase((prev) => (prev + 1) % scenarios.length);
    }, 4000);
    return () => clearInterval(interval);
  }, []);

  // Animate metrics
  useEffect(() => {
    const targetMetrics = scenarios[animationPhase];
    const duration = 1000;
    const steps = 30;
    const interval = duration / steps;

    let step = 0;
    const timer = setInterval(() => {
      step++;
      const progress = step / steps;
      
      setMetrics({
        revenue: Math.floor(targetMetrics.revenue * progress),
        orders: Math.floor(targetMetrics.orders * progress),
        customers: Math.floor(targetMetrics.customers * progress),
        avgOrder: Math.floor(targetMetrics.avgOrder * progress * 100) / 100
      });

      if (step >= steps) {
        setMetrics(targetMetrics);
        clearInterval(timer);
      }
    }, interval);

    return () => clearInterval(timer);
  }, [animationPhase]);

  // Update time
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 30000);
    return () => clearInterval(timer);
  }, []);

  const currentScenario = scenarios[animationPhase];

  const getStatusColor = (status) => {
    switch (status) {
      case 'completed': return 'bg-green-100 text-green-800 border-green-200';
      case 'preparing': return 'bg-orange-100 text-orange-800 border-orange-200';
      case 'ready': return 'bg-blue-100 text-blue-800 border-blue-200';
      case 'confirmed': return 'bg-purple-100 text-purple-800 border-purple-200';
      default: return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  return (
    <motion.div 
      className={cn("bg-gradient-to-br from-slate-50 to-gray-100 rounded-2xl p-4 border border-gray-200 shadow-2xl w-full max-w-full overflow-hidden", className)}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6 }}
    >
      <div className="space-y-4 w-full min-w-0">
        {/* Header */}
        <motion.div 
          className="flex items-center justify-between"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.2 }}
        >
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse"></div>
              <div className="w-2 h-2 rounded-full bg-yellow-400 opacity-60"></div>
              <div className="w-2 h-2 rounded-full bg-red-400 opacity-40"></div>
            </div>
            <div>
              <h3 className="text-lg font-semibold text-gray-900">BeepBite Analytics</h3>
              <p className="text-xs text-gray-500 flex items-center gap-2">
                <Activity className="w-3 h-3 text-green-500" />
                Live Dashboard • {currentTime.toLocaleTimeString()}
              </p>
            </div>
          </div>
          <div className="flex gap-1">
            <Button variant="outline" size="sm" className="border-gray-300 text-gray-600 hover:bg-gray-50 text-xs px-2 py-1 h-7">
              <Calendar className="w-3 h-3 mr-1" />
              Today
            </Button>
            <Button variant="outline" size="sm" className="border-gray-300 text-gray-600 hover:bg-gray-50 text-xs px-2 py-1 h-7">
              <Download className="w-3 h-3 mr-1" />
              Export
            </Button>
          </div>
        </motion.div>

        {/* Key Metrics */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <motion.div
            key={`revenue-${animationPhase}`}
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.4, delay: 0.1 }}
          >
            <Card className="border-0 shadow-lg bg-gradient-to-br from-green-50 to-emerald-100">
              <CardContent className="p-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-gray-600 mb-1">Total Revenue</p>
                    <motion.p 
                      className="text-lg font-bold text-gray-900"
                      key={metrics.revenue}
                    >
                      {money(metrics.revenue)}
                    </motion.p>
                    <div className="flex items-center gap-1 mt-1">
                      <TrendingUp className="w-3 h-3 text-green-500" />
                      <span className="text-xs text-green-600 font-medium">+12.3%</span>
                    </div>
                  </div>
                  <div className="w-8 h-8 bg-green-100 rounded-lg flex items-center justify-center">
                    <DollarSign className="w-4 h-4 text-green-600" />
                  </div>
                </div>
              </CardContent>
            </Card>
          </motion.div>

          <motion.div
            key={`orders-${animationPhase}`}
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.4, delay: 0.2 }}
          >
            <Card className="border-0 shadow-lg bg-gradient-to-br from-blue-50 to-indigo-100">
              <CardContent className="p-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-gray-600 mb-1">Total Orders</p>
                    <motion.p 
                      className="text-lg font-bold text-gray-900"
                      key={metrics.orders}
                    >
                      {metrics.orders.toLocaleString()}
                    </motion.p>
                    <div className="flex items-center gap-1 mt-1">
                      <TrendingUp className="w-3 h-3 text-blue-500" />
                      <span className="text-xs text-blue-600 font-medium">+8.7%</span>
                    </div>
                  </div>
                  <div className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center">
                    <ShoppingCart className="w-4 h-4 text-blue-600" />
                  </div>
                </div>
              </CardContent>
            </Card>
          </motion.div>

          <motion.div
            key={`customers-${animationPhase}`}
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.4, delay: 0.3 }}
          >
            <Card className="border-0 shadow-lg bg-gradient-to-br from-purple-50 to-violet-100">
              <CardContent className="p-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-gray-600 mb-1">Customers</p>
                    <motion.p 
                      className="text-lg font-bold text-gray-900"
                      key={metrics.customers}
                    >
                      {metrics.customers.toLocaleString()}
                    </motion.p>
                    <div className="flex items-center gap-1 mt-1">
                      <TrendingUp className="w-3 h-3 text-purple-500" />
                      <span className="text-xs text-purple-600 font-medium">+15.2%</span>
                    </div>
                  </div>
                  <div className="w-8 h-8 bg-purple-100 rounded-lg flex items-center justify-center">
                    <Users className="w-4 h-4 text-purple-600" />
                  </div>
                </div>
              </CardContent>
            </Card>
          </motion.div>

          <motion.div
            key={`avg-${animationPhase}`}
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.4, delay: 0.4 }}
          >
            <Card className="border-0 shadow-lg bg-gradient-to-br from-orange-50 to-amber-100">
              <CardContent className="p-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-gray-600 mb-1">Avg Order</p>
                    <motion.p 
                      className="text-lg font-bold text-gray-900"
                      key={metrics.avgOrder}
                    >
                      {money(metrics.avgOrder)}
                    </motion.p>
                    <div className="flex items-center gap-1 mt-1">
                      <TrendingDown className="w-3 h-3 text-orange-500" />
                      <span className="text-xs text-orange-600 font-medium">-2.1%</span>
                    </div>
                  </div>
                  <div className="w-8 h-8 bg-orange-100 rounded-lg flex items-center justify-center">
                    <BarChart3 className="w-4 h-4 text-orange-600" />
                  </div>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        </div>

        <div className="grid lg:grid-cols-2 gap-4">
          {/* Live Orders */}
          <Card className="border-0 shadow-lg bg-white">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
                Live Orders
                <Badge className="ml-auto bg-green-100 text-green-800 text-xs">
                  {currentScenario.recentOrders.length} active
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <AnimatePresence mode="wait">
                {currentScenario.recentOrders.map((order, index) => (
                  <motion.div
                    key={`${animationPhase}-${order.id}`}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 20 }}
                    transition={{ duration: 0.3, delay: index * 0.1 }}
                    className="flex items-center justify-between p-2 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 bg-white rounded-lg shadow-sm flex items-center justify-center">
                        {order.type === 'whatsapp' ? (
                          <WhatsAppIcon className="w-3 h-3 text-green-600" />
                        ) : (
                          <Package className="w-3 h-3 text-orange-600" />
                        )}
                      </div>
                      <div>
                        <p className="font-semibold text-xs text-gray-900">{order.id}</p>
                        <p className="text-xs text-gray-600">{order.customer}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="font-bold text-xs text-gray-900">{money(order.total)}</p>
                      <div className="flex items-center gap-1">
                        <Badge className={cn("text-xs", getStatusColor(order.status))}>
                          {order.status}
                        </Badge>
                      </div>
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
            </CardContent>
          </Card>

          {/* Channel Performance */}
          <Card className="border-0 shadow-lg bg-white">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <MessageSquare className="w-4 h-4 text-orange-500" />
                Channel Performance
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <motion.div 
                className="relative p-2 bg-gradient-to-r from-green-50 to-emerald-100 rounded-lg"
                whileHover={{ scale: 1.02 }}
                transition={{ duration: 0.2 }}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <WhatsAppIcon className="w-4 h-4 text-green-600" />
                    <span className="font-semibold text-xs text-gray-900">WhatsApp</span>
                  </div>
                  <span className="text-sm font-bold text-green-600">
                    {Math.floor(metrics.orders * 0.46)}
                  </span>
                </div>
                <div className="flex justify-between text-xs text-gray-600 mb-1">
                  <span>46% of orders</span>
                  <span>{money(Math.floor(metrics.revenue * 0.45))}</span>
                </div>
                <div className="w-full h-1 bg-green-200 rounded-full overflow-hidden">
                  <motion.div 
                    className="h-full bg-green-500 rounded-full"
                    initial={{ width: 0 }}
                    animate={{ width: "46%" }}
                    transition={{ duration: 1, delay: 0.5 }}
                  />
                </div>
              </motion.div>

              <motion.div 
                className="relative p-2 bg-gradient-to-r from-orange-50 to-amber-100 rounded-lg"
                whileHover={{ scale: 1.02 }}
                transition={{ duration: 0.2 }}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Package className="w-4 h-4 text-orange-600" />
                    <span className="font-semibold text-xs text-gray-900">POS</span>
                  </div>
                  <span className="text-sm font-bold text-orange-600">
                    {Math.floor(metrics.orders * 0.54)}
                  </span>
                </div>
                <div className="flex justify-between text-xs text-gray-600 mb-1">
                  <span>54% of orders</span>
                  <span>{money(Math.floor(metrics.revenue * 0.55))}</span>
                </div>
                <div className="w-full h-1 bg-orange-200 rounded-full overflow-hidden">
                  <motion.div 
                    className="h-full bg-orange-500 rounded-full"
                    initial={{ width: 0 }}
                    animate={{ width: "54%" }}
                    transition={{ duration: 1, delay: 0.7 }}
                  />
                </div>
              </motion.div>
            </CardContent>
          </Card>
        </div>

        {/* Progress Indicators */}
        <div className="flex justify-center">
          <div className="flex gap-1">
            {scenarios.map((_, index) => (
              <motion.div
                key={index}
                className={cn(
                  "w-1.5 h-1.5 rounded-full transition-colors",
                  index === animationPhase ? "bg-orange-500" : "bg-gray-300"
                )}
                whileHover={{ scale: 1.2 }}
              />
            ))}
          </div>
        </div>
      </div>
    </motion.div>
  );
};

export default DashboardPreview; 