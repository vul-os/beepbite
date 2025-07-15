/**
 * PayStack API utility functions for order payments
 */

declare const Deno: any;

export interface PaymentCalculation {
  order_total_cents: number;
  driver_tip_cents: number;
  processing_fee_cents: number;
  gateway_fee_cents: number;
  platform_fee_cents: number;
  total_amount_cents: number;
  merchant_amount_cents: number;
}

export interface PaymentResult {
  success: boolean;
  error?: string;
  payment_method: 'existing' | 'new_card';
  transaction_id?: string;
  payment_link?: string;
  authorization_url?: string;
  reference?: string;
  amount_cents: number;
  calculation: PaymentCalculation;
}

export interface OrderPaymentData {
  order_id: string;
  customer_id: string;
  location_id: string;
  total_amount_cents: number;
  driver_tip_cents: number;
  customer_email: string;
  customer_phone?: string;
  customer_name?: string;
}

export interface SavedPaymentMethod {
  id: string;
  authorization_code: string;
  gateway_provider: string;
  customer_id: string;
  payment_method_code: string;
  card_last_four?: string;
  card_type?: string;
}

/**
 * Calculate total payment amount including fees
 * @param order_total_cents - Order total in cents
 * @param driver_tip_cents - Driver tip in cents
 * @param location_id - Location ID for fee calculation
 * @returns PaymentCalculation - Detailed fee breakdown
 */
export async function calculatePaymentAmount(
  order_total_cents: number,
  driver_tip_cents: number,
  location_id: string
): Promise<PaymentCalculation> {
  try {
    // For PayStack, we'll use the 'paystack' payment method code
    const base_amount_cents = order_total_cents + driver_tip_cents;
    
    // Default PayStack fees (can be overridden by location-specific fees)
    // PayStack charges 1.5% + NGN 100 (or equivalent)
    // We'll assume 3.1% + R1 as shown in the SQL example
    const gateway_fee_percentage = 3.1;
    const gateway_fixed_fee_cents = 100; // R1 in cents
    
    // Calculate gateway fees
    const gateway_fee_cents = gateway_fixed_fee_cents + 
      Math.round(base_amount_cents * gateway_fee_percentage / 100);
    
    // Platform processing fee (what we charge merchant)
    const processing_fee_percentage = 0.65;
    const processing_fixed_fee_cents = 100; // R1 in cents
    
    const processing_fee_cents = processing_fixed_fee_cents + 
      Math.round(base_amount_cents * processing_fee_percentage / 100);
    
    // Platform keeps the difference
    const platform_fee_cents = Math.max(0, processing_fee_cents - gateway_fee_cents);
    
    // Total amount customer pays (includes fees)
    const total_amount_cents = base_amount_cents + processing_fee_cents;
    
    // Merchant receives order total minus our processing fee
    const merchant_amount_cents = base_amount_cents - processing_fee_cents;
    
    return {
      order_total_cents,
      driver_tip_cents,
      processing_fee_cents,
      gateway_fee_cents,
      platform_fee_cents,
      total_amount_cents,
      merchant_amount_cents
    };
    
  } catch (error) {
    console.error('Error calculating payment amount:', error);
    throw new Error(`Payment calculation failed: ${error}`);
  }
}

/**
 * Charge an existing saved payment method
 * @param authorization_code - PayStack authorization code
 * @param amount_cents - Amount to charge in cents
 * @param reference - Unique payment reference
 * @param customer_email - Customer email
 * @returns PayStack charge response
 */
async function chargeExistingPaymentMethod(
  authorization_code: string,
  amount_cents: number,
  reference: string,
  customer_email: string
): Promise<any> {
  const apiKey = Deno.env.get('PAYSTACK_SECRET_KEY') ?? '';
  
  if (!apiKey) {
    throw new Error('PayStack secret key not found in environment variables');
  }

  const response = await fetch('https://api.paystack.co/transaction/charge_authorization', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      authorization_code,
      email: customer_email,
      amount: amount_cents, // PayStack expects amount in kobo (cents)
      reference,
      currency: 'ZAR' // South African Rand
    }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => null);
    throw new Error(`PayStack charge failed: ${errorData?.message || response.status}`);
  }

  return await response.json();
}

