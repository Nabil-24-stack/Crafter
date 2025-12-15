import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

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

interface SubscriptionStatusResponse {
  plan_type: 'free' | 'pro';
  status: string;
  iterations_used: number;
  iterations_limit: number;
  extra_iterations: number;
  total_available: number;
  current_period_end?: string;
  can_iterate: boolean;
}

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

  if (req.method !== 'POST' && req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed. Use GET or POST.' });
    return;
  }

  try {
    // Get user_id from request body or query
    const user_id = req.method === 'POST'
      ? req.body?.user_id
      : req.query?.user_id;

    if (!user_id) {
      res.status(400).json({ error: 'Missing user_id parameter' });
      return;
    }

    console.log('Checking subscription status for user:', user_id);

    // Get current month in YYYY-MM format
    const currentMonth = new Date().toISOString().slice(0, 7);

    // 1. Get subscription data
    const { data: subscription, error: subError } = await supabase
      .from('subscriptions')
      .select('*')
      .eq('user_id', user_id)
      .single();

    if (subError && subError.code !== 'PGRST116') { // PGRST116 = no rows returned
      console.error('Error fetching subscription:', subError);
      throw subError;
    }

    // If no subscription exists, create a free one
    if (!subscription) {
      console.log('No subscription found, creating free subscription');
      const { data: newSub, error: createError } = await supabase
        .from('subscriptions')
        .insert({
          user_id,
          status: 'free',
          plan_type: 'free'
        })
        .select()
        .single();

      if (createError) {
        console.error('Error creating subscription:', createError);
        throw createError;
      }

      // Return free plan defaults
      const response: SubscriptionStatusResponse = {
        plan_type: 'free',
        status: 'free',
        iterations_used: 0,
        iterations_limit: 10,
        extra_iterations: 0,
        total_available: 10,
        can_iterate: true
      };

      res.status(200).json(response);
      return;
    }

    // 2. Get usage data for current month
    let { data: usage, error: usageError } = await supabase
      .from('usage_tracking')
      .select('*')
      .eq('user_id', user_id)
      .eq('month', currentMonth)
      .single();

    if (usageError && usageError.code !== 'PGRST116') {
      console.error('Error fetching usage:', usageError);
      throw usageError;
    }

    // If no usage record exists for this month, create one
    if (!usage) {
      console.log('No usage record for current month, creating one');
      const { data: newUsage, error: createUsageError } = await supabase
        .from('usage_tracking')
        .insert({
          user_id,
          month: currentMonth,
          iterations_used: 0,
          extra_iterations_purchased: 0
        })
        .select()
        .single();

      if (createUsageError) {
        console.error('Error creating usage record:', createUsageError);
        throw createUsageError;
      }

      usage = newUsage;
    }

    // 3. Get active iteration packs for current month
    const { data: packs, error: packsError } = await supabase
      .from('iteration_packs')
      .select('iterations_remaining')
      .eq('user_id', user_id)
      .eq('valid_for_month', currentMonth)
      .eq('status', 'active');

    if (packsError) {
      console.error('Error fetching iteration packs:', packsError);
      throw packsError;
    }

    // Calculate extra iterations from packs
    const extra_iterations = packs?.reduce((sum, pack) => sum + pack.iterations_remaining, 0) || 0;

    // 4. Calculate limits based on plan type
    const plan_type = subscription.plan_type as 'free' | 'pro';
    const iterations_limit = plan_type === 'pro' ? 40 : 10;
    const iterations_used = usage.iterations_used || 0;

    // Total available = (limit - used) + extra iterations from packs
    const remaining_from_plan = Math.max(0, iterations_limit - iterations_used);
    const total_available = remaining_from_plan + extra_iterations;

    // User can iterate if they have any iterations available
    const can_iterate = total_available > 0;

    // 5. Build response
    const response: SubscriptionStatusResponse = {
      plan_type,
      status: subscription.status,
      iterations_used,
      iterations_limit,
      extra_iterations,
      total_available,
      current_period_end: subscription.current_period_end || undefined,
      can_iterate
    };

    console.log('Subscription status:', response);
    res.status(200).json(response);

  } catch (error) {
    console.error('Error in check-status handler:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({
      error: 'Failed to check subscription status',
      message: errorMessage
    });
  }
}
