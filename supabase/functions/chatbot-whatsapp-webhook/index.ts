import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { processMessage } from "./chatbot/main_handler.ts"

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
    location?: {
      latitude: number
      longitude: number
      name?: string
      address?: string
    }
    type: string
  }>
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
              const phoneNumberId = webhookData.metadata.phone_number_id
              const from = message.from
              const messageId = message.id
              const displayName = webhookData.contacts?.[0]?.profile?.name
              
              let messageBody = ''
              let messageType = message.type
              
              if (message.type === 'text' && message.text?.body) {
                messageBody = message.text.body
              } else if (message.type === 'location' && message.location) {
                // Format location data as a special message
                messageBody = `LOCATION:${message.location.latitude},${message.location.longitude}`
                if (message.location.name) {
                  messageBody += `:${message.location.name}`
                }
                if (message.location.address) {
                  messageBody += `:${message.location.address}`
                }
              }
              
              if (messageBody) {
                console.log('Processing message:', {
                  from,
                  messageBody,
                  messageType,
                  phoneNumberId,
                  displayName
                })
                
                await processMessage(phoneNumberId, from, messageId, messageBody, displayName)
              }
            }
          }
        }
      }
    }

    return new Response('OK', { status: 200 })
  } catch (error) {
    console.error('Webhook error:', error)
    return new Response('Internal Server Error', { status: 500 })
  }
})
