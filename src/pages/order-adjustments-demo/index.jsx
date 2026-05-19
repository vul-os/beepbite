/**
 * Order Adjustments Demo
 *
 * Developer QA page — mount at /dev/adjustments.
 * Lets you trigger each adjustment type without wiring into a real order screen.
 *
 * DO NOT import this page in production navigation.
 */

import { useState } from 'react';
import AdjustmentModal from '@/components/order-adjustments/adjustment-modal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const ADJUSTMENT_TYPES = ['void', 'comp', 'price_override', 'refund'];

export default function OrderAdjustmentsDemo() {
  // Configurable test values
  const [orderId, setOrderId] = useState('order-123');
  const [itemId, setItemId] = useState('item-456');
  const [locationId, setLocationId] = useState('loc-001');
  const [currentPriceCents, setCurrentPriceCents] = useState(1299);

  // Modal state
  const [modalType, setModalType] = useState(null);
  const [lastResult, setLastResult] = useState(null);

  function openModal(type) {
    setModalType(type);
    setLastResult(null);
  }

  function handleClose() {
    setModalType(null);
  }

  function handleSuccess(data) {
    setLastResult(data);
    setModalType(null);
  }

  return (
    <div className="min-h-screen bg-background p-8">
      <div className="mx-auto max-w-xl space-y-8">
        <div>
          <h1 className="text-2xl font-semibold">Order Adjustments — Dev Demo</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Use this page to QA the adjustment modal before wiring it into real order
            screens. Changes here hit the real backend; use a test order.
          </p>
        </div>

        {/* Test fixture inputs */}
        <div className="rounded-lg border p-4 space-y-4">
          <h2 className="font-medium">Test Fixture</h2>

          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="demo-order-id">Order ID</Label>
              <Input
                id="demo-order-id"
                value={orderId}
                onChange={(e) => setOrderId(e.target.value)}
                placeholder="order-123"
              />
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="demo-item-id">Item ID (comp / price override)</Label>
              <Input
                id="demo-item-id"
                value={itemId}
                onChange={(e) => setItemId(e.target.value)}
                placeholder="item-456"
              />
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="demo-location-id">Location ID</Label>
              <Input
                id="demo-location-id"
                value={locationId}
                onChange={(e) => setLocationId(e.target.value)}
                placeholder="loc-001"
              />
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="demo-price">Current Price (cents)</Label>
              <Input
                id="demo-price"
                type="number"
                value={currentPriceCents}
                onChange={(e) => setCurrentPriceCents(Number(e.target.value))}
                placeholder="1299"
              />
            </div>
          </div>
        </div>

        {/* Trigger buttons */}
        <div className="grid grid-cols-2 gap-3">
          {ADJUSTMENT_TYPES.map((type) => (
            <Button
              key={type}
              variant="outline"
              className="capitalize"
              onClick={() => openModal(type)}
            >
              {type.replace('_', ' ')}
            </Button>
          ))}
        </div>

        {/* Last result */}
        {lastResult && (
          <div className="rounded-lg border p-4">
            <h2 className="mb-2 font-medium">Last Success Response</h2>
            <pre className="overflow-x-auto text-xs text-muted-foreground whitespace-pre-wrap">
              {JSON.stringify(lastResult, null, 2)}
            </pre>
          </div>
        )}
      </div>

      {/* The modal — rendered once, driven by modalType */}
      <AdjustmentModal
        open={modalType !== null}
        onClose={handleClose}
        orderId={orderId}
        itemId={itemId || null}
        type={modalType ?? 'void'}
        currentPriceCents={currentPriceCents || null}
        onSuccess={handleSuccess}
        locationId={locationId}
      />
    </div>
  );
}
