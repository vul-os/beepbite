// category86.js — thin fetch wrappers for the bulk 86 / un-86 category
// endpoints. Calls:
//
//   POST /categories/{category_id}/eighty-six
//   POST /categories/{category_id}/un-eighty-six
//
// Both return { category_id, items_affected, is_86ed } on success.

import { api } from '@/lib/api-client';

export interface EightySixResult {
  category_id: string;
  items_affected: number;
  is_86ed: boolean;
}

/**
 * Mark every item in the given category (and all its subcategories) as 86'd.
 *
 * @param categoryId - UUID of the category to 86.
 */
export async function eightySixCategory(categoryId: string) {
  return api.request<EightySixResult>('POST', `/categories/${encodeURIComponent(categoryId)}/eighty-six`);
}

/**
 * Clear the 86 flag on every item in the given category (and all its
 * subcategories).
 *
 * @param categoryId - UUID of the category to un-86.
 */
export async function unEightySixCategory(categoryId: string) {
  return api.request<EightySixResult>('POST', `/categories/${encodeURIComponent(categoryId)}/un-eighty-six`);
}
