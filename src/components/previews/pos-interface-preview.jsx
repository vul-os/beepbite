import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Plus, Minus, ShoppingCart, CreditCard, DollarSign, Clock, CheckCircle, Coffee, UtensilsCrossed, IceCream, Search, Filter, Users, Package, Trash2, ArrowRight, Timer, Star, Receipt } from 'lucide-react';
import { cn } from "@/lib/utils";
import { formatMoney, currencyScale } from "@/lib/currency";

// WhatsApp SVG Icon Component
const WhatsAppIcon = ({ className = "w-4 h-4" }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor">
    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893A11.821 11.821 0 0020.465 3.488"/>
  </svg>
);

// This preview's menu/cart amounts are illustrative sample data, not tied to
// any real store — no currency is assumed (see src/lib/currency.js). Mock
// values stay major-unit floats and are scaled to minor units right before
// formatMoney renders them, the same convention real money uses elsewhere.
const DEMO_MONEY_SCALE = currencyScale();
const money = (major) => formatMoney(Math.round((major || 0) * DEMO_MONEY_SCALE));

// Illustrative demo tax rate only — not a real jurisdiction's rate (15% is
// specifically South Africa's VAT and must not read as a universal default).
// Applied tax-INCLUSIVE: the price shown already contains tax and the tax
// portion is backed out, mirroring the real cart's convention — see
// src/pages/home/components/cart-section.jsx, whose default (taxInclusive
// from useLocale) is inclusive, and which computes exactly this way rather
// than adding tax on top of the subtotal.
const DEMO_TAX_RATE = 0.1;

