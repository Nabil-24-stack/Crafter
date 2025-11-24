import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Only allow POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { job_id } = req.body;

    if (!job_id) {
      return res.status(400).json({ error: 'Missing job_id' });
    }

    // Update job status to 'cancelled' in Supabase
    const { error } = await supabase
      .from('jobs')
      .update({ status: 'cancelled' })
      .eq('id', job_id)
      .in('status', ['queued', 'processing']); // Only cancel if not already done

    if (error) {
      console.error('Error cancelling job:', error);
      return res.status(500).json({ error: 'Failed to cancel job', details: error.message });
    }

    console.log(`✅ Cancelled job ${job_id}`);
    return res.status(200).json({ success: true, job_id });
  } catch (error) {
    console.error('Error in cancel-job:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
