import type { VercelRequest, VercelResponse } from '@vercel/node';

interface SerializedNode {
  name: string;
  type: string;
  componentKey?: string;
  componentName?: string;
  text?: string;
  layoutMode?: 'NONE' | 'HORIZONTAL' | 'VERTICAL';
  itemSpacing?: number;
  paddingLeft?: number;
  paddingRight?: number;
  paddingTop?: number;
  paddingBottom?: number;
  children?: SerializedNode[];
}

interface SerializedFrame {
  name: string;
  type: string;
  layoutMode?: 'NONE' | 'HORIZONTAL' | 'VERTICAL';
  primaryAxisSizingMode?: 'FIXED' | 'AUTO';
  counterAxisSizingMode?: 'FIXED' | 'AUTO';
  primaryAxisAlignItems?: 'MIN' | 'CENTER' | 'MAX' | 'SPACE_BETWEEN';
  counterAxisAlignItems?: 'MIN' | 'CENTER' | 'MAX';
  paddingLeft?: number;
  paddingRight?: number;
  paddingTop?: number;
  paddingBottom?: number;
  itemSpacing?: number;
  fills?: Array<{
    type: string;
    color: { r: number; g: number; b: number; a?: number };
  }>;
  cornerRadius?: number;
  children?: SerializedNode[];
}

interface DesignSystemData {
  components: Array<{
    id: string;
    name: string;
    key: string;
    description: string;
    type: string;
    width?: number;
    height?: number;
    category?: string;
  }>;
  colors: Array<{
    id: string;
    name: string;
    color: {
      r: number;
      g: number;
      b: number;
      a: number;
    };
  }>;
  textStyles: Array<{
    id: string;
    name: string;
    fontSize: number;
    fontFamily: string;
    fontWeight: number;
  }>;
}

interface IterationRequest {
  mode: 'iterate';
  frameData: SerializedFrame;
  userPrompt: string;
  designSystem: DesignSystemData;
}

interface ClaudeRequest {
  model: string;
  max_tokens: number;
  messages: Array<{
    role: 'user' | 'assistant';
    content: string;
  }>;
}

interface ClaudeResponse {
  id: string;
  type: string;
  role: string;
  content: Array<{
    type: string;
    text: string;
  }>;
  model: string;
  stop_reason: string;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

/**
 * Serverless function to iterate on existing layouts using Claude API
 */
export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed. Use POST.' });
    return;
  }

  try {
    const { frameData, userPrompt, designSystem } = req.body as IterationRequest;

    // Validate request
    if (!frameData || !userPrompt || !designSystem) {
      res.status(400).json({
        error: 'Missing required fields: frameData, userPrompt, and designSystem are required',
      });
      return;
    }

    // Get API key
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      console.error('ANTHROPIC_API_KEY not configured');
      res.status(500).json({
        error: 'Server configuration error: API key not found',
      });
      return;
    }

    console.log('Starting iteration...');
    console.log(`Frame: ${frameData.name}`);
    console.log(`Prompt: ${userPrompt}`);

    // Build prompts
    const systemPrompt = buildIterationSystemPrompt(designSystem);
    const userMessage = buildIterationUserPrompt(frameData, userPrompt);

    const claudeRequest: ClaudeRequest = {
      model: 'claude-sonnet-4-5',
      max_tokens: 8192,
      messages: [
        {
          role: 'user',
          content: `${systemPrompt}\n\n${userMessage}`,
        },
      ],
    };

    console.log('Calling Claude API...');
    const claudeResponse = await callClaudeWithRetry(claudeRequest, apiKey);
    const responseText = claudeResponse.content[0]?.text || '{}';

    console.log('Claude API response received');

    // Parse response
    const result = parseClaudeResponse(responseText);

    res.status(200).json(result);
  } catch (error) {
    console.error('Error in iterate handler:', error);

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    if (errorMessage.includes('400')) {
      res.status(400).json({
        error: 'Invalid Request',
        message: 'The request contains invalid data.',
        details: errorMessage,
      });
    } else if (errorMessage.includes('429')) {
      res.status(429).json({
        error: 'Rate Limit',
        message: 'Too many requests. Please try again in a moment.',
        details: errorMessage,
      });
    } else if (errorMessage.includes('500') || errorMessage.includes('503')) {
      res.status(503).json({
        error: 'Service Temporarily Unavailable',
        message: 'Claude API is temporarily unavailable.',
        details: errorMessage,
      });
    } else {
      res.status(500).json({
        error: 'Internal Server Error',
        message: 'An unexpected error occurred during iteration.',
        details: errorMessage,
      });
    }
  }
}

/**
 * Build system prompt for iteration
 */
