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
  visualLanguage?: string;
}

interface AnalysisRequest {
  prompt: string;
  designSystem: DesignSystemData;
  frameContext?: {
    name?: string;
    type?: string;
    componentCount?: number;
    hasText?: boolean;
    hasImages?: boolean;
  };
  model?: 'claude' | 'gemini';
}

interface AnalysisResponse {
  variationCount: number;
  rationale: string;
  categories: string[];
}

/**
 * API endpoint to analyze user prompt and determine optimal variation count
 * Uses AI to intelligently decide how many variations are meaningful
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
    const { prompt, designSystem, frameContext, model } = req.body as AnalysisRequest;

    // Default to Claude if no model specified
    const selectedModel = model || 'claude';

    console.log('Analyzing variation needs:', {
      hasPrompt: !!prompt,
      hasDesignSystem: !!designSystem,
      hasFrameContext: !!frameContext,
      model: selectedModel,
    });

    if (!prompt || !designSystem) {
      res.status(400).json({
        error: 'Missing required fields: prompt and designSystem',
      });
      return;
    }

    // Build the analysis prompt
    const systemPrompt = buildAnalysisSystemPrompt();
    const userPrompt = buildAnalysisUserPrompt(prompt, frameContext, designSystem);

    console.log(`Calling ${selectedModel === 'gemini' ? 'Gemini' : 'Claude'} API to analyze variation needs...`);

    let responseText: string;

    if (selectedModel === 'gemini') {
      // Call Gemini API
      const geminiApiKey = process.env.GEMINI_API_KEY;
      if (!geminiApiKey) {
        console.error('GEMINI_API_KEY not configured');
        res.status(500).json({
          error: 'Server configuration error: Gemini API key not found',
        });
        return;
      }

      const geminiResponse = await fetch(
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-preview:generateContent',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': geminiApiKey,
          },
          body: JSON.stringify({
            contents: [
              {
                parts: [
                  {
                    text: `${systemPrompt}\n\n${userPrompt}`,
                  },
                ],
              },
            ],
          }),
        }
      );

      if (!geminiResponse.ok) {
        const errorText = await geminiResponse.text();
        throw new Error(`Gemini API error ${geminiResponse.status}: ${errorText}`);
      }

      const geminiData = await geminiResponse.json() as any;
      responseText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
      console.log('Gemini analysis complete');
    } else {
      // Call Claude API (default)
      const claudeApiKey = process.env.ANTHROPIC_API_KEY;
      if (!claudeApiKey) {
        console.error('ANTHROPIC_API_KEY not configured');
        res.status(500).json({
          error: 'Server configuration error: Claude API key not found',
        });
        return;
      }

      const claudeResponse = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': claudeApiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-5',
          max_tokens: 1024,
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

      const claudeData = await claudeResponse.json() as any;
      responseText = claudeData.content?.[0]?.text || '{}';
      console.log('Claude analysis complete');
    }

    // Parse the analysis response
    const analysis = parseAnalysisResponse(responseText);

    // Return the analysis
    res.status(200).json(analysis);
  } catch (error) {
    console.error('Error in analyze-variation-needs handler:', error);

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    res.status(500).json({
      error: 'Failed to analyze variation needs',
      message: errorMessage,
    });
  }
}

/**
 * Build system prompt for variation analysis
 */
function buildAnalysisSystemPrompt(): string {
  return `You are an expert UI/UX designer analyzing design iteration requests to determine the optimal number of variations needed.

YOUR TASK:
Analyze the user's design request and determine how many variations would be meaningful and valuable.

DECISION CRITERIA:

1. ERROR STATES:
   - If the request is about error states, count distinct error scenarios
   - Common error states: empty, network error, validation error, permission denied, server error, timeout
   - Only include error states that make sense for the specific component

2. UI ALTERNATIVES:
   - If the request is about different layouts or designs
   - Consider meaningfully different approaches (not just minor tweaks)
   - Think about: layout structure, visual hierarchy, interaction patterns
   - Each variation should offer a distinct value proposition

3. USER SCENARIOS:
   - Different user contexts (logged in/out, new/returning, etc.)
   - Different data states (empty, few items, many items)
   - Different device contexts if relevant

4. DESIGN PATTERNS:
   - Industry-standard variations for the component type
   - Common patterns users would expect to compare

QUALITY PRINCIPLES:
- Every variation must be meaningful and serve a clear purpose
- Quality over quantity - don't add filler variations
- Consider the complexity of implementation
- Think about what would actually help the user make design decisions
- If only 2 good variations exist, return 2, not 10

LIMITS:
- Minimum: 1 variation (when the request is very specific)
- Maximum: 10 variations (even if more could theoretically exist)
- Sweet spot: 3-6 variations for most requests

RESPONSE FORMAT:
Return ONLY a JSON object with this structure:
{
  "variationCount": [number between 1-10],
  "rationale": "[1-2 sentence explanation of why this count makes sense]",
  "categories": ["category1", "category2", ...] // what types of variations will be generated
}

No markdown, no code blocks, just the JSON object.`;
}

