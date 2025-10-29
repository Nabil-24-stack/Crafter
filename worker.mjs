/**
 * Railway Background Worker
 * Continuously processes queued jobs from Supabase
 * Calls Claude API for generation/iteration
 */

import 'dotenv/config';
import fetch from 'node-fetch';
import { createClient } from '@supabase/supabase-js';

// Initialize Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/**
 * Get the next queued job
 */
async function getNextQueuedJob() {
  const { data, error } = await supabase
    .from('jobs')
    .select('*')
    .eq('status', 'queued')
    .order('created_at', { ascending: true })
    .limit(1);

  if (error) {
    console.error('Error fetching next job:', error);
    throw error;
  }

  return data && data.length > 0 ? data[0] : null;
}

/**
 * Update job status and output
 */
async function updateJob(id, status, output = null, errorMessage = null) {
  const updateData = { status };

  if (output !== null) {
    updateData.output = output;
  }

  if (errorMessage !== null) {
    updateData.error = errorMessage;
  }

  const { error } = await supabase
    .from('jobs')
    .update(updateData)
    .eq('id', id);

  if (error) {
    console.error('Error updating job:', error);
    throw error;
  }

  console.log(`✅ Updated job ${id} to status: ${status}`);
}

/**
 * Build system prompt for generation
 */
function buildSystemPrompt(designSystem) {
  const MAX_DETAILED_COMPONENTS = 20;
  const totalComponents = designSystem.components.length;

  let componentsInfo;

  if (totalComponents <= MAX_DETAILED_COMPONENTS) {
    componentsInfo = designSystem.components.map(comp => {
      return `- ${comp.name} (${comp.category || 'component'})
  Key: ${comp.key}
  Size: ${comp.width}x${comp.height}px
  ${comp.description ? `Description: ${comp.description}` : ''}`;
    }).join('\n');
  } else {
    const topComponents = designSystem.components.slice(0, MAX_DETAILED_COMPONENTS);
    const remainingComponents = designSystem.components.slice(MAX_DETAILED_COMPONENTS);

    const detailedInfo = topComponents.map(comp => {
      return `- ${comp.name} (${comp.category || 'component'})
  Key: ${comp.key}
  Size: ${comp.width}x${comp.height}px
  ${comp.description ? `Description: ${comp.description}` : ''}`;
    }).join('\n');

    const summaryInfo = remainingComponents.map(comp =>
      `- ${comp.name} (${comp.category}, ${comp.width}x${comp.height}px, key: ${comp.key})`
    ).join('\n');

    componentsInfo = `PRIORITY COMPONENTS (with details):\n${detailedInfo}\n\nADDITIONAL COMPONENTS (available):\n${summaryInfo}`;
  }

  return `You are Crafter — an expert product designer...

COMPONENTS (${totalComponents} total):
${componentsInfo}

COLORS: ${designSystem.colors.length} available
TEXT STYLES: ${designSystem.textStyles.length} available`;
}

/**
 * Call Claude API
 */
async function callClaude(systemPrompt, userPrompt) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-5',
      max_tokens: 8192,
      messages: [
        {
          role: 'user',
          content: `${systemPrompt}\n\n${userPrompt}`,
        },
      ],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Claude API error ${response.status}: ${errorText}`);
  }

  return await response.json();
}

/**
 * Extract JSON from Claude's response (handles comments, markdown, etc.)
 */
function extractJSON(responseText) {
  let text = responseText.trim();

  // Log the raw response for debugging
  console.log('Raw Claude response (first 500 chars):', text.substring(0, 500));

  // Remove markdown code blocks
  text = text.replace(/```json\n?/g, '').replace(/```\n?/g, '');

  // Remove lines starting with # (comments)
  text = text.split('\n').filter(line => !line.trim().startsWith('#')).join('\n');

  // Try to find JSON object (greedy match to get the whole object)
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    text = jsonMatch[0];
  }

  console.log('Extracted JSON (first 500 chars):', text.substring(0, 500));

  return text.trim();
}

/**
 * Process a generate job
 */
async function processGenerateJob(job) {
  const { prompt, designSystem } = job.input;

  const systemPrompt = buildSystemPrompt(designSystem);
  const userPrompt = `Create a layout for: ${prompt}`;

  const claudeResponse = await callClaude(systemPrompt, userPrompt);
  const responseText = claudeResponse.content[0]?.text || '{}';

  // Extract and parse the layout JSON
  const jsonText = extractJSON(responseText);

  let parsed;
  try {
    parsed = JSON.parse(jsonText);
  } catch (error) {
    console.error('JSON parse error:', error.message);
    console.error('Failed JSON text:', jsonText);
    throw new Error(`Failed to parse Claude response: ${error.message}. Response: ${jsonText.substring(0, 200)}`);
  }

  return {
    layout: parsed.layout,
    reasoning: parsed.reasoning,
  };
}

/**
 * Process an iterate job
 */
async function processIterateJob(job) {
  const { prompt, frameData, designSystem } = job.input;

  const systemPrompt = buildSystemPrompt(designSystem);
  const userPrompt = `Existing layout:\n${JSON.stringify(frameData, null, 2)}\n\nUser request:\n"${prompt}"\n\nPlease modify the layout according to the user's request.`;

  const claudeResponse = await callClaude(systemPrompt, userPrompt);
  const responseText = claudeResponse.content[0]?.text || '{}';

  // Extract and parse the updated layout JSON
  const jsonText = extractJSON(responseText);

  let parsed;
  try {
    parsed = JSON.parse(jsonText);
  } catch (error) {
    console.error('JSON parse error:', error.message);
    console.error('Failed JSON text:', jsonText);
    throw new Error(`Failed to parse Claude response: ${error.message}. Response: ${jsonText.substring(0, 200)}`);
  }

  return {
    updatedLayout: parsed.updatedLayout,
    reasoning: parsed.reasoning,
  };
}

/**
 * Main worker loop
 */
async function main() {
  console.log('🚀 Crafter Background Worker Started');
  console.log('Listening for jobs in Supabase queue...\n');

  while (true) {
    try {
      // Get next job
      const job = await getNextQueuedJob();

      if (!job) {
        // No jobs, wait 3 seconds
        await new Promise(resolve => setTimeout(resolve, 3000));
        continue;
      }

      console.log(`\n📦 Processing job: ${job.id} (${job.mode})`);

      // Mark as processing
      await updateJob(job.id, 'processing');

      // Process based on mode
      let output;
      if (job.mode === 'generate') {
        output = await processGenerateJob(job);
      } else if (job.mode === 'iterate') {
        output = await processIterateJob(job);
      } else {
        throw new Error(`Unknown job mode: ${job.mode}`);
      }

      // Mark as done
      await updateJob(job.id, 'done', output);

      console.log(`✅ Job ${job.id} completed successfully`);
    } catch (error) {
      console.error('❌ Error processing job:', error.message);

      // Try to mark job as error
      try {
        if (error.jobId) {
          await updateJob(error.jobId, 'error', null, error.message);
        }
      } catch (updateError) {
        console.error('Failed to update job error status:', updateError);
      }

      // Wait before retrying
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
}

// Start the worker
main().catch(error => {
  console.error('Fatal error in worker:', error);
  process.exit(1);
});
