// assistant.js — thin API wrapper for the owner assistant endpoints.
//
// POST /assistant         — send a chat message (direct command or free-form)
// GET  /assistant/draft/:id         — retrieve a pending menu import draft
// POST /assistant/draft/:id/commit  — commit draft with user decisions
// DELETE /assistant/draft/:id       — discard a draft

import { api } from '@/lib/api-client';

// Mirrors backend/internal/ai/menu.go structs (VariationOption, ItemVariation,
// MenuItem, ExistingItem, SimilarityMatch, ItemSuggestion) — the shapes
// returned in a draft's `items` array. Note: backend/internal/handlers/
// ownerassistant/draftstore.go's Draft.Items field comment says
// "// []ai.MenuItem" but handler.go actually assigns `genResp.Suggestions`
// ([]ai.ItemSuggestion) to it — the comment is stale; typed against the
// real runtime shape here.
export interface MenuVariationOption {
  name: string;
  price_modifier: number;
  is_default: boolean;
}

export interface MenuItemVariation {
  name: string;
  is_required: boolean;
  options: MenuVariationOption[];
}

export interface GeneratedMenuItem {
  name: string;
  description?: string;
  price: number;
  category_path: string[];
  preparation_time?: number;
  variations?: MenuItemVariation[];
}

export interface ExistingMenuItem {
  id: string;
  name: string;
  description: string;
  price: number;
  category_id: string;
  category_name: string;
  category_path: string[];
  preparation_time: number;
  variations: MenuItemVariation[];
}

export interface SimilarityMatch {
  existing_item: ExistingMenuItem;
  similarity_score: number;
  differences: string[];
  reasons: string[];
}

export interface ItemSuggestion {
  generated_item: GeneratedMenuItem;
  similar_items: SimilarityMatch[];
  recommendation: string;
  recommendation_reason: string;
}

// Mirrors backend/internal/handlers/ownerassistant/draftstore.go Draft.
export interface AssistantDraft {
  id: string;
  location_id: string;
  org_id: string;
  categories: unknown;
  items: ItemSuggestion[];
  created_at: string;
}

export interface AssistantReply {
  reply: string;
  draft?: AssistantDraft;
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

// Mirrors backend/internal/ai/menu.go ConfirmResponse/ConfirmStats — the
// body of POST /assistant/draft/:id/commit.
export interface ConfirmStats {
  items_updated: number;
  items_created: number;
  items_skipped: number;
  items_failed: number;
  items_successful: number;
  categories_created: number;
  variations_created: number;
}

export interface ConfirmResponse {
  success: boolean;
  action: string;
  message: string;
  has_failures: boolean;
  stats: ConfirmStats;
  successful_items: UserDecision[];
  failed_items: UserDecision[];
}

/**
 * Commit a draft — apply the owner's decisions.
 */
export async function commitDraft(draftId: string, decisions: UserDecision[]) {
  return api.request<ConfirmResponse>('POST', `/assistant/draft/${encodeURIComponent(draftId)}/commit`, {
    body: { decisions },
  });
}

/**
 * Discard / delete a draft.
 */
export async function discardDraft(draftId: string) {
  return api.request('DELETE', `/assistant/draft/${encodeURIComponent(draftId)}`);
}
