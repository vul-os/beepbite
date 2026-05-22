// AI floor-plan service — thin wrappers around POST /ai/floor.
//
// The endpoint is a two-step flow:
//   1. generate → returns a *proposed* plan (sections + tables) for preview.
//   2. confirm  → persists the reviewed plan. The backend only ADDS sections
//                 and tables; it never deletes or rewrites the existing layout.
//
// Both helpers throw on error so callers can use try/catch.

import { api } from '@/lib/api-client';

/**
 * Ask the backend to generate a floor-plan proposal from a description.
 * Route: POST /ai/floor  { action:"generate", location_id, description }
 * @returns {Promise<{plan: object, stats: object}>}
 */
export async function generateFloor(locationId, description) {
  if (!locationId) throw new Error('locationId required');
  const { data, error } = await api.request('POST', '/ai/floor', {
    body: { action: 'generate', location_id: locationId, description },
  });
  if (error) {
    const e = new Error(error.message || 'Failed to generate floor plan');
    e.status = error.status;
    throw e;
  }
  if (!data?.success) {
    throw new Error(data?.message || 'Floor plan generation was not successful');
  }
  return { plan: data.plan, stats: data.stats };
}

/**
 * Persist a previously-generated (and reviewed) plan.
 * Route: POST /ai/floor  { action:"confirm", location_id, plan }
 * @returns {Promise<{stats: {sections_created: number, tables_created: number}}>}
 */
export async function applyFloor(locationId, plan) {
  if (!locationId) throw new Error('locationId required');
  if (!plan) throw new Error('plan required');
  const { data, error } = await api.request('POST', '/ai/floor', {
    body: { action: 'confirm', location_id: locationId, plan },
  });
  if (error) {
    const e = new Error(error.message || 'Failed to apply floor plan');
    e.status = error.status;
    throw e;
  }
  if (!data?.success) {
    throw new Error(data?.message || 'Applying the floor plan was not successful');
  }
  return { stats: data.stats };
}
