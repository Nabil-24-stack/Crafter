import type { VercelRequest, VercelResponse } from '@vercel/node';

interface DesignSystemData {
  components: Array<{
    id: string;
    name: string;
    key: string;
    description?: string;
    type: string;
    width?: number;
    height?: number;
    category?: string;
  }>;
  colors: Array<any>;
  textStyles: Array<any>;
}

interface Concept {
  id: string;
  caption: string;
  layout: Array<{
    component: string;
    area: string;
    width?: string;
    height?: string;
  }>;
}

/**
 * API endpoint to generate 10 high-level layout concept ideas
 * Uses Claude 4.5 to brainstorm design variations
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
    const { prompt, designSystem } = req.body as {
      prompt: string;
      designSystem: DesignSystemData;
    };

    if (!prompt || !designSystem) {
      res.status(400).json({
        error: 'Missing required fields: prompt and designSystem are required',
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

    // Build a lightweight component summary (limit to avoid token overflow)
    const componentSummary = buildComponentSummary(designSystem);

    // Build the ideation prompt
    const systemPrompt = buildIdeationSystemPrompt(componentSummary);
    const userPrompt = `User's design request: "${prompt}"

Generate 10 distinct high-level layout concepts. Return ONLY valid JSON array, no explanations.`;

    console.log('Calling Claude API for ideation...');

    // Call Claude API
    const claudeResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 4096, // Concepts are lightweight
        messages: [
          {
            role: 'user',
            content: `${systemPrompt}\n\n${userPrompt}`,
          },
        ],
      }),
    });

    if (!claudeResponse.ok) {
      const errorText = await claudeResponse.text();
      throw new Error(`Claude API error ${claudeResponse.status}: ${errorText}`);
    }

    const data = await claudeResponse.json();
    const responseText = data.content[0]?.text || '[]';

    console.log('Claude response received');

    // Parse the concepts
    const concepts = parseConceptsResponse(responseText);

    // Return the concepts
    res.status(200).json({ concepts });
  } catch (error) {
    console.error('Error in generate-ideas handler:', error);

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    res.status(500).json({
      error: 'Failed to generate ideas',
      message: errorMessage,
    });
  }
}

/**
 * Build a lightweight component summary for ideation
 * Limits to top 100 components to avoid token overflow
 */
function buildComponentSummary(designSystem: DesignSystemData): string {
  const MAX_COMPONENTS = 100;
  const components = designSystem.components.slice(0, MAX_COMPONENTS);

  // Group by category for better organization
  const categorized: Record<string, string[]> = {};

  components.forEach((comp) => {
    const category = comp.category || 'general';
    if (!categorized[category]) {
      categorized[category] = [];
    }
    categorized[category].push(comp.name);
  });

  // Build summary by category
  const summary = Object.entries(categorized)
    .map(([category, names]) => {
      return `${category}: ${names.slice(0, 20).join(', ')}${names.length > 20 ? '...' : ''}`;
    })
    .join('\n');

  return summary;
}

/**
 * Build system prompt for ideation
 */
function buildIdeationSystemPrompt(componentSummary: string): string {
  return `You are an expert product designer brainstorming high-level layout concepts.

Available component categories:
${componentSummary}

YOUR TASK:
Generate 10 distinct, creative layout concepts based on the user's request. Each concept should represent a different approach to organizing the interface.

Think about:
- Different navigation patterns (top nav, sidebar, tabs, bottom nav)
- Content organization (grid, list, cards, columns)
- Layout structures (single column, multi-column, dashboard, form-based)
- Visual hierarchies (hero sections, split views, centered content)

RESPONSE FORMAT (JSON array only, no markdown, no explanations):
[
  {
    "id": "concept-1",
    "caption": "Brief 3-5 word description of this layout approach",
    "layout": [
      {"component": "TopNav", "area": "top", "width": "100%", "height": "64px"},
      {"component": "Hero", "area": "center", "width": "100%"},
      {"component": "CardGrid", "area": "main"}
    ]
  },
  {
    "id": "concept-2",
    "caption": "Another layout approach",
    "layout": [
      {"component": "Sidebar", "area": "left", "width": "280px"},
      {"component": "ContentArea", "area": "center"}
    ]
  }
]

RULES:
- Generate EXACTLY 10 concepts
- Each concept must have a unique id (concept-1 through concept-10)
- Caption should be 3-5 words describing the layout approach
- Layout array should have 2-5 high-level zones
- Use area values: "top", "left", "right", "center", "main", "bottom"
- Keep it abstract and high-level (these are concepts, not detailed implementations)
- Return ONLY the JSON array, no markdown code blocks, no explanations
- Each concept should be meaningfully different from the others`;
}

/**
 * Parse Claude's response to extract concepts
 */
function parseConceptsResponse(responseText: string): Concept[] {
  let text = responseText.trim();

  // Remove markdown code blocks if present
  text = text.replace(/```json\n?/g, '').replace(/```\n?/g, '');

  // Try to find JSON array
  const arrayMatch = text.match(/\[[\s\S]*\]/);
  if (arrayMatch) {
    text = arrayMatch[0];
  }

  try {
    const concepts = JSON.parse(text);

    if (!Array.isArray(concepts)) {
      throw new Error('Response is not an array');
    }

    // Validate and ensure we have exactly 10 concepts
    const validConcepts = concepts.filter(
      (c) => c.id && c.caption && Array.isArray(c.layout)
    );

    // If we got fewer than 10, pad with simple concepts
    while (validConcepts.length < 10) {
      validConcepts.push({
        id: `concept-${validConcepts.length + 1}`,
        caption: 'Simple layout',
        layout: [
          { component: 'Container', area: 'center' },
        ],
      });
    }

    return validConcepts.slice(0, 10);
  } catch (error) {
    console.error('Failed to parse concepts:', error);
    console.error('Response text:', text);

    // Return fallback concepts
    return Array.from({ length: 10 }, (_, i) => ({
      id: `concept-${i + 1}`,
      caption: 'Layout concept',
      layout: [
        { component: 'Container', area: 'center' },
      ],
    }));
  }
}
