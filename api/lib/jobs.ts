/**
 * Supabase Job Queue Helper Functions
 * Used by both Vercel API endpoints and Railway worker
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Initialize Supabase client
let supabaseClient: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient {
  if (!supabaseClient) {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseKey) {
      throw new Error('Missing Supabase environment variables: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
    }

    supabaseClient = createClient(supabaseUrl, supabaseKey);
  }

  return supabaseClient;
}

export interface Job {
  id: string;
  status: 'queued' | 'processing' | 'done' | 'error';
  mode: 'generate' | 'iterate';
  input: any;
  output?: any;
  error?: string;
  created_at: string;
  updated_at: string;
}

/**
 * Creates a new job in the queue
 */
export async function createJob(mode: 'generate' | 'iterate', input: any): Promise<string> {
  const supabase = getSupabaseClient();

  // Log payload size for debugging
  const payloadSize = JSON.stringify(input).length;
  console.log(`Creating job with payload size: ${payloadSize} bytes`);

  const { data, error } = await supabase
    .from('jobs')
    .insert({
      mode,
      status: 'queued',
      input,
    })
    .select('id')
    .single();

  if (error) {
    console.error('Error creating job:', error);
    console.error('Error details:', JSON.stringify(error, null, 2));
    throw new Error(`Failed to create job: ${error.message}`);
  }

  console.log('Created job:', data.id);
  return data.id;
}

/**
 * Fetches a job by ID
 */
export async function getJob(id: string): Promise<Job | null> {
  const supabase = getSupabaseClient();

  const { data, error } = await supabase
    .from('jobs')
    .select('*')
    .eq('id', id)
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      // Not found
      return null;
    }
    console.error('Error fetching job:', error);
    throw new Error(`Failed to fetch job: ${error.message}`);
  }

  return data as Job;
}

/**
 * Updates a job's status and output
 */
export async function updateJob(
  id: string,
  status: 'processing' | 'done' | 'error',
  output?: any,
  errorMessage?: string
): Promise<void> {
  const supabase = getSupabaseClient();

  const updateData: any = {
    status,
  };

  if (output !== undefined) {
    updateData.output = output;
  }

  if (errorMessage !== undefined) {
    updateData.error = errorMessage;
  }

  const { error } = await supabase
    .from('jobs')
    .update(updateData)
    .eq('id', id);

  if (error) {
    console.error('Error updating job:', error);
    throw new Error(`Failed to update job: ${error.message}`);
  }

  console.log(`Updated job ${id} to status: ${status}`);
}

/**
 * Gets the next queued job (oldest first)
 * Used by the Railway worker
 */
export async function getNextQueuedJob(): Promise<Job | null> {
  const supabase = getSupabaseClient();

  const { data, error } = await supabase
    .from('jobs')
    .select('*')
    .eq('status', 'queued')
    .order('created_at', { ascending: true })
    .limit(1);

  if (error) {
    console.error('Error fetching next job:', error);
    throw new Error(`Failed to fetch next job: ${error.message}`);
  }

  return data && data.length > 0 ? (data[0] as Job) : null;
}
