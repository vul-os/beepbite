// use-schedules.ts — fetch and mutate menu_schedules + related data for a location.
// All API calls go through api.request() hitting the Go data handler at /data/<table>.

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api-client';

// Types below mirror backend/migrations/001_baseline.sql `menu_schedules`,
// `menu_schedule_slots`, `item_menu_schedules` and `item_price_schedules`
// tables (subset this hook reads/writes).
export interface MenuSchedule {
  id: string;
  location_id: string;
  name: string;
  code: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface MenuScheduleSlot {
  id: string;
  menu_schedule_id: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
  created_at: string;
}

export interface ItemMenuSchedule {
  id: string;
  item_id: string;
  menu_schedule_id: string;
  created_at: string;
}

export interface ItemPriceSchedule {
  id: string;
  item_id: string;
  menu_schedule_id: string;
  price: number;
  created_at: string;
  updated_at: string;
}

// Subset of the `items` table used by the schedule item-picker/happy-hour tables.
export interface ScheduleMenuItem {
  id: string;
  name: string;
  price: number;
  [key: string]: unknown;
}

export interface CreateScheduleInput {
  name: string;
  code: string;
  // NOTE (found by this TS conversion, not fixed — out of scope): `menu_schedules`
  // (backend/migrations/001_baseline.sql) has no `description` column, but this
  // field is collected in the "New Schedule" dialog and sent in this POST body
  // regardless. Pre-existing dead write, preserved as-is.
  description?: string;
}

export interface AddSlotInput {
  menuScheduleId: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
}

export interface AddItemScheduleInput {
  itemId: string;
  menuScheduleId: string;
}

export interface UpsertPriceScheduleInput {
  itemId: string;
  menuScheduleId: string;
  price: number;
  existingId?: string | null;
}

export function useSchedules(locationId: string | undefined) {
  const [schedules, setSchedules] = useState<MenuSchedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);

