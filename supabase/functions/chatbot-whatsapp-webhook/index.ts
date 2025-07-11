import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { sendSmartMessage, canUseWhatsApp } from "../utility/communication.ts"
import {
  sendWhatsAppMessage,
  getOrCreateCustomer,
  getOrCreateChat,
  saveMessage,
  updateChatState,
  getUnreviewedBites,
  getIncompleteBites,
  getRecentBitesByWhatsApp,
  sendRecentBiteUpdates,
  sendBiteStatusMessage,
  formatWelcomeMessage,
  formatBitesForReview,
  formatRatingRequest,
  formatCommentRequest,
  formatCommentWriteRequest,
  formatAnonSelectionMessage,
  formatThankYouMessage,
  saveReview,
  sendConsentConfirmation,
  handleMessage,
  handleConsentMessage,
  ConversationState,
  SYSTEM_BOT_ID
} from "./chatbot.ts"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface WhatsAppWebhookMessage {
  messaging_product: string
  metadata: {
    display_phone_number: string
    phone_number_id: string
  }
  contacts: Array<{
    profile: {
      name: string
    }
    wa_id: string
  }>
  messages: Array<{
    from: string
    id: string
    timestamp: string
    text?: {
      body: string
    }
    type: string
  }>
}

const supabase = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
)

async function getBotFromPhoneNumber(phoneNumberId: string) {
  const { data: bot, error } = await supabase
    .from('bots')
    .select('*')
    .eq('whatsapp_phone_number_id', phoneNumberId)
    .eq('is_active', true)
    .single()

  if (error) {
    console.error('Error fetching bot:', error)
    return null
  }

  return bot
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  // Handle webhook verification
  if (req.method === 'GET') {
    const url = new URL(req.url)
    const mode = url.searchParams.get('hub.mode')
    const token = url.searchParams.get('hub.verify_token')
    const challenge = url.searchParams.get('hub.challenge')
    
    const verifyToken = Deno.env.get('WHATSAPP_WEBHOOK_VERIFY_TOKEN')
    
    if (mode === 'subscribe' && token === verifyToken) {
      console.log('Webhook verified successfully')
      return new Response(challenge, { status: 200 })
    } else {
      console.error('Webhook verification failed')
      return new Response('Forbidden', { status: 403 })
    }
  }

  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 })
  }

  try {
    const body = await req.json()
    
    // Handle WhatsApp webhook
    if (body.object === 'whatsapp_business_account') {
      for (const entry of body.entry || []) {
        for (const change of entry.changes || []) {
          if (change.field === 'messages' && change.value.messages) {
            const webhookData: WhatsAppWebhookMessage = change.value
            
            for (const message of webhookData.messages) {
              if (message.type === 'text' && message.text?.body) {
                const phoneNumberId = webhookData.metadata.phone_number_id
                const from = message.from
                const messageId = message.id
                const messageBody = message.text.body
                const displayName = webhookData.contacts?.[0]?.profile?.name
                
                console.log('Processing message:', {
                  from,
                  messageBody,
                  phoneNumberId,
                  displayName
                })
                
                await handleMessage(phoneNumberId, from, messageId, messageBody, displayName)
              }
            }
          }
        }
      }
    }

    // Handle bite status updates (called from other functions)
    if (body.type === 'bite_status_update' && body.bite_id) {
      await sendBiteStatusMessage(body.bite_id)
    }

    return new Response('OK', { status: 200 })
  } catch (error) {
    console.error('Webhook error:', error)
    return new Response('Internal Server Error', { status: 500 })
  }
})
