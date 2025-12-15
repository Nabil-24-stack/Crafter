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

interface RecordIterationResponse {
  success: boolean;
  message?: string;
  iterations_used?: number;
  iterations_remaining?: number;
  limit_exceeded?: boolean;
  plan_type?: 'free' | 'pro';
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

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed. Use POST.' });
    return;
  }

  try {
    const { user_id } = req.body;

    if (!user_id) {
      res.status(400).json({ error: 'Missing user_id parameter' });
      return;
    }

    console.log('Recording iteration for user:', user_id);

    // Get current month in YYYY-MM format
    const currentMonth = new Date().toISOString().slice(0, 7);

    // 1. Get subscription data
    const { data: subscription, error: subError } = await supabase
      .from('subscriptions')
      .select('*')
      .eq('user_id', user_id)
      .single();

    if (subError) {
      console.error('Error fetching subscription:', subError);
      throw subError;
    }

    if (!subscription) {
      res.status(400).json({ error: 'No subscription found for user' });
      return;
    }

    const plan_type = subscription.plan_type as 'free' | 'pro';
    const iterations_limit = plan_type === 'pro' ? 40 : 10;

    // 2. Get or create usage record for current month
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

    // Create usage record if it doesn't exist
    if (!usage) {
      const { data: newUsage, error: createError } = await supabase
        .from('usage_tracking')
        .insert({
          user_id,
          month: currentMonth,
          iterations_used: 0,
          extra_iterations_purchased: 0
        })
        .select()
        .single();

      if (createError) {
        console.error('Error creating usage record:', createError);
        throw createError;
      }

      usage = newUsage;
    }

    const current_iterations_used = usage.iterations_used || 0;

    // 3. Check if user has available iterations from packs
    const { data: packs, error: packsError } = await supabase
      .from('iteration_packs')
      .select('*')
      .eq('user_id', user_id)
      .eq('valid_for_month', currentMonth)
      .eq('status', 'active')
      .order('purchased_at', { ascending: true }); // Use oldest packs first

    if (packsError) {
      console.error('Error fetching iteration packs:', packsError);
      throw packsError;
    }

    const total_pack_iterations = packs?.reduce((sum, pack) => sum + pack.iterations_remaining, 0) || 0;

    // 4. Check if user has exceeded their limit
    if (current_iterations_used >= iterations_limit && total_pack_iterations === 0) {
      const response: RecordIterationResponse = {
        success: false,
        limit_exceeded: true,
        message: `You've reached your ${iterations_limit} iteration limit for this month.`,
        iterations_used: current_iterations_used,
        iterations_remaining: 0,
        plan_type
      };

      res.status(403).json(response);
      return;
    }

    // 5. Record the iteration
    // If within plan limit, increment usage_tracking
    if (current_iterations_used < iterations_limit) {
      const { error: updateError } = await supabase
        .from('usage_tracking')
        .update({ iterations_used: current_iterations_used + 1 })
        .eq('user_id', user_id)
        .eq('month', currentMonth);

      if (updateError) {
        console.error('Error updating usage:', updateError);
        throw updateError;
      }

      const response: RecordIterationResponse = {
        success: true,
        message: 'Iteration recorded successfully',
        iterations_used: current_iterations_used + 1,
        iterations_remaining: iterations_limit - (current_iterations_used + 1) + total_pack_iterations,
        plan_type,
        limit_exceeded: false
      };

      console.log('Iteration recorded:', response);
      res.status(200).json(response);
      return;
    }

    // 6. If plan limit reached, use iteration pack
    if (packs && packs.length > 0 && total_pack_iterations > 0) {
      // Use the oldest pack first
      const packToUse = packs[0];

      // Decrement pack iterations
      const newRemaining = packToUse.iterations_remaining - 1;

      if (newRemaining === 0) {
        // Mark pack as consumed
        const { error: updatePackError } = await supabase
          .from('iteration_packs')
          .update({
            iterations_remaining: 0,
            status: 'consumed',
            consumed_at: new Date().toISOString()
          })
          .eq('id', packToUse.id);

        if (updatePackError) {
          console.error('Error updating pack:', updatePackError);
          throw updatePackError;
        }
      } else {
        // Decrement pack
        const { error: updatePackError } = await supabase
          .from('iteration_packs')
          .update({ iterations_remaining: newRemaining })
          .eq('id', packToUse.id);

        if (updatePackError) {
          console.error('Error updating pack:', updatePackError);
          throw updatePackError;
        }
      }

      const response: RecordIterationResponse = {
        success: true,
        message: 'Iteration recorded successfully (using iteration pack)',
        iterations_used: current_iterations_used,
        iterations_remaining: total_pack_iterations - 1,
        plan_type,
        limit_exceeded: false
      };

      console.log('Iteration recorded from pack:', response);
      res.status(200).json(response);
      return;
    }

    // 7. Should never reach here, but handle edge case
    res.status(403).json({
      success: false,
      limit_exceeded: true,
      message: 'Unable to record iteration - limit reached',
      iterations_used: current_iterations_used,
      iterations_remaining: 0,
      plan_type
    });

  } catch (error) {
    console.error('Error in record-iteration handler:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({
      success: false,
      error: 'Failed to record iteration',
      message: errorMessage
    });
  }
}
