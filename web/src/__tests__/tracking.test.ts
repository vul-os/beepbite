// tracking.test.ts — unit tests for src/services/tracking.ts
//
// normalizeTracking() is not exported — it is exercised through the public
// fetchTracking() entry point, with api.request mocked so no network call
// happens. The whole point of this module is documented in tracking.js
// itself: the backend's wire format is FLAT (store_lat/store_lng,
// delivery_lat/delivery_lng as siblings of status), but the UI wants a
// NESTED shape (store: {lat,lng}, delivery_address: {lat,lng,label}).
// Commit 7739452 fixed a real bug where these were confused — a regression
// here is a live customer-facing tracking page silently breaking.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const requestMock = vi.fn();
vi.mock('@/lib/api-client', () => ({
  api: { request: (...args: unknown[]) => requestMock(...args) },
}));

const { fetchTracking } = await import('../services/tracking.js');

beforeEach(() => {
  requestMock.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('fetchTracking — token guard', () => {
  it('returns a 400 error without calling the API when the token is missing', async () => {
    const result = await fetchTracking('');
    expect(result.data).toBeNull();
    expect(result.error).toEqual({ message: 'No tracking token provided', status: 400 });
    expect(requestMock).not.toHaveBeenCalled();
  });

  it('returns a 400 error for undefined/null token', async () => {
    expect((await fetchTracking(undefined as unknown as string)).error?.status).toBe(400);
    expect((await fetchTracking(null as unknown as string)).error?.status).toBe(400);
  });
});

describe('fetchTracking — request shaping', () => {
  it('calls GET /track/{token} unauthenticated, URL-encoding the token', async () => {
    requestMock.mockResolvedValue({ data: null, error: null });
    await fetchTracking('a b/c');
    expect(requestMock).toHaveBeenCalledWith(
      'GET',
      `/track/${encodeURIComponent('a b/c')}`,
      { auth: false },
    );
  });

  it('propagates a backend error without attempting to normalize it', async () => {
    requestMock.mockResolvedValue({ data: null, error: { message: 'not found', status: 404 } });
    const result = await fetchTracking('tok');
    expect(result.data).toBeNull();
    expect(result.error).toEqual({ message: 'not found', status: 404 });
  });

  it('passes through a null payload rather than crashing on it', async () => {
    requestMock.mockResolvedValue({ data: null, error: null });
    const result = await fetchTracking('tok');
    expect(result.data).toBeNull();
    expect(result.error).toBeNull();
  });
});

describe('fetchTracking — normalises the flat wire shape into the nested UI shape', () => {
  // Regression test for commit 7739452 (flat-vs-nested payload bug).
  it('nests store_lat/store_lng into store: {lat, lng}', async () => {
    requestMock.mockResolvedValue({
      data: {
        status: 'preparing',
        fulfillment_type: 'delivery',
        store_lat: -26.2041,
        store_lng: 28.0473,
      },
      error: null,
    });
    const { data } = await fetchTracking('tok');
    expect(data!.store).toEqual({ lat: -26.2041, lng: 28.0473 });
  });

  it('nests delivery_lat/delivery_lng + delivery_address into delivery_address: {lat, lng, label}', async () => {
    requestMock.mockResolvedValue({
      data: {
        status: 'out_for_delivery',
        fulfillment_type: 'delivery',
        delivery_lat: -26.1,
        delivery_lng: 28.05,
        delivery_address: '123 Main St',
      },
      error: null,
    });
    const { data } = await fetchTracking('tok');
    expect(data!.delivery_address).toEqual({ lat: -26.1, lng: 28.05, label: '123 Main St' });
  });

  it('nests the driver position unchanged when present', async () => {
    requestMock.mockResolvedValue({
      data: {
        status: 'out_for_delivery',
        fulfillment_type: 'delivery',
        driver: { lat: 1, lng: 2, recorded_at: '2026-01-01T00:00:00Z' },
      },
      error: null,
    });
    const { data } = await fetchTracking('tok');
    expect(data!.driver).toEqual({ lat: 1, lng: 2 });
  });

  it('carries fulfillment_type over as fulfillmentType (camelCase bridge)', async () => {
    requestMock.mockResolvedValue({
      data: { status: 'pending', fulfillment_type: 'pickup' },
      error: null,
    });
    const { data } = await fetchTracking('tok');
    expect(data!.fulfillmentType).toBe('pickup');
  });

  it('store is null when only one of the two coordinates is present (never a half-populated point)', async () => {
    requestMock.mockResolvedValue({
      data: { status: 'pending', fulfillment_type: 'pickup', store_lat: 1.5 },
      error: null,
    });
    const { data } = await fetchTracking('tok');
    expect(data!.store).toBeNull();
  });

  it('delivery_address keeps its label but nulls the coords when they are absent (pre-dispatch)', async () => {
    requestMock.mockResolvedValue({
      data: { status: 'confirmed', fulfillment_type: 'delivery', delivery_address: '5 Oak Ave' },
      error: null,
    });
    const { data } = await fetchTracking('tok');
    expect(data!.delivery_address).toEqual({ lat: null, lng: null, label: '5 Oak Ave' });
  });

  it('driver is null when the backend has not sent one', async () => {
    requestMock.mockResolvedValue({
      data: { status: 'pending', fulfillment_type: 'pickup' },
      error: null,
    });
    const { data } = await fetchTracking('tok');
    expect(data!.driver).toBeNull();
  });
});

describe('fetchTracking — eta_minutes derivation', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T12:00:00.000Z'));
  });

  it('rounds a future estimated_delivery_time to whole minutes from now', async () => {
    requestMock.mockResolvedValue({
      data: {
        status: 'out_for_delivery',
        fulfillment_type: 'delivery',
        estimated_delivery_time: '2026-01-01T12:15:00.000Z',
      },
      error: null,
    });
    const { data } = await fetchTracking('tok');
    expect(data!.eta_minutes).toBe(15);
  });

  it('clamps a past estimated_delivery_time to 0 rather than going negative', async () => {
    requestMock.mockResolvedValue({
      data: {
        status: 'out_for_delivery',
        fulfillment_type: 'delivery',
        estimated_delivery_time: '2026-01-01T11:00:00.000Z',
      },
      error: null,
    });
    const { data } = await fetchTracking('tok');
    expect(data!.eta_minutes).toBe(0);
  });

  it('is null when no estimated_delivery_time is sent', async () => {
    requestMock.mockResolvedValue({
      data: { status: 'pending', fulfillment_type: 'pickup' },
      error: null,
    });
    const { data } = await fetchTracking('tok');
    expect(data!.eta_minutes).toBeNull();
  });

  it('is null (not NaN) for an unparseable estimated_delivery_time', async () => {
    requestMock.mockResolvedValue({
      data: {
        status: 'pending',
        fulfillment_type: 'pickup',
        estimated_delivery_time: 'not-a-date',
      },
      error: null,
    });
    const { data } = await fetchTracking('tok');
    expect(data!.eta_minutes).toBeNull();
    expect(Number.isNaN(data!.eta_minutes)).toBe(false);
  });
});
