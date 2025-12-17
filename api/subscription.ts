import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';
import { buffer } from 'micro';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2024-12-18.acacia' as any,
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

/**
 * Unified subscription endpoint
 * Routes: /api/subscription?action=check-status|create-checkout|create-pack-checkout|portal|webhook
 */
export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization, stripe-signature'
  );

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  const action = req.query.action as string;

  try {
    switch (action) {
      case 'check-status':
        await handleCheckStatus(req, res);
        return;
      case 'create-checkout':
        await handleCreateCheckout(req, res);
        return;
      case 'create-pack-checkout':
        await handleCreatePackCheckout(req, res);
        return;
      case 'portal':
        await handlePortal(req, res);
        return;
      case 'webhook':
        await handleWebhook(req, res);
        return;
      case 'record-iteration':
        await handleRecordIteration(req, res);
        return;
      default:
        res.status(400).json({ error: 'Invalid action. Use: check-status, create-checkout, create-pack-checkout, portal, webhook, record-iteration' });
        return;
    }
  } catch (error) {
    console.error('Subscription API error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: 'Internal server error', message: errorMessage });
  }
}

// Check subscription status
async function handleCheckStatus(req: VercelRequest, res: VercelResponse) {
  const user_id = req.method === 'POST' ? req.body?.user_id : req.query?.user_id;

  if (!user_id) {
    return res.status(400).json({ error: 'Missing user_id parameter' });
  }

  const currentMonth = new Date().toISOString().slice(0, 7);

  // Get subscription
  const { data: subscription, error: subError } = await supabase
    .from('subscriptions')
    .select('*')
    .eq('user_id', user_id)
    .single();

  if (subError && subError.code !== 'PGRST116') {
    throw subError;
  }

  if (!subscription) {
    const { data: newSub } = await supabase
      .from('subscriptions')
      .insert({ user_id, status: 'free', plan_type: 'free' })
      .select()
      .single();

    // Calculate period end for new free user (one month from now)
    const now = new Date();
    const nextPeriod = new Date(now);
    nextPeriod.setMonth(nextPeriod.getMonth() + 1);

    return res.status(200).json({
      plan_type: 'free',
      status: 'free',
      iterations_used: 0,
      iterations_limit: 10,
      extra_iterations: 0,
      total_available: 10,
      current_period_end: nextPeriod.toISOString(),
      can_iterate: true
    });
  }

  // Get usage
  let { data: usage } = await supabase
    .from('usage_tracking')
    .select('*')
    .eq('user_id', user_id)
    .eq('month', currentMonth)
    .single();

  if (!usage) {
    const { data: newUsage } = await supabase
      .from('usage_tracking')
      .insert({ user_id, month: currentMonth, iterations_used: 0 })
      .select()
      .single();
    usage = newUsage;
  }

  // Get packs
  const { data: packs } = await supabase
    .from('iteration_packs')
    .select('iterations_remaining')
    .eq('user_id', user_id)
    .eq('valid_for_month', currentMonth)
    .eq('status', 'active');

  const extra_iterations = packs?.reduce((sum, pack) => sum + pack.iterations_remaining, 0) || 0;
  const plan_type = subscription.plan_type as 'free' | 'pro';
  const iterations_limit = plan_type === 'pro' ? 40 : 10;
  const iterations_used = usage.iterations_used || 0;
  const remaining_from_plan = Math.max(0, iterations_limit - iterations_used);
  const total_available = iterations_limit + extra_iterations;

  // Calculate period end
  let period_end: string | undefined;
  if (subscription.current_period_end) {
    // Pro users have Stripe-managed period end
    period_end = subscription.current_period_end;
  } else if (usage?.created_at) {
    // Free users: period ends one month from when they started using the plugin this month
    const usageStart = new Date(usage.created_at);
    const nextPeriod = new Date(usageStart);
    nextPeriod.setMonth(nextPeriod.getMonth() + 1);
    period_end = nextPeriod.toISOString();
  }

  res.status(200).json({
    plan_type,
    status: subscription.status,
    iterations_used,
    iterations_limit,
    extra_iterations,
    total_available,
    current_period_end: period_end,
    can_iterate: iterations_used < total_available
  });
}

