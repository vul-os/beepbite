import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Type declaration for Deno environment (this is expected in Supabase Edge Functions)
declare const Deno: {
  env: {
    get(key: string): string | undefined
  }
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Add new interfaces for different input types
interface MenuInput {
  type: 'images' | 'text' | 'pdf'
  content: any // base64 for files, text for prompts, array for multiple images
  filename?: string // for PDF uploads
  additional_text?: string // for additional context when files are provided
}

interface MenuCategory {
  name: string
  description?: string
  subcategories?: MenuCategory[]
  items: MenuItem[]
}

interface MenuItem {
  name: string
  description?: string
  price: number
  category_path: string[] // For nested categories
  preparation_time?: number
  variations?: ItemVariation[]
}

interface ItemVariation {
  name: string
  is_required: boolean
  options: VariationOption[]
}

interface VariationOption {
  name: string
  price_modifier: number
  is_default: boolean
}

interface ProcessedMenu {
  categories: MenuCategory[]
  items: MenuItem[]
}

interface ExistingItem {
  id: string
  name: string
  description: string
  price: number
  category_id: string
  category_name: string
  category_path: string[]
  preparation_time: number
  variations: any[]
}

interface SimilarityMatch {
  existing_item: ExistingItem
  similarity_score: number
  differences: string[]
  reasons: string[]
}

interface ItemSuggestion {
  generated_item: MenuItem
  similar_items: SimilarityMatch[]
  recommendation: 'update' | 'create_new' | 'skip'
  recommendation_reason: string
}

interface UserDecision {
  generated_item: MenuItem
  action: 'update' | 'create_new' | 'skip'
  existing_item_id?: string
  modifications?: Partial<MenuItem> // User can modify the generated item
}

interface GenerateRequest {
  action: 'generate'
  location_id: string
  input: MenuInput
}

interface ConfirmRequest {
  action: 'confirm'
  location_id: string
  decisions: UserDecision[]
}

serve(async (req) => {
  // Handle CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Initialize Supabase client
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    )

    // Parse request body with better error handling
    let body;
    try {
      body = await req.json()
    } catch (parseError) {
      console.error('JSON parse error:', parseError)
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: 'Invalid JSON in request body',
          error_code: 'INVALID_JSON'
        }),
        { 
          status: 400, 
          headers: { 
            ...corsHeaders, 
            'Content-Type': 'application/json' 
          } 
        }
      )
    }

    const { action, location_id } = body
    
    if (!location_id) {
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: 'location_id is required',
          error_code: 'MISSING_LOCATION_ID'
        }),
        { 
          status: 400, 
          headers: { 
            ...corsHeaders, 
            'Content-Type': 'application/json' 
          } 
        }
      )
    }

    if (!action || !['generate', 'confirm'].includes(action)) {
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: 'action must be either "generate" or "confirm"',
          error_code: 'INVALID_ACTION'
        }),
        { 
          status: 400, 
          headers: { 
            ...corsHeaders, 
            'Content-Type': 'application/json' 
          } 
        }
      )
    }

    // Verify location exists with better error handling
    let location;
    try {
      const { data, error: locationError } = await supabaseClient
      .from('locations')
      .select('id, name')
      .eq('id', location_id)
      .single()

      if (locationError) {
        console.error('Location query error:', locationError)
        return new Response(
          JSON.stringify({ 
            success: false, 
            error: 'Location not found or access denied',
            error_code: 'LOCATION_NOT_FOUND'
          }),
          { 
            status: 400, 
            headers: { 
              ...corsHeaders, 
              'Content-Type': 'application/json' 
            } 
          }
        )
      }

      if (!data) {
        return new Response(
          JSON.stringify({ 
            success: false, 
            error: 'Location not found',
            error_code: 'LOCATION_NOT_FOUND'
          }),
          { 
            status: 400, 
            headers: { 
              ...corsHeaders, 
              'Content-Type': 'application/json' 
            } 
          }
        )
      }

      location = data
    } catch (dbError) {
      console.error('Database connection error:', dbError)
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: 'Database connection failed. Please try again.',
          error_code: 'DATABASE_ERROR'
        }),
        { 
          status: 500, 
          headers: { 
            ...corsHeaders, 
            'Content-Type': 'application/json' 
          } 
        }
      )
    }

    console.log(`Processing ${action} request for location: ${location.name}`)

    if (action === 'generate') {
      return await handleGenerateRequest(body as GenerateRequest, supabaseClient, location)
    } else {
      return await handleConfirmRequest(body as ConfirmRequest, supabaseClient, location)
    }

  } catch (error) {
    console.error('Unexpected error processing request:', error)
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: 'An unexpected error occurred. Please try again.',
        error_code: 'INTERNAL_ERROR'
      }),
      { 
        status: 500, 
        headers: { 
          ...corsHeaders, 
          'Content-Type': 'application/json' 
        } 
      }
    )
  }
})

