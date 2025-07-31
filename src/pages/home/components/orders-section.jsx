import React, { useState } from 'react';
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { 
  Search,
  Clock,
  Package,
  Timer,
  Eye,
  Edit,
  PhoneCall,
  X,
  ArrowLeft,
  Save,
  User,
  MapPin,
  CreditCard,
  ShoppingBag,
  FileText,
  Calendar,
  Utensils,
  AlertCircle
} from 'lucide-react';
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from 'date-fns';

const OrdersSection = ({
  orders,
  loadingOrders,
  orderSearchTerm,
  setOrderSearchTerm,
  orderStatusFilter,
  setOrderStatusFilter,
  filteredOrders,
  updateOrderStatus,
  setEditingOrder,
  setIsOrderEditModalOpen,
  viewOrderDetails,
  getStatusColor,
  getNextStatus,
  getStatusLabel,
  isOrdersExpanded
}) => {
  // Local state for inline views
  const [currentView, setCurrentView] = useState('list'); // 'list', 'details', 'edit'
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [selectedOrderDetails, setSelectedOrderDetails] = useState(null);
  const [loadingOrderDetails, setLoadingOrderDetails] = useState(false);
  const [editFormData, setEditFormData] = useState({});

  // Handle view order details inline - fetch detailed data
  const handleViewDetails = async (order) => {
    setSelectedOrder(order);
    setCurrentView('details');
    setLoadingOrderDetails(true);
    
    try {
      // Import supabase client
      const { supabase } = await import('@/services/supabase-client');
      
      // Fetch detailed order data including items
      const { data: orderDetails, error: orderError } = await supabase
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
            delivery_instructions,
            notes,
            kitchen_notes,
            estimated_prep_time
          )
        `)
        .eq('id', order.id)
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
        .eq('order_id', order.id);

      if (itemsError) throw itemsError;

      // Combine order details with items
      setSelectedOrderDetails({
        ...orderDetails,
        order_items: orderItems || []
      });
      
    } catch (error) {
      console.error('Error fetching order details:', error);
      alert('Failed to load order details');
      handleBackToList();
    } finally {
      setLoadingOrderDetails(false);
    }
  };

  // Handle edit order inline
  const handleEditOrder = (order) => {
    setSelectedOrder(order);
    setEditFormData({
      delivery_address: order.order_details?.delivery_address || '',
      delivery_instructions: order.order_details?.delivery_instructions || '',
      notes: order.order_details?.notes || '',
      kitchen_notes: order.order_details?.kitchen_notes || '',
      estimated_prep_time: order.order_details?.estimated_prep_time || 30,
    });
    setCurrentView('edit');
  };

  // Handle back to list
  const handleBackToList = () => {
    setCurrentView('list');
    setSelectedOrder(null);
    setSelectedOrderDetails(null);
    setLoadingOrderDetails(false);
    setEditFormData({});
  };

  // Handle save edit
  const handleSaveEdit = async () => {
    // Here you would typically call an API to update the order
    console.log('Saving order edit:', selectedOrder.id, editFormData);
    
    // For now, just go back to list
    handleBackToList();
  };

  // Handle form input changes
  const handleInputChange = (field, value) => {
    setEditFormData(prev => ({
      ...prev,
      [field]: value
    }));
  };

  // Get shorter status labels for buttons
  const getStatusLabelShort = (status) => {
    const labels = {
      'pending': 'Pending',
      'confirmed': 'Confirmed',
      'preparing': 'Preparing',
      'ready': 'Ready',
      'out_for_delivery': 'Out for Del.',
      'delivered': 'Delivered',
      'completed': 'Complete',
      'cancelled': 'Cancelled'
    };
    return labels[status] || status;
  };

  // Order Details View Component
  const OrderDetailsView = ({ order }) => (
    <div className="absolute inset-0 flex flex-col">
      {/* Header */}
      <div className="flex-shrink-0 flex items-center gap-3 p-4 border-b border-gray-200 bg-gray-50">
        <Button
          variant="ghost"
          size="sm"
          onClick={handleBackToList}
          className="h-8 w-8 rounded-full p-0 hover:bg-orange-100"
        >
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <div className="flex-1 flex items-center justify-between">
          <div>
            <div className="flex items-center gap-3">
              <h2 className="text-lg font-bold text-gray-900">Order Details</h2>
              <Badge className={cn("text-xs font-medium px-2 py-1", getStatusColor(order.status))}>
                {order.status === 'out_for_delivery' ? 'Out for Del.' : getStatusLabel(order.status)}
              </Badge>
            </div>
            <p className="text-sm text-gray-600">#{order.order_number}</p>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {loadingOrderDetails ? (
          <div className="p-6 space-y-4">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-32 bg-gray-200 rounded-lg animate-pulse"></div>
            ))}
          </div>
        ) : selectedOrderDetails ? (
          <div className="p-6 space-y-6">
            {/* Order Items */}
            <Card className="border border-orange-200">
              <CardContent className="p-4">
                <h3 className="font-semibold text-gray-900 mb-3 flex items-center">
                  <Utensils className="w-4 h-4 mr-2 text-orange-500" />
                  Order Items
                </h3>
                <div className="space-y-3">
                  {selectedOrderDetails.order_items && selectedOrderDetails.order_items.length > 0 ? (
                    selectedOrderDetails.order_items.map((item, index) => (
                      <div key={index} className="flex justify-between items-start p-3 bg-gray-50 rounded-lg">
                        <div className="flex-1">
                          <h4 className="font-medium text-gray-900">{item.items?.name || item.name || 'Unknown Item'}</h4>
                          {item.items?.description && (
                            <p className="text-sm text-gray-600 mt-1">{item.items.description}</p>
                          )}
                          {item.order_item_variations && item.order_item_variations.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-2">
                              {item.order_item_variations.map((variation, vIndex) => (
                                <span key={vIndex} className="inline-block bg-blue-100 rounded-full px-2 py-1 text-xs text-blue-700">
                                  {variation.item_variations?.name}: {variation.item_variation_options?.name}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                        <div className="text-right ml-4">
                          <div className="font-bold text-orange-600">
                            R{parseFloat(item.total_price || 0).toFixed(2)}
                          </div>
                          <div className="text-sm text-gray-500">
                            {item.quantity % 1 === 0 ? item.quantity : parseFloat(item.quantity).toFixed(2)} × R{parseFloat(item.unit_price || 0).toFixed(2)}
                          </div>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="text-center py-6 text-gray-500">
                      <Utensils className="w-8 h-8 mx-auto mb-2 text-gray-300" />
                      <p>No items found for this order</p>
                    </div>
                  )}
                </div>
                
                {/* Order Total */}
                {selectedOrderDetails.order_items && selectedOrderDetails.order_items.length > 0 && (
                  <div className="border-t pt-3 mt-3">
                    <div className="flex justify-between items-center">
                      <span className="font-semibold text-gray-900">Order Total:</span>
                      <span className="text-xl font-bold text-orange-600">
                        R{selectedOrderDetails.order_items.reduce((total, item) => total + parseFloat(item.total_price || 0), 0).toFixed(2)}
                      </span>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Customer Information */}
            <Card className="border border-orange-200">
              <CardContent className="p-4">
                <h3 className="font-semibold text-gray-900 mb-3 flex items-center">
                  <User className="w-4 h-4 mr-2 text-orange-500" />
                  Customer Information
                </h3>
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-gray-700">Name</span>
                    <span className="text-sm text-gray-900">
                      {selectedOrderDetails.customers?.first_name} {selectedOrderDetails.customers?.last_name || 'N/A'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-gray-700">Phone</span>
                    <span className="text-sm text-gray-900 flex items-center bg-blue-100 px-2 py-1 rounded">
                      <PhoneCall className="w-3 h-3 mr-1" />
                      {selectedOrderDetails.customers?.whatsapp_number || 'No phone'}
                    </span>
                  </div>
                  {selectedOrderDetails.customers?.email && (
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-gray-700">Email</span>
                      <span className="text-sm text-gray-900">{selectedOrderDetails.customers.email}</span>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Order Information */}
            <Card className="border border-orange-200">
              <CardContent className="p-4">
                <h3 className="font-semibold text-gray-900 mb-3 flex items-center">
                  <ShoppingBag className="w-4 h-4 mr-2 text-orange-500" />
                  Order Information
                </h3>
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-gray-700">Type</span>
                    <span className="text-sm text-gray-900 capitalize bg-gray-100 px-2 py-1 rounded">
                      {selectedOrderDetails.order_type || 'delivery'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-gray-700">Created</span>
                    <span className="text-sm text-gray-900 flex items-center">
                      <Calendar className="w-3 h-3 mr-1" />
                      {formatDistanceToNow(new Date(selectedOrderDetails.created_at), { addSuffix: true })}
                    </span>
                  </div>
                  {selectedOrderDetails.order_details?.[0]?.estimated_prep_time && (
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-gray-700">Prep Time</span>
                      <span className="text-sm text-gray-900 flex items-center bg-orange-100 px-2 py-1 rounded">
                        <Timer className="w-3 h-3 mr-1" />
                        {selectedOrderDetails.order_details[0].estimated_prep_time} min
                      </span>
                    </div>
                  )}
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-gray-700">Status</span>
                    <Badge className={cn("text-xs font-medium px-2 py-1", getStatusColor(selectedOrderDetails.status))}>
                      {selectedOrderDetails.status === 'out_for_delivery' ? 'Out for Del.' : getStatusLabel(selectedOrderDetails.status)}
                    </Badge>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Delivery Information */}
            {selectedOrderDetails.order_details?.[0]?.delivery_address && (
              <Card className="border border-orange-200">
                <CardContent className="p-4">
                  <h3 className="font-semibold text-gray-900 mb-3 flex items-center">
                    <MapPin className="w-4 h-4 mr-2 text-orange-500" />
                    Delivery Information
                  </h3>
                  <div className="space-y-3">
                    <div className="flex items-start justify-between">
                      <span className="text-sm font-medium text-gray-700">Address</span>
                      <span className="text-sm text-gray-900 text-right max-w-[60%]">
                        {selectedOrderDetails.order_details[0].delivery_address}
                      </span>
                    </div>
                    {selectedOrderDetails.order_details[0].delivery_instructions && (
                      <div className="flex items-start justify-between">
                        <span className="text-sm font-medium text-gray-700">Instructions</span>
                        <span className="text-sm text-gray-900 text-right max-w-[60%] bg-yellow-100 px-2 py-1 rounded">
                          {selectedOrderDetails.order_details[0].delivery_instructions}
                        </span>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Notes */}
            {(selectedOrderDetails.order_details?.[0]?.notes || selectedOrderDetails.order_details?.[0]?.kitchen_notes) && (
              <Card className="border border-orange-200">
                <CardContent className="p-4">
                  <h3 className="font-semibold text-gray-900 mb-3 flex items-center">
                    <FileText className="w-4 h-4 mr-2 text-orange-500" />
                    Notes
                  </h3>
                  <div className="space-y-3">
                    {selectedOrderDetails.order_details[0]?.notes && (
                      <div className="flex items-start justify-between">
                        <span className="text-sm font-medium text-gray-700">General</span>
                        <span className="text-sm text-gray-900 text-right max-w-[60%] bg-gray-100 px-2 py-1 rounded">
                          {selectedOrderDetails.order_details[0].notes}
                        </span>
                      </div>
                    )}
                    {selectedOrderDetails.order_details[0]?.kitchen_notes && (
                      <div className="flex items-start justify-between">
                        <span className="text-sm font-medium text-gray-700">Kitchen</span>
                        <span className="text-sm text-gray-900 text-right max-w-[60%] bg-orange-100 px-2 py-1 rounded">
                          {selectedOrderDetails.order_details[0].kitchen_notes}
                        </span>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Action Buttons - Now inside scrollable area at bottom */}
            <div className="flex gap-3 pt-4 pb-4 justify-center">
              {getNextStatus(order.status) && (
                <Button
                  onClick={() => updateOrderStatus(order.id, getNextStatus(order.status))}
                  className="bg-orange-500 hover:bg-orange-600 text-white px-6"
                >
                  {getStatusLabelShort(getNextStatus(order.status))}
                </Button>
              )}
              <Button
                variant="outline"
                onClick={() => handleEditOrder(order)}
                className="border-orange-200 hover:bg-orange-50 px-6"
              >
                Edit
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-center h-full">
            <div className="text-center text-gray-500">
              <AlertCircle className="w-16 h-16 mx-auto mb-4 text-gray-300" />
              <p>Failed to load order details</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );

  // Order Edit View Component
  const OrderEditView = ({ order }) => (
    <div className="absolute inset-0 flex flex-col">
      {/* Header */}
      <div className="flex-shrink-0 flex items-center gap-3 p-4 border-b border-gray-200 bg-gray-50">
        <Button
          variant="ghost"
          size="sm"
          onClick={handleBackToList}
          className="h-8 w-8 rounded-full p-0 hover:bg-orange-100"
        >
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <div className="flex-1 flex items-center justify-between">
          <div>
            <div className="flex items-center gap-3">
              <h2 className="text-lg font-bold text-gray-900">Edit Order</h2>
              <Badge className={cn("text-xs font-medium px-2 py-1", getStatusColor(order.status))}>
                {order.status === 'out_for_delivery' ? 'Out for Del.' : getStatusLabel(order.status)}
              </Badge>
            </div>
            <p className="text-sm text-gray-600">#{order.order_number}</p>
          </div>
        </div>
      </div>

      {/* Scrollable Content */}
      <div className="flex-1 overflow-y-auto">
        <div className="p-6 space-y-6">
          {/* Delivery Information */}
          <Card className="border border-orange-200">
            <CardContent className="p-4">
              <h3 className="font-semibold text-gray-900 mb-4 flex items-center">
                <MapPin className="w-4 h-4 mr-2 text-orange-500" />
                Delivery Information
              </h3>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Delivery Address
                  </label>
                  <Textarea
                    value={editFormData.delivery_address || ''}
                    onChange={(e) => handleInputChange('delivery_address', e.target.value)}
                    placeholder="Enter delivery address..."
                    rows={2}
                    className="w-full"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Delivery Instructions
                  </label>
                  <Textarea
                    value={editFormData.delivery_instructions || ''}
                    onChange={(e) => handleInputChange('delivery_instructions', e.target.value)}
                    placeholder="Special delivery instructions..."
                    rows={2}
                    className="w-full"
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Order Settings */}
          <Card className="border border-orange-200">
            <CardContent className="p-4">
              <h3 className="font-semibold text-gray-900 mb-4 flex items-center">
                <Timer className="w-4 h-4 mr-2 text-orange-500" />
                Order Settings
              </h3>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Estimated Prep Time (minutes)
                </label>
                <Input
                  type="number"
                  value={editFormData.estimated_prep_time || 30}
                  onChange={(e) => handleInputChange('estimated_prep_time', parseInt(e.target.value))}
                  className="w-full"
                  min="5"
                  max="120"
                />
              </div>
            </CardContent>
          </Card>

          {/* Notes */}
          <Card className="border border-orange-200">
            <CardContent className="p-4">
              <h3 className="font-semibold text-gray-900 mb-4 flex items-center">
                <FileText className="w-4 h-4 mr-2 text-orange-500" />
                Notes
              </h3>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    General Notes
                  </label>
                  <Textarea
                    value={editFormData.notes || ''}
                    onChange={(e) => handleInputChange('notes', e.target.value)}
                    placeholder="General order notes..."
                    rows={2}
                    className="w-full"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Kitchen Notes
                  </label>
                  <Textarea
                    value={editFormData.kitchen_notes || ''}
                    onChange={(e) => handleInputChange('kitchen_notes', e.target.value)}
                    placeholder="Special instructions for kitchen..."
                    rows={2}
                    className="w-full"
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Action Buttons - Now inside scrollable area at bottom */}
          <div className="flex gap-3 pt-4 pb-4 justify-center">
            <Button
              onClick={handleSaveEdit}
              className="bg-orange-500 hover:bg-orange-600 text-white px-6"
            >
              Save
            </Button>
            <Button
              variant="outline"
              onClick={handleBackToList}
              className="border-gray-300 hover:bg-gray-50 px-6"
            >
              Cancel
            </Button>
          </div>
        </div>
      </div>
    </div>
  );

  // Render based on current view
  if (currentView === 'details' && selectedOrder) {
    return <OrderDetailsView order={selectedOrder} />;
  }

  if (currentView === 'edit' && selectedOrder) {
    return <OrderEditView order={selectedOrder} />;
  }

  // Default orders list view
  return (
    <div className="absolute inset-0 flex flex-col">
      {/* Orders Search and Filter Header */}
      <div className="flex-shrink-0 p-4 border-b border-gray-200 bg-gray-50">
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

      {/* Orders List - Full Height */}
      <div className="flex-1 overflow-y-auto p-4">
        {loadingOrders ? (
          <div className={`grid gap-3 ${isOrdersExpanded ? 'grid-cols-2' : 'grid-cols-1'}`}>
            {[...Array(6)].map((_, i) => (
              <div key={i} className="h-24 bg-gray-200 rounded-lg animate-pulse"></div>
            ))}
          </div>
        ) : filteredOrders.length === 0 ? (
          <div className="flex items-center justify-center h-full min-h-[200px]">
            <div className="text-center">
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
          </div>
        ) : (
          <div className={`grid gap-3 ${isOrdersExpanded ? 'grid-cols-2' : 'grid-cols-1'}`}>
            {filteredOrders.map((order) => (
              <Card key={order.id} className="border border-orange-200 hover:border-orange-300 transition-colors hover:shadow-md">
                <CardContent className="p-4">
                  <div className="flex justify-between items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-2">
                        <h4 className="font-bold text-gray-900 text-lg truncate">#{order.order_number}</h4>
                        <Badge className={cn("text-xs font-medium px-2 py-1 flex-shrink-0", getStatusColor(order.status))}>
                          {order.status === 'out_for_delivery' ? 'Out for Del.' : getStatusLabel(order.status)}
                        </Badge>
                      </div>
                      <p className="text-sm text-gray-600 flex items-center gap-2 mb-1 truncate">
                        <PhoneCall className="w-4 h-4 flex-shrink-0" />
                        <span className="truncate">{order.customers?.whatsapp_number || 'No phone'}</span>
                      </p>
                      {order.customers?.first_name && (
                        <p className="text-sm text-gray-700 font-medium truncate">
                          {order.customers.first_name} {order.customers.last_name}
                        </p>
                      )}
                      <p className="text-sm text-gray-500 flex items-center gap-2 mt-2">
                        <Timer className="w-4 h-4 flex-shrink-0" />
                        <span className="truncate">{formatDistanceToNow(new Date(order.created_at), { addSuffix: true })}</span>
                      </p>
                    </div>
                  </div>

                  <div className="flex gap-2 mt-4">
                    {getNextStatus(order.status) && (
                      <Button
                        size="sm"
                        onClick={() => updateOrderStatus(order.id, getNextStatus(order.status))}
                        className="flex-1 bg-orange-500 hover:bg-orange-600 text-white h-8 text-sm truncate"
                      >
                        {getStatusLabelShort(getNextStatus(order.status))}
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleEditOrder(order)}
                      className="h-8 w-8 p-0 flex-shrink-0 border-orange-200 hover:bg-orange-50"
                    >
                      <Edit className="w-3 h-3" />
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleViewDetails(order)}
                      className="h-8 w-8 p-0 flex-shrink-0 border-orange-200 hover:bg-orange-50"
                    >
                      <Eye className="w-3 h-3" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default OrdersSection; 