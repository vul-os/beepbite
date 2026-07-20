import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Radio } from 'lucide-react';
import OrdersSection from './orders-section';

/**
 * Live Orders Panel
 *
 * Wraps OrdersSection in a Card with a sticky header that shows a live
 * pulse indicator and the current order count badge.
 * All order-fetch logic and state is owned in the parent (home/index.jsx).
 */
export default function LiveOrdersPanel({
  orders,
  loadingOrders,
  orderSearchTerm,
  setOrderSearchTerm,
  orderStatusFilter,
  setOrderStatusFilter,
  filteredOrders,
  updateOrderStatus,
}) {
  const getStatusColor = (status) => {
    switch (status) {
      case 'pending':             return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      case 'confirmed':           return 'bg-blue-100 text-blue-800 border-blue-200';
      case 'preparing':           return 'bg-orange-100 text-orange-800 border-orange-200';
      case 'ready':               return 'bg-green-100 text-green-800 border-green-200';
      case 'out_for_delivery':    return 'bg-purple-100 text-purple-800 border-purple-200';
      case 'pending_on_delivery': return 'bg-amber-100 text-amber-800 border-amber-200';
      default:                    return 'bg-muted text-muted-foreground border-border';
    }
  };

  const getNextStatus = (currentStatus) => {
    const flow = {
      pending:          'confirmed',
      confirmed:        'preparing',
      preparing:        'ready',
      ready:            'out_for_delivery',
      out_for_delivery: 'delivered',
    };
    return flow[currentStatus];
  };

  const getStatusLabel = (status) => {
    const labels = {
      pending:            'Pending',
      confirmed:          'Confirmed',
      preparing:          'Preparing',
      ready:              'Ready',
      out_for_delivery:   'Out for Delivery',
      delivered:          'Delivered',
      completed:          'Completed',
      cancelled:          'Cancelled',
      pending_on_delivery:'Awaiting Payment',
    };
    return labels[status] || status;
  };

  const activeCount = orders.filter((o) =>
    ['pending', 'confirmed', 'preparing', 'ready', 'out_for_delivery', 'pending_on_delivery'].includes(o.status)
  ).length;

  return (
    <Card variant="elevated" className="flex flex-col h-full" style={{ minHeight: 520 }}>
      <CardHeader className="pb-3 px-5 pt-5 flex-shrink-0 border-b border-border/60">
        <CardTitle className="flex items-center gap-2.5">
          {/* Animated live pulse */}
          <span className="relative flex h-2.5 w-2.5 flex-shrink-0" aria-hidden="true">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-60" />
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-primary" />
          </span>
          <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Radio className="h-4 w-4" aria-hidden="true" />
          </span>
          Live Orders
          {activeCount > 0 && (
            <span
              aria-label={`${activeCount} active orders`}
              className="ml-auto text-xs font-bold bg-primary text-primary-foreground rounded-full px-2.5 py-0.5 tabular-nums"
            >
              {activeCount}
            </span>
          )}
        </CardTitle>
      </CardHeader>
      {/* OrdersSection uses absolute positioning internally; give it a bounded container */}
      <CardContent className="p-0 flex-1 relative overflow-hidden" style={{ minHeight: 320 }}>
        <OrdersSection
          orders={orders}
          loadingOrders={loadingOrders}
          orderSearchTerm={orderSearchTerm}
          setOrderSearchTerm={setOrderSearchTerm}
          orderStatusFilter={orderStatusFilter}
          setOrderStatusFilter={setOrderStatusFilter}
          filteredOrders={filteredOrders}
          updateOrderStatus={updateOrderStatus}
          setEditingOrder={() => {}}
          setIsOrderEditModalOpen={() => {}}
          viewOrderDetails={() => {}}
          getStatusColor={getStatusColor}
          getNextStatus={getNextStatus}
          getStatusLabel={getStatusLabel}
          isOrdersExpanded={false}
        />
      </CardContent>
    </Card>
  );
}
