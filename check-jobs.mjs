import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Get all jobs from the last hour
const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

const { data, error } = await supabase
  .from('jobs')
  .select('id, status, mode, created_at, updated_at')
  .gte('created_at', oneHourAgo)
  .order('created_at', { ascending: false })
  .limit(20);

if (error) {
  console.error('Error fetching jobs:', error);
  process.exit(1);
}

console.log('\n📊 Recent Jobs (last hour):');
console.log('═'.repeat(80));

if (!data || data.length === 0) {
  console.log('No jobs found in the last hour');
} else {
  const statusCounts = {
    queued: 0,
    processing: 0,
    done: 0,
    error: 0,
    cancelled: 0
  };

  data.forEach(job => {
    statusCounts[job.status] = (statusCounts[job.status] || 0) + 1;

    const created = new Date(job.created_at);
    const updated = new Date(job.updated_at);
    const duration = Math.round((updated - created) / 1000);

    console.log(`
ID: ${job.id}
Mode: ${job.mode}
Status: ${job.status}
Created: ${created.toLocaleTimeString()}
Duration: ${duration}s
`);
  });

  console.log('═'.repeat(80));
  console.log('\n📈 Status Summary:');
  Object.entries(statusCounts).forEach(([status, count]) => {
    if (count > 0) {
      console.log(`  ${status}: ${count}`);
    }
  });
}

// Check for stuck jobs (queued for more than 2 minutes)
const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString();
const { data: stuckJobs } = await supabase
  .from('jobs')
  .select('id, mode, created_at')
  .eq('status', 'queued')
  .lt('created_at', twoMinutesAgo);

if (stuckJobs && stuckJobs.length > 0) {
  console.log(`\n⚠️  WARNING: ${stuckJobs.length} jobs stuck in 'queued' status for >2 minutes`);
  console.log('This suggests the worker is NOT running!\n');
}

process.exit(0);
