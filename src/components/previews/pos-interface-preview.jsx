import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  Clock,
  ShoppingCart,
  Search,
  Plus,
  Minus,
  Filter,
  Package,
  Utensils,
  Eye,
  Edit,
  CheckCircle,
  Coffee,
  Zap
} from 'lucide-react';
import { cn } from "@/lib/utils";

const POSInterfacePreview = ({ className }) => {
  const [activeTab, setActiveTab] = useState('orders');
  const [activeCategory, setActiveCategory] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [cart, setCart] = useState([]);
  const [animationPhase, setAnimationPhase] = useState(0);

  // Dynamic scenarios that cycle through different states
  const orderScenarios = [
    [
      { id: 'ORD001', order_number: "ORD001", status: "preparing", customer_phone: "Maria G.", created_at: "2024-01-15T10:30:00Z", total: 85.50, items_count: 3 },
      { id: 'ORD002', order_number: "ORD002", status: "ready", customer_phone: "Walk-in", created_at: "2024-01-15T10:45:00Z", total: 42.00, items_count: 2 },
      { id: 'ORD003', order_number: "ORD003", status: "confirmed", customer_phone: "John D.", created_at: "2024-01-15T11:00:00Z", total: 127.25, items_count: 5 }
    ],
    [
      { id: 'ORD004', order_number: "ORD004", status: "completed", customer_phone: "Sarah L.", created_at: "2024-01-15T11:15:00Z", total: 95.00, items_count: 4 },
      { id: 'ORD005', order_number: "ORD005", status: "preparing", customer_phone: "Table 3", created_at: "2024-01-15T11:20:00Z", total: 135.50, items_count: 6 },
      { id: 'ORD006', order_number: "ORD006", status: "ready", customer_phone: "Mike K.", created_at: "2024-01-15T11:25:00Z", total: 68.75, items_count: 3 }
    ]
  ];

  const menuItems = [
    { id: 1, name: "Chicken Burger", price: 45.00, category: "burgers", description: "Grilled chicken with lettuce", available: true, image: "🍔" },
    { id: 2, name: "Beef Burger", price: 55.00, category: "burgers", description: "Juicy beef patty with cheese", available: true, image: "🍔" },
    { id: 3, name: "Fish Burger", price: 48.00, category: "burgers", description: "Crispy fish fillet", available: true, image: "🍔" },
    { id: 4, name: "Grilled Chicken", price: 65.00, category: "mains", description: "Herb-seasoned chicken breast", available: true, image: "🍗" },
    { id: 5, name: "Chicken Wings", price: 55.00, category: "mains", description: "6 piece spicy wings", available: true, image: "🍗" },
    { id: 6, name: "Steak", price: 95.00, category: "mains", description: "300g ribeye steak", available: true, image: "🥩" },
    { id: 7, name: "Fries (Large)", price: 25.00, category: "sides", description: "Crispy golden fries", available: true, image: "🍟" },
    { id: 8, name: "Fries (Regular)", price: 18.00, category: "sides", description: "Perfect portion of fries", available: true, image: "🍟" },
    { id: 9, name: "Onion Rings", price: 22.00, category: "sides", description: "Crispy battered rings", available: true, image: "🧅" },
    { id: 10, name: "Coca Cola", price: 15.00, category: "drinks", description: "330ml can", available: true, image: "🥤" },
    { id: 11, name: "Coffee", price: 18.00, category: "drinks", description: "Freshly brewed", available: true, image: "☕" },
    { id: 12, name: "Fresh Juice", price: 25.00, category: "drinks", description: "Orange or apple", available: true, image: "🧃" }
  ];

  const categories = [
    { id: 'all', name: 'All Items', icon: <Filter className="w-4 h-4" /> },
    { id: 'burgers', name: 'Burgers', icon: <Utensils className="w-4 h-4" /> },
    { id: 'mains', name: 'Mains', icon: <Utensils className="w-4 h-4" /> },
    { id: 'sides', name: 'Sides', icon: <Package className="w-4 h-4" /> },
    { id: 'drinks', name: 'Drinks', icon: <Coffee className="w-4 h-4" /> }
  ];

  // Cycle through order scenarios
  useEffect(() => {
    const interval = setInterval(() => {
      setAnimationPhase((prev) => (prev + 1) % orderScenarios.length);
    }, 6000);
    return () => clearInterval(interval);
  }, []);

  // Auto-demo adding items to cart
  useEffect(() => {
    const demoItems = [
      { id: 1, name: "Chicken Burger", price: 45.00, quantity: 2 },
      { id: 7, name: "Fries (Large)", price: 25.00, quantity: 1 }
    ];
    
    if (activeTab === 'cart') {
      // Animate cart build-up
      setTimeout(() => {
        setCart([demoItems[0]]);
        setTimeout(() => {
          setCart(demoItems);
        }, 1000);
      }, 500);
    }
  }, [activeTab]);

  const currentOrders = orderScenarios[animationPhase];
  const filteredItems = menuItems.filter(item => 
    (activeCategory === 'all' || item.category === activeCategory) &&
    (searchQuery === '' || item.name.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  const getStatusColor = (status) => {
    switch (status) {
      case 'pending': return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      case 'confirmed': return 'bg-blue-100 text-blue-800 border-blue-200';
      case 'preparing': return 'bg-orange-100 text-orange-800 border-orange-200';
      case 'ready': return 'bg-green-100 text-green-800 border-green-200';
      case 'completed': return 'bg-gray-100 text-gray-800 border-gray-200';
      default: return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  const addToCart = (item) => {
    setCart(prev => {
      const existing = prev.find(i => i.id === item.id);
      if (existing) {
        return prev.map(i => 
          i.id === item.id 
            ? { ...i, quantity: i.quantity + 1 }
            : i
        );
      }
      return [...prev, { ...item, quantity: 1 }];
    });
  };

  const updateCartQuantity = (id, change) => {
    setCart(prev => {
      return prev.map(item => {
        if (item.id === id) {
          const newQuantity = Math.max(0, item.quantity + change);
          return newQuantity === 0 ? null : { ...item, quantity: newQuantity };
        }
        return item;
      }).filter(Boolean);
    });
  };

  const cartTotal = cart.reduce((total, item) => total + (item.price * item.quantity), 0);

  return (
    <motion.div 
      className={cn("relative bg-gradient-to-br from-slate-50 to-gray-100 rounded-2xl overflow-hidden border border-gray-200 shadow-2xl w-full max-w-full", className)}
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.6 }}
    >
      <div className="flex h-[450px] w-full min-w-0">
        {/* Left Sidebar - Orders & Cart */}
        <motion.div 
          className="bg-white border-r border-gray-200 flex flex-col shadow-lg w-72 min-w-[280px] flex-shrink-0"
          initial={{ x: -50, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          transition={{ duration: 0.5, delay: 0.2 }}
        >
          {/* Header with Tabs */}
          <div className="bg-gradient-to-r from-orange-500 to-orange-600 px-4 py-3">
            <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
              <TabsList className="grid w-full grid-cols-2 bg-white/20 backdrop-blur-sm">
                <TabsTrigger 
                  value="orders" 
                  className="data-[state=active]:bg-white data-[state=active]:text-orange-600 text-white/90 text-sm font-medium"
                >
                  <Clock className="w-4 h-4 mr-2" />
                  Orders ({currentOrders.length})
                </TabsTrigger>
                <TabsTrigger 
                  value="cart" 
                  className="data-[state=active]:bg-white data-[state=active]:text-orange-600 text-white/90 text-sm font-medium"
                >
                  <ShoppingCart className="w-4 h-4 mr-2" />
                  Cart ({cart.length})
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>

          {/* Tab Content */}
          <div className="flex-1 overflow-hidden">
            <Tabs value={activeTab} className="h-full flex flex-col">
              {/* Orders Tab */}
              <TabsContent value="orders" className="flex-1 overflow-y-auto m-0 p-3 space-y-3">
                <AnimatePresence mode="wait">
                  {currentOrders.map((order, index) => (
                    <motion.div
                      key={`${animationPhase}-${order.id}`}
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -20 }}
                      transition={{ duration: 0.3, delay: index * 0.1 }}
                    >
                      <Card className="border border-gray-200 hover:border-orange-300 transition-all duration-200 hover:shadow-lg cursor-pointer">
                        <CardContent className="p-3">
                          <div className="flex items-center justify-between mb-2">
                            <span className="font-bold text-sm">#{order.order_number}</span>
                            <Badge className={cn("text-xs px-2 py-1", getStatusColor(order.status))}>
                              {order.status}
                            </Badge>
                          </div>
                          <div className="text-xs text-gray-600 space-y-1">
                            <p className="truncate font-medium">{order.customer_phone}</p>
                            <p>R{order.total.toFixed(2)} • {order.items_count} items</p>
                            <p className="text-gray-500">10:30 AM</p>
                          </div>
                          <div className="flex gap-2 mt-3">
                            <Button size="sm" variant="ghost" className="h-6 px-2 text-xs hover:bg-orange-50">
                              <Eye className="w-3 h-3 mr-1" />
                              View
                            </Button>
                            <Button size="sm" variant="ghost" className="h-6 px-2 text-xs hover:bg-orange-50">
                              <Edit className="w-3 h-3 mr-1" />
                              Edit
                            </Button>
                          </div>
                        </CardContent>
                      </Card>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </TabsContent>

              {/* Cart Tab */}
              <TabsContent value="cart" className="flex-1 flex flex-col m-0">
                <div className="flex-1 overflow-y-auto p-3 space-y-3">
                  <AnimatePresence>
                    {cart.map((item, index) => (
                      <motion.div
                        key={item.id}
                        initial={{ opacity: 0, x: -20 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: 20 }}
                        transition={{ duration: 0.3, delay: index * 0.1 }}
                      >
                        <Card className="border border-gray-200 hover:border-orange-200 transition-colors">
                          <CardContent className="p-3">
                            <div className="flex justify-between items-start mb-2">
                              <div className="flex-1 min-w-0">
                                <h4 className="font-medium text-sm truncate">{item.name}</h4>
                                <p className="text-xs text-gray-600">R{item.price.toFixed(2)} each</p>
                              </div>
                              <div className="text-right ml-2">
                                <p className="text-sm font-bold text-orange-600">R{(item.price * item.quantity).toFixed(2)}</p>
                              </div>
                            </div>
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <Button 
                                  size="sm" 
                                  variant="outline" 
                                  className="h-6 w-6 p-0"
                                  onClick={() => updateCartQuantity(item.id, -1)}
                                >
                                  <Minus className="w-3 h-3" />
                                </Button>
                                <span className="text-sm font-medium w-8 text-center">{item.quantity}</span>
                                <Button 
                                  size="sm" 
                                  variant="outline" 
                                  className="h-6 w-6 p-0"
                                  onClick={() => updateCartQuantity(item.id, 1)}
                                >
                                  <Plus className="w-3 h-3" />
                                </Button>
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      </motion.div>
                    ))}
                  </AnimatePresence>
                  
                  {cart.length === 0 && (
                    <motion.div 
                      className="text-center py-8 text-gray-500"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                    >
                      <ShoppingCart className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                      <p className="text-sm">Your cart is empty</p>
                      <p className="text-xs">Add items from the menu</p>
                    </motion.div>
                  )}
                </div>
                
                {/* Cart Footer */}
                {cart.length > 0 && (
                  <motion.div 
                    className="border-t border-gray-200 p-3 bg-gray-50"
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                  >
                    <div className="flex justify-between items-center mb-3">
                      <span className="font-bold">Total:</span>
                      <span className="font-bold text-orange-600 text-lg">R{cartTotal.toFixed(2)}</span>
                    </div>
                    <Button className="w-full bg-orange-500 hover:bg-orange-600 text-white">
                      <CheckCircle className="w-4 h-4 mr-2" />
                      Create Order
                    </Button>
                  </motion.div>
                )}
              </TabsContent>
            </Tabs>
          </div>
        </motion.div>

        {/* Right Side - Menu Items */}
        <motion.div 
          className="flex-1 bg-white min-w-0 flex flex-col"
          initial={{ x: 50, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          transition={{ duration: 0.5, delay: 0.4 }}
        >
          {/* Search Bar */}
          <div className="p-3 bg-white border-b border-gray-200">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
              <Input
                placeholder="Search menu items..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10 h-9 text-sm border-2 border-gray-200 focus:border-orange-400 transition-colors"
              />
              {searchQuery && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="absolute right-3 top-1/2 transform -translate-y-1/2"
                >
                  <Zap className="w-4 h-4 text-orange-500" />
                </motion.div>
              )}
            </div>
          </div>

          {/* Categories */}
          <div className="p-3 bg-white border-b border-gray-200">
            <div className="flex gap-2 overflow-x-auto scrollbar-hide">
              {categories.map((category) => (
                <Button
                  key={category.id}
                  variant={activeCategory === category.id ? "default" : "outline"}
                  className={cn(
                    "whitespace-nowrap flex-shrink-0 h-8 px-4 rounded-full text-xs transition-all duration-200",
                    activeCategory === category.id 
                      ? "bg-orange-500 hover:bg-orange-600 text-white shadow-lg" 
                      : "border-gray-200 text-gray-700 hover:bg-orange-50 hover:border-orange-200"
                  )}
                  onClick={() => setActiveCategory(category.id)}
                >
                  {category.icon}
                  <span className="ml-2">{category.name}</span>
                </Button>
              ))}
            </div>
          </div>

          {/* Items Grid */}
          <div className="flex-1 overflow-y-auto p-3 bg-gray-50">
            <motion.div 
              className="grid grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 gap-2"
              layout
            >
              <AnimatePresence>
                {filteredItems.slice(0, 15).map((item, index) => (
                  <motion.div
                    key={item.id}
                    layout
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.9 }}
                    transition={{ duration: 0.2, delay: index * 0.02 }}
                    whileHover={{ scale: 1.02, y: -2 }}
                    whileTap={{ scale: 0.98 }}
                  >
                    <Card
                      className="border border-gray-200 hover:border-orange-300 transition-all duration-200 hover:shadow-md cursor-pointer bg-white group"
                      onClick={() => addToCart(item)}
                    >
                      <CardContent className="p-2">
                        <div className="space-y-1">
                          <div className="flex items-center justify-between">
                            <span className="text-lg">{item.image}</span>
                            <motion.div
                              whileHover={{ scale: 1.1 }}
                              whileTap={{ scale: 0.9 }}
                            >
                              <Button 
                                size="sm" 
                                className="h-5 w-5 p-0 bg-orange-500 hover:bg-orange-600 rounded-full opacity-70 group-hover:opacity-100 transition-opacity"
                              >
                                <Plus className="w-2.5 h-2.5" />
                              </Button>
                            </motion.div>
                          </div>
                          
                          <div>
                            <h3 className="font-bold text-xs leading-tight text-gray-900">
                              {item.name}
                            </h3>
                            <p className="text-xs text-gray-500 leading-tight truncate">
                              {item.description}
                            </p>
                          </div>
                          
                          <div className="flex justify-between items-center pt-1">
                            <span className="font-bold text-orange-600 text-sm">R{item.price.toFixed(0)}</span>
                            <Badge variant="outline" className="text-xs border-green-200 text-green-700 h-4 px-1 bg-green-50">
                              ✓
                            </Badge>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  </motion.div>
                ))}
              </AnimatePresence>
            </motion.div>
            
            {filteredItems.length === 0 && (
              <motion.div 
                className="text-center py-8 text-gray-500"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
              >
                <Search className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                <p className="text-sm font-medium">No items found</p>
                <p className="text-xs">Try adjusting your search or category filter</p>
              </motion.div>
            )}
          </div>
        </motion.div>
      </div>
    </motion.div>
  );
};

export default POSInterfacePreview; 