async function handleGenerateRequest(request: GenerateRequest, supabaseClient: any, location: any) {
  const { input } = request
  
  // Validate input with detailed error messages
  if (!input) {
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: 'No input provided',
        error_code: 'MISSING_INPUT'
      }),
      { 
        status: 400, 
        headers: { 
          ...corsHeaders, 
          'Content-Type': 'application/json' 
        } 
      }
    )
  }

  if (!input.content) {
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: 'No content provided in input',
        error_code: 'MISSING_CONTENT'
      }),
      { 
        status: 400, 
        headers: { 
          ...corsHeaders, 
          'Content-Type': 'application/json' 
        } 
      }
    )
  }

  // Validate content based on type
  if (input.type === 'images') {
    if (!Array.isArray(input.content) || input.content.length === 0) {
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: 'No images provided or invalid image format',
          error_code: 'INVALID_IMAGES'
        }),
        { 
          status: 400, 
          headers: { 
            ...corsHeaders, 
            'Content-Type': 'application/json' 
          } 
        }
      )
    }
  } else if (input.type === 'text') {
    if (typeof input.content !== 'string' || input.content.trim().length === 0) {
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: 'No text content provided or invalid text format',
          error_code: 'INVALID_TEXT'
        }),
        { 
          status: 400, 
          headers: { 
            ...corsHeaders, 
            'Content-Type': 'application/json' 
          } 
        }
      )
    }
  } else if (input.type === 'pdf') {
    if (!input.content) {
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: 'No PDF content provided or invalid PDF format',
          error_code: 'INVALID_PDF'
        }),
        { 
          status: 400, 
          headers: { 
            ...corsHeaders, 
            'Content-Type': 'application/json' 
          } 
        }
      )
    }
  }

  // Get Gemini API key from secrets
  const geminiApiKey = Deno.env.get('GEMINI_API_KEY')
  if (!geminiApiKey) {
    console.error('GEMINI_API_KEY not found in environment variables')
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: 'AI service configuration error. Please contact support.',
        error_code: 'MISSING_API_KEY'
      }),
      { 
        status: 500, 
        headers: { 
          ...corsHeaders, 
          'Content-Type': 'application/json' 
        } 
      }
    )
  }

  try {
    // Process input to generate menu
    const processedMenu = await processMenuInput(input, geminiApiKey)
    
    // Get existing items from database for similarity matching
    const existingItems = await getExistingItems(supabaseClient, request.location_id)
    
    // Generate suggestions by comparing with existing items
    const suggestions = await generateSuggestions(processedMenu.items, existingItems)

    return new Response(
      JSON.stringify({
        success: true,
        action: 'generate',
        message: `Menu generated successfully for ${location.name}`,
        input_type: input.type,
        stats: {
          generated_items: processedMenu.items.length,
          existing_items: existingItems.length,
          suggestions: suggestions.length,
          categories: processedMenu.categories.length
        },
        suggestions: suggestions,
        categories: processedMenu.categories
      }),
      { 
        headers: { 
          ...corsHeaders, 
          'Content-Type': 'application/json' 
        } 
      }
    )

  } catch (error) {
    console.error('Error in handleGenerateRequest:', error)
    
    // Handle specific error types
    if (error.message?.includes('Gemini API error')) {
    return new Response(
      JSON.stringify({ 
        success: false, 
          error: 'AI service is temporarily unavailable. Please try again in a few moments.',
          error_code: 'AI_SERVICE_ERROR'
        }),
        { 
          status: 503, 
          headers: { 
            ...corsHeaders, 
            'Content-Type': 'application/json' 
          } 
        }
      )
    }

    if (error.message?.includes('Failed to parse menu data')) {
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: 'Unable to process the menu content. Please try with clearer images or better formatted text.',
          error_code: 'PROCESSING_ERROR'
      }),
      { 
        status: 400, 
        headers: { 
          ...corsHeaders, 
          'Content-Type': 'application/json' 
        } 
      }
    )
  }

    return new Response(
      JSON.stringify({ 
        success: false, 
        error: 'Failed to generate menu. Please try again.',
        error_code: 'GENERATION_ERROR'
      }),
      { 
        status: 500, 
        headers: { 
          ...corsHeaders, 
          'Content-Type': 'application/json' 
        } 
      }
    )
  }
}