const POSInterfacePreview = ({ className }) => {
  const [activeCategory, setActiveCategory] = useState('burgers');
  const [cart, setCart] = useState([]);
  const [animationPhase, setAnimationPhase] = useState(0); // 0: browsing, 1: adding to cart, 2: checkout, 3: payment success
  const [currentTime, setCurrentTime] = useState(new Date());
  const [orderTotal, setOrderTotal] = useState(0);

  // Categories
  const categories = [
    { id: 'burgers', name: 'Burgers', icon: <UtensilsCrossed className="w-4 h-4" /> },
    { id: 'sides', name: 'Sides', icon: <Package className="w-4 h-4" /> },
    { id: 'drinks', name: 'Drinks', icon: <Coffee className="w-4 h-4" /> },
    { id: 'desserts', name: 'Desserts', icon: <IceCream className="w-4 h-4" /> }
  ];

  // Menu items
  const menuItems = {
    burgers: [
      { id: 1, name: 'Classic Beef Burger', price: 89.00, image: '🍔', inStock: true, popular: true },
      { id: 2, name: 'Chicken Deluxe', price: 95.00, image: '🍗', inStock: true, popular: false },
      { id: 3, name: 'Veggie Supreme', price: 78.00, image: '🥗', inStock: true, popular: false },
      { id: 4, name: 'BBQ Bacon Burger', price: 105.00, image: '🥓', inStock: false, popular: true },
      { id: 17, name: 'Double Cheese', price: 112.00, image: '🧀', inStock: true, popular: true },
      { id: 18, name: 'Spicy Jalapeño', price: 98.00, image: '🌶️', inStock: true, popular: false },
      { id: 19, name: 'Fish Burger', price: 85.00, image: '🐟', inStock: true, popular: false },
      { id: 20, name: 'Mushroom Swiss', price: 92.00, image: '🍄', inStock: true, popular: false }
    ],
    sides: [
      { id: 5, name: 'Crispy Fries', price: 35.00, image: '🍟', inStock: true, popular: true },
      { id: 6, name: 'Onion Rings', price: 42.00, image: '🧅', inStock: true, popular: false },
      { id: 7, name: 'Loaded Nachos', price: 65.00, image: '🧀', inStock: true, popular: true },
      { id: 8, name: 'Sweet Potato Fries', price: 38.00, image: '🍠', inStock: true, popular: false },
      { id: 21, name: 'Mozzarella Sticks', price: 48.00, image: '🧀', inStock: true, popular: true },
      { id: 22, name: 'Chicken Wings', price: 55.00, image: '🍗', inStock: true, popular: true },
      { id: 23, name: 'Garlic Bread', price: 28.00, image: '🥖', inStock: true, popular: false },
      { id: 24, name: 'Caesar Salad', price: 45.00, image: '🥗', inStock: true, popular: false }
    ],
    drinks: [
      { id: 9, name: 'Coke', price: 25.00, image: '🥤', inStock: true, popular: true },
      { id: 10, name: 'Fresh Juice', price: 35.00, image: '🧃', inStock: true, popular: false },
      { id: 11, name: 'Milkshake', price: 45.00, image: '🥛', inStock: true, popular: true },
      { id: 12, name: 'Coffee', price: 28.00, image: '☕', inStock: true, popular: false },
      { id: 25, name: 'Iced Tea', price: 22.00, image: '🧊', inStock: true, popular: false },
      { id: 26, name: 'Smoothie', price: 42.00, image: '🥤', inStock: true, popular: true },
      { id: 27, name: 'Hot Chocolate', price: 32.00, image: '☕', inStock: true, popular: false },
      { id: 28, name: 'Energy Drink', price: 38.00, image: '⚡', inStock: false, popular: false }
    ],
    desserts: [
      { id: 13, name: 'Chocolate Cake', price: 48.00, image: '🍰', inStock: true, popular: true },
      { id: 14, name: 'Ice Cream', price: 32.00, image: '🍦', inStock: true, popular: false },
      { id: 15, name: 'Apple Pie', price: 42.00, image: '🥧', inStock: true, popular: false },
      { id: 16, name: 'Cookies', price: 25.00, image: '🍪', inStock: true, popular: true },
      { id: 29, name: 'Cheesecake', price: 52.00, image: '🍰', inStock: true, popular: true },
      { id: 30, name: 'Donut', price: 18.00, image: '🍩', inStock: true, popular: false },
      { id: 31, name: 'Brownie', price: 35.00, image: '🟤', inStock: true, popular: true },
      { id: 32, name: 'Pudding', price: 28.00, image: '🍮', inStock: true, popular: false }
    ]
  };

  // Animation sequences
  const animationScenarios = [
    // Scenario 1: Browse and add items
    {
      cart: [
        { id: 1, name: 'Classic Beef Burger', price: 89.00, quantity: 1, image: '🍔' },
        { id: 5, name: 'Crispy Fries', price: 35.00, quantity: 1, image: '🍟' }
      ],
      total: 124.00,
      status: 'adding'
    },
    // Scenario 2: Add more items
    {
      cart: [
        { id: 1, name: 'Classic Beef Burger', price: 89.00, quantity: 2, image: '🍔' },
        { id: 5, name: 'Crispy Fries', price: 35.00, quantity: 2, image: '🍟' },
        { id: 9, name: 'Coke', price: 25.00, quantity: 2, image: '🥤' },
        { id: 22, name: 'Chicken Wings', price: 55.00, quantity: 1, image: '🍗' }
      ],
      total: 353.00,
      status: 'checkout'
    },
    // Scenario 3: Payment processing
    {
      cart: [
        { id: 1, name: 'Classic Beef Burger', price: 89.00, quantity: 2, image: '🍔' },
        { id: 5, name: 'Crispy Fries', price: 35.00, quantity: 2, image: '🍟' },
        { id: 9, name: 'Coke', price: 25.00, quantity: 2, image: '🥤' },
        { id: 22, name: 'Chicken Wings', price: 55.00, quantity: 1, image: '🍗' }
      ],
      total: 353.00,
      status: 'payment'
    },
    // Scenario 4: Order completed
    {
      cart: [],
      total: 0,
      status: 'completed'
    }
  ];

  // Cycle through scenarios
  useEffect(() => {
    const interval = setInterval(() => {
      setAnimationPhase((prev) => (prev + 1) % animationScenarios.length);
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  // Update cart based on scenario
  useEffect(() => {
    const scenario = animationScenarios[animationPhase];
    setCart(scenario.cart);
    setOrderTotal(scenario.total);
  }, [animationPhase]);

  // Update time
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 30000);
    return () => clearInterval(timer);
  }, []);

  const currentScenario = animationScenarios[animationPhase];

  // Tax-inclusive, matching the real cart: orderTotal already contains tax,
  // so it's backed out rather than added on top of it.
  const taxAmount = orderTotal - orderTotal / (1 + DEMO_TAX_RATE);
  const netAmount = orderTotal - taxAmount;

  const addToCart = (item) => {
    const existingItem = cart.find(cartItem => cartItem.id === item.id);
    if (existingItem) {
      setCart(cart.map(cartItem => 
        cartItem.id === item.id 
          ? { ...cartItem, quantity: cartItem.quantity + 1 }
          : cartItem
      ));
    } else {
      setCart([...cart, { ...item, quantity: 1 }]);
    }
  };

  const removeFromCart = (itemId) => {
    setCart(cart.filter(item => item.id !== itemId));
  };

  const updateQuantity = (itemId, change) => {
    setCart(cart.map(item => {
      if (item.id === itemId) {
        const newQuantity = item.quantity + change;
        return newQuantity > 0 ? { ...item, quantity: newQuantity } : null;
      }
      return item;
    }).filter(Boolean));
  };

  return (
    <motion.div 
      className={cn("bg-white rounded-2xl border border-gray-200 shadow-2xl w-full max-w-full overflow-hidden", className)}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6 }}
    >
      <div className="grid lg:grid-cols-3 min-h-[600px] max-h-[600px]">
        {/* Menu Section - Left Side */}
        <div className="lg:col-span-2 bg-gray-50 p-3 border-r border-gray-200 flex flex-col">
          {/* Header */}
          <motion.div 
            className="flex items-center justify-between mb-3"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.2 }}
          >
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 bg-orange-500 rounded-lg flex items-center justify-center">
                <UtensilsCrossed className="w-3 h-3 text-white" />
              </div>
              <div>
                <h3 className="font-semibold text-gray-900 text-sm">BeepBite POS</h3>
                <p className="text-xs text-gray-500">{currentTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Badge className="bg-green-100 text-green-800 text-xs px-2 py-1">
                <div className="w-1.5 h-1.5 bg-green-500 rounded-full mr-1 animate-pulse"></div>
                Live
              </Badge>
              <Badge className="bg-blue-100 text-blue-800 text-xs px-2 py-1">
                Table 7
              </Badge>
            </div>
          </motion.div>

          {/* Search and Filter */}
          <div className="flex items-center gap-2 mb-3">
            <div className="flex-1 relative">
              <Search className="w-3 h-3 absolute left-2.5 top-2.5 text-gray-400" />
              <input 
                type="text" 
                placeholder="Search menu items..."
                className="w-full pl-8 pr-3 py-2 border border-gray-300 rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-orange-500 focus:border-transparent"
                readOnly
              />
            </div>
            <Button variant="outline" size="sm" className="px-2 h-8">
              <Filter className="w-3 h-3" />
            </Button>
          </div>

          {/* Categories */}
          <div className="flex gap-1.5 mb-3">
            {categories.map((category) => (
              <motion.button
                key={category.id}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors",
                  activeCategory === category.id
                    ? "bg-orange-500 text-white"
                    : "bg-white text-gray-600 hover:bg-gray-100"
                )}
                onClick={() => setActiveCategory(category.id)}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
              >
                {React.cloneElement(category.icon, { className: "w-3 h-3" })}
                {category.name}
              </motion.button>
            ))}
          </div>

          {/* Menu Items Grid */}
          <div className="flex-1">
            <div className="grid grid-cols-3 gap-2 pr-1 h-full">
              <AnimatePresence mode="wait">
                {menuItems[activeCategory]?.slice(0, 9).map((item, index) => (
                  <motion.div
                    key={`${activeCategory}-${item.id}`}
                    className={cn(
                      "bg-white rounded-lg border border-gray-200 p-2 cursor-pointer transition-all hover:shadow-md",
                      !item.inStock && "opacity-50 cursor-not-allowed"
                    )}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -20 }}
                    transition={{ delay: index * 0.05 }}
                    onClick={() => item.inStock && addToCart(item)}
                    whileHover={item.inStock ? { scale: 1.02 } : {}}
                    whileTap={item.inStock ? { scale: 0.98 } : {}}
                  >
                    <div className="flex flex-col items-center text-center mb-2">
                      <div className="text-lg mb-1">{item.image}</div>
                      <div className="w-full">
                        <div className="flex items-center justify-center gap-1 mb-1 min-h-[2rem]">
                          <h4 className="font-medium text-gray-900 text-xs leading-tight line-clamp-2 text-center flex-1">{item.name}</h4>
                          {item.popular && (
                            <Star className="w-2 h-2 text-yellow-500 fill-yellow-500 flex-shrink-0" />
                          )}
                        </div>
                        <p className="text-orange-600 font-semibold text-xs mb-1">{money(item.price)}</p>
                      </div>
                    </div>
                    {!item.inStock && (
                      <Badge variant="secondary" className="text-xs w-full justify-center py-1">
                        Out of Stock
                      </Badge>
                    )}
                    {item.inStock && (
                      <Button size="sm" className="w-full bg-orange-500 hover:bg-orange-600 text-white text-xs h-6">
                        <Plus className="w-2.5 h-2.5 mr-1" />
                        Add
                      </Button>
                    )}
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          </div>
        </div>

        {/* Cart Section - Right Side */}
        <div className="bg-white p-3 flex flex-col min-h-0">
          {/* Cart Header */}
          <motion.div 
            className="flex items-center justify-between mb-3"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.4 }}
          >
            <h3 className="font-semibold text-gray-900 flex items-center gap-1.5 text-sm">
              <ShoppingCart className="w-3.5 h-3.5" />
              Current Order
            </h3>
            <Badge className="bg-gray-100 text-gray-800 text-xs px-2 py-1">
              {cart.reduce((sum, item) => sum + item.quantity, 0)} items
            </Badge>
          </motion.div>

          {/* Order Status Based on Animation Phase */}
          <div className="flex-1 min-h-0 flex flex-col">
            <AnimatePresence mode="wait">
              {currentScenario.status === 'completed' && (
                <motion.div
                  key="completed"
                  className="text-center py-6 flex-1 flex flex-col justify-center"
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.8 }}
                >
                  <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-3">
                    <CheckCircle className="w-6 h-6 text-green-600" />
                  </div>
                  <h3 className="font-semibold text-gray-900 mb-2 text-sm">Order Completed!</h3>
                  <p className="text-xs text-gray-600 mb-3">Order #POS-2024-001</p>
                  <div className="space-y-2">
                    <Badge className="bg-blue-100 text-blue-800 text-xs px-2 py-1">
                      <Clock className="w-2.5 h-2.5 mr-1" />
                      Est. 15 mins
                    </Badge>
                    <div className="flex items-center justify-center gap-1.5 text-xs text-gray-500">
                      <WhatsAppIcon className="w-2.5 h-2.5 text-green-500" />
                      Customer notified via WhatsApp
                    </div>
                  </div>
                </motion.div>
              )}

              {currentScenario.status === 'payment' && (
                <motion.div
                  key="payment"
                  className="space-y-3 flex-1 flex flex-col"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                >
                  <div className="text-center py-3">
                    <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-2">
                      <CreditCard className="w-5 h-5 text-blue-600" />
                    </div>
                    <h3 className="font-semibold text-gray-900 mb-1 text-sm">Processing Payment</h3>
                    <p className="text-lg font-bold text-gray-900">{money(orderTotal)}</p>
                  </div>
                  
                  <div className="space-y-2 flex-1">
                    <Button className="w-full bg-green-600 hover:bg-green-700 text-white text-xs h-8">
                      <CreditCard className="w-3 h-3 mr-1.5" />
                      Card Payment
                    </Button>
                    <Button variant="outline" className="w-full text-xs h-8">
                      <DollarSign className="w-3 h-3 mr-1.5" />
                      Cash Payment
                    </Button>
                    <Button variant="outline" className="w-full text-xs h-8">
                      <WhatsAppIcon className="w-3 h-3 mr-1.5" />
                      WhatsApp Pay
                    </Button>
                  </div>
                </motion.div>
              )}

              {(currentScenario.status === 'adding' || currentScenario.status === 'checkout') && (
                <motion.div
                  key="cart-items"
                  className="flex-1 flex flex-col min-h-0"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                >
                  {/* Cart Items */}
                  <div className="flex-1 min-h-0 mb-3">
                    <div className="space-y-2 pr-1">
                      <AnimatePresence>
                        {cart.slice(0, 4).map((item) => (
                          <motion.div
                            key={item.id}
                            className="flex items-start gap-2 p-2 border border-gray-200 rounded-lg"
                            initial={{ opacity: 0, x: 20 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={{ opacity: 0, x: -20 }}
                            layout
                          >
                            <div className="text-sm flex-shrink-0">{item.image}</div>
                            <div className="flex-1 min-w-0">
                              <h4 className="font-medium text-gray-900 text-xs leading-tight line-clamp-1 mb-0.5">{item.name}</h4>
                              <p className="text-orange-600 font-semibold text-xs">{money(item.price)}</p>
                            </div>
                            <div className="flex flex-col items-center gap-1 flex-shrink-0">
                              <div className="flex items-center gap-1">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="w-5 h-5 p-0"
                                  onClick={() => updateQuantity(item.id, -1)}
                                >
                                  <Minus className="w-2.5 h-2.5" />
                                </Button>
                                <span className="text-xs font-medium w-4 text-center">{item.quantity}</span>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="w-5 h-5 p-0"
                                  onClick={() => updateQuantity(item.id, 1)}
                                >
                                  <Plus className="w-2.5 h-2.5" />
                                </Button>
                              </div>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="w-5 h-5 p-0 text-red-500 hover:text-red-700"
                                onClick={() => removeFromCart(item.id)}
                              >
                                <Trash2 className="w-2.5 h-2.5" />
                              </Button>
                            </div>
                          </motion.div>
                        ))}
                      </AnimatePresence>
                    </div>
                  </div>

                  {/* Order Summary */}
                  <div className="border-t border-gray-200 pt-3 space-y-3">
                    <div className="space-y-1.5">
                      <div className="flex justify-between text-xs">
                        <span className="text-gray-600">Subtotal</span>
                        <span className="font-medium">{money(netAmount)}</span>
                      </div>
                      <div className="flex justify-between text-xs">
                        <span className="text-gray-600">Tax (incl.)</span>
                        <span className="font-medium">{money(taxAmount)}</span>
                      </div>
                      <div className="flex justify-between text-sm font-semibold border-t border-gray-200 pt-1.5">
                        <span>Total</span>
                        <span className="text-orange-600">{money(orderTotal)}</span>
                      </div>
                    </div>

                    {cart.length > 0 && (
                      <div className="space-y-2">
                        <Button className="w-full bg-orange-500 hover:bg-orange-600 text-white text-xs h-8">
                          <ArrowRight className="w-3 h-3 mr-1.5" />
                          Proceed to Payment
                        </Button>
                        <div className="flex gap-1">
                          <Button variant="outline" size="sm" className="flex-1 text-xs h-7 px-1">
                            <Users className="w-2.5 h-2.5 mr-0.5" />
                            <span className="text-xs">Dine-In</span>
                          </Button>
                          <Button variant="outline" size="sm" className="flex-1 text-xs h-7 px-1">
                            <Package className="w-2.5 h-2.5 mr-0.5" />
                            <span className="text-xs">Takeaway</span>
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {cart.length === 0 && currentScenario.status !== 'completed' && currentScenario.status !== 'payment' && (
              <div className="flex-1 flex items-center justify-center text-center">
                <div>
                  <ShoppingCart className="w-10 h-10 text-gray-300 mx-auto mb-2" />
                  <p className="text-gray-500 text-xs">Cart is empty</p>
                  <p className="text-gray-400 text-xs">Add items to start an order</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Real-time Order Status Bar */}
      <motion.div 
        className="bg-gray-50 border-t border-gray-200 px-3 py-2 flex items-center justify-between"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.6 }}
      >
        <div className="flex items-center gap-3 text-xs text-gray-600">
          <div className="flex items-center gap-1">
            <div className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse"></div>
            <span>Online</span>
          </div>
          <div className="flex items-center gap-1">
            <Timer className="w-2.5 h-2.5" />
            <span>Avg Order: 12 min</span>
          </div>
          <div className="flex items-center gap-1">
            <Receipt className="w-2.5 h-2.5" />
            <span>42 orders today</span>
          </div>
        </div>
        <div className="text-xs text-gray-500">
          Last sync: {currentTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </div>
      </motion.div>
    </motion.div>
  );
};

export default POSInterfacePreview; 