  const fetchSchedules = useCallback(async () => {
    if (!locationId) {
      setSchedules([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await api.request<MenuSchedule[]>(
        'GET',
        `/data/menu_schedules?eq=location_id,${locationId}&order=created_at.asc`,
      );
      if (!mounted.current) return;
      if (res.error) throw new Error(res.error.message || 'Failed to load schedules');
      setSchedules(Array.isArray(res.data) ? res.data : []);
      setError(null);
    } catch (e) {
      if (!mounted.current) return;
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [locationId]);

  useEffect(() => {
    mounted.current = true;
    // fetchSchedules() is fully try/catch/finally-wrapped above.
    void fetchSchedules();
    return () => { mounted.current = false; };
  }, [fetchSchedules]);

  // ---- schedules CRUD ----

  const createSchedule = useCallback(async ({ name, code, description }: CreateScheduleInput) => {
    const res = await api.request<MenuSchedule>('POST', '/data/menu_schedules', {
      body: { location_id: locationId, name, code, description: description || null },
    });
    if (res.error) throw new Error(res.error.message || 'Failed to create schedule');
    await fetchSchedules();
    return res.data;
  }, [locationId, fetchSchedules]);

  const deleteSchedule = useCallback(async (id: string) => {
    const res = await api.request('DELETE', `/data/menu_schedules?eq=id,${id}`);
    if (res.error) throw new Error(res.error.message || 'Failed to delete schedule');
    await fetchSchedules();
  }, [fetchSchedules]);

  // ---- slots ----

  const fetchSlots = useCallback(async (scheduleId: string) => {
    const res = await api.request<MenuScheduleSlot[]>(
      'GET',
      `/data/menu_schedule_slots?eq=menu_schedule_id,${scheduleId}&order=day_of_week.asc`,
    );
    if (res.error) throw new Error(res.error.message || 'Failed to load slots');
    return Array.isArray(res.data) ? res.data : [];
  }, []);

  const addSlot = useCallback(async ({ menuScheduleId, dayOfWeek, startTime, endTime }: AddSlotInput) => {
    const res = await api.request<MenuScheduleSlot>('POST', '/data/menu_schedule_slots', {
      body: {
        menu_schedule_id: menuScheduleId,
        day_of_week: dayOfWeek,
        start_time: startTime,
        end_time: endTime,
      },
    });
    if (res.error) throw new Error(res.error.message || 'Failed to add slot');
    return res.data;
  }, []);

  const deleteSlot = useCallback(async (id: string) => {
    const res = await api.request('DELETE', `/data/menu_schedule_slots?eq=id,${id}`);
    if (res.error) throw new Error(res.error.message || 'Failed to delete slot');
  }, []);

  // ---- item_menu_schedules ----

  const fetchItemSchedules = useCallback(async (scheduleId: string) => {
    const res = await api.request<ItemMenuSchedule[]>(
      'GET',
      `/data/item_menu_schedules?eq=menu_schedule_id,${scheduleId}`,
    );
    if (res.error) throw new Error(res.error.message || 'Failed to load item schedules');
    return Array.isArray(res.data) ? res.data : [];
  }, []);

  const addItemSchedule = useCallback(async ({ itemId, menuScheduleId }: AddItemScheduleInput) => {
    const res = await api.request<ItemMenuSchedule>('POST', '/data/item_menu_schedules', {
      body: { item_id: itemId, menu_schedule_id: menuScheduleId },
    });
    if (res.error) throw new Error(res.error.message || 'Failed to link item to schedule');
    return res.data;
  }, []);

  const deleteItemSchedule = useCallback(async (id: string) => {
    const res = await api.request('DELETE', `/data/item_menu_schedules?eq=id,${id}`);
    if (res.error) throw new Error(res.error.message || 'Failed to unlink item from schedule');
  }, []);

  // ---- item_price_schedules ----

  const fetchPriceSchedules = useCallback(async (scheduleId: string) => {
    const res = await api.request<ItemPriceSchedule[]>(
      'GET',
      `/data/item_price_schedules?eq=menu_schedule_id,${scheduleId}`,
    );
    if (res.error) throw new Error(res.error.message || 'Failed to load price overrides');
    return Array.isArray(res.data) ? res.data : [];
  }, []);

  const upsertPriceSchedule = useCallback(async ({ itemId, menuScheduleId, price, existingId }: UpsertPriceScheduleInput) => {
    if (existingId) {
      // update existing row via PATCH
      const res = await api.request<ItemPriceSchedule>(
        'PATCH',
        `/data/item_price_schedules?eq=id,${existingId}`,
        { body: { price } },
      );
      if (res.error) throw new Error(res.error.message || 'Failed to update price override');
      return res.data;
    }
    const res = await api.request<ItemPriceSchedule>('POST', '/data/item_price_schedules', {
      body: { item_id: itemId, menu_schedule_id: menuScheduleId, price },
    });
    if (res.error) throw new Error(res.error.message || 'Failed to save price override');
    return res.data;
  }, []);

  const deletePriceSchedule = useCallback(async (id: string) => {
    const res = await api.request('DELETE', `/data/item_price_schedules?eq=id,${id}`);
    if (res.error) throw new Error(res.error.message || 'Failed to delete price override');
  }, []);

  // ---- items for this location ----

  const fetchItems = useCallback(async () => {
    const res = await api.request<ScheduleMenuItem[]>(
      'GET',
      `/data/items?eq=location_id,${locationId}&eq=is_active,true&order=name.asc`,
    );
    if (res.error) throw new Error(res.error.message || 'Failed to load items');
    return Array.isArray(res.data) ? res.data : [];
  }, [locationId]);

  return {
    schedules,
    loading,
    error,
    refresh: fetchSchedules,
    createSchedule,
    deleteSchedule,
    fetchSlots,
    addSlot,
    deleteSlot,
    fetchItemSchedules,
    addItemSchedule,
    deleteItemSchedule,
    fetchPriceSchedules,
    upsertPriceSchedule,
    deletePriceSchedule,
    fetchItems,
  };
}