async function handleConfirmRequest(request: ConfirmRequest, supabaseClient: any, location: any) {
  const { decisions } = request
  
  // Basic input validation only
  if (!decisions) {
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: 'No decisions provided',
        error_code: 'MISSING_DECISIONS'
      }),
      { 
        status: 400, 
        headers: { 
          ...corsHeaders, 
          'Content-Type': 'application/json' 
        } 
      }
    )
  }

  if (!Array.isArray(decisions)) {
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: 'Decisions must be an array',
        error_code: 'INVALID_DECISIONS_FORMAT'
      }),
      { 
        status: 400, 
        headers: { 
          ...corsHeaders, 
          'Content-Type': 'application/json' 
        } 
      }
    )
  }

  if (decisions.length === 0) {
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: 'No decisions provided',
        error_code: 'EMPTY_DECISIONS'
      }),
      { 
        status: 400, 
        headers: { 
          ...corsHeaders, 
          'Content-Type': 'application/json' 
        } 
      }
    )
  }

  try {
    // Process each decision and collect detailed results (no upfront validation)
    const results = await processUserDecisionsWithValidation(supabaseClient, request.location_id, decisions)

    // Determine overall success - succeed if at least one item was processed successfully
    const hasSuccessful = results.successful_items.length > 0
    const hasFailures = results.failed_items.length > 0

    return new Response(
      JSON.stringify({
        success: true, // Always return success if we can process the request
        action: 'confirm',
        message: hasFailures 
          ? `Menu partially updated for ${location.name}. ${results.failed_items.length} items failed validation.`
          : `Menu updated successfully for ${location.name}`,
        has_failures: hasFailures,
        stats: {
          items_updated: results.itemsUpdated,
          items_created: results.itemsCreated,
          items_skipped: results.itemsSkipped,
          items_failed: results.failed_items.length,
          items_successful: results.successful_items.length,
          categories_created: results.categoriesCreated,
          variations_created: results.variationsCreated
        },
        successful_items: results.successful_items,
        failed_items: results.failed_items,
        results: results
      }),
      { 
        headers: { 
          ...corsHeaders, 
          'Content-Type': 'application/json' 
        } 
      }
    )

  } catch (error) {
    console.error('Error in handleConfirmRequest:', error)
    
    // Handle specific database errors
    if (error.message?.includes('permission')) {
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: 'Permission denied. Please check your access rights.',
          error_code: 'PERMISSION_DENIED'
        }),
        { 
          status: 403, 
          headers: { 
            ...corsHeaders, 
            'Content-Type': 'application/json' 
          } 
        }
      )
    }

    if (error.message?.includes('connection') || error.message?.includes('timeout')) {
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: 'Database connection failed. Please try again.',
          error_code: 'DATABASE_CONNECTION_ERROR'
        }),
        { 
          status: 503, 
          headers: { 
            ...corsHeaders, 
            'Content-Type': 'application/json' 
          } 
        }
      )
    }

    return new Response(
      JSON.stringify({ 
        success: false, 
        error: 'Failed to update menu. Please try again.',
        error_code: 'UPDATE_ERROR'
      }),
      { 
        status: 500, 
        headers: { 
          ...corsHeaders, 
          'Content-Type': 'application/json' 
        } 
      }
    )
  }
}

async function getExistingItems(supabaseClient: any, locationId: string): Promise<ExistingItem[]> {
  const { data, error } = await supabaseClient
    .from('items')
    .select(`
      id,
      name,
      description,
      price,
      preparation_time,
      category_id,
      categories!inner(name, parent_id),
      item_variations(
        id,
        name,
        is_required,
        item_variation_options(
          id,
          name,
          price_modifier,
          is_default
        )
      )
    `)
    .eq('location_id', locationId)
    .eq('is_active', true)

  if (error) {
    console.error('Error fetching existing items:', error)
    return []
  }

  return data?.map((item: any) => ({
    id: item.id,
    name: item.name,
    description: item.description || '',
    price: item.price,
    category_id: item.category_id,
    category_name: item.categories.name,
    category_path: [item.categories.name], // Simplified - would need recursive logic for full path
    preparation_time: item.preparation_time,
    variations: item.item_variations || []
  })) || []
}

