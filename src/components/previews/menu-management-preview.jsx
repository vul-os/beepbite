import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  Package,
  Edit,
  Plus,
  Minus,
  Search,
  Filter,
  BarChart3,
  AlertTriangle,
  CheckCircle,
  Star,
  Utensils,
  DollarSign,
  TrendingUp,
  TrendingDown,
  Eye,
  Save,
  X,
  Settings
} from 'lucide-react';
import { cn } from "@/lib/utils";
import { formatMoney, currencyScale } from "@/lib/currency";

// This preview's prices/revenue are illustrative sample data, not tied to any
// real store — no currency is assumed (see src/lib/currency.js). Mock values
// stay major-unit floats and are scaled to minor units right before
// formatMoney renders them, the same convention real money uses elsewhere.
const DEMO_MONEY_SCALE = currencyScale();
const money = (major) => formatMoney(Math.round((major || 0) * DEMO_MONEY_SCALE));

const MenuManagementPreview = ({ className }) => {
  const [activeTab, setActiveTab] = useState('inventory');
  const [searchQuery, setSearchQuery] = useState('');
  const [editingItem, setEditingItem] = useState(null);
  const [animationPhase, setAnimationPhase] = useState(0);
  const [stockUpdates, setStockUpdates] = useState([]);

  // Dynamic menu items with changing stock levels
  const [menuItems, setMenuItems] = useState([
    { 
      id: 1, 
      name: "Chicken Burger", 
      price: 45.00, 
      category: "Burgers", 
      stock: 25, 
      status: "available", 
      sold_today: 18,
      cost: 25.00,
      margin: 44.4,
      popularity: 92,
      image: "🍔"
    },
    { 
      id: 2, 
      name: "Beef Burger", 
      price: 55.00, 
      category: "Burgers", 
      stock: 8, 
      status: "low_stock", 
      sold_today: 12,
      cost: 30.00,
      margin: 45.5,
      popularity: 87,
      image: "🍔"
    },
    { 
      id: 3, 
      name: "Fries (Large)", 
      price: 25.00, 
      category: "Sides", 
      stock: 45, 
      status: "available", 
      sold_today: 34,
      cost: 8.50,
      margin: 66.0,
      popularity: 95,
      image: "🍟"
    },
    { 
      id: 4, 
      name: "Steak", 
      price: 95.00, 
      category: "Mains", 
      stock: 3, 
      status: "critical", 
      sold_today: 7,
      cost: 65.00,
      margin: 31.6,
      popularity: 78,
      image: "🥩"
    },
    { 
      id: 5, 
      name: "Coca Cola", 
      price: 15.00, 
      category: "Drinks", 
      stock: 67, 
      status: "available", 
      sold_today: 28,
      cost: 6.00,
      margin: 60.0,
      popularity: 88,
      image: "🥤"
    },
    { 
      id: 6, 
      name: "Coffee", 
      price: 18.00, 
      category: "Drinks", 
      stock: 0, 
      status: "out_of_stock", 
      sold_today: 0,
      cost: 5.50,
      margin: 69.4,
      popularity: 72,
      image: "☕"
    }
  ]);

  const categories = [
    { id: 'all', name: 'All Items', count: menuItems.length },
    { id: 'burgers', name: 'Burgers', count: menuItems.filter(i => i.category === 'Burgers').length },
    { id: 'mains', name: 'Mains', count: menuItems.filter(i => i.category === 'Mains').length },
    { id: 'sides', name: 'Sides', count: menuItems.filter(i => i.category === 'Sides').length },
    { id: 'drinks', name: 'Drinks', count: menuItems.filter(i => i.category === 'Drinks').length }
  ];

  // Simulate stock updates
  useEffect(() => {
    const interval = setInterval(() => {
      setAnimationPhase((prev) => (prev + 1) % 3);
      
      // Simulate random stock changes
      const randomItem = Math.floor(Math.random() * menuItems.length);
      const change = Math.random() > 0.5 ? 1 : -1;
      
      setMenuItems(prev => prev.map((item, index) => {
        if (index === randomItem && item.stock > 0) {
          const newStock = Math.max(0, item.stock + change);
          const newStatus = newStock === 0 ? 'out_of_stock' : 
                          newStock < 10 ? 'critical' :
                          newStock < 20 ? 'low_stock' : 'available';
          
          // Add to stock updates log
          setStockUpdates(prev => [{
            id: Date.now(),
            item: item.name,
            change: change,
            newStock: newStock,
            time: new Date().toLocaleTimeString()
          }, ...prev.slice(0, 4)]);
          
          return { ...item, stock: newStock, status: newStatus };
        }
        return item;
      }));
    }, 4000);

    return () => clearInterval(interval);
  }, [menuItems.length]);

  const filteredItems = menuItems.filter(item => 
    searchQuery === '' || item.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const getStatusColor = (status) => {
    switch (status) {
      case 'available': return 'bg-green-100 text-green-800 border-green-200';
      case 'low_stock': return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      case 'critical': return 'bg-orange-100 text-orange-800 border-orange-200';
      case 'out_of_stock': return 'bg-red-100 text-red-800 border-red-200';
      default: return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  const getStatusIcon = (status) => {
    switch (status) {
      case 'available': return <CheckCircle className="w-4 h-4 text-green-600" />;
      case 'low_stock': return <AlertTriangle className="w-4 h-4 text-yellow-600" />;
      case 'critical': return <AlertTriangle className="w-4 h-4 text-orange-600" />;
      case 'out_of_stock': return <X className="w-4 h-4 text-red-600" />;
      default: return <Package className="w-4 h-4 text-gray-600" />;
    }
  };

  const updateStock = (id, change) => {
    setMenuItems(prev => prev.map(item => {
      if (item.id === id) {
        const newStock = Math.max(0, item.stock + change);
        const newStatus = newStock === 0 ? 'out_of_stock' : 
                        newStock < 10 ? 'critical' :
                        newStock < 20 ? 'low_stock' : 'available';
        return { ...item, stock: newStock, status: newStatus };
      }
      return item;
    }));
  };

  const startEditing = (item) => {
    setEditingItem({ ...item });
  };

  const saveEdit = () => {
    setMenuItems(prev => prev.map(item => 
      item.id === editingItem.id ? editingItem : item
    ));
    setEditingItem(null);
  };

  const lowStockItems = menuItems.filter(item => 
    item.status === 'critical' || item.status === 'low_stock' || item.status === 'out_of_stock'
  );

  const totalRevenue = menuItems.reduce((sum, item) => sum + (item.price * item.sold_today), 0);
  const totalItemsSold = menuItems.reduce((sum, item) => sum + item.sold_today, 0);

  return (
    <motion.div 
      className={cn("bg-gradient-to-br from-purple-50 to-indigo-100 rounded-2xl overflow-hidden border border-purple-200 shadow-2xl w-full max-w-full", className)}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6 }}
    >
      <div className="h-[520px] flex flex-col w-full">
        {/* Header */}
        <motion.div 
          className="bg-white border-b border-gray-200 p-4 flex-shrink-0"
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center">
                <Package className="w-6 h-6 text-purple-600" />
              </div>
              <div>
                <h3 className="text-xl font-semibold text-gray-900">Menu Management</h3>
                <p className="text-sm text-gray-500">Real-time inventory and menu control</p>
              </div>
            </div>
            <div className="flex gap-2">
              <Badge className="bg-green-100 text-green-800">
                {menuItems.filter(i => i.status === 'available').length} Available
              </Badge>
              <Badge className="bg-red-100 text-red-800">
                {lowStockItems.length} Low Stock
              </Badge>
            </div>
          </div>

          {/* Tabs */}
          <Tabs value={activeTab} onValueChange={setActiveTab} className="mt-4">
            <TabsList className="grid w-full grid-cols-3 bg-gray-100">
              <TabsTrigger value="inventory" className="text-sm">
                <Package className="w-4 h-4 mr-2" />
                Inventory
              </TabsTrigger>
              <TabsTrigger value="analytics" className="text-sm">
                <BarChart3 className="w-4 h-4 mr-2" />
                Analytics
              </TabsTrigger>
              <TabsTrigger value="alerts" className="text-sm">
                <AlertTriangle className="w-4 h-4 mr-2" />
                Alerts ({lowStockItems.length})
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </motion.div>

        {/* Content */}
        <div className="flex-1 overflow-hidden bg-white">
          <Tabs value={activeTab} className="h-full flex flex-col">
            {/* Inventory Tab */}
            <TabsContent value="inventory" className="flex-1 overflow-hidden p-4">
              <div className="h-full flex flex-col gap-4">
                {/* Search and Filters */}
                <div className="flex gap-3">
                  <div className="flex-1 relative">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                    <Input
                      placeholder="Search menu items..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="pl-10"
                    />
                  </div>
                  <Button variant="outline" size="sm">
                    <Filter className="w-4 h-4 mr-2" />
                    Filter
                  </Button>
                  <Button size="sm" className="bg-purple-500 hover:bg-purple-600">
                    <Plus className="w-4 h-4 mr-2" />
                    Add Item
                  </Button>
                </div>

                {/* Items Grid */}
                <div className="flex-1 overflow-y-auto">
                  <motion.div 
                    className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 pb-4"
                    layout
                  >
                    <AnimatePresence>
                      {filteredItems.map((item, index) => (
                        <motion.div
                          key={item.id}
                          layout
                          initial={{ opacity: 0, scale: 0.9 }}
                          animate={{ opacity: 1, scale: 1 }}
                          exit={{ opacity: 0, scale: 0.9 }}
                          transition={{ duration: 0.2, delay: index * 0.05 }}
                          whileHover={{ y: -2 }}
                        >
                          <Card className="border border-gray-200 hover:border-purple-300 transition-all duration-200 hover:shadow-lg">
                            <CardContent className="p-3">
                              <div className="space-y-3">
                                {/* Header */}
                                <div className="flex items-center justify-between">
                                  <div className="flex items-center gap-2">
                                    <span className="text-xl">{item.image}</span>
                                    <div className="min-w-0">
                                      <h4 className="font-semibold text-sm truncate">{item.name}</h4>
                                      <p className="text-xs text-gray-600">{item.category}</p>
                                    </div>
                                  </div>
                                  <Button 
                                    variant="ghost" 
                                    size="sm" 
                                    className="h-6 w-6 p-0"
                                    onClick={() => startEditing(item)}
                                  >
                                    <Edit className="w-3 h-3" />
                                  </Button>
                                </div>

                                {/* Stock Level */}
                                <div className="space-y-2">
                                  <div className="flex items-center justify-between">
                                    <span className="text-xs text-gray-600">Stock Level</span>
                                    <Badge className={cn("text-xs", getStatusColor(item.status))}>
                                      {getStatusIcon(item.status)}
                                      <span className="ml-1">{item.stock}</span>
                                    </Badge>
                                  </div>
                                  
                                  <div className="flex items-center gap-2">
                                    <Button 
                                      variant="outline" 
                                      size="sm" 
                                      className="h-6 w-6 p-0"
                                      onClick={() => updateStock(item.id, -1)}
                                      disabled={item.stock === 0}
                                    >
                                      <Minus className="w-3 h-3" />
                                    </Button>
                                    <div className="flex-1 text-center">
                                      <motion.span 
                                        key={item.stock}
                                        initial={{ scale: 1.2, color: "#10b981" }}
                                        animate={{ scale: 1, color: "#374151" }}
                                        className="font-medium text-sm"
                                      >
                                        {item.stock}
                                      </motion.span>
                                    </div>
                                    <Button 
                                      variant="outline" 
                                      size="sm" 
                                      className="h-6 w-6 p-0"
                                      onClick={() => updateStock(item.id, 1)}
                                    >
                                      <Plus className="w-3 h-3" />
                                    </Button>
                                  </div>
                                </div>

                                {/* Price and Sales */}
                                <div className="flex justify-between text-xs">
                                  <span className="text-gray-600">Price: <span className="font-medium text-purple-600">{money(item.price)}</span></span>
                                  <span className="text-gray-600">Sold: <span className="font-medium">{item.sold_today}</span></span>
                                </div>
                              </div>
                            </CardContent>
                          </Card>
                        </motion.div>
                      ))}
                    </AnimatePresence>
                  </motion.div>
                </div>
              </div>
            </TabsContent>

            {/* Analytics Tab */}
            <TabsContent value="analytics" className="flex-1 overflow-hidden">
              <div className="h-full overflow-y-auto px-4 py-3">
                {/* Stats Cards */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
                  <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.1 }}
                  >
                    <Card className="border-0 shadow-lg bg-gradient-to-br from-green-50 to-emerald-100">
                      <CardContent className="p-4">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-sm text-gray-600">Revenue Today</p>
                            <p className="text-xl font-bold text-green-600">{money(totalRevenue)}</p>
                          </div>
                          <DollarSign className="w-8 h-8 text-green-600" />
                        </div>
                      </CardContent>
                    </Card>
                  </motion.div>

                  <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.2 }}
                  >
                    <Card className="border-0 shadow-lg bg-gradient-to-br from-blue-50 to-indigo-100">
                      <CardContent className="p-4">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-sm text-gray-600">Items Sold</p>
                            <p className="text-xl font-bold text-blue-600">{totalItemsSold}</p>
                          </div>
                          <Utensils className="w-8 h-8 text-blue-600" />
                        </div>
                      </CardContent>
                    </Card>
                  </motion.div>

                  <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.3 }}
                  >
                    <Card className="border-0 shadow-lg bg-gradient-to-br from-purple-50 to-violet-100">
                      <CardContent className="p-4">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-sm text-gray-600">Avg Margin</p>
                            <p className="text-xl font-bold text-purple-600">
                              {(menuItems.reduce((sum, item) => sum + item.margin, 0) / menuItems.length).toFixed(1)}%
                            </p>
                          </div>
                          <TrendingUp className="w-8 h-8 text-purple-600" />
                        </div>
                      </CardContent>
                    </Card>
                  </motion.div>

                  <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.4 }}
                  >
                    <Card className="border-0 shadow-lg bg-gradient-to-br from-orange-50 to-amber-100">
                      <CardContent className="p-4">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-sm text-gray-600">Top Item</p>
                            <p className="text-sm font-bold text-orange-600">
                              {menuItems.sort((a, b) => b.sold_today - a.sold_today)[0]?.name || 'N/A'}
                            </p>
                          </div>
                          <Star className="w-8 h-8 text-orange-600" />
                        </div>
                      </CardContent>
                    </Card>
                  </motion.div>
                </div>

                {/* Top Performers */}
                <Card className="border border-gray-100 shadow-md">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base font-medium">Top Performing Items</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {menuItems
                      .sort((a, b) => b.sold_today - a.sold_today)
                      .slice(0, 5)
                      .map((item, index) => (
                        <motion.div
                          key={item.id}
                          initial={{ opacity: 0, x: -20 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: index * 0.1 }}
                          className="flex items-center justify-between p-2 hover:bg-gray-50 rounded-lg mb-2 last:mb-0"
                        >
                          <div className="flex items-center gap-3">
                            <div className="w-6 h-6 bg-purple-100 rounded-full flex items-center justify-center text-xs font-medium text-purple-600">
                              {index + 1}
                            </div>
                            <span className="text-lg">{item.image}</span>
                            <div>
                              <p className="font-medium text-sm">{item.name}</p>
                              <p className="text-xs text-gray-500">Margin: {item.margin.toFixed(1)}%</p>
                            </div>
                          </div>
                          <div className="text-right">
                            <p className="font-medium text-sm">{item.sold_today} sold</p>
                            <p className="text-xs text-gray-500">{money(item.price * item.sold_today)}</p>
                          </div>
                        </motion.div>
                      ))}
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            {/* Alerts Tab */}
            <TabsContent value="alerts" className="flex-1 overflow-hidden">
              <div className="h-full overflow-y-auto px-4 py-3">
                {/* Stock Updates */}
                <Card className="mb-4 border border-gray-100 shadow-md">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base font-medium flex items-center gap-2">
                      <div className="w-2 h-2 bg-orange-400 rounded-full animate-pulse"></div>
                      Recent Stock Changes
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <AnimatePresence>
                      {stockUpdates.map((update) => (
                        <motion.div
                          key={update.id}
                          initial={{ opacity: 0, x: -20 }}
                          animate={{ opacity: 1, x: 0 }}
                          exit={{ opacity: 0, x: 20 }}
                          className="flex items-center justify-between p-2 bg-orange-50 rounded-lg border border-orange-100 mb-2 last:mb-0"
                        >
                          <div className="flex items-center gap-2">
                            {update.change > 0 ? (
                              <TrendingUp className="w-4 h-4 text-green-600" />
                            ) : (
                              <TrendingDown className="w-4 h-4 text-red-600" />
                            )}
                            <span className="text-sm font-medium">{update.item}</span>
                          </div>
                          <div className="text-right">
                            <p className="text-sm font-bold">Stock: {update.newStock}</p>
                            <p className="text-xs text-gray-600">{update.time}</p>
                          </div>
                        </motion.div>
                      ))}
                    </AnimatePresence>
                    {stockUpdates.length === 0 && (
                      <p className="text-center text-gray-500 py-3 text-sm">No recent stock changes</p>
                    )}
                  </CardContent>
                </Card>

                {/* Low Stock Alerts */}
                <Card className="border border-gray-100 shadow-md">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base font-medium flex items-center gap-2 text-red-600">
                      <AlertTriangle className="w-4 h-4" />
                      Stock Alerts
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {lowStockItems.map((item, index) => (
                      <motion.div
                        key={item.id}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: index * 0.1 }}
                        className="flex items-center justify-between p-3 bg-red-50 rounded-lg border border-red-200"
                      >
                        <div className="flex items-center gap-3">
                          {getStatusIcon(item.status)}
                          <span className="text-lg">{item.image}</span>
                          <div>
                            <p className="font-medium text-sm">{item.name}</p>
                            <p className="text-xs text-gray-600">{item.category}</p>
                          </div>
                        </div>
                        <div className="text-right">
                          <Badge className={cn("text-xs", getStatusColor(item.status))}>
                            {item.stock} left
                          </Badge>
                          <p className="text-xs text-gray-600 mt-1">Needs restock</p>
                        </div>
                      </motion.div>
                    ))}
                    {lowStockItems.length === 0 && (
                      <div className="text-center py-8">
                        <CheckCircle className="w-12 h-12 mx-auto text-green-500 mb-2" />
                        <p className="text-green-600 font-medium">All items well stocked!</p>
                        <p className="text-sm text-gray-600">No alerts at this time</p>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
            </TabsContent>
          </Tabs>
        </div>

        {/* Edit Modal */}
        <AnimatePresence>
          {editingItem && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/50 flex items-center justify-center p-4"
            >
              <motion.div
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.9, opacity: 0 }}
                className="bg-white rounded-xl p-6 w-full max-w-md"
              >
                <h3 className="text-lg font-semibold mb-4">Edit Menu Item</h3>
                <div className="space-y-4">
                  <div>
                    <label className="text-sm font-medium text-gray-700">Name</label>
                    <Input
                      value={editingItem.name}
                      onChange={(e) => setEditingItem({ ...editingItem, name: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium text-gray-700">Price</label>
                    <Input
                      type="number"
                      value={editingItem.price}
                      onChange={(e) => setEditingItem({ ...editingItem, price: parseFloat(e.target.value) })}
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium text-gray-700">Stock</label>
                    <Input
                      type="number"
                      value={editingItem.stock}
                      onChange={(e) => setEditingItem({ ...editingItem, stock: parseInt(e.target.value) })}
                    />
                  </div>
                </div>
                <div className="flex gap-2 mt-6">
                  <Button onClick={saveEdit} className="flex-1 bg-purple-500 hover:bg-purple-600">
                    <Save className="w-4 h-4 mr-2" />
                    Save Changes
                  </Button>
                  <Button variant="outline" onClick={() => setEditingItem(null)} className="flex-1">
                    Cancel
                  </Button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
};

export default MenuManagementPreview; 