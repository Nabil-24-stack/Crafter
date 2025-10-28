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
  textOverrides?: Record<string, string>;

  // Auto Layout properties
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

  // Additional styling properties
  cornerRadius?: number;
  strokeWeight?: number;
  strokes?: Array<{
    type: string;
    color: {
      r: number;
      g: number;
      b: number;
      a?: number;
    };
  }>;
  opacity?: number;
}

interface GenerationResult {
  layout: LayoutNode;
  reasoning?: string;
}

/**
 * Serverless function to generate layouts using Claude API
 * This keeps the Anthropic API key secure on the server
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

    // Build the system prompt with design system context
    const systemPrompt = buildSystemPrompt(designSystem);
    const userPrompt = buildUserPrompt(prompt);

    // Prepare Claude API request
    const claudeRequest: ClaudeRequest = {
      model: 'claude-sonnet-4-5', // Claude 4.5 Sonnet
      max_tokens: 8192, // Increased to handle complex layouts
      messages: [
        {
          role: 'user',
          content: `${systemPrompt}\n\n${userPrompt}`,
        },
      ],
    };

    console.log('Calling Claude API with retry logic...');

    // Call Claude API with retry logic
    const data = await callClaudeWithRetry(claudeRequest, apiKey);
    const responseText = data.content[0]?.text || '';

    console.log('Claude API response received');

    // Parse the layout from Claude's response
    const layoutResult = parseClaudeResponse(responseText);

    // Return the result
    res.status(200).json(layoutResult);
  } catch (error) {
    console.error('Error in generate handler:', error);

    // Categorize errors and provide helpful messages
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    if (errorMessage.includes('400')) {
      res.status(400).json({
        error: 'Invalid Request',
        message: 'The design system data or prompt contains invalid characters. Try simplifying your prompt or removing special characters from component names.',
        details: errorMessage,
      });
    } else if (errorMessage.includes('420') || errorMessage.includes('429')) {
      res.status(429).json({
        error: 'Rate Limit or Payload Too Large',
        message: 'The request is too complex. Try reducing the number of components in your design system or simplifying your prompt.',
        details: errorMessage,
      });
    } else if (errorMessage.includes('500') || errorMessage.includes('503')) {
      res.status(503).json({
        error: 'Service Temporarily Unavailable',
        message: 'Claude API is temporarily unavailable. Please try again in a moment.',
        details: errorMessage,
      });
    } else {
      res.status(500).json({
        error: 'Internal Server Error',
        message: 'An unexpected error occurred. Please try again or use Mock Mode for testing.',
        details: errorMessage,
      });
    }
  }
}

/**
 * Delays execution for a specified number of milliseconds
 */
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Calls Claude API with retry logic and exponential backoff
 */
async function callClaudeWithRetry(
  claudeRequest: ClaudeRequest,
  apiKey: string,
  maxRetries: number = 2
): Promise<ClaudeResponse> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      console.log(`Claude API attempt ${attempt + 1}/${maxRetries}`);

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
        console.error(`Claude API error (attempt ${attempt + 1}):`, response.status, errorText);

        // Don't retry on 400 errors (bad request) - these won't succeed on retry
        if (response.status === 400) {
          throw new Error(`Claude API error 400: Invalid request format. ${errorText}`);
        }

        // For 420, 429, 500+ errors, retry with backoff
        if (attempt < maxRetries - 1) {
          const backoffMs = 1000 * Math.pow(2, attempt); // 1s, 2s, 4s...
          console.log(`Retrying after ${backoffMs}ms...`);
          await delay(backoffMs);
          continue;
        }

        throw new Error(`Claude API error ${response.status}: ${errorText}`);
      }

      const data = await response.json() as ClaudeResponse;
      console.log('Claude API success');
      return data;

    } catch (error) {
      lastError = error instanceof Error ? error : new Error('Unknown error');

      // If it's the last attempt, throw the error
      if (attempt === maxRetries - 1) {
        throw lastError;
      }

      // Otherwise, wait and retry
      const backoffMs = 1000 * Math.pow(2, attempt);
      console.log(`Error occurred, retrying after ${backoffMs}ms...`);
      await delay(backoffMs);
    }
  }

  // Should never reach here, but TypeScript needs it
  throw lastError || new Error('Failed after retries');
}

/**
 * Sanitizes a string to remove problematic characters and ensure JSON safety
 */
function sanitizeString(str: string | undefined): string {
  if (!str) return '';

  return str
    // Remove emoji and non-ASCII characters
    .replace(/[^\x20-\x7E\n\r\t]/g, '')
    // Remove control characters except newlines and tabs
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    // Trim whitespace
    .trim();
}

/**
 * Sanitizes component data to prevent API errors
 */
function sanitizeComponentData(component: any) {
  return {
    id: component.id,
    name: sanitizeString(component.name),
    key: component.key,
    description: sanitizeString(component.description),
    type: component.type,
    width: component.width,
    height: component.height,
    category: sanitizeString(component.category),
  };
}

/**
 * Sanitizes the entire design system
 */
