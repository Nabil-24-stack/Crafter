import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';
import { buffer } from 'micro';

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

// Disable body parsing for webhook
export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed. Use POST.' });
    return;
  }

  try {
    const buf = await buffer(req);
    const sig = req.headers['stripe-signature'];

    if (!sig) {
      res.status(400).json({ error: 'Missing stripe-signature header' });
      return;
    }

    let event: Stripe.Event;

    try {
      event = stripe.webhooks.constructEvent(
        buf,
        sig,
        process.env.STRIPE_WEBHOOK_SECRET!
      );
    } catch (err) {
      console.error('Webhook signature verification failed:', err);
      res.status(400).json({ error: 'Webhook signature verification failed' });
      return;
    }

    console.log('Webhook event received:', event.type);

    // Handle different event types
    switch (event.type) {
      case 'checkout.session.completed':
        await handleCheckoutSessionCompleted(event.data.object as Stripe.Checkout.Session);
        break;

      case 'customer.subscription.created':
      case 'customer.subscription.updated':
        await handleSubscriptionUpdated(event.data.object as Stripe.Subscription);
        break;

      case 'customer.subscription.deleted':
        await handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
        break;

      case 'invoice.payment_succeeded':
        await handleInvoicePaymentSucceeded(event.data.object as Stripe.Invoice);
        break;

      case 'invoice.payment_failed':
        await handleInvoicePaymentFailed(event.data.object as Stripe.Invoice);
        break;

      default:
        console.log(`Unhandled event type: ${event.type}`);
    }

    res.status(200).json({ received: true });

  } catch (error) {
    console.error('Webhook handler error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({
      error: 'Webhook handler failed',
      message: errorMessage,
    });
  }
}

/**
 * Handle checkout session completed
 * This fires when a user successfully completes checkout
 */
async function handleCheckoutSessionCompleted(session: Stripe.Checkout.Session) {
  console.log('Checkout session completed:', session.id);

  const user_id = session.metadata?.user_id;

  if (!user_id) {
    console.error('No user_id in session metadata');
    return;
  }

  // Check if this is a subscription or one-time payment
  if (session.mode === 'subscription' && session.subscription) {
    // Subscription checkout - fetch full subscription details
    const subscription = await stripe.subscriptions.retrieve(session.subscription as string);
    await handleSubscriptionUpdated(subscription);
  }

  // Check if this is an iteration pack purchase
  if (session.mode === 'payment' && session.metadata?.type === 'iteration_pack') {
    const pack_size = parseInt(session.metadata.pack_size || '0');
    const currentMonth = new Date().toISOString().slice(0, 7);

    console.log(`Creating iteration pack for user ${user_id}, size: ${pack_size}`);

    // Create iteration pack record
    const { error } = await supabase
      .from('iteration_packs')
      .insert({
        user_id,
        pack_size,
        iterations_remaining: pack_size,
        stripe_checkout_session_id: session.id,
        stripe_payment_intent_id: session.payment_intent as string || null,
        valid_for_month: currentMonth,
        status: 'active',
      });

    if (error) {
      console.error('Error creating iteration pack:', error);
    } else {
      console.log('Iteration pack created successfully');
    }
  }
}

/**
 * Handle subscription created or updated
 */
async function handleSubscriptionUpdated(subscription: Stripe.Subscription) {
  console.log('Subscription updated:', subscription.id);

  const user_id = subscription.metadata?.user_id;

  if (!user_id) {
    console.error('No user_id in subscription metadata');
    return;
  }

  // Map Stripe status to our status
  let status = subscription.status;
  let plan_type: 'free' | 'pro' = 'pro';

  if (subscription.status === 'canceled' || subscription.status === 'incomplete_expired') {
    plan_type = 'free';
  }

  // Update subscription in database
  const { error } = await supabase
    .from('subscriptions')
    .upsert({
      user_id,
      stripe_customer_id: subscription.customer as string,
      stripe_subscription_id: subscription.id,
      status,
      plan_type,
      current_period_start: new Date(subscription.current_period_start * 1000).toISOString(),
      current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
      cancel_at_period_end: subscription.cancel_at_period_end,
    }, {
      onConflict: 'user_id'
    });

  if (error) {
    console.error('Error updating subscription:', error);
  } else {
    console.log('Subscription updated successfully');
  }
}

/**
 * Handle subscription deleted (canceled)
 */
async function handleSubscriptionDeleted(subscription: Stripe.Subscription) {
  console.log('Subscription deleted:', subscription.id);

  const user_id = subscription.metadata?.user_id;

  if (!user_id) {
    console.error('No user_id in subscription metadata');
    return;
  }

  // Update subscription to free plan
  const { error } = await supabase
    .from('subscriptions')
    .update({
      status: 'canceled',
      plan_type: 'free',
    })
    .eq('user_id', user_id);

  if (error) {
    console.error('Error updating subscription to canceled:', error);
  } else {
    console.log('Subscription marked as canceled');
  }
}

/**
 * Handle successful invoice payment
 */
async function handleInvoicePaymentSucceeded(invoice: Stripe.Invoice) {
  console.log('Invoice payment succeeded:', invoice.id);

  if (invoice.subscription) {
    // Fetch subscription and update
    const subscription = await stripe.subscriptions.retrieve(invoice.subscription as string);
    await handleSubscriptionUpdated(subscription);
  }
}

/**
 * Handle failed invoice payment
 */
async function handleInvoicePaymentFailed(invoice: Stripe.Invoice) {
  console.log('Invoice payment failed:', invoice.id);

  const subscription_id = invoice.subscription as string;

  if (!subscription_id) {
    return;
  }

  // Fetch subscription to get user_id
  const subscription = await stripe.subscriptions.retrieve(subscription_id);
  const user_id = subscription.metadata?.user_id;

  if (!user_id) {
    console.error('No user_id in subscription metadata');
    return;
  }

  // Update subscription status to past_due
  const { error } = await supabase
    .from('subscriptions')
    .update({
      status: 'past_due',
    })
    .eq('user_id', user_id);

  if (error) {
    console.error('Error updating subscription to past_due:', error);
  } else {
    console.log('Subscription marked as past_due');
  }
}