async function generateSuggestions(generatedItems: MenuItem[], existingItems: ExistingItem[]): Promise<ItemSuggestion[]> {
  const suggestions: ItemSuggestion[] = []

  for (const genItem of generatedItems) {
    const similarItems: SimilarityMatch[] = []
    
    for (const existingItem of existingItems) {
      const similarity = calculateSimilarity(genItem, existingItem)
      
      if (similarity.similarity_score >= 0.6) { // 60% threshold for consideration
        similarItems.push(similarity)
      }
    }

    // Sort by similarity score (highest first)
    similarItems.sort((a, b) => b.similarity_score - a.similarity_score)

    // Generate recommendation
    const recommendation = getRecommendation(genItem, similarItems)
    
    suggestions.push({
      generated_item: genItem,
      similar_items: similarItems.slice(0, 3), // Top 3 matches
      recommendation: recommendation.action,
      recommendation_reason: recommendation.reason
    })
  }

  return suggestions
}

function calculateSimilarity(genItem: MenuItem, existingItem: ExistingItem): SimilarityMatch {
  let score = 0
  const differences: string[] = []
  const reasons: string[] = []

  // Name similarity (most important - 50% weight)
  const nameSimilarity = calculateStringSimilarity(genItem.name, existingItem.name)
  score += nameSimilarity * 0.5
  
  if (nameSimilarity > 0.7) {
    reasons.push(`Name similarity: ${Math.round(nameSimilarity * 100)}%`)
  }
  
  if (genItem.name.toLowerCase() !== existingItem.name.toLowerCase()) {
    differences.push('name')
  }

  // Category similarity (20% weight)
  const categoryMatch = genItem.category_path.some(cat => 
    existingItem.category_path.some(existCat => 
      calculateStringSimilarity(cat, existCat) > 0.8
    )
  )
  
  if (categoryMatch) {
    score += 0.2
    reasons.push('Category match')
  } else {
    differences.push('category')
  }

  // Price similarity (20% weight)
  const priceDiff = Math.abs(genItem.price - existingItem.price) / Math.max(genItem.price, existingItem.price)
  const priceSimilarity = Math.max(0, 1 - priceDiff)
  score += priceSimilarity * 0.2
  
  if (priceSimilarity > 0.8) {
    reasons.push(`Price similarity: ${Math.round(priceSimilarity * 100)}%`)
  }
  
  if (Math.abs(genItem.price - existingItem.price) > 0.01) {
    differences.push('price')
  }

  // Description similarity (10% weight)
  if (genItem.description && existingItem.description) {
    const descSimilarity = calculateStringSimilarity(genItem.description, existingItem.description)
    score += descSimilarity * 0.1
    
    if (descSimilarity > 0.6) {
      reasons.push(`Description similarity: ${Math.round(descSimilarity * 100)}%`)
    }
    
    if (genItem.description !== existingItem.description) {
      differences.push('description')
    }
  }

    return {
    existing_item: existingItem,
    similarity_score: score,
    differences,
    reasons
  }
}

function calculateStringSimilarity(str1: string, str2: string): number {
  // Simple Levenshtein distance implementation
  const s1 = str1.toLowerCase().trim()
  const s2 = str2.toLowerCase().trim()
  
  if (s1 === s2) return 1
  
  const matrix: number[][] = []
  
  for (let i = 0; i <= s2.length; i++) {
    matrix[i] = [i]
  }
  
  for (let j = 0; j <= s1.length; j++) {
    matrix[0][j] = j
  }
  
  for (let i = 1; i <= s2.length; i++) {
    for (let j = 1; j <= s1.length; j++) {
      if (s2.charAt(i - 1) === s1.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1]
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        )
      }
    }
  }
  
  const distance = matrix[s2.length][s1.length]
  const maxLength = Math.max(s1.length, s2.length)
  
  return maxLength === 0 ? 1 : (maxLength - distance) / maxLength
}

function getRecommendation(genItem: MenuItem, similarItems: SimilarityMatch[]): { action: 'update' | 'create_new' | 'skip', reason: string } {
  if (similarItems.length === 0) {
    return {
      action: 'create_new',
      reason: 'No similar items found'
    }
  }

  const bestMatch = similarItems[0]
  
  if (bestMatch.similarity_score >= 0.9) {
    return {
      action: 'update',
      reason: `Very similar to "${bestMatch.existing_item.name}" (${Math.round(bestMatch.similarity_score * 100)}% match)`
    }
  }
  
  if (bestMatch.similarity_score >= 0.75) {
    return {
      action: 'update',
      reason: `Similar to "${bestMatch.existing_item.name}" (${Math.round(bestMatch.similarity_score * 100)}% match) - consider updating`
    }
  }
  
  return {
    action: 'create_new',
    reason: `Low similarity to existing items (best match: ${Math.round(bestMatch.similarity_score * 100)}%)`
  }
}

