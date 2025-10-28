// Service for interacting with Claude API via async job queue
import { ClaudeRequest, ClaudeResponse, DesignSystemData, GenerationResult, LayoutNode, SerializedFrame, IterationResult } from './types';
import { config } from './config';

// Backend API endpoints (configured in config.ts)
const START_JOB_URL = config.BACKEND_URL.replace('/api/generate', '/api/start-job');
const JOB_STATUS_URL = config.BACKEND_URL.replace('/api/generate', '/api/job-status');

// Polling configuration
const POLL_INTERVAL_MS = 3000; // Poll every 3 seconds
const MAX_POLL_ATTEMPTS = 60; // Max 3 minutes (60 * 3s)

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
  apiKey: string
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
 * Generates a mock layout for testing without API key
 */
function generateMockLayout(prompt: string, designSystem: DesignSystemData): GenerationResult {
  console.log('Using mock layout generation for prompt:', prompt);

  // Create a simple mock layout based on available components
  const mockLayout: LayoutNode = {
    type: 'FRAME',
    name: 'Generated Layout',
    x: 0,
    y: 0,
    width: 1200,
    height: 800,
    fills: [
      {
        type: 'SOLID',
        color: { r: 0.95, g: 0.95, b: 0.95 },
      },
    ],
    children: [],
  };

  // Add a header frame
  const headerFrame: LayoutNode = {
    type: 'FRAME',
    name: 'Header',
    x: 0,
    y: 0,
    width: 1200,
    height: 80,
    fills: [
      {
        type: 'SOLID',
        color: { r: 1, g: 1, b: 1 },
      },
    ],
    children: [],
  };

  // Add components if available
  if (designSystem.components.length > 0) {
    // Add first component as a button in header
    const firstComponent = designSystem.components[0];
    headerFrame.children?.push({
      type: 'COMPONENT_INSTANCE',
      name: firstComponent.name,
      componentKey: firstComponent.key,
      componentName: firstComponent.name,
      x: 40,
      y: 20,
      width: 120,
      height: 40,
    });
  } else {
    // Add a placeholder rectangle if no components
    headerFrame.children?.push({
      type: 'RECTANGLE',
      name: 'Placeholder Button',
      x: 40,
      y: 20,
      width: 120,
      height: 40,
      fills: [
        {
          type: 'SOLID',
          color: { r: 0.2, g: 0.6, b: 1 },
        },
      ],
    });
  }

  // Add a content frame
  const contentFrame: LayoutNode = {
    type: 'FRAME',
    name: 'Content',
    x: 40,
    y: 120,
    width: 1120,
    height: 640,
    fills: [
      {
        type: 'SOLID',
        color: { r: 1, g: 1, b: 1 },
      },
    ],
    children: [],
  };

  // Add more component instances if available
  if (designSystem.components.length > 1) {
    for (let i = 1; i < Math.min(4, designSystem.components.length); i++) {
      const component = designSystem.components[i];
      contentFrame.children?.push({
        type: 'COMPONENT_INSTANCE',
        name: component.name,
        componentKey: component.key,
        componentName: component.name,
        x: 40,
        y: 40 + i * 100,
        width: 300,
        height: 80,
      });
    }
  } else {
    // Add placeholder cards
    for (let i = 0; i < 3; i++) {
      contentFrame.children?.push({
        type: 'RECTANGLE',
        name: `Card ${i + 1}`,
        x: 40 + i * 360,
        y: 40,
        width: 320,
        height: 200,
        fills: [
          {
            type: 'SOLID',
            color: { r: 0.9, g: 0.9, b: 0.95 },
          },
        ],
      });
    }
  }

  mockLayout.children?.push(headerFrame, contentFrame);

  return {
    layout: mockLayout,
    reasoning: `Mock layout generated for: "${prompt}". This is a demonstration layout using ${designSystem.components.length} available components.`,
  };
}

/**
 * Iterates on an existing layout using Claude API
 * Uses async job queue to avoid timeouts
 */
export async function iterateLayout(
  frameData: SerializedFrame,
  userPrompt: string,
  designSystem: DesignSystemData
): Promise<IterationResult> {
  try {
    // Start the job
    const startResponse = await fetch(START_JOB_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        mode: 'iterate',
        prompt: userPrompt,
        frameData,
        designSystem,
      }),
    });

    if (!startResponse.ok) {
      const errorData = await startResponse.json().catch(() => ({}));
      throw new Error(errorData.message || 'Failed to start iteration job');
    }

    const { job_id } = await startResponse.json();

    console.log('Iteration job started:', job_id);

    // Poll for results
    const output = await pollJobStatus(job_id);

    return output as IterationResult;
  } catch (error) {
    console.error('Error iterating layout:', error);

    if (error instanceof Error) {
      throw error;
    }

    throw new Error('Network error: Could not connect to the AI service.');
  }
}