// Record iteration
async function handleRecordIteration(req: VercelRequest, res: VercelResponse) {
  const buf = await buffer(req);
  const body = JSON.parse(buf.toString());
  const { user_id } = body;

  if (!user_id) {
    return res.status(400).json({ error: 'Missing user_id' });
  }

  const currentMonth = new Date().toISOString().slice(0, 7);

  const { data: subscription } = await supabase
    .from('subscriptions')
    .select('*')
    .eq('user_id', user_id)
    .single();

  if (!subscription) {
    return res.status(400).json({ error: 'No subscription found' });
  }

  const plan_type = subscription.plan_type as 'free' | 'pro';
  const iterations_limit = plan_type === 'pro' ? 40 : 10;

  let { data: usage } = await supabase
    .from('usage_tracking')
    .select('*')
    .eq('user_id', user_id)
    .eq('month', currentMonth)
    .single();

  if (!usage) {
    const { data: newUsage } = await supabase
      .from('usage_tracking')
      .insert({ user_id, month: currentMonth, iterations_used: 0 })
      .select()
      .single();
    usage = newUsage;
  }

  const current_iterations_used = usage.iterations_used || 0;

  const { data: packs } = await supabase
    .from('iteration_packs')
    .select('*')
    .eq('user_id', user_id)
    .eq('valid_for_month', currentMonth)
    .eq('status', 'active')
    .order('purchased_at', { ascending: true });

  const total_pack_iterations = packs?.reduce((sum, pack) => sum + pack.iterations_remaining, 0) || 0;

  if (current_iterations_used >= iterations_limit && total_pack_iterations === 0) {
    return res.status(403).json({
      success: false,
      limit_exceeded: true,
      message: `You've reached your ${iterations_limit} iteration limit for this month.`,
      iterations_used: current_iterations_used,
      iterations_remaining: 0,
      plan_type
    });
  }

  if (current_iterations_used < iterations_limit) {
    await supabase
      .from('usage_tracking')
      .update({ iterations_used: current_iterations_used + 1 })
      .eq('user_id', user_id)
      .eq('month', currentMonth);

    return res.status(200).json({
      success: true,
      message: 'Iteration recorded',
      iterations_used: current_iterations_used + 1,
      iterations_limit,
      extra_iterations: total_pack_iterations,
      total_available: iterations_limit + total_pack_iterations,
      plan_type
    });
  }

  if (packs && packs.length > 0) {
    const packToUse = packs[0];
    const newRemaining = packToUse.iterations_remaining - 1;

    // Update pack iterations remaining
    await supabase
      .from('iteration_packs')
      .update({
        iterations_remaining: newRemaining,
        status: newRemaining === 0 ? 'consumed' : 'active',
        consumed_at: newRemaining === 0 ? new Date().toISOString() : undefined
      })
      .eq('id', packToUse.id);

    // Also increment usage_tracking.iterations_used when using pack iterations
    await supabase
      .from('usage_tracking')
      .update({ iterations_used: current_iterations_used + 1 })
      .eq('user_id', user_id)
      .eq('month', currentMonth);

    const new_iterations_used = current_iterations_used + 1;
    const remaining_extra_iterations = total_pack_iterations - 1;

    return res.status(200).json({
      success: true,
      message: 'Iteration recorded (using pack)',
      iterations_used: new_iterations_used,
      iterations_limit,
      extra_iterations: remaining_extra_iterations,
      total_available: Math.max(new_iterations_used, iterations_limit) + remaining_extra_iterations,
      plan_type
    });
  }

  res.status(403).json({
    success: false,
    limit_exceeded: true,
    message: 'Limit reached',
    iterations_used: current_iterations_used,
    iterations_remaining: 0,
    plan_type
  });
}