/**
 * Generate a new payment link for card payments
 * @param amount_cents - Amount in cents
 * @param reference - Unique payment reference
 * @param customer_email - Customer email
 * @param customer_name - Customer name
 * @param callback_url - URL to redirect after payment
 * @returns PayStack payment link response
 */
async function generatePaymentLink(
  amount_cents: number,
  reference: string,
  customer_email: string,
  customer_name?: string,
  callback_url?: string
): Promise<any> {
  const apiKey = Deno.env.get('PAYSTACK_SECRET_KEY') ?? '';
  
  if (!apiKey) {
    throw new Error('PayStack secret key not found in environment variables');
  }

  const response = await fetch('https://api.paystack.co/transaction/initialize', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email: customer_email,
      amount: amount_cents,
      reference,
      currency: 'ZAR',
      callback_url: callback_url || `${Deno.env.get('FRONTEND_URL') ?? ''}/payment-success`,
      metadata: {
        customer_name,
        payment_type: 'order_payment'
      },
      channels: ['card'], // Only allow card payments
      plan: null // One-time payment
    }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => null);
    throw new Error(`PayStack initialization failed: ${errorData?.message || response.status}`);
  }

  return await response.json();
}

/**
 * Get order payment data from database
 * @param order_id - Order ID
 * @returns Order payment data
 */
async function getOrderPaymentData(order_id: string): Promise<OrderPaymentData> {
  // This would typically query your Supabase database
  // For now, I'll create a placeholder that you can replace with actual DB queries
  
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  
  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Supabase configuration not found');
  }

  const response = await fetch(`${supabaseUrl}/rest/v1/orders?id=eq.${order_id}&select=*,customers(email,phone,name),locations(id)`, {
    headers: {
      'Authorization': `Bearer ${supabaseKey}`,
      'apikey': supabaseKey,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch order data: ${response.status}`);
  }

  const orders = await response.json();
  
  if (!orders || orders.length === 0) {
    throw new Error('Order not found');
  }

  const order = orders[0];
  
  return {
    order_id: order.id,
    customer_id: order.customer_id,
    location_id: order.location_id,
    total_amount_cents: Math.round(order.total_amount * 100), // Convert to cents
    driver_tip_cents: Math.round((order.driver_tip || 0) * 100),
    customer_email: order.customers.email,
    customer_phone: order.customers.phone,
    customer_name: order.customers.name
  };
}

/**
 * Get saved payment method details
 * @param customer_payment_authorization_id - Authorization ID
 * @returns Saved payment method details
 */
async function getSavedPaymentMethod(customer_payment_authorization_id: string): Promise<SavedPaymentMethod> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  
  const response = await fetch(`${supabaseUrl}/rest/v1/customer_payment_authorizations?id=eq.${customer_payment_authorization_id}&is_active=eq.true&select=*`, {
    headers: {
      'Authorization': `Bearer ${supabaseKey}`,
      'apikey': supabaseKey,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch payment method: ${response.status}`);
  }

  const methods = await response.json();
  
  if (!methods || methods.length === 0) {
    throw new Error('Payment method not found or inactive');
  }

  return methods[0];
}

/**
 * Generate unique payment reference
 * @param order_id - Order ID
 * @returns Unique reference string
 */
function generatePaymentReference(order_id: string): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  return `beepbite_${order_id}_${timestamp}_${random}`;
}

/**
 * Main payment processing function
 * @param order_id - Order ID to process payment for
 * @param customer_payment_authorization_id - Optional saved payment method ID
 * @returns PaymentResult - Payment processing result
 */