async function processUserDecisionsWithValidation(supabaseClient: any, locationId: string, decisions: UserDecision[]) {
  let itemsUpdated = 0
  let itemsCreated = 0
  let itemsSkipped = 0
  let categoriesCreated = 0
  let variationsCreated = 0

  const successful_items: UserDecision[] = []
  const failed_items: UserDecision[] = []

  // Create categories first
  const categoryMap = new Map<string, string>()
  const categoriesNeeded = new Set<string>()
  
  for (const decision of decisions) {
    if (decision.action !== 'skip') {
      // Fix: Use the same logic as below to properly get the item
      const hasModifications = decision.modifications && Object.keys(decision.modifications).length > 0
      const item = hasModifications 
        ? { ...decision.generated_item, ...decision.modifications }
        : decision.generated_item
      
      if (item.category_path) {
        for (const categoryPath of item.category_path) {
          categoriesNeeded.add(categoryPath)
        }
      }
    }
  }

  // Create categories that don't exist
  for (const categoryName of categoriesNeeded) {
    const { data: existingCategory } = await supabaseClient
      .from('categories')
      .select('id')
      .eq('location_id', locationId)
      .eq('name', categoryName)
      .single()

    if (existingCategory) {
      categoryMap.set(categoryName, existingCategory.id)
    } else {
      const { data: newCategory, error } = await supabaseClient
        .from('categories')
        .insert({
          location_id: locationId,
          name: categoryName,
          is_active: true,
          sort_order: categoriesCreated
        })
        .select('id')
        .single()

      if (!error && newCategory) {
        categoryMap.set(categoryName, newCategory.id)
        categoriesCreated++
      }
    }
  }

  // Process each decision
  for (const decision of decisions) {
    try {
      if (decision.action === 'skip') {
        itemsSkipped++
        successful_items.push(decision)
        continue
      }

      // Fix: Properly merge modifications with generated_item
      // Only use modifications if it has actual properties
      const hasModifications = decision.modifications && Object.keys(decision.modifications).length > 0
      const item = hasModifications 
        ? { ...decision.generated_item, ...decision.modifications }
        : decision.generated_item
      
      // Validate item data
      if (!item.name || item.name.trim() === '') {
        console.error(`Item has invalid name: ${JSON.stringify(item)}`)
        failed_items.push(decision)
        continue
      }
      
      if (item.price === null || item.price === undefined || isNaN(item.price)) {
        console.error(`Item "${item.name}" has invalid price: ${item.price}`)
        failed_items.push(decision)
        continue
      }
      
      if (!item.category_path || item.category_path.length === 0) {
        console.error(`No category path for item: ${item.name}`)
        failed_items.push(decision)
        continue
      }

      const categoryId = categoryMap.get(item.category_path[item.category_path.length - 1])
      
      if (!categoryId) {
        console.error(`Category not found for item: ${item.name}`)
        failed_items.push(decision)
        continue
      }

      if (decision.action === 'update' && decision.existing_item_id) {
        // Update existing item
        const { error } = await supabaseClient
          .from('items')
          .update({
            name: item.name,
            description: item.description,
            price: item.price,
            preparation_time: item.preparation_time || 15,
            category_id: categoryId
          })
          .eq('id', decision.existing_item_id)

        if (!error) {
          itemsUpdated++
          successful_items.push(decision)
          
          // Handle variations update (simplified - would need more complex logic)
          if (item.variations) {
            variationsCreated += item.variations.length
          }
        } else {
          console.error(`Failed to update item ${item.name} (ID: ${decision.existing_item_id}):`, error)
          failed_items.push(decision)
        }
      } else if (decision.action === 'create_new') {
        // Create new item
        const { data: newItem, error } = await supabaseClient
          .from('items')
          .insert({
            location_id: locationId,
            category_id: categoryId,
            name: item.name,
            description: item.description,
            price: item.price,
            preparation_time: item.preparation_time || 15,
            is_active: true,
            sort_order: itemsCreated
          })
          .select('id')
          .single()

        if (!error && newItem) {
          itemsCreated++
          successful_items.push(decision)
          
          // Create variations
          if (item.variations) {
            for (const variation of item.variations) {
              const { data: newVariation, error: varError } = await supabaseClient
                .from('item_variations')
                .insert({
                  item_id: newItem.id,
                  name: variation.name,
                  is_required: variation.is_required
                })
                .select('id')
                .single()

              if (!varError && newVariation) {
                variationsCreated++
                
                // Create variation options
                for (const option of variation.options) {
                  await supabaseClient
                    .from('item_variation_options')
                    .insert({
                      variation_id: newVariation.id,
                      name: option.name,
                      price_modifier: option.price_modifier,
                      is_default: option.is_default
                    })
                }
              }
            }
          }
        } else {
          console.error(`Failed to create new item ${item.name}:`, error)
          failed_items.push(decision)
        }
      }
    } catch (error) {
      console.error(`Error processing decision for item ${decision.generated_item.name}:`, error)
      failed_items.push(decision)
    }
  }

  return {
    itemsUpdated,
    itemsCreated,
    itemsSkipped,
    categoriesCreated,
    variationsCreated,
    successful_items,
    failed_items
  }
}

