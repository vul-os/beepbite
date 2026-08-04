// customerchat.js — Customer chat assistant API service.
// POST /chat  requires a valid bearer token (customer JWT).

import { api } from '../lib/api-client';

export interface ChatMessage {
  role: string;
  content: string;
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