// Create Pro subscription checkout
async function handleCreateCheckout(req: VercelRequest, res: VercelResponse) {
  const buf = await buffer(req);
  const { user_id, user_email, success_url, cancel_url } = JSON.parse(buf.toString());

  if (!user_id || !user_email) {
    return res.status(400).json({ error: 'Missing user_id or user_email' });
  }

  const { data: existingSub } = await supabase
    .from('subscriptions')
    .select('*')
    .eq('user_id', user_id)
    .single();

  let customerId = existingSub?.stripe_customer_id;

  // Verify customer exists in Stripe, or create new one
  if (customerId) {
    try {
      await stripe.customers.retrieve(customerId);
    } catch (error: any) {
      // Customer doesn't exist (likely test mode ID), create new one
      if (error.code === 'resource_missing') {
        console.log(`Customer ${customerId} not found, creating new one`);
        customerId = null;
      } else {
        throw error;
      }
    }
  }

  if (!customerId) {
    const customer = await stripe.customers.create({
      email: user_email,
      metadata: { user_id },
    });
    customerId = customer.id;

    if (existingSub) {
      await supabase
        .from('subscriptions')
        .update({ stripe_customer_id: customerId })
        .eq('user_id', user_id);
    }
  }

  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: 'subscription',
    payment_method_types: ['card'],
    line_items: [{ price: process.env.STRIPE_PRO_PRICE_ID!, quantity: 1 }],
    success_url: success_url || `${process.env.PAYMENT_PORTAL_URL}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: cancel_url || `${process.env.PAYMENT_PORTAL_URL}/pricing`,
    metadata: { user_id },
    subscription_data: { metadata: { user_id } },
    allow_promotion_codes: true,
  });

  res.status(200).json({ checkout_url: session.url, session_id: session.id });
}

// Create iteration pack checkout
async function handleCreatePackCheckout(req: VercelRequest, res: VercelResponse) {
  const buf = await buffer(req);
  const { user_id, user_email, pack_size, success_url, cancel_url } = JSON.parse(buf.toString());

  if (!user_id || !user_email || !pack_size) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  if (![10, 20, 50].includes(pack_size)) {
    return res.status(400).json({ error: 'Invalid pack_size' });
  }

  const PACK_PRICE_IDS: Record<number, string> = {
    10: process.env.STRIPE_PACK_10_PRICE_ID!,
    20: process.env.STRIPE_PACK_20_PRICE_ID!,
    50: process.env.STRIPE_PACK_50_PRICE_ID!,
  };

  const { data: subscription } = await supabase
    .from('subscriptions')
    .select('stripe_customer_id')
    .eq('user_id', user_id)
    .single();

  let customerId = subscription?.stripe_customer_id;

  // Verify customer exists in Stripe, or create new one
  if (customerId) {
    try {
      await stripe.customers.retrieve(customerId);
    } catch (error: any) {
      // Customer doesn't exist (likely test mode ID), create new one
      if (error.code === 'resource_missing') {
        console.log(`Customer ${customerId} not found, creating new one`);
        customerId = null;
      } else {
        throw error;
      }
    }
  }

  if (!customerId) {
    const customer = await stripe.customers.create({
      email: user_email,
      metadata: { user_id },
    });
    customerId = customer.id;

    await supabase
      .from('subscriptions')
      .upsert({ user_id, stripe_customer_id: customerId, status: 'free', plan_type: 'free' }, { onConflict: 'user_id' });
  }

  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: 'payment',
    payment_method_types: ['card'],
    line_items: [{ price: PACK_PRICE_IDS[pack_size], quantity: 1 }],
    success_url: success_url || `${process.env.PAYMENT_PORTAL_URL}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: cancel_url || `${process.env.PAYMENT_PORTAL_URL}/pricing`,
    metadata: { user_id, pack_size: pack_size.toString(), type: 'iteration_pack' },
  });

  res.status(200).json({ checkout_url: session.url, session_id: session.id });
}