async function processMenuInput(input: MenuInput, apiKey: string): Promise<ProcessedMenu> {
  switch (input.type) {
    case 'images':
      return await processMenuImages(
        Array.isArray(input.content) ? input.content : [input.content], 
        apiKey,
        input.additional_text
      )
    case 'text':
      return await processMenuText(input.content as string, apiKey)
    case 'pdf':
      return await processMenuPDF(input.content as string, apiKey)
    default:
      throw new Error(`Unsupported input type: ${input.type}`)
  }
}

async function processMenuText(textContent: string, apiKey: string): Promise<ProcessedMenu> {
  const geminiUrl = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent'

  const prompt = `
    Analyze this menu text and extract a comprehensive menu structure. The text content is:

    "${textContent}"
    
    Return a JSON object with the following structure:
    {
      "categories": [
        {
          "name": "Category Name",
          "description": "Optional description",
          "subcategories": [
            {
              "name": "Subcategory Name",
              "description": "Optional description",
              "items": []
            }
          ],
          "items": [
            {
              "name": "Item Name",
              "description": "Item description",
              "price": 0.00,
              "category_path": ["Main Category", "Subcategory"],
              "preparation_time": 15,
              "variations": [
                {
                  "name": "Size",
                  "is_required": true,
                  "options": [
                    {
                      "name": "Small",
                      "price_modifier": 0.00,
                      "is_default": true
                    },
                    {
                      "name": "Large",
                      "price_modifier": 5.00,
                      "is_default": false
                    }
                  ]
                }
              ]
            }
          ]
        }
      ]
    }

    Guidelines:
    1. Create logical category hierarchies
    2. Extract accurate prices in decimal format
    3. Include item descriptions when available
    4. Identify variations like sizes, toppings, spice levels
    5. Set reasonable preparation times (10-45 minutes)
    6. Use clear, consistent naming
    7. Handle multiple currencies if present
    8. Create subcategories for better organization
    9. Include allergen information in descriptions if visible
    10. Maintain original menu structure where possible

    Return only valid JSON, no additional text.
  `

  const requestBody = {
    contents: [
      {
        parts: [
          { text: prompt }
        ]
      }
    ],
    generationConfig: {
      temperature: 0.1,
      topK: 32,
      topP: 1,
      maxOutputTokens: 8192
    }
  }

  return await makeGeminiRequest(geminiUrl, apiKey, requestBody)
}

async function processMenuPDF(base64Content: string, apiKey: string): Promise<ProcessedMenu> {
  const geminiUrl = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent'
  
  // Remove data:application/pdf;base64, prefix if present
  const base64Data = base64Content.replace(/^data:application\/pdf;base64,/, '')
  
  const prompt = `
    Analyze this PDF menu document and extract a comprehensive menu structure.
    
    Return a JSON object with the following structure:
    {
      "categories": [
        {
          "name": "Category Name",
          "description": "Optional description",
          "subcategories": [
            {
              "name": "Subcategory Name",
              "description": "Optional description",
              "items": []
            }
          ],
          "items": [
            {
              "name": "Item Name",
              "description": "Item description",
              "price": 0.00,
              "category_path": ["Main Category", "Subcategory"],
              "preparation_time": 15,
              "variations": [
                {
                  "name": "Size",
                  "is_required": true,
                  "options": [
                    {
                      "name": "Small",
                      "price_modifier": 0.00,
                      "is_default": true
                    },
                    {
                      "name": "Large",
                      "price_modifier": 5.00,
                      "is_default": false
                    }
                  ]
                }
              ]
            }
          ]
        }
      ]
    }

    Guidelines:
    1. Create logical category hierarchies
    2. Extract accurate prices in South African Rand (R) format
    3. Include item descriptions when available
    4. Identify variations like sizes, toppings, spice levels
    5. Set reasonable preparation times (10-45 minutes)
    6. Use clear, consistent naming
    7. Create subcategories for better organization
    8. Include allergen information in descriptions if visible
    9. Maintain original menu structure where possible

    Return only valid JSON, no additional text.
  `

  const requestBody = {
    contents: [
      {
        parts: [
          {
            inline_data: {
              mime_type: "application/pdf",
              data: base64Data
            }
          },
          { text: prompt }
        ]
      }
    ],
    generationConfig: {
      temperature: 0.1,
      topK: 32,
      topP: 1,
      maxOutputTokens: 8192
    }
  }

  return await makeGeminiRequest(geminiUrl, apiKey, requestBody)
}

