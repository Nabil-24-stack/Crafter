import type { VercelRequest, VercelResponse } from '@vercel/node';

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

interface RequestBody {
  prompt: string;
  designSystem: DesignSystemData;
}

interface ClaudeMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface ClaudeRequest {
  model: string;
  max_tokens: number;
  messages: ClaudeMessage[];
  system?: string;
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

interface ComponentSummary {
  name: string;
  category: string;
  purpose: string;
  tags: string[];
  key: string;
  size: string;
}

interface LayoutSection {
  name: string;
  goal: string;
  components: string[];
}

interface LayoutPlan {
  screen: string;
  sections: LayoutSection[];
}

interface LayoutNode {
  type: string;
  name: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  fills?: Array<{
    type: string;
    color: {
      r: number;
      g: number;
      b: number;
      a?: number;
    };
  }>;
  children?: LayoutNode[];
  componentKey?: string;
  componentName?: string;
  text?: string;
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
  cornerRadius?: number;
  opacity?: number;
}

interface GenerationResult {
  layout: LayoutNode;
  reasoning?: string;
}

interface ProgressUpdate {
  phase: 'summarizing' | 'planning' | 'generating' | 'complete' | 'error';
  message: string;
  progress: number;
  data?: any;
}

/**
 * Multi-phase serverless function to generate layouts using Claude API
 * Breaks down generation into: Summarize → Plan → Generate Sections
 */
export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  // Enable CORS for Figma plugin
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Handle preflight request
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  // Only allow POST requests
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed. Use POST.' });
    return;
  }

  try {
    const { prompt, designSystem } = req.body as RequestBody;

    // Validate request
    if (!prompt || !designSystem) {
      res.status(400).json({
        error: 'Missing required fields: prompt and designSystem are required',
      });
      return;
    }

    // Get API key from environment variable
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      console.error('ANTHROPIC_API_KEY not configured');
      res.status(500).json({
        error: 'Server configuration error: API key not found',
      });
      return;
    }

    console.log('Starting multi-phase generation...');
    console.log(`Components: ${designSystem.components.length}`);
    console.log(`Prompt: ${prompt}`);

    // Sanitize design system
    const cleanDesignSystem = sanitizeDesignSystem(designSystem);

    // OPTIMIZED: Single-pass generation with smart summarization
    console.log('Generating layout with optimized multi-phase approach...');

    // Quick summary (no API call for small systems)
    const componentSummary = summarizeDesignSystemFast(cleanDesignSystem);
    console.log(`✓ Summarized ${componentSummary.length} components`);

    // Generate layout directly with smart prompting
    const finalLayout = await generateLayoutDirect(prompt, componentSummary, cleanDesignSystem, apiKey);
    console.log(`✓ Layout generated successfully`);

    // Return the result
    res.status(200).json({
      layout: finalLayout,
      reasoning: `Optimized multi-phase generation complete using ${componentSummary.length} components`,
    });

  } catch (error) {
    console.error('Error in multi-phase generation:', error);

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    if (errorMessage.includes('400')) {
      res.status(400).json({
        error: 'Invalid Request',
        message: 'The design system data or prompt contains invalid characters.',
        details: errorMessage,
      });
    } else if (errorMessage.includes('420') || errorMessage.includes('429')) {
      res.status(429).json({
        error: 'Rate Limit',
        message: 'Too many requests. Please try again in a moment.',
        details: errorMessage,
      });
    } else if (errorMessage.includes('500') || errorMessage.includes('503')) {
      res.status(503).json({
        error: 'Service Temporarily Unavailable',
        message: 'Claude API is temporarily unavailable. Please try again.',
        details: errorMessage,
      });
    } else {
      res.status(500).json({
        error: 'Internal Server Error',
        message: 'An unexpected error occurred during multi-phase generation.',
        details: errorMessage,
      });
    }
  }
}

/**
 * Fast Summarization (No API Call)
 */
function summarizeDesignSystemFast(
  designSystem: DesignSystemData
): ComponentSummary[] {
  return designSystem.components.map(comp => ({
    name: comp.name,
    category: comp.category || 'component',
    purpose: comp.description || `${comp.category || 'Component'} element`,
    tags: [comp.category || 'component', comp.type],
    key: comp.key,
    size: `${comp.width}x${comp.height}`,
  }));
}

