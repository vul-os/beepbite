// customerchat.js — Customer chat assistant API service.
// POST /chat  requires a valid bearer token (customer JWT).

import { api } from '../lib/api-client';

export interface ChatMessage {
  role: string;
  content: string;
}

// Mirrors backend/internal/handlers/customerchat/store.go DTOs — the shapes
// each named tool's `data` payload actually takes (dispatched in
// backend/internal/handlers/customerchat/tools.go dispatchTool).
export interface ChatStoreResult {
  id: string;
  name: string;
  slug?: string;
  address?: string;
  city?: string;
  country?: string;
  lat?: number;
  lng?: number;
}

export interface ChatMenuItem {
  id: string;
  name: string;
  description?: string;
  price: number;
}

export interface ChatMenuCategory {
  id: string;
  name: string;
  description?: string;
  items: ChatMenuItem[];
}

export interface ChatVariationOption {
  id: string;
  name: string;
  price_modifier: number;
}

export interface ChatItemVariation {
  id: string;
  name: string;
  is_required: boolean;
  options: ChatVariationOption[];
}

export interface ChatItemDetail {
  id: string;
  name: string;
  description?: string;
  price: number;
  variations?: ChatItemVariation[];
}

export interface ChatCartLine {
  cart_item_id: string;
  item_id: string;
  item_name: string;
  quantity: number;
  unit_price: number;
  total_price: number;
  modifiers?: string[];
}

export interface ChatCartView {
  location_id: string;
  lines: ChatCartLine[];
  subtotal: number;
}

export interface ChatOrderConfirmation {
  order_id: string;
  order_number: string;
  total_amount: number;
}

export interface ChatOrderStatus {
  order_id: string;
  order_number: string;
  status: string;
  created_at: string;
}

export interface ChatToolErrorData {
  error: string;
}

export interface ChatToolResult {
  tool: string;
  data: unknown;
}

export interface ChatReply {
  reply: string;
  tool_results: ChatToolResult[];
}

/**
 * Send a chat turn to the customer assistant.
 *
 * @param messages  Full conversation history.
 * @param conversationId  Optional client-generated conversation UUID.
 */
export async function sendChatMessage(messages: ChatMessage[], conversationId?: string) {
  return api.request<ChatReply>('POST', '/chat', {
    body: {
      messages,
      conversation_id: conversationId,
    },
  });
}