async function makeGeminiRequest(url: string, apiKey: string, requestBody: any): Promise<ProcessedMenu> {
  const response = await fetch(`${url}?key=${apiKey}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(requestBody)
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Gemini API error: ${response.status} - ${errorText}`)
  }

  const result = await response.json()
  
  if (!result.candidates || result.candidates.length === 0) {
    throw new Error('No response from Gemini AI')
  }

  const content = result.candidates[0].content.parts[0].text
  
  try {
    // Clean the response (remove markdown formatting if present)
    const cleanContent = content.replace(/```json\n?|\n?```/g, '').trim()
    const menuData = JSON.parse(cleanContent)
    
    // Validate the structure
    if (!menuData.categories || !Array.isArray(menuData.categories)) {
      throw new Error('Invalid menu structure: categories array missing')
    }

    // Flatten items from nested categories
    const allItems: MenuItem[] = []
    flattenMenuItems(menuData.categories, allItems)

    return {
      categories: menuData.categories,
      items: allItems
    }
  } catch (parseError) {
    console.error('Failed to parse Gemini response:', content)
    throw new Error(`Failed to parse menu data: ${parseError.message}`)
  }
}

async function processMenuImages(images: string[], apiKey: string, additionalText?: string): Promise<ProcessedMenu> {
  const geminiUrl = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent'
  
  // Prepare images for Gemini (convert base64 to proper format)
  const imageParts = images.map(image => {
    // Remove data:image/jpeg;base64, prefix if present
    const base64Data = image.replace(/^data:image\/[a-z]+;base64,/, '')
    // Detect mime type from the data URL or default to jpeg
    const mimeType = image.match(/^data:image\/([a-z]+);base64,/) ? 
      `image/${image.match(/^data:image\/([a-z]+);base64,/)![1]}` : 
      "image/jpeg"
    
    return {
      inline_data: {
        mime_type: mimeType,
        data: base64Data
      }
    }
  })

  let prompt = `
    Analyze these menu images and extract a comprehensive menu structure.`

  if (additionalText) {
    prompt += `
    
    Additional context provided by the user:
    "${additionalText}"
    
    Use this text to supplement and clarify the information you extract from the images.`
  }

  prompt += `
    
    Return a JSON object with the following structure:

    {
      "categories": [
        {
          "name": "Category Name",
          "description": "Optional description",
          "subcategories": [
            {
              "name": "Subcategory Name",
              "description": "Optional description",
              "items": []
            }
          ],
          "items": [
            {
              "name": "Item Name",
              "description": "Item description",
              "price": 0.00,
              "category_path": ["Main Category", "Subcategory"],
              "preparation_time": 15,
              "variations": [
                {
                  "name": "Size",
                  "is_required": true,
                  "options": [
                    {
                      "name": "Small",
                      "price_modifier": 0.00,
                      "is_default": true
                    },
                    {
                      "name": "Large",
                      "price_modifier": 5.00,
                      "is_default": false
                    }
                  ]
                }
              ]
            }
          ]
        }
      ]
    }

    Guidelines:
    1. Create logical category hierarchies (e.g., "Mains" > "Pizza", "Beverages" > "Hot Drinks")
    2. Extract accurate prices in decimal format
    3. Include item descriptions when available
    4. Identify variations like sizes, toppings, spice levels
    5. Set reasonable preparation times (10-45 minutes)
    6. Use clear, consistent naming
    7. Handle multiple currencies if present
    8. Create subcategories for better organization
    9. Include allergen information in descriptions if visible
    10. Maintain original menu structure where possible

    Return only valid JSON, no additional text.
  `

  const requestBody = {
    contents: [
      {
        parts: [
          { text: prompt },
          ...imageParts
        ]
      }
    ],
    generationConfig: {
      temperature: 0.1,
      topK: 32,
      topP: 1,
      maxOutputTokens: 8192
    }
  }

  return await makeGeminiRequest(geminiUrl, apiKey, requestBody)
}

