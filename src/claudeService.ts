// Service for interacting with Claude API via async job queue
import { ClaudeRequest, ClaudeResponse, DesignSystemData, GenerationResult, LayoutNode, SerializedFrame, IterationResult } from './types';
import { config } from './config';

// Backend API endpoints (configured in config.ts)
const START_JOB_URL = config.BACKEND_URL.replace('/api/generate', '/api/start-job');
const JOB_STATUS_URL = config.BACKEND_URL.replace('/api/generate', '/api/job-status');

// Polling configuration
const POLL_INTERVAL_MS = 3000; // Poll every 3 seconds
const MAX_POLL_ATTEMPTS = 120; // Max 6 minutes (120 * 3s) - increased for vision jobs

/**
 * Helper function to poll job status
 */
async function pollJobStatus(jobId: string): Promise<any> {
  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
    const response = await fetch(`${JOB_STATUS_URL}?job_id=${jobId}`);

    if (!response.ok) {
      throw new Error(`Failed to check job status: ${response.statusText}`);
    }

    const data = await response.json();

    if (data.status === 'done') {
      return data.output;
    }

    if (data.status === 'error') {
      throw new Error(data.error || 'Job failed');
    }

    // Job still processing, wait and retry
    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  throw new Error('Job timed out. Please try again.');
}

/**
 * Generates a layout using Claude API based on the design system and user prompt
 * Uses async job queue to avoid timeouts
 */
export async function generateLayout(
  prompt: string,
  designSystem: DesignSystemData,
  apiKey: string,
  model: 'claude' | 'gemini' = 'claude'
): Promise<GenerationResult> {
  // Use mock mode if specified
  if (apiKey === 'MOCK_API_KEY' || !apiKey) {
    return generateMockLayout(prompt, designSystem);
  }

  try {
    // Start the job
    const startResponse = await fetch(START_JOB_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        mode: 'generate',
        prompt,
        designSystem,
        model,
      }),
    });

    if (!startResponse.ok) {
      const errorData = await startResponse.json().catch(() => ({}));
      throw new Error(errorData.message || 'Failed to start generation job');
    }

    const { job_id } = await startResponse.json();

    console.log('Generation job started:', job_id);

    // Poll for results
    const output = await pollJobStatus(job_id);

    return output as GenerationResult;
  } catch (error) {
    console.error('Error generating layout:', error);

    if (error instanceof Error) {
      throw error;
    }

    throw new Error('Network error: Could not connect to the AI service.');
  }
}

/**
 * Generates a mock SVG for testing without API key
 */
function generateMockLayout(prompt: string, designSystem: DesignSystemData): GenerationResult {
  console.log('Using mock SVG generation for prompt:', prompt);

  // Get primary color from design system or use default
  const primaryColor = designSystem.colors[0]?.hex || '#0066cc';
  const backgroundColor = '#ffffff';

  // Create a simple mock SVG
  const mockSVG = `<svg width="1920" height="1080" xmlns="http://www.w3.org/2000/svg">
  <rect x="0" y="0" width="1920" height="1080" fill="${backgroundColor}"/>
  <rect x="0" y="0" width="1920" height="80" fill="${primaryColor}"/>
  <text x="40" y="50" font-family="Inter" font-size="24" font-weight="600" fill="#ffffff">Mock SVG - ${prompt}</text>
  <g id="content">
    <rect x="40" y="120" width="400" height="200" fill="${backgroundColor}" stroke="${primaryColor}" stroke-width="2" rx="8"/>
    <text x="60" y="160" font-family="Inter" font-size="18" font-weight="500" fill="#1f2937">This is a mock SVG</text>
    <text x="60" y="200" font-family="Inter" font-size="14" fill="#6b7280">Generated for testing without API key</text>
  </g>
</svg>`;

  return {
    svg: mockSVG,
    reasoning: `Mock SVG generated for: "${prompt}". This is a demonstration using the design system's visual language.`,
  };
}

/**
 * Iterates on an existing design using Claude API with vision
 * Uses async job queue to avoid timeouts
 *
 * @param onJobStarted - Optional callback called immediately when job_id is available (before polling)
 */
export async function iterateLayout(
  imageData: string,
  userPrompt: string,
  designSystem: DesignSystemData,
  model: 'claude' | 'gemini' = 'claude',
  chatHistory?: string,
  onJobStarted?: (jobId: string) => void
): Promise<IterationResult> {
  try {
    console.log('iterateLayout called with:', {
      imageDataLength: imageData?.length,
      promptLength: userPrompt?.length,
      hasDesignSystem: !!designSystem,
      model,
      hasChatHistory: !!chatHistory,
    });

    // Start the job
    const startResponse = await fetch(START_JOB_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        mode: 'iterate',
        prompt: userPrompt,
        imageData,
        designSystem,
        model,
        chatHistory,
      }),
    });

    if (!startResponse.ok) {
      const errorData = await startResponse.json().catch(() => ({}));
      throw new Error(errorData.message || 'Failed to start iteration job');
    }

    const { job_id } = await startResponse.json();

    console.log('Iteration job started:', job_id);

    // Call the callback immediately with job_id (for early subscription)
    if (onJobStarted) {
      onJobStarted(job_id);
    }

    // Poll for results
    const output = await pollJobStatus(job_id);

    // Include job_id in the result for realtime subscriptions
    return {
      ...output,
      job_id,
    } as IterationResult;
  } catch (error) {
    console.error('Error iterating layout:', error);

    if (error instanceof Error) {
      throw error;
    }

    throw new Error('Network error: Could not connect to the AI service.');
  }
}
