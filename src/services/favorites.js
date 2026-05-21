// favorites.js — service helpers for the customer-favourite-items feature.
//
// Wraps the backend endpoints:
//   GET    /customers/{customer_id}/favorites
//   POST   /customers/{customer_id}/favorites        body: { item_id }
//   DELETE /customers/{customer_id}/favorites/{item_id}
//
// Each favourite item in the response has the shape:
//   { id, item_id, name, price_cents, image_url, created_at }

import { api } from '@/lib/api-client';

/**
 * List all favourite items for a customer.
 *
 * @param {string} customerId - UUID of the customer
 * @returns {Promise<Array>}  - Array of FavoriteItem objects, newest first
 * @throws {Error}            - On HTTP error or network failure
 */
export async function listFavorites(customerId) {
  if (!customerId) throw new Error('customerId is required');

  const { data, error } = await api.request(
    'GET',
    `/customers/${encodeURIComponent(customerId)}/favorites`,
  );

  if (error) {
    const e = new Error(error.message || 'Failed to fetch favorites');
    e.status = error.status;
    throw e;
  }

  return Array.isArray(data) ? data : [];
}

/**
 * Add an item to the customer's favourites (idempotent).
 *
 * @param {string} customerId - UUID of the customer
 * @param {string} itemId     - UUID of the menu item to favourite
 * @returns {Promise<Object>} - The created (or existing) FavoriteItem
 * @throws {Error}            - On HTTP error or network failure
 */
export async function addFavorite(customerId, itemId) {
  if (!customerId) throw new Error('customerId is required');
  if (!itemId) throw new Error('itemId is required');

  const { data, error } = await api.request(
    'POST',
    `/customers/${encodeURIComponent(customerId)}/favorites`,
    { body: { item_id: itemId } },
  );

  if (error) {
    const e = new Error(error.message || 'Failed to add favorite');
    e.status = error.status;
    throw e;
  }

  return data;
}

/**
 * Remove an item from the customer's favourites.
 *
 * @param {string} customerId - UUID of the customer
 * @param {string} itemId     - UUID of the menu item to un-favourite
 * @returns {Promise<void>}
 * @throws {Error}            - On HTTP error or network failure
 */
export async function removeFavorite(customerId, itemId) {
  if (!customerId) throw new Error('customerId is required');
  if (!itemId) throw new Error('itemId is required');

  const { error } = await api.request(
    'DELETE',
    `/customers/${encodeURIComponent(customerId)}/favorites/${encodeURIComponent(itemId)}`,
  );

  if (error) {
    const e = new Error(error.message || 'Failed to remove favorite');
    e.status = error.status;
    throw e;
  }
}
