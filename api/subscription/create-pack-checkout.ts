import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2024-12-18.acacia',
});

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
);

// Map pack sizes to Stripe Price IDs
// You'll need to create these in Stripe dashboard
const PACK_PRICE_IDS: Record<number, string> = {
  10: process.env.STRIPE_PACK_10_PRICE_ID!,
  20: process.env.STRIPE_PACK_20_PRICE_ID!,
  50: process.env.STRIPE_PACK_50_PRICE_ID!,
};

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  // Enable CORS - set headers first before any other logic
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization'
  );

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed. Use POST.' });
    return;
  }

  try {
    const { user_id, user_email, pack_size, success_url, cancel_url } = req.body;

    if (!user_id || !user_email || !pack_size) {
      res.status(400).json({ error: 'Missing required fields: user_id, user_email, pack_size' });
      return;
    }

    // Validate pack size
    if (![10, 20, 50].includes(pack_size)) {
      res.status(400).json({ error: 'Invalid pack_size. Must be 10, 20, or 50' });
      return;
    }

    console.log(`Creating pack checkout for user ${user_id}, pack size: ${pack_size}`);

    // 1. Get or create Stripe customer
    const { data: subscription } = await supabase
      .from('subscriptions')
      .select('stripe_customer_id')
      .eq('user_id', user_id)
      .single();

    let customerId: string;

    if (subscription?.stripe_customer_id) {
      customerId = subscription.stripe_customer_id;
      console.log('Using existing Stripe customer:', customerId);
    } else {
      // Create new Stripe customer
      const customer = await stripe.customers.create({
        email: user_email,
        metadata: {
          user_id: user_id,
        },
      });
      customerId = customer.id;
      console.log('Created new Stripe customer:', customerId);

      // Update subscription record with customer ID
      await supabase
        .from('subscriptions')
        .upsert({
          user_id,
          stripe_customer_id: customerId,
          status: 'free',
          plan_type: 'free'
        }, {
          onConflict: 'user_id'
        });
    }

    // 2. Get the Price ID for this pack size
    const priceId = PACK_PRICE_IDS[pack_size];

    if (!priceId) {
      res.status(500).json({ error: `Stripe Price ID not configured for pack size ${pack_size}` });
      return;
    }

    // 3. Create Stripe Checkout Session for one-time payment
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'payment', // One-time payment, not subscription
      payment_method_types: ['card'],
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      success_url: success_url || `${process.env.PAYMENT_PORTAL_URL}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: cancel_url || `${process.env.PAYMENT_PORTAL_URL}/buy-iterations`,
      metadata: {
        user_id: user_id,
        pack_size: pack_size.toString(),
        type: 'iteration_pack',
      },
    });

    console.log('Pack checkout session created:', session.id);

    res.status(200).json({
      checkout_url: session.url,
      session_id: session.id,
    });

  } catch (error) {
    console.error('Error creating pack checkout session:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({
      error: 'Failed to create pack checkout session',
      message: errorMessage,
    });
  }
}
