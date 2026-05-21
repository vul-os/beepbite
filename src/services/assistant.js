// assistant.js — thin API wrapper for the owner assistant endpoints.
//
// POST /assistant         — send a chat message (direct command or free-form)
// GET  /assistant/draft/:id         — retrieve a pending menu import draft
// POST /assistant/draft/:id/commit  — commit draft with user decisions
// DELETE /assistant/draft/:id       — discard a draft

import { api } from '@/lib/api-client';

/**
 * Send a message to the owner assistant.
 *
 * @param {{ message: string, location_id?: string }} opts
 * @returns {Promise<{ data: { reply: string, draft?: object }, error: object|null }>}
 */
export async function sendMessage({ message, location_id = '' }) {
  return api.request('POST', '/assistant', {
    body: { message, location_id },
  });
}

/**
 * Retrieve a pending import draft by its ID.
 *
 * @param {string} draftId
 * @returns {Promise<{ data: object, error: object|null }>}
 */
export async function getDraft(draftId) {
  return api.request('GET', `/assistant/draft/${encodeURIComponent(draftId)}`);
}

/**
 * Commit a draft — apply the owner's decisions.
 *
 * decisions is the array of ai.UserDecision objects matching the existing
 * aimenu confirm contract:
 *   { generated_item: MenuItem, action: 'create_new'|'update'|'skip',
 *     existing_item_id?: string, modifications?: MenuItem }
 *
 * @param {string} draftId
 * @param {object[]} decisions
 * @returns {Promise<{ data: object, error: object|null }>}
 */
export async function commitDraft(draftId, decisions) {
  return api.request('POST', `/assistant/draft/${encodeURIComponent(draftId)}/commit`, {
    body: { decisions },
  });
}

/**
 * Discard / delete a draft.
 *
 * @param {string} draftId
 * @returns {Promise<{ data: object, error: object|null }>}
 */
export async function discardDraft(draftId) {
  return api.request('DELETE', `/assistant/draft/${encodeURIComponent(draftId)}`);
}
