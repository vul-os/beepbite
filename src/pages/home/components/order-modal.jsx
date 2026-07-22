import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { 
  Plus, 
  Clock,
  Utensils,
  Edit,
  Eye,
  Settings,
  AlertCircle
} from 'lucide-react';
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from 'date-fns';
import { useMoney } from "@/context/locale-context";

const OrderModals = ({
  // Quick Order Creation Modal
  isCreateOrderOpen,
  setIsCreateOrderOpen,
  customerPhone,
  setCustomerPhone,
  orderNumber,
  setOrderNumber,
  creating,
  createOrder,
  cart,
  cartTotal,

  // Variation Selection Modal
  isVariationModalOpen,
  setIsVariationModalOpen,
  selectedItem,
  setSelectedItem,
  selectedVariations,
  handleVariationChange,
  addToCart,

  // Order Edit Modal
  isOrderEditModalOpen,
  setIsOrderEditModalOpen,
  editingOrder,
  setEditingOrder,
  updateOrderStatus,

  // Order Details Modal
  isOrderDetailsModalOpen,
  setIsOrderDetailsModalOpen,
  viewingOrder,
  orderDetails,
  loadingOrderDetails,
  closeOrderDetails,
  getStatusColor,
  getStatusLabel,

  // Fractional Quantity Modal
  isFractionalQtyOpen,
  setIsFractionalQtyOpen,
  fractionalQtyItem,
  fractionalQtyValue,
  setFractionalQtyValue,
  saveFractionalQty
}) => {
  // Cart/menu prices arrive as major-unit floats; `scale` converts them to the
  // minor units format() expects, and is 1 in JPY where a literal 100 is wrong.
  const { format, scale } = useMoney();
  const toMinor = (major) => Math.round(parseFloat(major || 0) * scale);

  return (
    <>
      {/* Quick Order Creation Dialog */}
      <Dialog open={isCreateOrderOpen} onOpenChange={setIsCreateOrderOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Plus className="w-5 h-5 text-primary" />
              Create Order
            </DialogTitle>
            <DialogDescription>
              {cart.length > 0 
                ? `Create order with ${cart.length} items (Total: ${format(toMinor(cartTotal))})`
                : "Create a new order with customer details."
              }
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 mt-4">
            <div>
              <label className="text-sm font-medium text-foreground block mb-2">
                Order Number <span className="text-destructive">*</span>
              </label>
              <Input
                placeholder="e.g., ORD123"
                value={orderNumber}
                onChange={(e) => setOrderNumber(e.target.value)}
                className="w-full"
              />
            </div>

            <div>
              <label className="text-sm font-medium text-foreground block mb-2">
                Customer Phone <span className="text-destructive">*</span>
              </label>
              <Input
                placeholder="Enter phone number"
                value={customerPhone}
                onChange={(e) => setCustomerPhone(e.target.value)}
                className="w-full"
              />
            </div>

            {cart.length > 0 && (
              <div className="bg-primary/5 p-3 rounded-lg">
                <h4 className="font-medium text-foreground mb-2">Order Items:</h4>
                <div className="space-y-1 text-sm">
                  {cart.map((item) => (
                    <div key={item.cartItemKey} className="flex justify-between">
                      <span>
                        {item.quantity}x {item.name}
                        {item.variationDetails && item.variationDetails.length > 0 && (
                          <span className="text-muted-foreground text-xs ml-1">
                            ({item.variationDetails.map(v => v.optionName).join(', ')})
                          </span>
                        )}
                      </span>
                      <span>{format(toMinor(item.price * item.quantity))}</span>
                    </div>
                  ))}
                  <div className="border-t pt-1 mt-2 font-semibold flex justify-between">
                    <span>Total:</span>
                    <span>{format(toMinor(cartTotal))}</span>
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
              className="flex-1"
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
              <Utensils className="w-5 h-5 text-primary" />
              Customize Item
            </DialogTitle>
            <DialogDescription>
              {selectedItem?.name} - {format(toMinor(selectedItem?.price))}
            </DialogDescription>
          </DialogHeader>
          
          {selectedItem && (
            <div className="space-y-4 mt-4">
              {selectedItem.item_variations?.map((variation) => (
                <div key={variation.id} className="space-y-2">
                  <label className="text-sm font-medium text-foreground block">
                    {variation.name} {variation.is_required && <span className="text-destructive">*</span>}
                  </label>
                  <div className="grid grid-cols-1 gap-2">
                    {variation.item_variation_options?.map((option) => (
                      <Button
                        key={option.id}
                        type="button"
                        variant="outline"
                        aria-pressed={selectedVariations[variation.id] === option.id}
                        onClick={() => handleVariationChange(variation.id, option.id)}
                        className={cn(
                          "h-auto justify-start text-left p-3 font-normal",
                          selectedVariations[variation.id] === option.id
                            ? "border-primary bg-primary/10 text-primary hover:bg-primary/10"
                            : "hover:border-primary/40 hover:bg-primary/5"
                        )}
                      >
                        <div className="flex justify-between items-center w-full">
                          <span className="font-medium">{option.name}</span>
                          {option.price_modifier !== 0 && (
                            <span className="text-sm text-primary">
                              {option.price_modifier > 0 ? '+' : ''}{format(toMinor(option.price_modifier))}
                            </span>
                          )}
                        </div>
                      </Button>
                    ))}
                  </div>
                </div>
              ))}

              {/* Price Preview */}
              <div className="bg-primary/5 p-3 rounded-lg">
                <div className="flex justify-between items-center">
                  <span className="font-medium text-foreground">Total Price:</span>
                  <span className="text-lg font-bold text-primary">
                    {(() => {
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
                      return format(toMinor(total));
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
                setSelectedItem(null);
              }}
              className="flex-1"
            >
              Cancel
            </Button>
            <Button 
              onClick={() => addToCart(selectedItem, selectedVariations)}
              className="flex-1"
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
              <Edit className="w-5 h-5 text-primary" />
              Edit Order #{editingOrder?.order_number}
            </DialogTitle>
            <DialogDescription>
              Modify order status and details
            </DialogDescription>
          </DialogHeader>
          
          {editingOrder && (
            <div className="space-y-4 mt-4">
              <div>
                <label className="text-sm font-medium text-foreground block mb-2">
                  Order Status
                </label>
                <select
                  value={editingOrder.status}
                  onChange={(e) => setEditingOrder({...editingOrder, status: e.target.value})}
                  className="w-full p-2 border border-border rounded-md focus:border-primary focus:ring-primary/20"
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
                <label className="text-sm font-medium text-foreground block mb-2">
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

              <div className="bg-muted p-3 rounded-lg">
                <p className="text-sm text-muted-foreground">
                  <strong className="text-foreground">Created:</strong> {formatDistanceToNow(new Date(editingOrder.created_at), { addSuffix: true })}
                </p>
                <p className="text-sm text-muted-foreground">
                  <strong className="text-foreground">Type:</strong> {editingOrder.order_type}
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
              className="flex-1"
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
              <Settings className="w-5 h-5 text-primary" />
              Fractional Quantity
            </DialogTitle>
            <DialogDescription>
              Enter a fractional quantity for {fractionalQtyItem?.name}
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 mt-4">
            <div>
              <label className="text-sm font-medium text-foreground block mb-2">
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
                  className="h-8 text-xs border-primary/20 hover:bg-primary/5"
                >
                  {preset}
                </Button>
              ))}
            </div>

            {/* Current Total Price Preview */}
            {fractionalQtyItem && fractionalQtyValue && !isNaN(parseFloat(fractionalQtyValue)) && (
              <div className="bg-primary/5 p-3 rounded-lg">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-foreground">Total Price:</span>
                  <span className="text-lg font-bold text-primary">
                    {format(toMinor(fractionalQtyItem.price * parseFloat(fractionalQtyValue)))}
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
              className="flex-1"
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
              <Eye className="w-5 h-5 text-primary" />
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
                  <div key={i} className="h-16 bg-muted rounded-lg animate-pulse"></div>
                ))}
              </div>
            </div>
          ) : orderDetails ? (
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {/* Order Header */}
              <div className="bg-muted p-4 rounded-lg border border-border">
                <div className="flex justify-between items-start mb-2">
                  <h3 className="font-bold text-foreground text-xl">Order #{orderDetails.order_number}</h3>
                  <Badge className={cn("text-xs", getStatusColor(orderDetails.status))}>
                    {getStatusLabel(orderDetails.status)}
                  </Badge>
                </div>
                <p className="text-sm text-muted-foreground">
                  <strong>Created:</strong> {formatDistanceToNow(new Date(orderDetails.created_at), { addSuffix: true })}
                </p>
                <p className="text-sm text-muted-foreground">
                  <strong>Type:</strong> {orderDetails.order_type}
                </p>
              </div>

              {/* Customer Info */}
              <Card className="border-border">
                <CardContent className="p-4">
                  <h4 className="font-medium text-foreground mb-2">Customer Information</h4>
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
              <Card className="border-border">
                <CardContent className="p-4">
                  <h4 className="font-medium text-foreground mb-3">Order Details</h4>
                  <div className="space-y-2 text-sm">
                    <p><strong>Delivery Address:</strong> {orderDetails.delivery_address || 'N/A'}</p>
                    <p><strong>Notes:</strong> {orderDetails.notes || 'N/A'}</p>
                    <p><strong>Kitchen Notes:</strong> {orderDetails.kitchen_notes || 'N/A'}</p>
                  </div>
                </CardContent>
              </Card>

              {/* Order Items */}
              <Card className="border-border">
                <CardContent className="p-4">
                  <h4 className="font-medium text-foreground mb-3">Order Items</h4>
                  <div className="space-y-3">
                    {orderDetails.order_items?.map((orderItem) => (
                      <div key={orderItem.id} className="border border-border rounded-lg p-3">
                        <div className="flex justify-between items-start mb-2">
                          <div className="flex-1">
                            <h5 className="font-medium text-foreground">{orderItem.items?.name}</h5>
                            {orderItem.items?.description && (
                              <p className="text-xs text-muted-foreground">{orderItem.items.description}</p>
                            )}
                          </div>
                          <div className="text-right">
                            <div className="font-bold text-primary">{format(toMinor(orderItem.total_price))}</div>
                            <div className="text-xs text-muted-foreground">
                              {orderItem.quantity % 1 === 0 ? orderItem.quantity : parseFloat(orderItem.quantity).toFixed(2)} × {format(toMinor(orderItem.unit_price))}
                            </div>
                          </div>
                        </div>
                        
                        {/* Modifiers */}
                        {orderItem.order_item_modifiers && orderItem.order_item_modifiers.length > 0 && (
                          <div className="mt-2">
                            <div className="flex flex-wrap gap-1">
                              {orderItem.order_item_modifiers.map((modifier, index) => {
                                const priceDelta = modifier.price_cents_snapshot || 0;
                                return (
                                  <span key={index} className="inline-block bg-primary/10 rounded-full px-2 py-1 text-xs text-primary">
                                    <span className="font-medium">{modifier.name_snapshot}</span>
                                    {priceDelta !== 0 && (
                                      <span className="ml-1">
                                        {priceDelta > 0 ? '+' : ''}{format(priceDelta)}
                                      </span>
                                    )}
                                  </span>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              {/* Financial Summary */}
              {(orderDetails.subtotal_cents != null || orderDetails.total_cents != null) && (
                <Card className="border-border">
                  <CardContent className="p-4">
                    <h4 className="font-medium text-foreground mb-3">Order Summary</h4>
                    <div className="space-y-2 text-sm">
                      {orderDetails.subtotal_cents != null && (
                        <div className="flex justify-between">
                          <span>Subtotal:</span>
                          <span>{format(orderDetails.subtotal_cents)}</span>
                        </div>
                      )}
                      {orderDetails.tax_cents != null && (
                        <div className="flex justify-between">
                          <span>Tax:</span>
                          <span>{format(orderDetails.tax_cents)}</span>
                        </div>
                      )}
                      {orderDetails.total_cents != null && (
                        <div className="border-t pt-2 flex justify-between font-bold text-lg">
                          <span>Total:</span>
                          <span className="text-primary">{format(orderDetails.total_cents)}</span>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Notes */}
              {orderDetails.notes && (
                <Card className="border-border">
                  <CardContent className="p-4">
                    <h4 className="font-medium text-foreground mb-2">Notes</h4>
                    <p className="text-sm text-muted-foreground">{orderDetails.notes}</p>
                  </CardContent>
                </Card>
              )}
            </div>
          ) : (
            <div className="text-center py-8">
              <AlertCircle className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
              <p className="text-muted-foreground">Failed to load order details</p>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
};

export default OrderModals; 