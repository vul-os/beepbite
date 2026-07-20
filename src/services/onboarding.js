// onboarding.js — service helpers for the onboarding wizard progress endpoints.
// Backed by the Go handler at GET/PUT /onboarding/progress and
// GET /onboarding/status.

import { api } from '@/lib/api-client';

/**
 * Fetch current onboarding progress for the authenticated org.
 * The handler always returns 200 (returning step=0, completed_steps=[]
 * when no progress row exists yet).
 *
 * @returns {Promise<{ data: { org_id?: string, step: number, completed_steps: string[], updated_at?: string }, error }>}
 */
export async function getProgress() {
  return api.request('GET', '/onboarding/progress');
}

/**
 * Save onboarding progress. Creates or updates the row for the org.
 *
 * @param {{ step: number, completed_steps: string[] }} progress
 * @returns {Promise<{ data: { org_id: string, step: number, completed_steps: string[], updated_at: string }, error }>}
 */
export async function putProgress({ step, completed_steps }) {
  return api.request('PUT', '/onboarding/progress', {
    body: { step, completed_steps },
  });
}

/**
 * Fetch live completion status derived from real DB counts:
 *  - has_location       — at least one location exists
 *  - has_five_items     — at least 5 active menu items
 *  - has_staff_or_driver — at least one staff member
 *  - has_order          — at least one completed/delivered order
 *
 * @returns {Promise<{ data: { has_location: boolean, has_five_items: boolean, has_staff_or_driver: boolean, has_order: boolean }, error }>}
 */
export async function getStatus() {
  return api.request('GET', '/onboarding/status');
}