function sanitizeDesignSystem(designSystem: DesignSystemData): DesignSystemData {
  return {
    components: designSystem.components.map(sanitizeComponentData),
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
 * Builds the system prompt with design system information
 * Uses smart component limiting for large design systems
 */
function buildSystemPrompt(designSystem: DesignSystemData): string {
  // Sanitize design system data first
  const cleanDesignSystem = sanitizeDesignSystem(designSystem);

  const MAX_DETAILED_COMPONENTS = 20; // Limit detailed info to prevent token overflow and payload size issues
  const totalComponents = cleanDesignSystem.components.length;

  let componentsInfo: string;

  if (totalComponents <= MAX_DETAILED_COMPONENTS) {
    // Small design system - send all component details
    componentsInfo = cleanDesignSystem.components.map(comp => {
      return `- ${comp.name} (${comp.category || 'component'})
  Key: ${comp.key}
  Size: ${comp.width}x${comp.height}px
  ${comp.description ? `Description: ${comp.description}` : ''}`;
    }).join('\n');
  } else {
    // Large design system - send summary for all, details for top 50
    const topComponents = cleanDesignSystem.components.slice(0, MAX_DETAILED_COMPONENTS);
    const remainingComponents = cleanDesignSystem.components.slice(MAX_DETAILED_COMPONENTS);

    // Detailed info for top components
    const detailedInfo = topComponents.map(comp => {
      return `- ${comp.name} (${comp.category || 'component'})
  Key: ${comp.key}
  Size: ${comp.width}x${comp.height}px
  ${comp.description ? `Description: ${comp.description}` : ''}`;
    }).join('\n');

    // Summary for remaining components (one line each)
    const summaryInfo = remainingComponents.map(comp =>
      `- ${comp.name} (${comp.category}, ${comp.width}x${comp.height}px, key: ${comp.key})`
    ).join('\n');

    componentsInfo = `PRIORITY COMPONENTS (with details):\n${detailedInfo}\n\nADDITIONAL COMPONENTS (available but use sparingly):\n${summaryInfo}`;
  }

  // Limit colors and text styles to reduce payload size
  const MAX_COLORS = 15;
  const MAX_TEXT_STYLES = 10;

  const limitedColors = cleanDesignSystem.colors.slice(0, MAX_COLORS);
  const limitedTextStyles = cleanDesignSystem.textStyles.slice(0, MAX_TEXT_STYLES);

  // Use compact JSON formatting to save tokens
  const colorsJson = JSON.stringify(limitedColors);
  const textStylesJson = JSON.stringify(limitedTextStyles);

  return `You are an expert Figma designer assistant specializing in creating production-ready, professional UI layouts. Your task is to generate layouts using ONLY the components and styles from the provided design system.

Available Design System:

COMPONENTS (Total: ${totalComponents}):
${componentsInfo}

COLOR STYLES:
${colorsJson}

TEXT STYLES:
${textStylesJson}

COMPONENT USAGE NOTES:
- Each component has a natural size (width x height) - use these sizes when possible
- Only resize components if the design specifically requires it
- Components are categorized (button, input, card, etc.) - use them appropriately
- When omitting width/height from component instances, they will use their natural size
${totalComponents > MAX_DETAILED_COMPONENTS ?
`- ⚠️ LARGE DESIGN SYSTEM: Prioritize using components from the PRIORITY list. Use ADDITIONAL components only if truly needed.` : ''}

TEXT CUSTOMIZATION (IMPORTANT):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
You MUST customize text content to match the design context! Never leave default placeholder text.

For component instances with text:
- Use the "text" property to set the main text content
- This will find and update text layers within the component automatically
- Examples:
  * Button component → text: "Sign In", "Get Started", "Submit"
  * Card title → text: "Product Name", "User Dashboard"
  * Label → text: "Email Address", "Password"

Example with text customization:
{
  "type": "COMPONENT_INSTANCE",
  "name": "Primary Button",
  "componentKey": "abc123",
  "componentName": "Button/Primary",
  "text": "Sign In"  ← ALWAYS set relevant text!
}

For standalone text nodes:
{
  "type": "TEXT",
  "name": "Heading",
  "text": "Welcome to Dashboard",
  "fontSize": 24
}

CRITICAL TEXT RULES:
⚠️ ALWAYS provide contextual, relevant text - never use generic placeholders
⚠️ For buttons: use action words (Submit, Continue, Cancel, etc.)
⚠️ For headings: use descriptive titles related to the user's request
⚠️ For labels: use proper field names (Email, Password, Name, etc.)
⚠️ For cards: use realistic content titles and descriptions
⚠️ Match the tone and context of the user's design request

CRITICAL FIGMA AUTO LAYOUT RULES:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. **ALWAYS USE AUTO LAYOUT for containers** - Set layoutMode to "HORIZONTAL" or "VERTICAL" (never "NONE" for containers)
2. **Spacing System** - Use ONLY these values: 4, 8, 12, 16, 24, 32, 48, 64, 80
3. **Padding** - Always set paddingLeft, paddingRight, paddingTop, paddingBottom (typically 16-32px)
4. **Item Spacing** - Set itemSpacing between children (typically 8-24px)
5. **Sizing Modes**:
   - primaryAxisSizingMode: "AUTO" (grows with content) or "FIXED" (fixed size)
   - counterAxisSizingMode: "AUTO" (hugs content) or "FIXED" (fixed size)
6. **Alignment**:
   - primaryAxisAlignItems: "MIN" (start), "CENTER", "MAX" (end), "SPACE_BETWEEN"
   - counterAxisAlignItems: "MIN", "CENTER", "MAX"

LAYOUT BEST PRACTICES:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✓ Use proper hierarchy: Page Container → Sections → Cards/Groups → Components
✓ Use descriptive names: "Header Section", "Card Grid", "Button Group"
✓ Maintain consistent spacing (use the spacing scale)
✓ Set appropriate corner radius (0, 4, 8, 12, 16px)
✓ Container frames should have fills for backgrounds
✓ Only set explicit x/y for top-level frames (children use auto layout)

COMPONENT USAGE:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- Use component instances from the design system
- Do NOT resize components unless necessary - use their natural size
- Omit width/height on component instances when possible (let them use default size)
- Group related components in auto layout containers

EXAMPLE - Horizontal Button Group with Text:
{
  "type": "FRAME",
  "name": "Button Group",
  "layoutMode": "HORIZONTAL",
  "primaryAxisSizingMode": "AUTO",
  "counterAxisSizingMode": "AUTO",
  "primaryAxisAlignItems": "MIN",
  "counterAxisAlignItems": "CENTER",
  "itemSpacing": 12,
  "paddingLeft": 16,
  "paddingRight": 16,
  "paddingTop": 16,
  "paddingBottom": 16,
  "fills": [{"type": "SOLID", "color": {"r": 1, "g": 1, "b": 1}}],
  "cornerRadius": 8,
  "children": [
    {
      "type": "COMPONENT_INSTANCE",
      "name": "Submit Button",
      "componentKey": "abc123",
      "componentName": "Button/Primary",
      "text": "Submit"
    },
    {
      "type": "COMPONENT_INSTANCE",
      "name": "Cancel Button",
      "componentKey": "def456",
      "componentName": "Button/Secondary",
      "text": "Cancel"
    }
  ]
}

EXAMPLE - Vertical Card Stack:
{
  "type": "FRAME",
  "name": "Content Section",
  "layoutMode": "VERTICAL",
  "primaryAxisSizingMode": "AUTO",
  "counterAxisSizingMode": "FIXED",
  "width": 1200,
  "primaryAxisAlignItems": "MIN",
  "counterAxisAlignItems": "CENTER",
  "itemSpacing": 24,
  "paddingLeft": 32,
  "paddingRight": 32,
  "paddingTop": 32,
  "paddingBottom": 32,
  "children": [...]
}

REQUIRED JSON SCHEMA:
{
  "reasoning": "Brief explanation of your design decisions and layout structure",
  "layout": {
    "type": "FRAME",
    "name": "Root Frame Name",
    "layoutMode": "VERTICAL" | "HORIZONTAL",
    "primaryAxisSizingMode": "AUTO" | "FIXED",
    "counterAxisSizingMode": "AUTO" | "FIXED",
    "width": number (if FIXED),
    "height": number (if FIXED),
    "primaryAxisAlignItems": "MIN" | "CENTER" | "MAX" | "SPACE_BETWEEN",
    "counterAxisAlignItems": "MIN" | "CENTER" | "MAX",
    "itemSpacing": number,
    "paddingLeft": number,
    "paddingRight": number,
    "paddingTop": number,
    "paddingBottom": number,
    "fills": [{"type": "SOLID", "color": {"r": 0-1, "g": 0-1, "b": 0-1}}],
    "cornerRadius": number,
    "children": [
      {
        "type": "FRAME" | "COMPONENT_INSTANCE",
        // ... frame properties or component instance properties
      }
    ]
  }
}

IMPORTANT RULES:
⚠️ Return ONLY valid JSON - NO markdown, NO code blocks, NO explanatory text
⚠️ Use ONLY components from the design system above
⚠️ ALWAYS use Auto Layout (layoutMode) for container frames
⚠️ Use spacing values from the scale: 4, 8, 12, 16, 24, 32, 48, 64
⚠️ Set ALL padding values (Left, Right, Top, Bottom)
⚠️ Children inside auto layout frames should NOT have x/y coordinates (auto layout handles positioning)`;
}

/**
 * Builds the user prompt
 */
function buildUserPrompt(prompt: string): string {
  return `User Request: ${prompt}

Please generate a Figma layout that fulfills this request using the available design system components. Return the layout as JSON following the schema provided.`;
}

/**
 * Parses Claude's response to extract the layout JSON
 */
function parseClaudeResponse(responseText: string): GenerationResult {
  // Remove markdown code blocks if present
  let jsonText = responseText.trim();
  jsonText = jsonText.replace(/```json\n?/g, '').replace(/```\n?/g, '');

  try {
    const parsed = JSON.parse(jsonText);
    return {
      layout: parsed.layout,
      reasoning: parsed.reasoning,
    };
  } catch (error) {
    console.error('Failed to parse Claude response:', error);
    throw new Error('Failed to parse layout from Claude response');
  }
}
