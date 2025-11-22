import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createJob } from './lib/jobs';

/**
 * Fast API endpoint to queue a generation/iteration job
 * Returns immediately with a job_id
 * The actual Claude API call happens in the Railway worker
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

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed. Use POST.' });
    return;
  }

  try {
    const { mode, prompt, designSystem, imageData, model, chatHistory } = req.body;

    // Validate input
    if (!mode || !designSystem) {
      res.status(400).json({
        error: 'Missing required fields: mode and designSystem are required',
      });
      return;
    }

    if (mode !== 'generate' && mode !== 'iterate') {
      res.status(400).json({
        error: 'Invalid mode. Must be "generate" or "iterate"',
      });
      return;
    }

    if (mode === 'generate' && !prompt) {
      res.status(400).json({
        error: 'Missing required field: prompt is required for generate mode',
      });
      return;
    }

    if (mode === 'iterate' && (!imageData || !prompt)) {
      res.status(400).json({
        error: 'Missing required fields: imageData and prompt are required for iterate mode',
      });
      return;
    }

    console.log(`Starting ${mode} job...`);

    // Create job in Supabase queue
    const input = {
      mode,
      prompt,
      designSystem,
      imageData,
      model: model || 'claude', // Default to Claude if not specified
      chatHistory: chatHistory || '', // Optional chat history for multi-iteration chats
    };

    const jobId = await createJob(mode, input);

    console.log(`Job queued: ${jobId}`);

    // Return immediately
    res.status(200).json({
      job_id: jobId,
      status: 'queued',
      message: 'Job queued successfully. Poll /api/job-status?job_id=... for results.',
    });
  } catch (error) {
    console.error('Error in start-job handler:', error);

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to queue job',
      details: errorMessage,
    });
  }
}
