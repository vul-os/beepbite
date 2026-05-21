import React, { useState, useCallback, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Radio } from 'lucide-react';
import OrdersSection from './orders-section';

/**
 * Live Orders Panel
 *
 * Wraps OrdersSection in a Card header so it fits the dashboard layout.
 * All order-fetch logic and state is owned here (lifted from the old home index).
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
      case 'pending':           return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      case 'confirmed':         return 'bg-blue-100 text-blue-800 border-blue-200';
      case 'preparing':         return 'bg-orange-100 text-orange-800 border-orange-200';
      case 'ready':             return 'bg-green-100 text-green-800 border-green-200';
      case 'out_for_delivery':  return 'bg-purple-100 text-purple-800 border-purple-200';
      case 'pending_on_delivery': return 'bg-amber-100 text-amber-800 border-amber-200';
      default:                  return 'bg-gray-100 text-gray-800 border-gray-200';
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

  return (
    <Card className="border border-orange-100 shadow-sm flex flex-col h-full">
      <CardHeader className="pb-2 px-4 pt-4 flex-shrink-0">
        <CardTitle className="text-sm font-semibold text-gray-700 flex items-center gap-2">
          <Radio className="w-4 h-4 text-orange-500" />
          Live Orders
          {orders.length > 0 && (
            <span className="ml-auto text-xs font-normal bg-orange-100 text-orange-700 rounded-full px-2 py-0.5">
              {orders.length}
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