function flattenMenuItems(categories: MenuCategory[], items: MenuItem[], parentPath: string[] = []): void {
  for (const category of categories) {
    const currentPath = [...parentPath, category.name]
    
    // Add items from this category
    if (category.items) {
      for (const item of category.items) {
        items.push({
          ...item,
          category_path: item.category_path || currentPath
        })
      }
    }
    
    // Recursively process subcategories
    if (category.subcategories) {
      flattenMenuItems(category.subcategories, items, currentPath)
    }
  }
}

async function createMenuInDatabase(supabaseClient: any, locationId: string, menu: ProcessedMenu) {
  let categoriesCreated = 0
  let itemsCreated = 0
  let variationsCreated = 0

  // Create categories hierarchy
  const categoryMap = new Map<string, string>() // path -> category_id
  
  async function createCategoriesRecursive(categories: MenuCategory[], parentId: string | null = null, parentPath: string[] = []) {
    for (const category of categories) {
      const currentPath = [...parentPath, category.name]
      const pathKey = currentPath.join(' > ')
      
      // Check if category already exists
      let existingCategory = await supabaseClient
        .from('categories')
        .select('id')
        .eq('location_id', locationId)
        .eq('name', category.name)
        .eq('parent_id', parentId)
        .single()

      let categoryId: string

      if (existingCategory.data) {
        categoryId = existingCategory.data.id
        console.log(`Category already exists: ${category.name}`)
      } else {
        // Create new category
        const { data: newCategory, error: categoryError } = await supabaseClient
          .from('categories')
          .insert({
            location_id: locationId,
            parent_id: parentId,
            name: category.name,
            description: category.description || null,
            sort_order: categoriesCreated,
            is_active: true
          })
          .select('id')
          .single()

        if (categoryError) {
          console.error('Error creating category:', categoryError)
          throw new Error(`Failed to create category: ${category.name}`)
        }

        categoryId = newCategory.id
        categoriesCreated++
        console.log(`Created category: ${category.name}`)
      }

      categoryMap.set(pathKey, categoryId)

      // Recursively create subcategories
      if (category.subcategories) {
        await createCategoriesRecursive(category.subcategories, categoryId, currentPath)
      }
    }
  }

  // Create all categories
  await createCategoriesRecursive(menu.categories)

  // Create items
  for (const item of menu.items) {
    try {
      const categoryPath = item.category_path.join(' > ')
      const categoryId = categoryMap.get(categoryPath)
      
      if (!categoryId) {
        console.error(`Category not found for item ${item.name}: ${categoryPath}`)
        continue
      }

      // Check if item already exists
      const existingItem = await supabaseClient
        .from('items')
        .select('id')
        .eq('location_id', locationId)
        .eq('category_id', categoryId)
        .eq('name', item.name)
        .single()

      let itemId: string

      if (existingItem.data) {
        itemId = existingItem.data.id
        console.log(`Item already exists: ${item.name}`)
      } else {
        // Create new item
        const { data: newItem, error: itemError } = await supabaseClient
          .from('items')
          .insert({
            location_id: locationId,
            category_id: categoryId,
            name: item.name,
            description: item.description || null,
            price: item.price,
            preparation_time: item.preparation_time || 15,
            is_active: true,
            sort_order: itemsCreated
          })
          .select('id')
          .single()

        if (itemError) {
          console.error('Error creating item:', itemError)
          continue
        }

        itemId = newItem.id
        itemsCreated++
        console.log(`Created item: ${item.name}`)
      }

      // Create variations if they exist
      if (item.variations) {
        for (const variation of item.variations) {
          const { data: newVariation, error: variationError } = await supabaseClient
            .from('item_variations')
            .insert({
              item_id: itemId,
              name: variation.name,
              is_required: variation.is_required
            })
            .select('id')
            .single()

          if (variationError) {
            console.error('Error creating variation:', variationError)
            continue
          }

          variationsCreated++

          // Create variation options
          for (const option of variation.options) {
            await supabaseClient
              .from('item_variation_options')
              .insert({
                variation_id: newVariation.id,
                name: option.name,
                price_modifier: option.price_modifier,
                is_default: option.is_default
              })
          }
        }
      }

    } catch (error) {
      console.error(`Error processing item ${item.name}:`, error)
      continue
    }
  }

  return {
    categoriesCreated,
    itemsCreated,
    variationsCreated,
    categories: menu.categories,
    items: menu.items
  }
}