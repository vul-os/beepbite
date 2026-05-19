// use-schedules.js — fetch and mutate menu_schedules + related data for a location.
// All API calls go through api.request() hitting the Go data handler at /data/<table>.

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api-client';

export function useSchedules(locationId) {
  const [schedules, setSchedules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const mounted = useRef(true);

  const fetchSchedules = useCallback(async () => {
    if (!locationId) {
      setSchedules([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await api.request(
        'GET',
        `/data/menu_schedules?eq=location_id,${locationId}&order=created_at.asc`,
      );
      if (!mounted.current) return;
      if (res.error) throw new Error(res.error.message || 'Failed to load schedules');
      setSchedules(Array.isArray(res.data) ? res.data : []);
      setError(null);
    } catch (e) {
      if (!mounted.current) return;
      setError(e.message || String(e));
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [locationId]);

  useEffect(() => {
    mounted.current = true;
    fetchSchedules();
    return () => { mounted.current = false; };
  }, [fetchSchedules]);

  // ---- schedules CRUD ----

  const createSchedule = useCallback(async ({ name, code, description }) => {
    const res = await api.request('POST', '/data/menu_schedules', {
      body: { location_id: locationId, name, code, description: description || null },
    });
    if (res.error) throw new Error(res.error.message || 'Failed to create schedule');
    await fetchSchedules();
    return res.data;
  }, [locationId, fetchSchedules]);

  const deleteSchedule = useCallback(async (id) => {
    const res = await api.request('DELETE', `/data/menu_schedules?eq=id,${id}`);
    if (res.error) throw new Error(res.error.message || 'Failed to delete schedule');
    await fetchSchedules();
  }, [fetchSchedules]);

  // ---- slots ----

  const fetchSlots = useCallback(async (scheduleId) => {
    const res = await api.request(
      'GET',
      `/data/menu_schedule_slots?eq=menu_schedule_id,${scheduleId}&order=day_of_week.asc`,
    );
    if (res.error) throw new Error(res.error.message || 'Failed to load slots');
    return Array.isArray(res.data) ? res.data : [];
  }, []);

  const addSlot = useCallback(async ({ menuScheduleId, dayOfWeek, startTime, endTime }) => {
    const res = await api.request('POST', '/data/menu_schedule_slots', {
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

  const deleteSlot = useCallback(async (id) => {
    const res = await api.request('DELETE', `/data/menu_schedule_slots?eq=id,${id}`);
    if (res.error) throw new Error(res.error.message || 'Failed to delete slot');
  }, []);

  // ---- item_menu_schedules ----

  const fetchItemSchedules = useCallback(async (scheduleId) => {
    const res = await api.request(
      'GET',
      `/data/item_menu_schedules?eq=menu_schedule_id,${scheduleId}`,
    );
    if (res.error) throw new Error(res.error.message || 'Failed to load item schedules');
    return Array.isArray(res.data) ? res.data : [];
  }, []);

  const addItemSchedule = useCallback(async ({ itemId, menuScheduleId }) => {
    const res = await api.request('POST', '/data/item_menu_schedules', {
      body: { item_id: itemId, menu_schedule_id: menuScheduleId },
    });
    if (res.error) throw new Error(res.error.message || 'Failed to link item to schedule');
    return res.data;
  }, []);

  const deleteItemSchedule = useCallback(async (id) => {
    const res = await api.request('DELETE', `/data/item_menu_schedules?eq=id,${id}`);
    if (res.error) throw new Error(res.error.message || 'Failed to unlink item from schedule');
  }, []);

  // ---- item_price_schedules ----

  const fetchPriceSchedules = useCallback(async (scheduleId) => {
    const res = await api.request(
      'GET',
      `/data/item_price_schedules?eq=menu_schedule_id,${scheduleId}`,
    );
    if (res.error) throw new Error(res.error.message || 'Failed to load price overrides');
    return Array.isArray(res.data) ? res.data : [];
  }, []);

  const upsertPriceSchedule = useCallback(async ({ itemId, menuScheduleId, price, existingId }) => {
    if (existingId) {
      // update existing row via PATCH
      const res = await api.request(
        'PATCH',
        `/data/item_price_schedules?eq=id,${existingId}`,
        { body: { price } },
      );
      if (res.error) throw new Error(res.error.message || 'Failed to update price override');
      return res.data;
    }
    const res = await api.request('POST', '/data/item_price_schedules', {
      body: { item_id: itemId, menu_schedule_id: menuScheduleId, price },
    });
    if (res.error) throw new Error(res.error.message || 'Failed to save price override');
    return res.data;
  }, []);

  const deletePriceSchedule = useCallback(async (id) => {
    const res = await api.request('DELETE', `/data/item_price_schedules?eq=id,${id}`);
    if (res.error) throw new Error(res.error.message || 'Failed to delete price override');
  }, []);

  // ---- items for this location ----

  const fetchItems = useCallback(async () => {
    const res = await api.request(
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
