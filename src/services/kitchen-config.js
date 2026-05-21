// kitchen-config.js — data helpers for the kitchen-routing settings page.
//
// All reads/writes go through the generic /data/{table} endpoint via the
// api.from(...) query builder (same pattern as other settings hooks).
//
// Tables owned by this service:
//
//   kitchen_stations           id, location_id, name, display_order, is_active
//   category_station_routing   id, location_id, category_id, station_id
//   item_station_routing       id, location_id, item_id, station_id
//   kds_display_groups         id, location_id, name, station_ids[], display_order,
//                              auto_recall_seconds  (created by migration 031)
//
// All write operations throw on error so the caller can catch and display.

import { api } from '@/lib/api-client';

// ---- stations ----------------------------------------------------------------

/** Fetch all kitchen stations for a location, ordered by display_order. */
export async function fetchStations(locationId) {
  const { data, error } = await api
    .from('kitchen_stations')
    .select('*')
    .eq('location_id', locationId)
    .order('display_order', { ascending: true });
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

/** Fetch all category→station routing rows for a location. */
export async function fetchCategoryRoutings(locationId) {
  const { data, error } = await api
    .from('category_station_routing')
    .select('*')
    .eq('location_id', locationId);
  if (error) throw new Error(error.message);
  return data ?? [];
}

/**
 * Upsert a category→station binding.
 * If a row already exists for (location_id, category_id) it is deleted first,
 * then re-inserted with the new station_id. Pass station_id = null to clear.
 */
export async function setCategoryRouting(locationId, categoryId, stationId) {
  // Delete any existing row for this category in this location.
  await api
    .from('category_station_routing')
    .delete()
    .eq('location_id', locationId)
    .eq('category_id', categoryId);

  if (!stationId) return; // cleared — nothing to insert

  const { data, error } = await api
    .from('category_station_routing')
    .insert({ location_id: locationId, category_id: categoryId, station_id: stationId });
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

/** Fetch all item→station routing rows for a location. */
export async function fetchItemRoutings(locationId) {
  const { data, error } = await api
    .from('item_station_routing')
    .select('*')
    .eq('location_id', locationId);
  if (error) throw new Error(error.message);
  return data ?? [];
}

/**
 * Upsert an item→station binding.
 * Deletes any existing row for (location_id, item_id) then inserts the new one.
 * Pass station_id = null to clear.
 */
export async function setItemRouting(locationId, itemId, stationId) {
  await api
    .from('item_station_routing')
    .delete()
    .eq('location_id', locationId)
    .eq('item_id', itemId);

  if (!stationId) return;

  const { data, error } = await api
    .from('item_station_routing')
    .insert({ location_id: locationId, item_id: itemId, station_id: stationId });
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
