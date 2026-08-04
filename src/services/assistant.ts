// assistant.js — thin API wrapper for the owner assistant endpoints.
//
// POST /assistant         — send a chat message (direct command or free-form)
// GET  /assistant/draft/:id         — retrieve a pending menu import draft
// POST /assistant/draft/:id/commit  — commit draft with user decisions
// DELETE /assistant/draft/:id       — discard a draft

import { api } from '@/lib/api-client';

export interface AssistantReply {
  reply: string;
  draft?: unknown;
}

/**
 * A ai.UserDecision object matching the existing aimenu confirm contract.
 */
export interface UserDecision {
  generated_item: unknown;
  action: 'create_new' | 'update' | 'skip';
  existing_item_id?: string;
  modifications?: unknown;
}

/**
 * Send a message to the owner assistant.
 */
export async function sendMessage({ message, location_id = '' }: { message: string; location_id?: string }) {
  return api.request<AssistantReply>('POST', '/assistant', {
    body: { message, location_id },
  });
}

/**
 * Retrieve a pending import draft by its ID.
 */
export async function getDraft(draftId: string) {
  return api.request('GET', `/assistant/draft/${encodeURIComponent(draftId)}`);
}

/**
 * Commit a draft — apply the owner's decisions.
 */
export async function commitDraft(draftId: string, decisions: UserDecision[]) {
  return api.request('POST', `/assistant/draft/${encodeURIComponent(draftId)}/commit`, {
    body: { decisions },
  });
}

/**
 * Discard / delete a draft.
 */
export async function discardDraft(draftId: string) {
  return api.request('DELETE', `/assistant/draft/${encodeURIComponent(draftId)}`);
}
