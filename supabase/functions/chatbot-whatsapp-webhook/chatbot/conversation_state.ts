import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const supabase = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
)

export interface ConversationState {
  step: 'main_menu' | 'make_order' | 'new_order_warning' | 'order_type' | 'address_selection' | 'new_address' | 'store_selection' | 'store_search' | 'menu_display' | 'category_items' | 'item_details' | 'item_customization' | 'cart_view' | 'checkout' | 'payment' | 'tip_selection' | 'email_collection' | 'payment_method' | 'review_selection' | 'rating' | 'comment' | 'comment_write' | 'anon_selection' | 'completed' | 'address_list' | 'address_actions' | 'address_add' | 'address_added' | 'location_suggestions' | 'profile_view' | 'profile_edit' | 'profile_field_edit'
  
  // Order flow data
  delivery_type?: 'delivery' | 'collection'
  selected_address_id?: string
  selected_location_id?: string
  current_category_id?: string
  current_item_id?: string
  
  // Menu pagination data
  menu_page?: number
  menu_view_type?: 'categories' | 'items'
  
  // Item customization data
  temp_item_variations?: Record<string, string> // variation_id -> option_id
  current_variation_index?: number
  
  // Cart data
  cart_items?: Array<{
    item_id: string
    quantity: number
    variations: Record<string, string>
    special_instructions?: string
  }>
  
  // Payment data
  tip_amount?: number
  customer_email?: string
  payment_method?: string
  payment_authorization_id?: string
  
  // Review data (existing)
  selected_bite_id?: string
  rating?: number
  comment?: string
  review_page?: number
  
  // Profile data
  editing_field?: 'first_name' | 'last_name' | 'email'
  
  // Navigation
  previous_step?: string
  temp_address_data?: any
}

export async function getConversationState(chatId: string): Promise<ConversationState> {
  const { data: chat, error } = await supabase
    .from('chats')
    .select('conversation_state')
    .eq('id', chatId)
    .single()
    
  if (error) {
    console.error('Error getting conversation state:', error)
    return { step: 'main_menu' }
  }
  
  return chat.conversation_state || { step: 'main_menu' }
}

export async function updateConversationState(chatId: string, newState: ConversationState): Promise<void> {
  const { error } = await supabase
    .from('chats')
    .update({ 
      conversation_state: newState,
      updated_at: new Date().toISOString()
    })
    .eq('id', chatId)
    
  if (error) {
    console.error('Error updating conversation state:', error)
  }
}

export async function resetConversationState(chatId: string): Promise<void> {
  await updateConversationState(chatId, { step: 'main_menu' })
} 