/**
 * Optimized Direct Generation (Single API Call)
 * Uses the same advanced prompting as the original endpoint but with smarter component limiting
 */
async function generateLayoutDirect(
  prompt: string,
  componentSummary: ComponentSummary[],
  designSystem: DesignSystemData,
  apiKey: string
): Promise<LayoutNode> {
  // Limit components intelligently
  const MAX_COMPONENTS = 30;
  const limitedComponents = componentSummary.slice(0, MAX_COMPONENTS);

  const systemPrompt = buildOptimizedSystemPrompt(limitedComponents, designSystem);
  const userPrompt = `User Request: ${prompt}

Please generate a Figma layout that fulfills this request using the available design system components. Return the layout as JSON following the schema provided.`;

  const claudeRequest: ClaudeRequest = {
    model: 'claude-sonnet-4-5',
    max_tokens: 8192,
    messages: [{ role: 'user', content: `${systemPrompt}\n\n${userPrompt}` }],
  };

  const response = await callClaudeWithRetry(claudeRequest, apiKey);
  const responseText = response.content[0]?.text || '{}';

  const parsed = parseJSON<{ layout: LayoutNode; reasoning?: string }>(responseText);
  return parsed.layout;
}

/**
 * Build optimized system prompt (reuses original logic but with component summaries)
 */
function buildOptimizedSystemPrompt(
  components: ComponentSummary[],
  designSystem: DesignSystemData
): string {
  const componentsInfo = components.map(comp =>
    `- ${comp.name} (${comp.category})\n  Key: ${comp.key}\n  Size: ${comp.size}`
  ).join('\n');

  const colorsJson = JSON.stringify(designSystem.colors.slice(0, 15));
  const textStylesJson = JSON.stringify(designSystem.textStyles.slice(0, 10));

  return `You are an expert Figma designer assistant specializing in creating production-ready, professional UI layouts.

Available Design System:

COMPONENTS (${components.length} available):
${componentsInfo}

COLOR STYLES:
${colorsJson}

TEXT STYLES:
${textStylesJson}

CRITICAL RULES:
⚠️ ALWAYS use Auto Layout (layoutMode: "HORIZONTAL" or "VERTICAL")
⚠️ ALWAYS set relevant text content - never use placeholders
⚠️ Use spacing values: 4, 8, 12, 16, 24, 32, 48, 64
⚠️ Return ONLY valid JSON - NO markdown, NO code blocks

REQUIRED JSON SCHEMA:
{
  "reasoning": "Brief explanation",
  "layout": {
    "type": "FRAME",
    "name": "Root Frame",
    "layoutMode": "VERTICAL" | "HORIZONTAL",
    "primaryAxisSizingMode": "AUTO" | "FIXED",
    "counterAxisSizingMode": "AUTO" | "FIXED",
    "itemSpacing": number,
    "paddingLeft": number,
    "paddingRight": number,
    "paddingTop": number,
    "paddingBottom": number,
    "children": [...]
  }
}`;
}

/**
 * Utility: Call Claude API with Retry Logic
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
 * Utility: Delay
 */
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Utility: Sanitize String
 */
function sanitizeString(str: string | undefined): string {
  if (!str) return '';
  return str
    .replace(/[^\x20-\x7E\n\r\t]/g, '')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .trim();
}

/**
 * Utility: Sanitize Design System
 */
function sanitizeDesignSystem(designSystem: DesignSystemData): DesignSystemData {
  return {
    components: designSystem.components.map(comp => ({
      ...comp,
      name: sanitizeString(comp.name),
      description: sanitizeString(comp.description),
      category: sanitizeString(comp.category),
    })),
    colors: designSystem.colors.map(color => ({
      ...color,
      name: sanitizeString(color.name),
    })),
    textStyles: designSystem.textStyles.map(style => ({
      ...style,
      name: sanitizeString(style.name),
      fontFamily: sanitizeString(style.fontFamily),
    })),
  };
}

/**
 * Utility: Parse JSON with error handling
 */
function parseJSON<T>(text: string): T {
  let jsonText = text.trim();
  jsonText = jsonText.replace(/```json\n?/g, '').replace(/```\n?/g, '');

  try {
    return JSON.parse(jsonText) as T;
  } catch (error) {
    console.error('Failed to parse JSON:', error);
    console.error('Raw text:', text);
    throw new Error('Failed to parse response from Claude');
  }
}
