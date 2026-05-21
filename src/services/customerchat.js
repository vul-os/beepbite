// customerchat.js — Customer chat assistant API service.
// POST /chat  requires a valid bearer token (customer JWT).

import { api } from '../lib/api-client.js';

/**
 * Send a chat turn to the customer assistant.
 *
 * @param {Array<{role: string, content: string}>} messages  Full conversation history.
 * @param {string} [conversationId]  Optional client-generated conversation UUID.
 * @returns {Promise<{
 *   data: { reply: string, tool_results: Array<{tool: string, data: any}> } | null,
 *   error: any
 * }>}
 */
export async function sendChatMessage(messages, conversationId) {
  return api.request('POST', '/chat', {
    body: {
      messages,
      conversation_id: conversationId,
    },
  });
}
