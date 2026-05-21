// category86.js — thin fetch wrappers for the bulk 86 / un-86 category
// endpoints. Calls:
//
//   POST /categories/{category_id}/eighty-six
//   POST /categories/{category_id}/un-eighty-six
//
// Both return { category_id, items_affected, is_86ed } on success.

import { api } from '@/lib/api-client';

/**
 * Mark every item in the given category (and all its subcategories) as 86'd.
 *
 * @param {string} categoryId - UUID of the category to 86.
 * @returns {{ data: { category_id: string, items_affected: number, is_86ed: boolean } | null, error: object | null }}
 */
export async function eightySixCategory(categoryId) {
  return api.request('POST', `/categories/${encodeURIComponent(categoryId)}/eighty-six`);
}

/**
 * Clear the 86 flag on every item in the given category (and all its
 * subcategories).
 *
 * @param {string} categoryId - UUID of the category to un-86.
 * @returns {{ data: { category_id: string, items_affected: number, is_86ed: boolean } | null, error: object | null }}
 */
export async function unEightySixCategory(categoryId) {
  return api.request('POST', `/categories/${encodeURIComponent(categoryId)}/un-eighty-six`);
}
