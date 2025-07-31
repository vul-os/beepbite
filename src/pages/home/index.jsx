import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from "@/components/ui/button";
import { 
  Clock,
  ShoppingCart,
  PanelLeftOpen,
  PanelRightOpen,
  AlertCircle
} from 'lucide-react';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { useAuth } from '@/context/auth-context';
import { supabase } from '@/services/supabase-client';

// Import the new components
import OrdersSection from './components/orders-section';
import CartSection from './components/cart-section';
import POSSection from './components/pos-section';
import OrderModals from './components/order-modal';
import { cn } from '@/lib/utils';

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

  return (
    <div className="fixed inset-0 top-16 bg-gradient-to-br from-orange-50 to-orange-100 flex overflow-hidden">
      {/* Mobile View Toggle Button */}
      <Button
        onClick={() => setIsOrdersExpanded(!isOrdersExpanded)}
        className="md:hidden fixed bottom-4 right-4 z-50 bg-white border-2 border-orange-300 text-orange-600 hover:bg-orange-50 h-12 w-12 rounded-full shadow-lg flex items-center justify-center"
        size="sm"
      >
        {isOrdersExpanded ? <PanelRightOpen className="w-5 h-5" /> : <PanelLeftOpen className="w-5 h-5" />}
      </Button>

      {/* Left Sidebar - Orders & Cart */}
      <div 
        className={cn(
          "bg-white border-r border-orange-200 flex flex-col shadow-lg transition-all duration-300 ease-in-out",
          "fixed md:relative",
          isOrdersExpanded 
            ? "inset-0 w-full md:w-[45%] lg:w-[35%]" 
            : "md:w-[30%] -translate-x-full md:translate-x-0 w-full"
        )}
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
          <TabsContent 
            value="orders" 
            className={`overflow-hidden m-0 ${activeTab === 'orders' ? 'flex-1 flex flex-col relative' : ''}`}
          >
            <OrdersSection
              orders={orders}
              loadingOrders={loadingOrders}
              orderSearchTerm={orderSearchTerm}
              setOrderSearchTerm={setOrderSearchTerm}
              orderStatusFilter={orderStatusFilter}
              setOrderStatusFilter={setOrderStatusFilter}
              filteredOrders={filteredOrders}
              updateOrderStatus={updateOrderStatus}
              setEditingOrder={setEditingOrder}
              setIsOrderEditModalOpen={setIsOrderEditModalOpen}
              viewOrderDetails={viewOrderDetails}
              getStatusColor={getStatusColor}
              getNextStatus={getNextStatus}
              getStatusLabel={getStatusLabel}
              isOrdersExpanded={isOrdersExpanded}
            />
          </TabsContent>

          {/* Cart Tab */}
          <TabsContent 
            value="cart" 
            className={`overflow-hidden m-0 ${activeTab === 'cart' ? 'flex-1 flex flex-col' : ''}`}
          >
            <CartSection
              cart={cart}
              items={items}
              expandedCartItems={expandedCartItems}
              tempVariationSelections={tempVariationSelections}
              updateCartQuantity={updateCartQuantity}
              toggleCartItemExpanded={toggleCartItemExpanded}
              updateTempVariation={updateTempVariation}
              saveInlineVariationEdit={saveInlineVariationEdit}
              openFractionalQtyModal={openFractionalQtyModal}
              cartTotal={cartTotal}
              clearCart={clearCart}
              setIsCreateOrderOpen={setIsCreateOrderOpen}
            />
          </TabsContent>
        </Tabs>
      </div>

      {/* Desktop Toggle Button */}
      <div className="hidden md:block relative z-10">
        <Button
          onClick={() => setIsOrdersExpanded(!isOrdersExpanded)}
          className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 bg-white border-2 border-orange-300 text-orange-600 hover:bg-orange-50 h-12 w-12 rounded-full shadow-lg"
          size="sm"
        >
          {isOrdersExpanded ? <PanelRightOpen className="w-5 h-5" /> : <PanelLeftOpen className="w-5 h-5" />}
        </Button>
      </div>

      {/* Main POS Area */}
      <div 
        className={cn(
          "flex flex-col min-w-0 transition-all duration-300 ease-in-out",
          "fixed md:relative",
          !isOrdersExpanded 
            ? "inset-0 w-full" 
            : "md:flex-1 translate-x-full md:translate-x-0 w-full"
        )}
      >
        <POSSection
          searchTerm={searchTerm}
          setSearchTerm={setSearchTerm}
          categories={categories}
          selectedCategory={selectedCategory}
          setSelectedCategory={setSelectedCategory}
          filteredItems={filteredItems}
          loadingItems={loadingItems}
          isOrdersExpanded={isOrdersExpanded}
          addToCart={addToCart}
        />
      </div>

      {/* All Modals */}
      <OrderModals
        // Quick Order Creation Modal
        isCreateOrderOpen={isCreateOrderOpen}
        setIsCreateOrderOpen={setIsCreateOrderOpen}
        customerPhone={customerPhone}
        setCustomerPhone={setCustomerPhone}
        orderNumber={orderNumber}
        setOrderNumber={setOrderNumber}
        creating={creating}
        createOrder={createOrder}
        cart={cart}
        cartTotal={cartTotal}

        // Variation Selection Modal
        isVariationModalOpen={isVariationModalOpen}
        setIsVariationModalOpen={setIsVariationModalOpen}
        selectedItem={selectedItem}
        setSelectedItem={setSelectedItem}
        selectedVariations={selectedVariations}
        handleVariationChange={handleVariationChange}
        addToCart={addToCart}

        // Order Edit Modal
        isOrderEditModalOpen={isOrderEditModalOpen}
        setIsOrderEditModalOpen={setIsOrderEditModalOpen}
        editingOrder={editingOrder}
        setEditingOrder={setEditingOrder}
        updateOrderStatus={updateOrderStatus}

        // Order Details Modal
        isOrderDetailsModalOpen={isOrderDetailsModalOpen}
        setIsOrderDetailsModalOpen={setIsOrderDetailsModalOpen}
        viewingOrder={viewingOrder}
        orderDetails={orderDetails}
        loadingOrderDetails={loadingOrderDetails}
        closeOrderDetails={closeOrderDetails}
        getStatusColor={getStatusColor}
        getStatusLabel={getStatusLabel}

        // Fractional Quantity Modal
        isFractionalQtyOpen={isFractionalQtyOpen}
        setIsFractionalQtyOpen={setIsFractionalQtyOpen}
        fractionalQtyItem={fractionalQtyItem}
        fractionalQtyValue={fractionalQtyValue}
        setFractionalQtyValue={setFractionalQtyValue}
        saveFractionalQty={saveFractionalQty}
      />
    </div>
  );
};

export default Home; 