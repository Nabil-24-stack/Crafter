import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getJob } from './lib/jobs';

/**
 * Fast API endpoint to check job status
 * Called by Figma plugin to poll for results
 */
export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');
  res.setHeader('Access-Control-Allow-Credentials', 'true');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed. Use GET.' });
    return;
  }

  try {
    const { job_id } = req.query;

    if (!job_id || typeof job_id !== 'string') {
      res.status(400).json({
        error: 'Missing or invalid job_id parameter',
      });
      return;
    }

    // Fetch job from Supabase
    const job = await getJob(job_id);

    if (!job) {
      res.status(404).json({
        error: 'Job not found',
        job_id,
      });
      return;
    }

    // Return job status and output
    const response: any = {
      job_id: job.id,
      status: job.status,
      created_at: job.created_at,
      updated_at: job.updated_at,
    };

    if (job.status === 'done' && job.output) {
      response.output = job.output;
    }

    if (job.status === 'error' && job.error) {
      response.error = job.error;
    }

    res.status(200).json(response);
  } catch (error) {
    console.error('Error in job-status handler:', error);

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to fetch job status',
      details: errorMessage,
    });
  }
}