/**
 * Build user prompt for variation analysis
 */
function buildAnalysisUserPrompt(
  userPrompt: string,
  frameContext?: any,
  designSystem?: DesignSystemData
): string {
  let contextInfo = '';

  if (frameContext) {
    contextInfo = `
Selected Frame Context:
- Name: ${frameContext.name || 'Untitled'}
- Type: ${frameContext.type || 'Unknown'}
- Contains ${frameContext.componentCount || 0} components
- Has text: ${frameContext.hasText ? 'Yes' : 'No'}
- Has images: ${frameContext.hasImages ? 'Yes' : 'No'}`;
  }

  const componentCategories = new Set<string>();
  if (designSystem?.components) {
    designSystem.components.forEach(comp => {
      if (comp.category) {
        componentCategories.add(comp.category);
      }
    });
  }

  const availableComponents = componentCategories.size > 0
    ? `\nAvailable component categories in design system: ${Array.from(componentCategories).join(', ')}`
    : '';

  return `User's Design Request: "${userPrompt}"${contextInfo}${availableComponents}

Analyze this request and determine the optimal number of variations to generate.

Consider:
1. What is the user asking for? (error states, layout alternatives, styling options, etc.)
2. How many meaningfully different variations would provide value?
3. Would generating more variations just create redundancy?
4. What's the minimum needed to satisfy the request properly?

Return the JSON object with your analysis.`;
}

/**
 * Parse the AI's analysis response
 */
function parseAnalysisResponse(responseText: string): AnalysisResponse {
  let text = responseText.trim();

  // Remove markdown code blocks if present
  text = text.replace(/```json\n?/g, '').replace(/```\n?/g, '');

  // Try to find JSON object
  const objectMatch = text.match(/\{[\s\S]*\}/);
  if (objectMatch) {
    text = objectMatch[0];
  }

  try {
    const parsed = JSON.parse(text);

    // Validate the response
    let variationCount = parsed.variationCount || parsed.count || 3;

    // Ensure it's within bounds
    variationCount = Math.max(1, Math.min(10, Math.floor(variationCount)));

    const rationale = parsed.rationale ||
      `Generating ${variationCount} variations to explore different approaches.`;

    const categories = parsed.categories ||
      (variationCount <= 3 ? ['layout alternatives'] :
       variationCount <= 6 ? ['layout alternatives', 'visual styles'] :
       ['layout alternatives', 'visual styles', 'interaction patterns']);

    return {
      variationCount,
      rationale,
      categories: Array.isArray(categories) ? categories : [categories],
    };
  } catch (error) {
    console.error('Failed to parse analysis response:', error);
    console.error('Response text:', text);

    // Return sensible defaults based on prompt keywords
    const promptLower = responseText.toLowerCase();

    if (promptLower.includes('error') || promptLower.includes('state')) {
      return {
        variationCount: 5,
        rationale: 'Generating common error and state variations.',
        categories: ['error states', 'user states'],
      };
    }

    if (promptLower.includes('layout') || promptLower.includes('different')) {
      return {
        variationCount: 4,
        rationale: 'Generating different layout approaches.',
        categories: ['layout alternatives'],
      };
    }

    // Default fallback
    return {
      variationCount: 3,
      rationale: 'Generating a balanced set of variations to explore different approaches.',
      categories: ['design alternatives'],
    };
  }
}