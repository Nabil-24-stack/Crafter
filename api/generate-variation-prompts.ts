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

/**
 * API endpoint to generate dynamic variation sub-prompts
 * Uses Claude 4.5 to create contextual variation directions
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
    const { prompt, numVariations, designSystem, model } = req.body as {
      prompt: string;
      numVariations: number;
      designSystem: DesignSystemData;
      model?: 'claude' | 'gemini';
    };

    // Default to Claude if no model specified
    const selectedModel = model || 'claude';

    console.log('Received request:', {
      hasPrompt: !!prompt,
      hasNumVariations: !!numVariations,
      hasDesignSystem: !!designSystem,
      numVariations,
      model: selectedModel,
      designSystemKeys: designSystem ? Object.keys(designSystem) : 'null',
    });

    if (!prompt || !numVariations || !designSystem) {
      const missingFields = [];
      if (!prompt) missingFields.push('prompt');
      if (!numVariations) missingFields.push('numVariations');
      if (!designSystem) missingFields.push('designSystem');

      res.status(400).json({
        error: 'Missing required fields',
        missingFields,
        received: { prompt: !!prompt, numVariations: !!numVariations, designSystem: !!designSystem },
      });
      return;
    }

    if (numVariations < 1 || numVariations > 10) {
      res.status(400).json({
        error: 'numVariations must be between 1 and 10',
      });
      return;
    }

    // Build the prompt
    const systemPrompt = buildVariationPromptSystemPrompt(designSystem);
    const userPrompt = `User's original design request: "${prompt}"

Generate ${numVariations} distinct variation direction${numVariations > 1 ? 's' : ''}.

Return ONLY a JSON array of ${numVariations} string${numVariations > 1 ? 's' : ''}, no explanations.

Example format:
["${prompt} — [specific variation direction 1]", "${prompt} — [specific variation direction 2]"]`;

    console.log(`Calling ${selectedModel === 'gemini' ? 'Gemini' : 'Claude'} API to generate ${numVariations} variation prompts...`);

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
      responseText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || '[]';
      console.log('Gemini response received');
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
          max_tokens: 1024, // Variation prompts are short
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
      responseText = claudeData.content?.[0]?.text || '[]';
      console.log('Claude response received');
    }

    // Parse the variation prompts
    const variationPrompts = parseVariationPromptsResponse(responseText, numVariations, prompt);

    // Return the prompts
    res.status(200).json({ variationPrompts });
  } catch (error) {
    console.error('Error in generate-variation-prompts handler:', error);

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    res.status(500).json({
      error: 'Failed to generate variation prompts',
      message: errorMessage,
    });
  }
}

/**
 * Build system prompt for variation prompt generation
 */
function buildVariationPromptSystemPrompt(designSystem: DesignSystemData): string {
  // Get a summary of available components
  const componentCategories = new Set<string>();
  designSystem.components.slice(0, 100).forEach(comp => {
    componentCategories.add(comp.category || 'general');
  });

  const categorySummary = Array.from(componentCategories).join(', ');

  return `You are an expert UI/UX designer generating variation directions for design exploration.

Available component categories: ${categorySummary}

YOUR TASK:
Generate distinct, contextually relevant variation directions based on the user's design request.
Each variation should explore a meaningfully different approach.

VARIATION AXES TO CONSIDER:
1. Layout structure: single column, split view, grid, sidebar, card-based, timeline, dashboard
2. Visual mood: minimal, bold, editorial, futuristic, playful, data-dense, elegant
3. Interaction emphasis: navigation-centric, analytics-focused, social, input-heavy, browsing-focused
4. Composition rhythm: symmetrical, asymmetrical, stacked, masonry, centered, edge-aligned
5. Content hierarchy: hero-driven, equal-weight sections, progressive disclosure, scannable cards

RULES:
- Each variation direction should change at least TWO of the above axes
- Keep directions concise (5-10 words after the "—")
- Make them specific and actionable (not vague like "different style")
- Ensure they're contextually appropriate for the user's request
- Each should feel distinct from the others
- QUALITY OVER QUANTITY: Only generate meaningful variations
- Each variation must serve a clear purpose and add value
- Don't create filler variations just to reach the requested count

Good examples:
- "Create a dashboard — Grid-based, data-dense, analytics-focused"
- "Create a dashboard — Sidebar navigation, card layout, minimal mood"
- "Create a landing page — Hero-driven, bold typography, centered composition"
- "Create a landing page — Split layout, editorial style, asymmetrical rhythm"

Bad examples:
- "Create a dashboard — Different colors" (too vague, not structural)
- "Create a dashboard — Better layout" (not specific)
- "Create a dashboard — Variation 1" (meaningless label)

RESPONSE FORMAT:
Return ONLY a JSON array of strings. Each string is the original prompt + " — " + variation direction.
No markdown code blocks, no explanations, just the JSON array.`;
}

/**
 * Parse Claude's response to extract variation prompts
 */
function parseVariationPromptsResponse(
  responseText: string,
  expectedCount: number,
  originalPrompt: string
): string[] {
  let text = responseText.trim();

  // Remove markdown code blocks if present
  text = text.replace(/```json\n?/g, '').replace(/```\n?/g, '');

  // Try to find JSON array
  const arrayMatch = text.match(/\[[\s\S]*\]/);
  if (arrayMatch) {
    text = arrayMatch[0];
  }

  try {
    const prompts = JSON.parse(text);

    if (!Array.isArray(prompts)) {
      throw new Error('Response is not an array');
    }

    // Validate that we have strings
    const validPrompts = prompts.filter((p) => typeof p === 'string' && p.length > 0);

    // If we got fewer than expected, pad with fallback prompts
    const fallbackDirections = [
      'Tighter layout, emphasize primary actions',
      'Balanced composition, alternate arrangements',
      'More whitespace, simplified hierarchy',
      'Bold typography, strong visual hierarchy',
      'Minimal approach, focus on content',
      'Card-based layout, modular structure',
      'Dense information display, data-focused',
      'Asymmetrical design, dynamic composition',
      'Split-screen layout, dual focus areas',
      'Progressive disclosure, layered information',
    ];

    while (validPrompts.length < expectedCount) {
      const fallbackIndex = validPrompts.length;
      validPrompts.push(
        `${originalPrompt} — ${fallbackDirections[fallbackIndex] || 'Alternative layout'}`
      );
    }

    return validPrompts.slice(0, expectedCount);
  } catch (error) {
    console.error('Failed to parse variation prompts:', error);
    console.error('Response text:', text);

    // Return fallback prompts
    const fallbackDirections = [
      'Tighter layout, emphasize primary actions',
      'Balanced composition, alternate arrangements',
      'More whitespace, simplified hierarchy',
      'Bold typography, strong visual hierarchy',
      'Minimal approach, focus on content',
      'Card-based layout, modular structure',
      'Dense information display, data-focused',
      'Asymmetrical design, dynamic composition',
      'Split-screen layout, dual focus areas',
      'Progressive disclosure, layered information',
    ];

    return fallbackDirections.slice(0, expectedCount).map(
      (direction) => `${originalPrompt} — ${direction}`
    );
  }
}
