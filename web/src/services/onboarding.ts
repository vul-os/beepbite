// onboarding.js — service helpers for the onboarding wizard progress endpoints.
// Backed by the Go handler at GET/PUT /onboarding/progress and
// GET /onboarding/status.

import { api } from '@/lib/api-client';

export interface OnboardingProgress {
  org_id?: string;
  step: number;
  completed_steps: string[];
  updated_at?: string;
}

export interface OnboardingStatus {
  has_location: boolean;
  has_five_items: boolean;
  has_staff_or_driver: boolean;
  has_order: boolean;
}

/**
 * Fetch current onboarding progress for the authenticated org.
 * The handler always returns 200 (returning step=0, completed_steps=[]
 * when no progress row exists yet).
 */
export async function getProgress() {
  return api.request<OnboardingProgress>('GET', '/onboarding/progress');
}

/**
 * Save onboarding progress. Creates or updates the row for the org.
 */
export async function putProgress({ step, completed_steps }: { step: number; completed_steps: string[] }) {
  return api.request<OnboardingProgress>('PUT', '/onboarding/progress', {
    body: { step, completed_steps },
  });
}

/**
 * Fetch live completion status derived from real DB counts:
 *  - has_location       — at least one location exists
 *  - has_five_items     — at least 5 active menu items
 *  - has_staff_or_driver — at least one staff member
 *  - has_order          — at least one completed/delivered order
 */
export async function getStatus() {
  return api.request<OnboardingStatus>('GET', '/onboarding/status');
}