export async function processOrderPayment(
  order_id: string,
  customer_payment_authorization_id?: string
): Promise<PaymentResult> {
  try {
    // Get order data
    const orderData = await getOrderPaymentData(order_id);
    
    // Calculate payment amount including fees
    const calculation = await calculatePaymentAmount(
      orderData.total_amount_cents,
      orderData.driver_tip_cents,
      orderData.location_id
    );
    
    // Generate unique reference
    const reference = generatePaymentReference(order_id);
    
    // If saved payment method provided, try to charge it first
    if (customer_payment_authorization_id) {
      try {
        const savedMethod = await getSavedPaymentMethod(customer_payment_authorization_id);
        
        // Verify the payment method belongs to the customer
        if (savedMethod.customer_id !== orderData.customer_id) {
          throw new Error('Payment method does not belong to customer');
        }
        
        // Attempt to charge the saved payment method
        const chargeResult = await chargeExistingPaymentMethod(
          savedMethod.authorization_code,
          calculation.total_amount_cents,
          reference,
          orderData.customer_email
        );
        
        if (chargeResult.status === 'success') {
          console.log('Successfully charged existing payment method:', chargeResult.data.reference);
          
          return {
            success: true,
            payment_method: 'existing',
            transaction_id: chargeResult.data.id,
            reference: chargeResult.data.reference,
            amount_cents: calculation.total_amount_cents,
            calculation
          };
        } else {
          console.log('Existing payment method charge failed, falling back to new card');
          // Fall through to new card payment
        }
        
      } catch (error) {
        console.error('Error charging existing payment method:', error);
        console.log('Falling back to new card payment');
        // Fall through to new card payment
      }
    }
    
    // Generate new payment link for card payment
    const paymentLink = await generatePaymentLink(
      calculation.total_amount_cents,
      reference,
      orderData.customer_email,
      orderData.customer_name
    );
    
    if (paymentLink.status === 'success') {
      console.log('Generated new payment link:', paymentLink.data.reference);
      
      return {
        success: true,
        payment_method: 'new_card',
        payment_link: paymentLink.data.access_code,
        authorization_url: paymentLink.data.authorization_url,
        reference: paymentLink.data.reference,
        amount_cents: calculation.total_amount_cents,
        calculation
      };
    } else {
      throw new Error(`Payment link generation failed: ${paymentLink.message}`);
    }
    
  } catch (error) {
    const errorMessage = `Payment processing failed: ${error}`;
    console.error(errorMessage);
    
    return {
      success: false,
      error: errorMessage,
      payment_method: customer_payment_authorization_id ? 'existing' : 'new_card',
      amount_cents: 0,
      calculation: {
        order_total_cents: 0,
        driver_tip_cents: 0,
        processing_fee_cents: 0,
        gateway_fee_cents: 0,
        platform_fee_cents: 0,
        total_amount_cents: 0,
        merchant_amount_cents: 0
      }
    };
  }
}

/**
 * Verify PayStack transaction status
 * @param reference - PayStack transaction reference
 * @returns Transaction verification result
 */
export async function verifyPayStackTransaction(reference: string): Promise<any> {
  const apiKey = Deno.env.get('PAYSTACK_SECRET_KEY') ?? '';
  
  if (!apiKey) {
    throw new Error('PayStack secret key not found in environment variables');
  }

  const response = await fetch(`https://api.paystack.co/transaction/verify/${reference}`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => null);
    throw new Error(`PayStack verification failed: ${errorData?.message || response.status}`);
  }

  return await response.json();
}

/**
 * Save new payment authorization for future use
 * @param customer_id - Customer ID
 * @param authorization_code - PayStack authorization code
 * @param card_details - Card details from PayStack
 * @returns Success status
 */
export async function savePaymentAuthorization(
  customer_id: string,
  authorization_code: string,
  card_details: any
): Promise<boolean> {
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    
    const response = await fetch(`${supabaseUrl}/rest/v1/customer_payment_authorizations`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${supabaseKey}`,
        'apikey': supabaseKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        customer_id,
        payment_method_code: 'paystack',
        gateway_provider: 'paystack',
        authorization_code,
        card_last_four: card_details.last4,
        card_type: card_details.card_type,
        card_exp_month: card_details.exp_month,
        card_exp_year: card_details.exp_year,
        is_active: true,
        last_used_at: new Date().toISOString()
      }),
    });

    return response.ok;
  } catch (error) {
    console.error('Error saving payment authorization:', error);
    return false;
  }
} 