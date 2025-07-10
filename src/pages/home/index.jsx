import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { 
  Plus, 
  Search, 
  Clock,
  CheckCircle,
  Package,
  TrendingUp,
  Utensils,
  Users,
  Timer,
  ArrowRight,
  Eye,
  Edit,
  Trash2,
  PhoneCall,
  MapPin,
  DollarSign,
  AlertCircle,
  Star,
  ShoppingCart,
  Minus,
  Hash,
  Filter,
  X,
  PanelLeftOpen,
  PanelRightOpen,
  RotateCcw,
  Settings,
  ArrowLeft
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { useAuth } from '@/context/auth-context';
import { supabase } from '@/services/supabase-client';
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from 'date-fns';

const Home = () => {
  const { activeOrganization, activeLocation } = useAuth();
  const navigate = useNavigate();
  
  // Layout state
  const [isOrdersExpanded, setIsOrdersExpanded] = useState(false);
  const [activeTab, setActiveTab] = useState('orders');
  
  // State for orders
  const [orders, setOrders] = useState([]);
  const [loadingOrders, setLoadingOrders] = useState(true);
  const [orderSearchTerm, setOrderSearchTerm] = useState('');
  const [orderStatusFilter, setOrderStatusFilter] = useState('active'); // 'active', 'inactive', 'all'
  
  // State for POS
  const [items, setItems] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loadingItems, setLoadingItems] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [cart, setCart] = useState([]);
  
  // State for quick order creation
  const [isCreateOrderOpen, setIsCreateOrderOpen] = useState(false);
  const [customerPhone, setCustomerPhone] = useState('');
  const [orderNumber, setOrderNumber] = useState('');
  const [creating, setCreating] = useState(false);

  // State for variation selection
  const [isVariationModalOpen, setIsVariationModalOpen] = useState(false);
  const [selectedItem, setSelectedItem] = useState(null);
  const [selectedVariations, setSelectedVariations] = useState({});
  const [editingCartItem, setEditingCartItem] = useState(null);

  // State for order editing
  const [editingOrder, setEditingOrder] = useState(null);
  const [isOrderEditModalOpen, setIsOrderEditModalOpen] = useState(false);

  // State for order detail view
  const [viewingOrder, setViewingOrder] = useState(null);
  const [orderDetails, setOrderDetails] = useState(null);
  const [loadingOrderDetails, setLoadingOrderDetails] = useState(false);
  const [isOrderDetailsModalOpen, setIsOrderDetailsModalOpen] = useState(false);

  // State for inline cart editing
  const [expandedCartItems, setExpandedCartItems] = useState(new Set());
  const [tempVariationSelections, setTempVariationSelections] = useState({});

  // State for fractional quantity editing
  const [isFractionalQtyOpen, setIsFractionalQtyOpen] = useState(false);
  const [fractionalQtyItem, setFractionalQtyItem] = useState(null);
  const [fractionalQtyValue, setFractionalQtyValue] = useState('');

  // Auto-switch to cart tab when items are added
  useEffect(() => {
    if (cart.length > 0 && activeTab === 'orders') {
      setActiveTab('cart');
    }
  }, [cart.length]);

  // Fetch active orders
  const fetchOrders = useCallback(async () => {
    if (!activeLocation?.id) {
      setOrders([]);
      setLoadingOrders(false);
      return;
    }
    
    setLoadingOrders(true);
    try {
      let statusFilter;
      if (orderStatusFilter === 'active') {
        statusFilter = ['pending', 'confirmed', 'preparing', 'ready', 'out_for_delivery'];
      } else if (orderStatusFilter === 'inactive') {
        statusFilter = ['delivered', 'completed', 'cancelled'];
      } else {
        // 'all' - don't filter by status
        statusFilter = null;
      }

      let query = supabase
        .from('orders')
        .select(`
          *,
          customers (
            id,
            first_name,
            last_name,
            whatsapp_number,
            email
          ),
          order_details (
            delivery_address,
            notes,
            kitchen_notes
          )
        `)
        .eq('location_id', activeLocation.id)
        .order('created_at', { ascending: false })
        .limit(50);
      
      if (statusFilter) {
        query = query.in('status', statusFilter);
      }
      
      const { data, error } = await query;
      
      if (error) throw error;
      setOrders(data || []);
    } catch (error) {
      console.error('Error fetching orders:', error);
        setOrders([]);
    } finally {
      setLoadingOrders(false);
    }
  }, [activeLocation, orderStatusFilter]);

  // Fetch menu items and categories
  const fetchMenuData = useCallback(async () => {
    if (!activeLocation?.id) {
      setItems([]);
      setCategories([]);
      setLoadingItems(false);
      return;
    }
    
    setLoadingItems(true);
    try {
      // Fetch categories
      const { data: categoriesData, error: categoriesError } = await supabase
        .from('categories')
        .select('*')
        .eq('location_id', activeLocation.id)
        .eq('is_active', true)
        .order('sort_order', { ascending: true })
        .order('name', { ascending: true });
      
      if (categoriesError) throw categoriesError;
      setCategories(categoriesData || []);

      // Fetch items with variations
      const { data: itemsData, error: itemsError } = await supabase
        .from('items')
        .select(`
          *,
          categories (
            id,
            name
          ),
          item_variations (
            id,
            name,
            is_required,
            item_variation_options (
              id,
              name,
              price_modifier,
              is_default
            )
          )
        `)
        .eq('location_id', activeLocation.id)
        .eq('is_active', true)
        .order('sort_order', { ascending: true })
        .order('name', { ascending: true });
      
      if (itemsError) throw itemsError;
      setItems(itemsData || []);
    } catch (error) {
      console.error('Error fetching menu data:', error);
      setItems([]);
      setCategories([]);
    } finally {
      setLoadingItems(false);
    }
  }, [activeLocation]);

  // Effect to fetch data when activeLocation changes
  useEffect(() => {
    fetchOrders();
    fetchMenuData();
  }, [fetchOrders, fetchMenuData]);

  // Filter orders based on search term
  const filteredOrders = useMemo(() => {
    return orders.filter(order => {
      if (!orderSearchTerm) return true;
      
      const searchLower = orderSearchTerm.toLowerCase();
      return (
        order.order_number.toLowerCase().includes(searchLower) ||
        order.customers?.whatsapp_number?.includes(searchLower) ||
        order.customers?.first_name?.toLowerCase().includes(searchLower) ||
        order.customers?.last_name?.toLowerCase().includes(searchLower) ||
        order.status.toLowerCase().includes(searchLower)
      );
    });
  }, [orders, orderSearchTerm]);

  // Filter items based on search and category
  const filteredItems = useMemo(() => {
    return items.filter(item => {
      const matchesSearch = !searchTerm || 
        item.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        item.description?.toLowerCase().includes(searchTerm.toLowerCase());
      
      const matchesCategory = selectedCategory === 'all' || 
        item.category_id === selectedCategory;
      
      return matchesSearch && matchesCategory;
    });
  }, [items, searchTerm, selectedCategory]);

  // Cart functions with variation support
  const addToCart = (item, selectedVariations = {}) => {
    // If item has variations and none are selected, open variation modal
    if (item.item_variations && item.item_variations.length > 0 && Object.keys(selectedVariations).length === 0) {
      setSelectedItem(item);
      setSelectedVariations({});
      setIsVariationModalOpen(true);
      return;
    }

    // Create a unique cart item key including variations
    const variationKey = Object.keys(selectedVariations).sort().map(k => `${k}:${selectedVariations[k]}`).join('|');
    const cartItemKey = `${item.id}${variationKey ? '|' + variationKey : ''}`;
    
    // Calculate price with variations
    let totalPrice = parseFloat(item.price || 0);
    const variationDetails = [];
    
    if (item.item_variations) {
      item.item_variations.forEach(variation => {
        const selectedOptionId = selectedVariations[variation.id];
        if (selectedOptionId) {
          const option = variation.item_variation_options.find(opt => opt.id === selectedOptionId);
          if (option) {
            totalPrice += parseFloat(option.price_modifier || 0);
            variationDetails.push({
              variationName: variation.name,
              optionName: option.name,
              priceModifier: parseFloat(option.price_modifier || 0)
            });
          }
        }
      });
    }

    setCart(prev => {
      const existingItem = prev.find(cartItem => cartItem.cartItemKey === cartItemKey);
      if (existingItem) {
        return prev.map(cartItem =>
          cartItem.cartItemKey === cartItemKey
            ? { ...cartItem, quantity: cartItem.quantity + 1 }
            : cartItem
        );
      }
      return [...prev, { 
        ...item, 
        cartItemKey,
        quantity: 1,
        price: totalPrice,
        basePrice: parseFloat(item.price || 0),
        selectedVariations,
        variationDetails
      }];
    });

    // Close variation modal if open
    setIsVariationModalOpen(false);
    setSelectedItem(null);
  };

  const handleVariationChange = (variationId, optionId) => {
    setSelectedVariations(prev => ({
      ...prev,
      [variationId]: optionId
    }));
  };

  const updateCartQuantity = (cartItemKey, quantity) => {
    const numQty = parseFloat(quantity);
    if (numQty <= 0) {
      setCart(prev => prev.filter(item => item.cartItemKey !== cartItemKey));
    } else {
      setCart(prev => prev.map(item =>
        item.cartItemKey === cartItemKey ? { ...item, quantity: numQty } : item
      ));
    }
  };

  const clearCart = () => {
    setCart([]);
    setActiveTab('orders');
  };

  const cartTotal = cart.reduce((total, item) => total + (item.price * item.quantity), 0);

  const updateOrderStatus = async (orderId, newStatus) => {
    try {
      setOrders(prev => prev.map(order => 
        order.id === orderId 
          ? { 
              ...order, 
              status: newStatus,
              updated_at: new Date().toISOString()
            }
          : order
      ));

      const { error } = await supabase
        .from('orders')
        .update({ 
          status: newStatus,
          updated_at: new Date().toISOString()
        })
        .eq('id', orderId);
      
      if (error) throw error;
    } catch (error) {
      console.error('Error updating order status:', error);
      fetchOrders();
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'pending': return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      case 'confirmed': return 'bg-blue-100 text-blue-800 border-blue-200';
      case 'preparing': return 'bg-orange-100 text-orange-800 border-orange-200';
      case 'ready': return 'bg-green-100 text-green-800 border-green-200';
      case 'out_for_delivery': return 'bg-purple-100 text-purple-800 border-purple-200';
      default: return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  const getNextStatus = (currentStatus) => {
    const statusFlow = {
      'pending': 'confirmed',
      'confirmed': 'preparing',
      'preparing': 'ready',
      'ready': 'out_for_delivery',
      'out_for_delivery': 'delivered'
    };
    return statusFlow[currentStatus];
  };

  const getStatusLabel = (status) => {
    const labels = {
      'pending': 'Pending',
      'confirmed': 'Confirmed',
      'preparing': 'Preparing',
      'ready': 'Ready',
      'out_for_delivery': 'Out for Delivery',
      'delivered': 'Delivered',
      'completed': 'Completed',
      'cancelled': 'Cancelled'
    };
    return labels[status] || status;
  };

  const toggleCartItemExpanded = (cartItemKey) => {
    setExpandedCartItems(prev => {
      const newExpanded = new Set(prev);
      if (newExpanded.has(cartItemKey)) {
        newExpanded.delete(cartItemKey);
        // Clear temp selections when closing
        setTempVariationSelections(prev => {
          const newTemp = {...prev};
          delete newTemp[cartItemKey];
          return newTemp;
        });
      } else {
        newExpanded.add(cartItemKey);
        // Initialize temp selections with current values
        const cartItem = cart.find(item => item.cartItemKey === cartItemKey);
        if (cartItem) {
          setTempVariationSelections(prev => ({
            ...prev,
            [cartItemKey]: cartItem.selectedVariations || {}
          }));
        }
      }
      return newExpanded;
    });
  };

  const updateTempVariation = (cartItemKey, variationId, optionId) => {
    setTempVariationSelections(prev => ({
      ...prev,
      [cartItemKey]: {
        ...prev[cartItemKey],
        [variationId]: optionId
      }
    }));
  };

  const saveInlineVariationEdit = (cartItemKey) => {
    const cartItem = cart.find(item => item.cartItemKey === cartItemKey);
    const newVariations = tempVariationSelections[cartItemKey];
    
    if (cartItem && newVariations) {
      // Remove old item and add new one with updated variations
      setCart(prev => prev.filter(item => item.cartItemKey !== cartItemKey));
      const originalItem = items.find(item => item.id === cartItem.id);
      if (originalItem) {
        addToCart(originalItem, newVariations);
      }
    }
    
    // Close the expanded state
    setExpandedCartItems(prev => {
      const newExpanded = new Set(prev);
      newExpanded.delete(cartItemKey);
      return newExpanded;
    });
  };

  const openFractionalQtyModal = (cartItem) => {
    setFractionalQtyItem(cartItem);
    setFractionalQtyValue(cartItem.quantity.toString());
    setIsFractionalQtyOpen(true);
  };

  const saveFractionalQty = () => {
    if (!fractionalQtyItem) return;
    
    const newQty = parseFloat(fractionalQtyValue);
    if (isNaN(newQty) || newQty <= 0) {
      alert('Please enter a valid quantity');
      return;
    }
    
    updateCartQuantity(fractionalQtyItem.cartItemKey, newQty);
    setIsFractionalQtyOpen(false);
    setFractionalQtyItem(null);
    setFractionalQtyValue('');
  };

  const createOrder = async () => {
    if (!customerPhone.trim() || !orderNumber.trim()) {
      alert('Please enter both customer phone and order number');
      return;
    }

    if (!activeLocation?.id) {
      alert('No active location selected');
      return;
    }

    if (cart.length === 0) {
      alert('Cart is empty. Please add items before creating an order.');
      return;
    }

    setCreating(true);
    try {
      // Step 1: Create or get customer
      let customerId;
      const { data: existingCustomer, error: customerError } = await supabase
        .from('customers')
        .select('id')
        .eq('whatsapp_number', customerPhone.trim())
        .single();
      
      if (existingCustomer) {
        customerId = existingCustomer.id;
      } else {
        // Create new customer
        const { data: newCustomer, error: createCustomerError } = await supabase
          .from('customers')
          .insert({
            whatsapp_number: customerPhone.trim()
          })
          .select('id')
          .single();
        
        if (createCustomerError) throw createCustomerError;
        customerId = newCustomer.id;
      }

      // Step 2: Create order
      const { data: newOrder, error: orderError } = await supabase
        .from('orders')
        .insert({
          location_id: activeLocation.id,
          customer_id: customerId,
          order_number: orderNumber.trim(),
          order_type: 'whatsapp',
          status: 'pending'
        })
        .select('id')
        .single();

      if (orderError) throw orderError;
      const orderId = newOrder.id;

      // Step 3: Create order details
      await supabase
        .from('order_details')
        .insert({
          order_id: orderId,
          notes: `POS order created with ${cart.length} items`
        });

      // Step 4: Calculate totals
      const subtotal = cart.reduce((total, item) => total + (item.price * item.quantity), 0);
      
      // Step 5: Create financial details
      await supabase
        .from('order_financial_details')
        .insert({
          order_id: orderId,
          subtotal: subtotal,
          total_amount: subtotal,
          tax_rate: 15.00,
          tax_amount: subtotal * 0.15,
          tax_inclusive: true,
          payment_status: 'pending',
          payment_method: 'cash'
        });

      // Step 6: Create order items
      for (const cartItem of cart) {
        // Insert order item
        const { data: orderItem, error: itemError } = await supabase
          .from('order_items')
          .insert({
            order_id: orderId,
            item_id: cartItem.id,
            quantity: cartItem.quantity,
            unit_price: cartItem.basePrice, // Base price without variations
            total_price: cartItem.price * cartItem.quantity
          })
          .select('id')
          .single();

        if (itemError) throw itemError;

        // Insert variations if any
        if (cartItem.selectedVariations && Object.keys(cartItem.selectedVariations).length > 0) {
          for (const [variationId, optionId] of Object.entries(cartItem.selectedVariations)) {
            await supabase
              .from('order_item_variations')
              .insert({
                order_item_id: orderItem.id,
                variation_id: variationId,
                option_id: optionId,
                // Get price modifier from the original item data
                price_modifier: (() => {
                  const originalItem = items.find(item => item.id === cartItem.id);
                  const variation = originalItem?.item_variations?.find(v => v.id === variationId);
                  const option = variation?.item_variation_options?.find(o => o.id === optionId);
                  return parseFloat(option?.price_modifier || 0);
                })()
              });
          }
        }
      }

      // Success!
      alert(`Order #${orderNumber.trim()} created successfully!`);

      // Reset form and close dialog
      setCustomerPhone('');
      setOrderNumber('');
      setIsCreateOrderOpen(false);
      clearCart();
      
      // Refresh orders list
      fetchOrders();
      
    } catch (error) {
      console.error('Error creating order:', error);
      alert('Failed to create order: ' + error.message);
    } finally {
      setCreating(false);
    }
  };

  const fetchOrderDetails = async (orderId) => {
    setLoadingOrderDetails(true);
    try {
      // Fetch order with customer details
      const { data: order, error: orderError } = await supabase
        .from('orders')
        .select(`
          *,
          customers (
            id,
            first_name,
            last_name,
            whatsapp_number,
            email
          ),
          order_details (
            delivery_address,
            notes,
            kitchen_notes
          ),
          order_financial_details (
            subtotal,
            delivery_fee,
            total_amount,
            tax_amount,
            payment_status,
            payment_method
          )
        `)
        .eq('id', orderId)
        .single();

      if (orderError) throw orderError;

      // Fetch order items with variations
      const { data: orderItems, error: itemsError } = await supabase
        .from('order_items')
        .select(`
          *,
          items (
            id,
            name,
            description
          ),
          order_item_variations (
            price_modifier,
            item_variations (
              name
            ),
            item_variation_options (
              name
            )
          )
        `)
        .eq('order_id', orderId);

      if (itemsError) throw itemsError;

      setOrderDetails({
        ...order,
        order_items: orderItems || []
      });
      setViewingOrder(order);
      setIsOrderDetailsModalOpen(true);
    } catch (error) {
      console.error('Error fetching order details:', error);
      alert('Failed to load order details');
    } finally {
      setLoadingOrderDetails(false);
    }
  };

  const viewOrderDetails = (order) => {
    fetchOrderDetails(order.id);
  };

  const closeOrderDetails = () => {
    setViewingOrder(null);
    setOrderDetails(null);
    setIsOrderDetailsModalOpen(false);
  };

  if (!activeOrganization) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-gradient-to-br from-orange-50 to-orange-100">
        <AlertCircle className="w-16 h-16 text-orange-400 mb-4" />
        <h2 className="text-xl font-semibold text-gray-900 mb-2">No Organization Selected</h2>
        <p className="text-gray-600">Please select an organization to access the POS.</p>
      </div>
    );
  }

  if (!activeLocation) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-gradient-to-br from-orange-50 to-orange-100">
        <AlertCircle className="w-16 h-16 text-orange-400 mb-4" />
        <h2 className="text-xl font-semibold text-gray-900 mb-2">No Location Available</h2>
        <p className="text-gray-600">This organization has no locations configured.</p>
      </div>
    );
  }

  const sidebarWidth = isOrdersExpanded ? '70%' : '30%';
  const mainWidth = isOrdersExpanded ? '30%' : '70%';

  return (
    <div className="fixed inset-0 top-16 bg-gradient-to-br from-orange-50 to-orange-100 flex overflow-hidden">
      {/* Left Sidebar - Orders & Cart */}
      <div 
        className="bg-white border-r border-orange-200 flex flex-col shadow-lg transition-all duration-300 ease-in-out"
        style={{ width: sidebarWidth }}
      >
        {/* Header with Tabs */}
        <div className="bg-gradient-to-r from-orange-500 to-orange-600 px-6 py-4">
          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
            <TabsList className="grid w-full grid-cols-2 bg-white/20 backdrop-blur-sm">
              <TabsTrigger 
                value="orders" 
                className="data-[state=active]:bg-white data-[state=active]:text-orange-600 text-white/90"
              >
                <Clock className="w-4 h-4 mr-2" />
                Orders ({orders.length})
              </TabsTrigger>
              <TabsTrigger 
                value="cart" 
                className="data-[state=active]:bg-white data-[state=active]:text-orange-600 text-white/90"
              >
                <ShoppingCart className="w-4 h-4 mr-2" />
                Cart ({cart.length})
                {cart.length > 0 && (
                  <span className="ml-1 bg-red-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center">
                    {cart.length}
                  </span>
                )}
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        {/* Tab Content */}
        <Tabs value={activeTab} className="flex-1 flex flex-col">
          {/* Active Orders Tab */}
          <TabsContent value="orders" className="flex-1 overflow-hidden m-0">
            {/* Orders Search and Filter Header */}
            <div className="p-4 border-b border-gray-200 bg-gray-50">
              <div className="flex gap-2 items-center">
                {/* Search Input */}
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                  <Input
                    placeholder="Search orders..."
                    value={orderSearchTerm}
                    onChange={(e) => setOrderSearchTerm(e.target.value)}
                    className="pl-10 h-8 text-sm border-gray-300 focus:border-orange-400 focus:ring-orange-200"
                  />
                  {orderSearchTerm && (
                    <button
                      onClick={() => setOrderSearchTerm('')}
                      className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>
                
                {/* Filter Buttons */}
                <div className="flex gap-1">
                  <Button
                    size="sm"
                    variant={orderStatusFilter === 'active' ? 'default' : 'outline'}
                    onClick={() => setOrderStatusFilter('active')}
                    className={cn(
                      "h-8 px-3 text-xs transition-all",
                      orderStatusFilter === 'active'
                        ? "bg-orange-500 hover:bg-orange-600 text-white"
                        : "border-orange-200 text-gray-700 hover:bg-orange-50"
                    )}
                  >
                    Active
                  </Button>
                  <Button
                    size="sm"
                    variant={orderStatusFilter === 'inactive' ? 'default' : 'outline'}
                    onClick={() => setOrderStatusFilter('inactive')}
                    className={cn(
                      "h-8 px-3 text-xs transition-all",
                      orderStatusFilter === 'inactive'
                        ? "bg-orange-500 hover:bg-orange-600 text-white"
                        : "border-orange-200 text-gray-700 hover:bg-orange-50"
                    )}
                  >
                    Inactive
                  </Button>
                  <Button
                    size="sm"
                    variant={orderStatusFilter === 'all' ? 'default' : 'outline'}
                    onClick={() => setOrderStatusFilter('all')}
                    className={cn(
                      "h-8 px-3 text-xs transition-all",
                      orderStatusFilter === 'all'
                        ? "bg-orange-500 hover:bg-orange-600 text-white"
                        : "border-orange-200 text-gray-700 hover:bg-orange-50"
                    )}
                  >
                    All
                  </Button>
                </div>
              </div>
            </div>

            {/* Orders List */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {loadingOrders ? (
                <div className="space-y-3">
                  {[...Array(5)].map((_, i) => (
                    <div key={i} className="h-24 bg-gray-200 rounded-lg animate-pulse"></div>
                  ))}
                </div>
              ) : filteredOrders.length === 0 ? (
                <div className="text-center py-12">
                  <Package className="w-16 h-16 text-gray-300 mx-auto mb-4" />
                  <h3 className="text-lg font-medium text-gray-900 mb-2">
                    {orderSearchTerm ? 'No orders found' : 'No orders available'}
                  </h3>
                  <p className="text-gray-500">
                    {orderSearchTerm 
                      ? 'Try adjusting your search or filter criteria.'
                      : `No ${orderStatusFilter === 'all' ? '' : orderStatusFilter + ' '}orders found.`
                    }
                  </p>
                </div>
              ) : (
                filteredOrders.map((order) => (
                  <Card key={order.id} className="border border-orange-200 hover:border-orange-300 transition-colors hover:shadow-md">
                    <CardContent className="p-4">
                      <div className="flex justify-between items-start mb-3">
                        <div className="flex-1">
                          <h4 className="font-bold text-gray-900 text-lg">#{order.order_number}</h4>
                          <p className="text-sm text-gray-600 mt-1 flex items-center">
                            <PhoneCall className="w-4 h-4 mr-2" />
                            {order.customers?.whatsapp_number || 'No phone'}
                          </p>
                          {order.customers?.first_name && (
                            <p className="text-sm text-gray-700 font-medium mt-1">
                              {order.customers.first_name} {order.customers.last_name}
                            </p>
                          )}
                        </div>
                        <Badge className={cn("text-xs font-medium", getStatusColor(order.status))}>
                          {getStatusLabel(order.status)}
                        </Badge>
                      </div>
                      
                      <p className="text-sm text-gray-500 flex items-center mb-3">
                        <Timer className="w-4 h-4 mr-2" />
                        {formatDistanceToNow(new Date(order.created_at), { addSuffix: true })}
                      </p>

                      <div className="flex gap-2">
                        {getNextStatus(order.status) && (
                          <Button
                            size="sm"
                            onClick={() => updateOrderStatus(order.id, getNextStatus(order.status))}
                            className="flex-1 bg-orange-500 hover:bg-orange-600 text-white h-8 text-sm"
                          >
                            Mark {getStatusLabel(getNextStatus(order.status))}
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setEditingOrder(order);
                            setIsOrderEditModalOpen(true);
                          }}
                          className="h-8 px-3 border-orange-200 hover:bg-orange-50"
                        >
                          <Edit className="w-3 h-3" />
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => viewOrderDetails(order)}
                          className="h-8 px-3 border-orange-200 hover:bg-orange-50"
                        >
                          <Eye className="w-3 h-3" />
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))
              )}
            </div>
          </TabsContent>

          {/* Cart Tab */}
          <TabsContent value="cart" className="flex-1 flex flex-col overflow-hidden m-0">
            {cart.length === 0 ? (
              <div className="flex-1 flex items-center justify-center p-8">
                <div className="text-center">
                  <ShoppingCart className="w-16 h-16 text-gray-300 mx-auto mb-4" />
                  <h3 className="text-lg font-medium text-gray-900 mb-2">Cart is empty</h3>
                  <p className="text-gray-500">Add items from the menu to get started.</p>
                </div>
              </div>
            ) : (
              <>
                <div className="flex-1 overflow-y-auto p-4 space-y-3">
                  {cart.map((item) => {
                    const isExpanded = expandedCartItems.has(item.cartItemKey);
                    const originalItem = items.find(i => i.id === item.id);
                    
                    return (
                      <Card key={item.cartItemKey} className="border border-orange-200 hover:shadow-md transition-shadow">
                        <CardContent className="p-4">
                          {/* Top Row: Item Name and Edit Button */}
                          <div className="flex justify-between items-start mb-2">
                            <h4 className="font-medium text-gray-900 flex-1 pr-2">{item.name}</h4>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => toggleCartItemExpanded(item.cartItemKey)}
                              className={cn(
                                "h-8 w-8 p-0 rounded-full border-orange-200 transition-colors",
                                isExpanded ? "bg-orange-100 border-orange-400" : ""
                              )}
                            >
                              <Edit className="w-4 h-4" />
                            </Button>
                          </div>

                          {/* Current Variations Display */}
                          {item.variationDetails && item.variationDetails.length > 0 && (
                            <div className="mb-3">
                              <div className="flex flex-wrap gap-1">
                                {item.variationDetails.map((variation, index) => (
                                  <span key={index} className="inline-block bg-gray-100 rounded-full px-2 py-1 text-xs text-gray-700">
                                    <span className="font-medium">{variation.variationName}:</span> {variation.optionName}
                                    {variation.priceModifier !== 0 && (
                                      <span className="text-orange-600 ml-1">
                                        {variation.priceModifier > 0 ? '+' : ''}R{variation.priceModifier.toFixed(2)}
                                      </span>
                                    )}
                                  </span>
                                ))}
                              </div>
            </div>
          )}

                          {/* Expandable Variation Edit Section */}
                          {isExpanded && originalItem?.item_variations && (
                            <div className="mb-4 p-3 bg-orange-50 rounded-lg border border-orange-200">
                              <h5 className="text-sm font-medium text-gray-900 mb-3">Edit Options:</h5>
                              <div className="space-y-3">
                                {originalItem.item_variations.map((variation) => (
                                  <div key={variation.id} className="space-y-2">
                                    <label className="text-xs font-medium text-gray-700 block">
                                      {variation.name} {variation.is_required && <span className="text-red-500">*</span>}
                                    </label>
                                    <div className="grid grid-cols-1 gap-1">
                                      {variation.item_variation_options?.map((option) => (
                                        <button
                                          key={option.id}
                                          onClick={() => updateTempVariation(item.cartItemKey, variation.id, option.id)}
                                          className={cn(
                                            "text-left p-2 rounded border transition-colors text-xs",
                                            tempVariationSelections[item.cartItemKey]?.[variation.id] === option.id
                                              ? "border-orange-400 bg-orange-100 text-orange-700"
                                              : "border-gray-200 hover:border-orange-300 hover:bg-orange-50"
                                          )}
                                        >
                                          <div className="flex justify-between items-center">
                                            <span className="font-medium">{option.name}</span>
                                            {option.price_modifier !== 0 && (
                                              <span className="text-orange-600">
                                                {option.price_modifier > 0 ? '+' : ''}R{parseFloat(option.price_modifier || 0).toFixed(2)}
                                              </span>
                                            )}
                                          </div>
                                        </button>
                                      ))}
                                    </div>
                                  </div>
                                ))}
                                
                                {/* Save/Cancel Buttons */}
                                <div className="flex gap-2 pt-2">
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => toggleCartItemExpanded(item.cartItemKey)}
                                    className="flex-1 h-7 text-xs"
                                  >
                                    Cancel
                                  </Button>
                                  <Button
                                    size="sm"
                                    onClick={() => saveInlineVariationEdit(item.cartItemKey)}
                                    className="flex-1 h-7 text-xs bg-orange-500 hover:bg-orange-600 text-white"
                                  >
                                    Save
                                  </Button>
                                </div>
                              </div>
                            </div>
                          )}

                          {/* Bottom Row: Quantity Controls (Left) and Price (Right) */}
                          <div className="flex justify-between items-center">
                            {/* Quantity Controls - Bottom Left */}
                            <div className="flex items-center gap-2">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => updateCartQuantity(item.cartItemKey, item.quantity - 1)}
                                className="h-7 w-7 p-0 rounded-full border-orange-200"
                              >
                                <Minus className="w-3 h-3" />
                              </Button>
                              
                              <span className="text-sm font-medium w-8 text-center">
                                {item.quantity % 1 === 0 ? item.quantity : item.quantity.toFixed(2)}
                              </span>
                              
                              <Button
                                size="sm"
                                onClick={() => updateCartQuantity(item.cartItemKey, item.quantity + 1)}
                                className="h-7 w-7 p-0 rounded-full bg-orange-500 hover:bg-orange-600"
                              >
                                <Plus className="w-3 h-3" />
                              </Button>

                              {/* Settings Icon for Fractional Quantity */}
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => openFractionalQtyModal(item)}
                                className="h-7 w-7 p-0 rounded-full border-orange-200 hover:bg-orange-50"
                              >
                                <Settings className="w-3 h-3" />
                              </Button>
                            </div>

                            {/* Price and Per-Item Cost - Bottom Right */}
                            <div className="text-right">
                              <div className="text-lg font-bold text-orange-600">
                                R{(item.price * item.quantity).toFixed(2)}
                              </div>
                              <div className="text-xs text-gray-500">
                                R{parseFloat(item.price).toFixed(2)} each
                              </div>
                            </div>
                          </div>
        </CardContent>
      </Card>
                    );
                  })}
                </div>
                
                {/* Cart Footer */}
                <div className="border-t border-gray-200 bg-gray-50 p-6">
                  <div className="flex justify-between items-center mb-4">
                    <span className="text-xl font-bold text-gray-900">Total:</span>
                    <span className="text-2xl font-bold text-orange-600">
                      R{cartTotal.toFixed(2)}
                    </span>
                  </div>
                  
                  <div className="flex gap-3">
                    <Button
                      onClick={clearCart}
                      variant="outline"
                      className="flex-1 border-orange-200 text-orange-600 hover:bg-orange-50"
                    >
                      <RotateCcw className="w-4 h-4 mr-2" />
                      Clear
                    </Button>
                    <Button
                      onClick={() => setIsCreateOrderOpen(true)}
                      className="flex-2 bg-orange-500 hover:bg-orange-600 text-white h-12 text-lg font-semibold"
                    >
                      Create Order
                    </Button>
                  </div>
                </div>
              </>
            )}
          </TabsContent>
        </Tabs>
      </div>

      {/* Toggle Button */}
      <div className="relative">
        <Button
          onClick={() => setIsOrdersExpanded(!isOrdersExpanded)}
          className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 z-10 bg-white border-2 border-orange-300 text-orange-600 hover:bg-orange-50 h-12 w-12 rounded-full shadow-lg"
          size="sm"
        >
          {isOrdersExpanded ? <PanelRightOpen className="w-5 h-5" /> : <PanelLeftOpen className="w-5 h-5" />}
        </Button>
      </div>

      {/* Main POS Area */}
      <div 
        className="flex flex-col min-w-0 transition-all duration-300 ease-in-out"
        style={{ width: mainWidth }}
      >
        {/* Top Search Bar */}
        <div className="p-4 bg-white border-b border-orange-200 shadow-sm">
          <div className="relative">
            <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 text-gray-400 w-6 h-6" />
            <Input
              placeholder="Search menu items..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-12 h-12 text-lg font-medium border-2 border-orange-200 focus:border-orange-400 focus:ring-orange-200 rounded-xl"
            />
            {searchTerm && (
              <button
                onClick={() => setSearchTerm('')}
                className="absolute right-4 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                <X className="w-5 h-5" />
              </button>
            )}
          </div>
        </div>

        {/* Categories Row */}
        <div className="p-3 bg-white border-b border-orange-200">
          <div className="flex gap-2 overflow-x-auto pb-2">
            <Button
              variant={selectedCategory === 'all' ? 'default' : 'outline'}
              onClick={() => setSelectedCategory('all')}
              className={cn(
                "whitespace-nowrap flex-shrink-0 h-9 px-4 rounded-full font-medium transition-all text-sm",
                selectedCategory === 'all'
                  ? "bg-orange-500 hover:bg-orange-600 text-white shadow-md"
                  : "border-orange-200 text-gray-700 hover:bg-orange-50 hover:border-orange-300"
              )}
            >
              <Filter className="w-3 h-3 mr-2" />
              All Items
            </Button>
            {categories.map((category) => (
              <Button
                key={category.id}
                variant={selectedCategory === category.id ? 'default' : 'outline'}
                onClick={() => setSelectedCategory(category.id)}
                className={cn(
                  "whitespace-nowrap flex-shrink-0 h-9 px-4 rounded-full font-medium transition-all text-sm",
                  selectedCategory === category.id
                    ? "bg-orange-500 hover:bg-orange-600 text-white shadow-md"
                    : "border-orange-200 text-gray-700 hover:bg-orange-50 hover:border-orange-300"
                )}
              >
                {category.name}
              </Button>
            ))}
          </div>
        </div>

        {/* Items Grid - Fixed layout for consistent card sizes */}
        <div className="flex-1 overflow-y-auto p-4">
          {loadingItems ? (
            <div className={cn(
              "grid gap-4",
              isOrdersExpanded 
                ? "grid-cols-1 xl:grid-cols-2" 
                : "grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6"
            )}>
              {[...Array(isOrdersExpanded ? 8 : 24)].map((_, i) => (
                <div key={i} className="h-32 bg-gray-200 rounded-xl animate-pulse"></div>
              ))}
            </div>
          ) : filteredItems.length === 0 ? (
            <div className="text-center py-12">
              <Utensils className="w-16 h-16 text-gray-300 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">No items found</h3>
              <p className="text-gray-500">
                {searchTerm ? 'Try a different search term' : 'No items in this category'}
              </p>
            </div>
          ) : (
            <div className={cn(
              "grid gap-4",
              isOrdersExpanded 
                ? "grid-cols-1 xl:grid-cols-2" 
                : "grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6"
            )}>
              {filteredItems.map((item) => (
                <Card
                  key={item.id}
                  className="border-2 border-orange-200 hover:border-orange-400 transition-all duration-200 hover:shadow-lg cursor-pointer transform hover:scale-105"
                  onClick={() => addToCart(item)}
                >
                  <CardContent className={cn(
                    "p-4 flex flex-col justify-between",
                    isOrdersExpanded ? "h-40" : "h-32"
                  )}>
                    <div className="flex-1 min-h-0">
                      <h3 className={cn(
                        "font-bold text-gray-900 mb-1 leading-tight overflow-hidden text-ellipsis whitespace-nowrap",
                        isOrdersExpanded ? "text-base" : "text-sm"
                      )}>
                        {item.name.length > (isOrdersExpanded ? 25 : 20) 
                          ? item.name.substring(0, isOrdersExpanded ? 25 : 20) + '...'
                          : item.name
                        }
                      </h3>
                      
                      {item.description && (
                        <p className={cn(
                          "text-gray-600 mb-1 overflow-hidden text-ellipsis whitespace-nowrap",
                          isOrdersExpanded ? "text-sm" : "text-xs"
                        )}>
                          {item.description.length > (isOrdersExpanded ? 50 : 35) 
                            ? item.description.substring(0, isOrdersExpanded ? 50 : 35) + '...'
                            : item.description
                          }
                        </p>
                      )}

                      {/* Show variations preview - more compact */}
                      {item.item_variations && item.item_variations.length > 0 && (
                        <div className="text-xs text-gray-500">
                          {item.item_variations.slice(0, isOrdersExpanded ? 2 : 1).map((variation, index) => (
                            <span key={variation.id}>
                              {variation.name}
                              {index < Math.min(item.item_variations.length, isOrdersExpanded ? 2 : 1) - 1 && ', '}
                            </span>
                          ))}
                          {item.item_variations.length > (isOrdersExpanded ? 2 : 1) && '...'}
                        </div>
                      )}
                    </div>
                    
                    <div className="flex justify-between items-center mt-auto pt-2">
                      <span className={cn(
                        "font-bold text-orange-600",
                        isOrdersExpanded ? "text-lg" : "text-base"
                      )}>
                        R{parseFloat(item.price || 0).toFixed(2)}
                      </span>
                      
                      <Button
                        size="sm"
                        className={cn(
                          "bg-orange-500 hover:bg-orange-600 text-white p-0 rounded-full flex-shrink-0",
                          isOrdersExpanded ? "h-8 w-8" : "h-7 w-7"
                        )}
                        onClick={(e) => {
                          e.stopPropagation();
                          addToCart(item);
                        }}
                      >
                        <Plus className="w-3 h-3" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Quick Order Creation Dialog */}
      <Dialog open={isCreateOrderOpen} onOpenChange={setIsCreateOrderOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Plus className="w-5 h-5 text-orange-500" />
              Create Order
            </DialogTitle>
            <DialogDescription>
              {cart.length > 0 
                ? `Create order with ${cart.length} items (Total: R${cartTotal.toFixed(2)})`
                : "Create a new order with customer details."
              }
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 mt-4">
            <div>
              <label className="text-sm font-medium text-gray-700 block mb-2">
                Order Number <span className="text-red-500">*</span>
              </label>
              <Input
                placeholder="e.g., ORD123"
                value={orderNumber}
                onChange={(e) => setOrderNumber(e.target.value)}
                className="w-full"
              />
            </div>

            <div>
              <label className="text-sm font-medium text-gray-700 block mb-2">
                Customer Phone <span className="text-red-500">*</span>
              </label>
              <Input
                placeholder="Enter phone number"
                value={customerPhone}
                onChange={(e) => setCustomerPhone(e.target.value)}
                className="w-full"
              />
            </div>

            {cart.length > 0 && (
              <div className="bg-orange-50 p-3 rounded-lg">
                <h4 className="font-medium text-gray-900 mb-2">Order Items:</h4>
                <div className="space-y-1 text-sm">
                  {cart.map((item) => (
                    <div key={item.cartItemKey} className="flex justify-between">
                      <span>
                        {item.quantity}x {item.name}
                        {item.variationDetails && item.variationDetails.length > 0 && (
                          <span className="text-gray-500 text-xs ml-1">
                            ({item.variationDetails.map(v => v.optionName).join(', ')})
                          </span>
                        )}
                      </span>
                      <span>R{(item.price * item.quantity).toFixed(2)}</span>
                    </div>
                  ))}
                  <div className="border-t pt-1 mt-2 font-semibold flex justify-between">
                    <span>Total:</span>
                    <span>R{cartTotal.toFixed(2)}</span>
                  </div>
                </div>
              </div>
            )}
          </div>
          
          <div className="flex gap-3 pt-4">
            <Button 
              variant="outline" 
              onClick={() => setIsCreateOrderOpen(false)}
              className="flex-1"
              disabled={creating}
            >
              Cancel
            </Button>
            <Button 
              onClick={createOrder}
              disabled={creating || !customerPhone.trim() || !orderNumber.trim()}
              className="flex-1 bg-orange-500 hover:bg-orange-600 text-white"
            >
              {creating ? (
                <>
                  <Clock className="w-4 h-4 mr-2 animate-spin" />
                  Creating...
                </>
              ) : (
                <>
                  <Plus className="w-4 h-4 mr-2" />
                  Create Order
                </>
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Variation Selection Modal */}
      <Dialog open={isVariationModalOpen} onOpenChange={setIsVariationModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Utensils className="w-5 h-5 text-orange-500" />
              Customize Item
            </DialogTitle>
            <DialogDescription>
              {selectedItem?.name} - R{parseFloat(selectedItem?.price || 0).toFixed(2)}
            </DialogDescription>
          </DialogHeader>
          
          {selectedItem && (
            <div className="space-y-4 mt-4">
              {selectedItem.item_variations?.map((variation) => (
                <div key={variation.id} className="space-y-2">
                  <label className="text-sm font-medium text-gray-700 block">
                    {variation.name} {variation.is_required && <span className="text-red-500">*</span>}
                  </label>
                  <div className="grid grid-cols-1 gap-2">
                    {variation.item_variation_options?.map((option) => (
                      <button
                        key={option.id}
                        onClick={() => handleVariationChange(variation.id, option.id)}
                        className={cn(
                          "text-left p-3 rounded-lg border transition-colors",
                          selectedVariations[variation.id] === option.id
                            ? "border-orange-400 bg-orange-50 text-orange-700"
                            : "border-gray-200 hover:border-orange-300 hover:bg-orange-50"
                        )}
                      >
                        <div className="flex justify-between items-center">
                          <span className="font-medium">{option.name}</span>
                          {option.price_modifier !== 0 && (
                            <span className="text-sm text-orange-600">
                              {option.price_modifier > 0 ? '+' : ''}R{parseFloat(option.price_modifier || 0).toFixed(2)}
                            </span>
                          )}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              ))}

              {/* Price Preview */}
              <div className="bg-orange-50 p-3 rounded-lg">
                <div className="flex justify-between items-center">
                  <span className="font-medium text-gray-900">Total Price:</span>
                  <span className="text-lg font-bold text-orange-600">
                    R{(() => {
                      let total = parseFloat(selectedItem.price || 0);
                      selectedItem.item_variations?.forEach(variation => {
                        const selectedOptionId = selectedVariations[variation.id];
                        if (selectedOptionId) {
                          const option = variation.item_variation_options.find(opt => opt.id === selectedOptionId);
                          if (option) {
                            total += parseFloat(option.price_modifier || 0);
                          }
                        }
                      });
                      return total.toFixed(2);
                    })()}
                  </span>
                </div>
              </div>
            </div>
          )}
          
          <div className="flex gap-3 pt-4">
            <Button 
              variant="outline" 
              onClick={() => {
                setIsVariationModalOpen(false);
                setEditingCartItem(null);
                setSelectedItem(null);
              }}
              className="flex-1"
            >
              Cancel
            </Button>
            <Button 
              onClick={() => addToCart(selectedItem, selectedVariations)}
              className="flex-1 bg-orange-500 hover:bg-orange-600 text-white"
            >
              Add to Cart
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Order Edit Modal */}
      <Dialog open={isOrderEditModalOpen} onOpenChange={setIsOrderEditModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Edit className="w-5 h-5 text-orange-500" />
              Edit Order #{editingOrder?.order_number}
            </DialogTitle>
            <DialogDescription>
              Modify order status and details
            </DialogDescription>
          </DialogHeader>
          
          {editingOrder && (
            <div className="space-y-4 mt-4">
              <div>
                <label className="text-sm font-medium text-gray-700 block mb-2">
                  Order Status
                </label>
                <select
                  value={editingOrder.status}
                  onChange={(e) => setEditingOrder({...editingOrder, status: e.target.value})}
                  className="w-full p-2 border border-gray-300 rounded-md focus:border-orange-400 focus:ring-orange-200"
                >
                  <option value="pending">Pending</option>
                  <option value="confirmed">Confirmed</option>
                  <option value="preparing">Preparing</option>
                  <option value="ready">Ready</option>
                  <option value="out_for_delivery">Out for Delivery</option>
                  <option value="delivered">Delivered</option>
                  <option value="completed">Completed</option>
                  <option value="cancelled">Cancelled</option>
                </select>
              </div>

              <div>
                <label className="text-sm font-medium text-gray-700 block mb-2">
                  Customer Phone
                </label>
                <Input
                  value={editingOrder.customers?.whatsapp_number || ''}
                  onChange={(e) => setEditingOrder({
                    ...editingOrder, 
                    customers: {...editingOrder.customers, whatsapp_number: e.target.value}
                  })}
                  className="w-full"
                />
              </div>

              <div className="bg-blue-50 p-3 rounded-lg">
                <p className="text-sm text-blue-700">
                  <strong>Created:</strong> {formatDistanceToNow(new Date(editingOrder.created_at), { addSuffix: true })}
                </p>
                <p className="text-sm text-blue-700">
                  <strong>Type:</strong> {editingOrder.order_type}
                </p>
              </div>
            </div>
          )}
          
          <div className="flex gap-3 pt-4">
            <Button 
              variant="outline" 
              onClick={() => {
                setIsOrderEditModalOpen(false);
                setEditingOrder(null);
              }}
              className="flex-1"
            >
              Cancel
            </Button>
            <Button 
              onClick={async () => {
                if (editingOrder) {
                  await updateOrderStatus(editingOrder.id, editingOrder.status);
                  setIsOrderEditModalOpen(false);
                  setEditingOrder(null);
                }
              }}
              className="flex-1 bg-orange-500 hover:bg-orange-600 text-white"
            >
              Save Changes
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Fractional Quantity Modal */}
      <Dialog open={isFractionalQtyOpen} onOpenChange={setIsFractionalQtyOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Settings className="w-5 h-5 text-orange-500" />
              Fractional Quantity
            </DialogTitle>
            <DialogDescription>
              Enter a fractional quantity for {fractionalQtyItem?.name}
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 mt-4">
            <div>
              <label className="text-sm font-medium text-gray-700 block mb-2">
                Quantity (e.g., 1.5, 2.25, 0.75)
              </label>
              <Input
                type="number"
                step="0.01"
                min="0.01"
                value={fractionalQtyValue}
                onChange={(e) => setFractionalQtyValue(e.target.value)}
                placeholder="Enter quantity"
                className="w-full text-center text-lg"
              />
            </div>

            {/* Quick Preset Buttons */}
            <div className="grid grid-cols-4 gap-2">
              {[0.25, 0.5, 0.75, 1].map((preset) => (
                <Button
                  key={preset}
                  size="sm"
                  variant="outline"
                  onClick={() => setFractionalQtyValue(preset.toString())}
                  className="h-8 text-xs border-orange-200 hover:bg-orange-50"
                >
                  {preset}
                </Button>
              ))}
            </div>

            {/* Current Total Price Preview */}
            {fractionalQtyItem && fractionalQtyValue && !isNaN(parseFloat(fractionalQtyValue)) && (
              <div className="bg-orange-50 p-3 rounded-lg">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-700">Total Price:</span>
                  <span className="text-lg font-bold text-orange-600">
                    R{(fractionalQtyItem.price * parseFloat(fractionalQtyValue)).toFixed(2)}
                  </span>
                </div>
              </div>
            )}
          </div>
          
          <div className="flex gap-3 pt-4">
            <Button 
              variant="outline" 
              onClick={() => setIsFractionalQtyOpen(false)}
              className="flex-1"
            >
              Cancel
            </Button>
            <Button 
              onClick={saveFractionalQty}
              className="flex-1 bg-orange-500 hover:bg-orange-600 text-white"
            >
              Update Quantity
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Order Details Modal */}
      <Dialog open={isOrderDetailsModalOpen} onOpenChange={setIsOrderDetailsModalOpen}>
        <DialogContent className="max-w-2xl h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Eye className="w-5 h-5 text-orange-500" />
              Order Details
            </DialogTitle>
            <DialogDescription>
              Detailed view of order #{viewingOrder?.order_number}
            </DialogDescription>
          </DialogHeader>
          
          {loadingOrderDetails ? (
            <div className="flex-1 flex items-center justify-center">
              <div className="space-y-3">
                {[...Array(4)].map((_, i) => (
                  <div key={i} className="h-16 bg-gray-200 rounded-lg animate-pulse"></div>
                ))}
              </div>
            </div>
          ) : orderDetails ? (
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {/* Order Header */}
              <div className="bg-gray-50 p-4 rounded-lg border border-gray-200">
                <div className="flex justify-between items-start mb-2">
                  <h3 className="font-bold text-gray-900 text-xl">Order #{orderDetails.order_number}</h3>
                  <Badge className={cn("text-xs", getStatusColor(orderDetails.status))}>
                    {getStatusLabel(orderDetails.status)}
                  </Badge>
                </div>
                <p className="text-sm text-gray-600">
                  <strong>Created:</strong> {formatDistanceToNow(new Date(orderDetails.created_at), { addSuffix: true })}
                </p>
                <p className="text-sm text-gray-600">
                  <strong>Type:</strong> {orderDetails.order_type}
                </p>
              </div>

              {/* Customer Info */}
              <Card className="border-gray-200">
                <CardContent className="p-4">
                  <h4 className="font-medium text-gray-900 mb-2">Customer Information</h4>
                  <div className="space-y-1 text-sm">
                    <p><strong>Phone:</strong> {orderDetails.customers?.whatsapp_number || 'N/A'}</p>
                    {orderDetails.customers?.first_name && (
                      <p><strong>Name:</strong> {orderDetails.customers.first_name} {orderDetails.customers.last_name}</p>
                    )}
                    {orderDetails.customers?.email && (
                      <p><strong>Email:</strong> {orderDetails.customers.email}</p>
                    )}
                  </div>
                </CardContent>
              </Card>

              {/* Order Details */}
              <Card className="border-gray-200">
                <CardContent className="p-4">
                  <h4 className="font-medium text-gray-900 mb-3">Order Details</h4>
                  <div className="space-y-2 text-sm">
                    <p><strong>Delivery Address:</strong> {orderDetails.order_details?.[0]?.delivery_address || 'N/A'}</p>
                    <p><strong>Notes:</strong> {orderDetails.order_details?.[0]?.notes || 'N/A'}</p>
                    <p><strong>Kitchen Notes:</strong> {orderDetails.order_details?.[0]?.kitchen_notes || 'N/A'}</p>
                  </div>
                </CardContent>
              </Card>

              {/* Order Items */}
              <Card className="border-gray-200">
                <CardContent className="p-4">
                  <h4 className="font-medium text-gray-900 mb-3">Order Items</h4>
                  <div className="space-y-3">
                    {orderDetails.order_items?.map((orderItem) => (
                      <div key={orderItem.id} className="border border-gray-200 rounded-lg p-3">
                        <div className="flex justify-between items-start mb-2">
                          <div className="flex-1">
                            <h5 className="font-medium text-gray-900">{orderItem.items?.name}</h5>
                            {orderItem.items?.description && (
                              <p className="text-xs text-gray-600">{orderItem.items.description}</p>
                            )}
                          </div>
                          <div className="text-right">
                            <div className="font-bold text-orange-600">R{parseFloat(orderItem.total_price).toFixed(2)}</div>
                            <div className="text-xs text-gray-500">
                              {orderItem.quantity % 1 === 0 ? orderItem.quantity : parseFloat(orderItem.quantity).toFixed(2)} × R{parseFloat(orderItem.unit_price).toFixed(2)}
                            </div>
                          </div>
                        </div>
                        
                        {/* Variations */}
                        {orderItem.order_item_variations && orderItem.order_item_variations.length > 0 && (
                          <div className="mt-2">
                            <div className="flex flex-wrap gap-1">
                              {orderItem.order_item_variations.map((variation, index) => (
                                <span key={index} className="inline-block bg-blue-100 rounded-full px-2 py-1 text-xs text-blue-700">
                                  <span className="font-medium">{variation.item_variations?.name}:</span> {variation.item_variation_options?.name}
                                  {variation.price_modifier !== 0 && (
                                    <span className="text-blue-600 ml-1">
                                      {variation.price_modifier > 0 ? '+' : ''}R{parseFloat(variation.price_modifier).toFixed(2)}
                                    </span>
                                  )}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              {/* Financial Summary */}
              {orderDetails.order_financial_details?.[0] && (
                <Card className="border-gray-200">
                  <CardContent className="p-4">
                    <h4 className="font-medium text-gray-900 mb-3">Order Summary</h4>
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span>Subtotal:</span>
                        <span>R{parseFloat(orderDetails.order_financial_details[0].subtotal || 0).toFixed(2)}</span>
                      </div>
                      {orderDetails.order_financial_details[0].delivery_fee > 0 && (
                        <div className="flex justify-between">
                          <span>Delivery Fee:</span>
                          <span>R{parseFloat(orderDetails.order_financial_details[0].delivery_fee).toFixed(2)}</span>
                        </div>
                      )}
                      <div className="flex justify-between">
                        <span>Tax (15%):</span>
                        <span>R{parseFloat(orderDetails.order_financial_details[0].tax_amount || 0).toFixed(2)}</span>
                      </div>
                      <div className="border-t pt-2 flex justify-between font-bold text-lg">
                        <span>Total:</span>
                        <span className="text-orange-600">R{parseFloat(orderDetails.order_financial_details[0].total_amount).toFixed(2)}</span>
                      </div>
                      <div className="pt-2 border-t">
                        <p><strong>Payment:</strong> {orderDetails.order_financial_details[0].payment_method} ({orderDetails.order_financial_details[0].payment_status})</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Notes */}
              {orderDetails.order_details?.[0]?.notes && (
                <Card className="border-gray-200">
                  <CardContent className="p-4">
                    <h4 className="font-medium text-gray-900 mb-2">Notes</h4>
                    <p className="text-sm text-gray-600">{orderDetails.order_details[0].notes}</p>
                  </CardContent>
                </Card>
              )}
            </div>
          ) : (
            <div className="text-center py-8">
              <AlertCircle className="w-12 h-12 text-gray-300 mx-auto mb-3" />
              <p className="text-gray-500">Failed to load order details</p>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Home; 