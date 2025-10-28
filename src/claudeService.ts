// Service for interacting with Claude API via Vercel proxy server
import { ClaudeRequest, ClaudeResponse, DesignSystemData, GenerationResult, LayoutNode, SerializedFrame, IterationResult } from './types';
import { config } from './config';

// Backend API endpoints (configured in config.ts)
const PROXY_SERVER_URL = config.USE_MULTI_PHASE
  ? config.BACKEND_URL_MULTI_PHASE
  : config.BACKEND_URL;

const ITERATE_URL = config.BACKEND_URL.replace('/generate', '/iterate');

/**
 * Generates a layout using Claude API based on the design system and user prompt
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

  // Call via proxy server (which has the API key)
  try {
    const response = await fetch(PROXY_SERVER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prompt,
        designSystem,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));

      // Provide user-friendly error messages based on error type
      let userMessage = errorData.message || errorData.error || 'Failed to generate layout';

      // Add helpful suggestions
      if (response.status === 400) {
        userMessage += '\n\nSuggestion: Try removing special characters or emoji from your component names.';
      } else if (response.status === 429 || response.status === 420) {
        userMessage += '\n\nSuggestion: Your design system might be too large. Try using fewer components or a simpler prompt.';
      } else if (response.status >= 500) {
        userMessage += '\n\nSuggestion: The AI service is temporarily unavailable. Please try again in a moment or enable Mock Mode.';
      }

      throw new Error(userMessage);
    }

    const layoutResult: GenerationResult = await response.json();
    return layoutResult;
  } catch (error) {
    console.error('Error calling proxy server:', error);

    // Provide helpful error message
    if (error instanceof Error) {
      throw error; // Re-throw with our enhanced message
    }

    throw new Error('Network error: Could not connect to the AI service. Please check your internet connection.');
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
 */
export async function iterateLayout(
  frameData: SerializedFrame,
  userPrompt: string,
  designSystem: DesignSystemData
): Promise<IterationResult> {
  try {
    const response = await fetch(ITERATE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        mode: 'iterate',
        frameData,
        userPrompt,
        designSystem,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      let userMessage = errorData.message || errorData.error || 'Failed to iterate layout';

      if (response.status >= 500) {
        userMessage += '\n\nSuggestion: The AI service is temporarily unavailable. Please try again in a moment.';
      }

      throw new Error(userMessage);
    }

    const result: IterationResult = await response.json();
    return result;
  } catch (error) {
    console.error('Error calling iterate endpoint:', error);

    if (error instanceof Error) {
      throw error;
    }

    throw new Error('Network error: Could not connect to the AI service. Please check your internet connection.');
  }
}
