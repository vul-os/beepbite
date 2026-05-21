// kitchen-config.js — data helpers for the kitchen-routing settings page.
//
// All reads/writes go through the generic /data/{table} endpoint via the
// api.from(...) query builder (same pattern as other settings hooks).
//
// Tables owned by this service:
//
//   kitchen_stations           id, location_id, name, sort_order, is_active, station_type
//   category_station_routing   id, category_id, station_id, is_primary
//                              (no location_id — RLS scopes via station_id→kitchen_stations)
//   item_station_routing       id, item_id, station_id, is_primary
//                              (no location_id — RLS scopes via station_id→kitchen_stations)
//   kds_display_groups         id, location_id, name, station_ids[], display_order,
//                              auto_recall_seconds  (created by migration 031)
//
// All write operations throw on error so the caller can catch and display.

import { api } from '@/lib/api-client';

// ---- stations ----------------------------------------------------------------

/** Fetch all kitchen stations for a location, ordered by sort_order. */
export async function fetchStations(locationId) {
  const { data, error } = await api
    .from('kitchen_stations')
    .select('*')
    .eq('location_id', locationId)
    .order('sort_order', { ascending: true });
  if (error) throw new Error(error.message);
  return data ?? [];
}

/** Create a new kitchen station. Returns the created row. */
export async function createStation(payload) {
  const { data, error } = await api
    .from('kitchen_stations')
    .insert(payload)
    .single();
  if (error) throw new Error(error.message);
  return data;
}

/** Update a kitchen station by id. */
export async function updateStation(id, changes) {
  const { data, error } = await api
    .from('kitchen_stations')
    .update(changes)
    .eq('id', id)
    .single();
  if (error) throw new Error(error.message);
  return data;
}

/** Delete a kitchen station by id. */
export async function deleteStation(id) {
  const { error } = await api
    .from('kitchen_stations')
    .delete()
    .eq('id', id);
  if (error) throw new Error(error.message);
}

// ---- category → station routing ----------------------------------------------

/** Fetch all category→station routing rows visible to the current org (RLS scoped). */
export async function fetchCategoryRoutings(locationId) {
  // category_station_routing has no location_id column; RLS scopes via station_id→kitchen_stations.
  // We still need locationId to fetch stations for the UI but don't filter here.
  void locationId;
  const { data, error } = await api
    .from('category_station_routing')
    .select('*');
  if (error) throw new Error(error.message);
  return data ?? [];
}

/**
 * Upsert a category→station binding.
 * If a row already exists for category_id it is deleted first (RLS enforces org scope),
 * then re-inserted with the new station_id. Pass station_id = null to clear.
 */
export async function setCategoryRouting(locationId, categoryId, stationId) {
  void locationId; // no location_id column — RLS scopes transitively via station_id
  // Delete any existing row for this category (org-scoped by RLS).
  await api
    .from('category_station_routing')
    .delete()
    .eq('category_id', categoryId);

  if (!stationId) return; // cleared — nothing to insert

  const { data, error } = await api
    .from('category_station_routing')
    .insert({ category_id: categoryId, station_id: stationId });
  if (error) throw new Error(error.message);
  return data;
}

/** Delete a category routing row by its own id. */
export async function deleteCategoryRouting(id) {
  const { error } = await api
    .from('category_station_routing')
    .delete()
    .eq('id', id);
  if (error) throw new Error(error.message);
}

// ---- item → station routing --------------------------------------------------

/** Fetch all item→station routing rows visible to the current org (RLS scoped). */
export async function fetchItemRoutings(locationId) {
  // item_station_routing has no location_id column; RLS scopes via station_id→kitchen_stations.
  void locationId;
  const { data, error } = await api
    .from('item_station_routing')
    .select('*');
  if (error) throw new Error(error.message);
  return data ?? [];
}

/**
 * Upsert an item→station binding.
 * Deletes any existing row for item_id (org-scoped by RLS) then inserts the new one.
 * Pass station_id = null to clear.
 */
export async function setItemRouting(locationId, itemId, stationId) {
  void locationId; // no location_id column — RLS scopes transitively via station_id
  await api
    .from('item_station_routing')
    .delete()
    .eq('item_id', itemId);

  if (!stationId) return;

  const { data, error } = await api
    .from('item_station_routing')
    .insert({ item_id: itemId, station_id: stationId });
  if (error) throw new Error(error.message);
  return data;
}

/** Delete an item routing row by its own id. */
export async function deleteItemRouting(id) {
  const { error } = await api
    .from('item_station_routing')
    .delete()
    .eq('id', id);
  if (error) throw new Error(error.message);
}

// ---- KDS display groups (migration 031) -------------------------------------

/** Fetch all display groups for a location, ordered by display_order. */
export async function fetchDisplayGroups(locationId) {
  const { data, error } = await api
    .from('kds_display_groups')
    .select('*')
    .eq('location_id', locationId)
    .order('display_order', { ascending: true });
  if (error) throw new Error(error.message);
  return data ?? [];
}

/** Create a new display group. */
export async function createDisplayGroup(payload) {
  const { data, error } = await api
    .from('kds_display_groups')
    .insert(payload)
    .single();
  if (error) throw new Error(error.message);
  return data;
}

/** Update a display group by id. */
export async function updateDisplayGroup(id, changes) {
  const { data, error } = await api
    .from('kds_display_groups')
    .update(changes)
    .eq('id', id)
    .single();
  if (error) throw new Error(error.message);
  return data;
}

/** Delete a display group by id. */
export async function deleteDisplayGroup(id) {
  const { error } = await api
    .from('kds_display_groups')
    .delete()
    .eq('id', id);
  if (error) throw new Error(error.message);
}

// ---- helper: fetch categories & items for the routing pickers ---------------

/** Fetch menu categories for a location (for the routing picker labels). */
export async function fetchCategories(locationId) {
  const { data, error } = await api
    .from('categories')
    .select('id, name')
    .eq('location_id', locationId)
    .order('name', { ascending: true });
  if (error) throw new Error(error.message);
  return data ?? [];
}

/** Fetch menu items for a location (for the routing picker labels). */
export async function fetchItems(locationId) {
  const { data, error } = await api
    .from('items')
    .select('id, name, category_id')
    .eq('location_id', locationId)
    .order('name', { ascending: true });
  if (error) throw new Error(error.message);
  return data ?? [];
}
