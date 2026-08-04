// use-dashboard.js — parallel data fetch for the manager overview dashboard.
// Fires all requests concurrently and exposes per-section loading / error state.

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api-client';
import type { Promotion } from '../components/promotions-card';
import type { EightySixedItem } from '../components/eighty-six-card';
import type { AuditLogEntry } from '../components/audit-log-card';

// Mirrors backend/migrations/001_baseline.sql `menu_schedule_slots` table.
export interface MenuScheduleSlot {
  id: string;
  menu_schedule_id: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
  created_at: string;
}

// Mirrors backend/migrations/001_baseline.sql `menu_schedules` table, plus
// the `slots` this hook attaches client-side (see schedulesWithSlots below).
export interface MenuSchedule {
  id: string;
  location_id: string;
  name: string;
  code: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  slots: MenuScheduleSlot[];
}

// `select=id` narrows items to just the id column.
export interface ItemIdRow {
  id: string;
}

// Mirrors item_allergens / item_dietary_tags with `select=item_id`.
export interface ItemTagRow {
  item_id: string;
}

export interface DashboardData {
  promotions: Promotion[];
  schedules: MenuSchedule[];
  eightySixedItems: EightySixedItem[];
  allItems: ItemIdRow[];
  itemAllergens: ItemTagRow[];
  itemDietaryTags: ItemTagRow[];
  auditLog: AuditLogEntry[];
}

const EMPTY: DashboardData = Object.freeze({
  promotions: [],
  schedules: [],
  eightySixedItems: [],
  allItems: [],
  itemAllergens: [],
  itemDietaryTags: [],
  auditLog: [],
});

// Builds the promotions query URL.  We want:
//   organization_id = <orgId>
//   AND (location_id = <locId> OR location_id IS NULL)
//   AND is_active = true
// The backend's `or` param accepts supabase-js dot notation terms:
//   or=location_id.eq.<id>,location_id.is.null
function promoUrl(organizationId: string | undefined, locationId: string) {
  const params = new URLSearchParams();
  params.append('eq', `is_active,true`);
  params.append('eq', `organization_id,${organizationId}`);
  params.append('or', `location_id.eq.${locationId},location_id.is.null`);
  params.append('order', 'priority.desc');
  return `/data/promotions?${params.toString()}`;
}

export function useDashboard(locationId: string | undefined, organizationId: string | undefined) {
  const [data, setData] = useState<DashboardData>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);

  const fetch = useCallback(async () => {
    if (!locationId) {
      setData(EMPTY);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // All requests fire in parallel.
      const [
        promoRes,
        schedRes,
        e86Res,
        allItemsRes,
        schedSlotsRes,
        auditRes,
      ] = await Promise.all([
        // Active promotions: org-scoped, for this location OR org-wide (location_id IS NULL)
        api.request<Promotion[]>('GET', promoUrl(organizationId, locationId)),
        // Active menu schedules with their slots
        api.request<Omit<MenuSchedule, 'slots'>[]>('GET', `/data/menu_schedules?eq=location_id,${locationId}&eq=is_active,true&order=created_at.asc`),
        // 86'd items
        api.request<EightySixedItem[]>('GET', `/data/items?eq=location_id,${locationId}&eq=is_86ed,true&eq=is_active,true&order=name.asc`),
        // All active items — for coverage stats
        api.request<ItemIdRow[]>('GET', `/data/items?eq=location_id,${locationId}&eq=is_active,true&select=id`),
        // Schedule slots (for daypart current-status calculation)
        api.request<MenuScheduleSlot[]>('GET', `/data/menu_schedule_slots`),
        // Audit log — last 20 entries for this location
        api.request<AuditLogEntry[]>('GET', `/data/audit_log?eq=location_id,${locationId}&order=created_at.desc&limit=20`),
      ]);

      if (!mounted.current) return;

      const schedules = Array.isArray(schedRes.data) ? schedRes.data : [];
      const allItems = Array.isArray(allItemsRes.data) ? allItemsRes.data : [];
      const allSlots = Array.isArray(schedSlotsRes.data) ? schedSlotsRes.data : [];

      // Attach slots to their schedule
      const schedulesWithSlots: MenuSchedule[] = schedules.map(s => ({
        ...s,
        slots: allSlots.filter(sl => sl.menu_schedule_id === s.id),
      }));

      // Fetch allergen and dietary-tag coverage in parallel (only if there are items)
      let itemAllergens: ItemTagRow[] = [];
      let itemDietaryTags: ItemTagRow[] = [];

      if (allItems.length > 0) {
        const itemIds = allItems.map(i => i.id);
        const [allergenRes, dietaryRes] = await Promise.all([
          api.request<ItemTagRow[]>('GET', `/data/item_allergens?in=item_id,${itemIds.join(',')}&select=item_id`),
          api.request<ItemTagRow[]>('GET', `/data/item_dietary_tags?in=item_id,${itemIds.join(',')}&select=item_id`),
        ]);
        if (!mounted.current) return;
        itemAllergens = Array.isArray(allergenRes.data) ? allergenRes.data : [];
        itemDietaryTags = Array.isArray(dietaryRes.data) ? dietaryRes.data : [];
      }

      setData({
        promotions: Array.isArray(promoRes.data) ? promoRes.data : [],
        schedules: schedulesWithSlots,
        eightySixedItems: Array.isArray(e86Res.data) ? e86Res.data : [],
        allItems,
        itemAllergens,
        itemDietaryTags,
        auditLog: Array.isArray(auditRes.data) ? auditRes.data : [],
      });
    } catch (e) {
      if (!mounted.current) return;
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [locationId, organizationId]);

  useEffect(() => {
    mounted.current = true;
    fetch();
    return () => { mounted.current = false; };
  }, [fetch]);

  return { data, loading, error, refetch: fetch };
}