// Create customer portal session
async function handlePortal(req: VercelRequest, res: VercelResponse) {
  const buf = await buffer(req);
  const { user_id, return_url } = JSON.parse(buf.toString());

  if (!user_id) {
    return res.status(400).json({ error: 'Missing user_id' });
  }

  const { data: subscription } = await supabase
    .from('subscriptions')
    .select('stripe_customer_id')
    .eq('user_id', user_id)
    .single();

  if (!subscription?.stripe_customer_id) {
    return res.status(404).json({ error: 'No Stripe customer found' });
  }

  const session = await stripe.billingPortal.sessions.create({
    customer: subscription.stripe_customer_id,
    return_url: return_url || `${process.env.PAYMENT_PORTAL_URL}/pricing`,
  });

  res.status(200).json({ portal_url: session.url });
}

// Handle Stripe webhooks
async function handleWebhook(req: VercelRequest, res: VercelResponse) {
  const buf = await buffer(req);
  const sig = req.headers['stripe-signature'];

  if (!sig) {
    return res.status(400).json({ error: 'Missing stripe-signature header' });
  }

  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(buf, sig, process.env.STRIPE_WEBHOOK_SECRET!);
  } catch (err) {
    console.error('Webhook signature verification failed:', err);
    return res.status(400).json({ error: 'Webhook signature verification failed' });
  }

  console.log('Webhook event received:', event.type);

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
  }

  res.status(200).json({ received: true });
}

async function handleCheckoutSessionCompleted(session: Stripe.Checkout.Session) {
  const user_id = session.metadata?.user_id;
  if (!user_id) return;

  if (session.mode === 'subscription' && session.subscription) {
    const subscription = await stripe.subscriptions.retrieve(session.subscription as string);
    await handleSubscriptionUpdated(subscription);
  }

  if (session.mode === 'payment' && session.metadata?.type === 'iteration_pack') {
    const pack_size = parseInt(session.metadata.pack_size || '0');
    const currentMonth = new Date().toISOString().slice(0, 7);

    await supabase.from('iteration_packs').insert({
      user_id,
      pack_size,
      iterations_remaining: pack_size,
      stripe_checkout_session_id: session.id,
      stripe_payment_intent_id: session.payment_intent as string || null,
      valid_for_month: currentMonth,
      status: 'active',
    });
  }
}

async function handleSubscriptionUpdated(subscription: Stripe.Subscription) {
  const user_id = subscription.metadata?.user_id;
  if (!user_id) return;

  let status = subscription.status;
  let plan_type: 'free' | 'pro' = 'pro';

  if (subscription.status === 'canceled' || subscription.status === 'incomplete_expired') {
    plan_type = 'free';
  }

  await supabase.from('subscriptions').upsert({
    user_id,
    stripe_customer_id: subscription.customer as string,
    stripe_subscription_id: subscription.id,
    status,
    plan_type,
    current_period_start: new Date((subscription as any).current_period_start * 1000).toISOString(),
    current_period_end: new Date((subscription as any).current_period_end * 1000).toISOString(),
    cancel_at_period_end: subscription.cancel_at_period_end,
  }, { onConflict: 'user_id' });
}

async function handleSubscriptionDeleted(subscription: Stripe.Subscription) {
  const user_id = subscription.metadata?.user_id;
  if (!user_id) return;

  await supabase.from('subscriptions').update({ status: 'canceled', plan_type: 'free' }).eq('user_id', user_id);
}

async function handleInvoicePaymentSucceeded(invoice: Stripe.Invoice) {
  const subscriptionId = (invoice as any).subscription;
  if (subscriptionId) {
    const subscription = await stripe.subscriptions.retrieve(subscriptionId as string);
    await handleSubscriptionUpdated(subscription);
  }
}

async function handleInvoicePaymentFailed(invoice: Stripe.Invoice) {
  const subscription_id = (invoice as any).subscription as string;
  if (!subscription_id) return;

  const subscription = await stripe.subscriptions.retrieve(subscription_id);
  const user_id = subscription.metadata?.user_id;

  if (user_id) {
    await supabase.from('subscriptions').update({ status: 'past_due' }).eq('user_id', user_id);
  }
}