function buildIterationSystemPrompt(designSystem: DesignSystemData): string {
  const MAX_DETAILED_COMPONENTS = 30;
  const totalComponents = designSystem.components.length;

  let componentsInfo: string;

  if (totalComponents <= MAX_DETAILED_COMPONENTS) {
    // Small design system - send all component details with descriptions
    componentsInfo = designSystem.components.map(comp => {
      return `- ${comp.name} (${comp.category || 'component'})
  Key: ${comp.key}
  Size: ${comp.width}x${comp.height}px
  ${comp.description ? `Description: ${comp.description}` : ''}`;
    }).join('\n');
  } else {
    // Large design system - detailed for top 30, summary for rest
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

  return `You are Crafter — an expert product designer who iterates on existing layouts using Auto Layout principles.

Available Design System:

COMPONENTS (${totalComponents} total, details below):
${componentsInfo}

COLORS: ${designSystem.colors.length} available
TEXT STYLES: ${designSystem.textStyles.length} available

YOUR TASK:
Given an existing layout JSON and a designer's iteration request, modify the layout to improve or adjust it while:
✓ Keeping it clean, consistent, and aligned with the design system
✓ Maintaining hierarchy and naming consistency
✓ Using Auto Layout principles (no absolute coordinates)
✓ Following an 8px spacing grid
✓ Setting relevant text content (never use placeholders)
✓ You can ADD new components from the design system
✓ You can REMOVE existing components
✓ You can CHANGE component types by replacing them
✓ You can EDIT text in existing text nodes and component instances

CRITICAL RULES:
⚠️ Return ONLY the updated layout JSON - NO markdown, NO explanations outside JSON
⚠️ You can modify the children array (add, remove, reorder components)
⚠️ When adding components, CAREFULLY match the component name and description to what the user requested
⚠️ ALWAYS use the EXACT componentKey and componentName from the design system above
⚠️ Use type: "COMPONENT_INSTANCE" for component instances
⚠️ DO NOT create placeholder frames - only use actual components from the design system
⚠️ If a component doesn't exist in the design system, do not add it
⚠️ When user asks to change text, include "text" field in the node object with the new text
⚠️ For text nodes: type: "TEXT", text: "new content"
⚠️ For component instances with text: type: "COMPONENT_INSTANCE", text: "new content"
⚠️ Only modify what the user requested
⚠️ Use layoutMode: "HORIZONTAL" or "VERTICAL" for containers
⚠️ Use spacing values: 4, 8, 12, 16, 24, 32, 48, 64

ADDING COMPONENTS:
To add a component instance, include it in the children array:
{
  "type": "COMPONENT_INSTANCE",
  "name": "Submit Button",
  "componentKey": "component-key-from-design-system",
  "componentName": "Button/Primary",
  "text": "Click me" // optional text override
}

EDITING TEXT:
To change text in existing nodes, include the "text" field:
- Text node: { "type": "TEXT", "name": "Title", "text": "New Title Text" }
- Component with text: { "type": "COMPONENT_INSTANCE", "name": "Button", "text": "New Button Label" }

RESPONSE FORMAT:
{
  "reasoning": "Brief explanation of changes made",
  "updatedLayout": {
    "name": "Frame Name",
    "type": "FRAME",
    "layoutMode": "VERTICAL",
    "itemSpacing": 16,
    "paddingLeft": 24,
    "paddingRight": 24,
    "paddingTop": 24,
    "paddingBottom": 24,
    "children": [...]
  }
}`;
}

/**
 * Build user prompt for iteration
 */
function buildIterationUserPrompt(frameData: SerializedFrame, userPrompt: string): string {
  return `Existing layout:
${JSON.stringify(frameData, null, 2)}

User request:
"${userPrompt}"

Please modify the layout according to the user's request. Return the updated layout JSON.`;
}

/**
 * Call Claude API with retry logic
 */
async function callClaudeWithRetry(
  claudeRequest: ClaudeRequest,
  apiKey: string,
  maxRetries: number = 2
): Promise<ClaudeResponse> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(claudeRequest),
      });

      if (!response.ok) {
        const errorText = await response.text();

        if (response.status === 400) {
          throw new Error(`Claude API error 400: ${errorText}`);
        }

        if (attempt < maxRetries - 1) {
          const backoffMs = 1000 * Math.pow(2, attempt);
          await delay(backoffMs);
          continue;
        }

        throw new Error(`Claude API error ${response.status}: ${errorText}`);
      }

      return await response.json() as ClaudeResponse;

    } catch (error) {
      lastError = error instanceof Error ? error : new Error('Unknown error');

      if (attempt === maxRetries - 1) {
        throw lastError;
      }

      const backoffMs = 1000 * Math.pow(2, attempt);
      await delay(backoffMs);
    }
  }

  throw lastError || new Error('Failed after retries');
}

/**
 * Parse Claude response
 */
function parseClaudeResponse(responseText: string): any {
  let jsonText = responseText.trim();
  jsonText = jsonText.replace(/```json\n?/g, '').replace(/```\n?/g, '');

  try {
    const parsed = JSON.parse(jsonText);
    return {
      updatedLayout: parsed.updatedLayout,
      reasoning: parsed.reasoning,
    };
  } catch (error) {
    console.error('Failed to parse Claude response:', error);
    console.error('Raw text:', responseText);
    throw new Error('Failed to parse iteration response from Claude');
  }
}

/**
 * Delay utility
 */
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
