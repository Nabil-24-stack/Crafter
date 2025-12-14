import type { VercelRequest, VercelResponse } from '@vercel/node';

interface FlowFrame {
  frameId: string;
  frameName: string;
  imageData: string;
  structuralHints?: any;
}

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

interface FlowAnalysisRequest {
  prompt: string;
  frames: FlowFrame[];
  flowName: string;
  designSystem: DesignSystemData;
  model?: 'claude' | 'gemini';
}

interface FlowAnalysisResponse {
  variationCount: number;
  rationale: string;
  flowImprovements: string[];
  frameSpecificNeeds: Array<{
    frameName: string;
    improvements: string[];
  }>;
}

/**
 * API endpoint to analyze a multi-frame flow and determine what improvements are needed
 * Uses AI to identify UX flow issues and suggest contextual improvements
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
    const { prompt, frames, flowName, designSystem, model } = req.body as FlowAnalysisRequest;

    // Default to Gemini for flow analysis (better at understanding multiple screens)
    const selectedModel = model || 'gemini';

    console.log('Analyzing flow needs:', {
      hasPrompt: !!prompt,
      frameCount: frames?.length,
      flowName,
      hasDesignSystem: !!designSystem,
      model: selectedModel,
    });

    if (!prompt || !frames || frames.length < 2 || frames.length > 5 || !designSystem) {
      res.status(400).json({
        error: 'Invalid request. Requires prompt, designSystem, and 2-5 frames.',
      });
      return;
    }

    // Build the analysis prompt
    const systemPrompt = buildFlowAnalysisSystemPrompt();
    const userPrompt = buildFlowAnalysisUserPrompt(prompt, frames, flowName, designSystem);

    console.log(`Calling ${selectedModel === 'gemini' ? 'Gemini' : 'Claude'} API to analyze flow needs...`);

    let responseText: string;

    if (selectedModel === 'gemini') {
      // Call Gemini API with vision capability
      const geminiApiKey = process.env.GEMINI_API_KEY;
      if (!geminiApiKey) {
        console.error('GEMINI_API_KEY not configured');
        res.status(500).json({
          error: 'Server configuration error: Gemini API key not found',
        });
        return;
      }

      // Prepare multi-image content for Gemini
      const parts = [
        {
          text: `${systemPrompt}\n\n${userPrompt}`,
        },
      ];

      // Add each frame image
      frames.forEach((frame, index) => {
        parts.push({
          text: `Frame ${index + 1}: ${frame.frameName}`,
        });
        parts.push({
          inline_data: {
            mime_type: 'image/png',
            data: frame.imageData,
          },
        } as any);
      });

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
                parts,
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
      console.log('Gemini flow analysis complete');
    } else {
      // Call Claude API with vision capability
      const claudeApiKey = process.env.ANTHROPIC_API_KEY;
      if (!claudeApiKey) {
        console.error('ANTHROPIC_API_KEY not configured');
        res.status(500).json({
          error: 'Server configuration error: Claude API key not found',
        });
        return;
      }

      // Prepare multi-image content for Claude
      const content = [
        {
          type: 'text',
          text: `${systemPrompt}\n\n${userPrompt}`,
        },
      ];

      // Add each frame image
      frames.forEach((frame, index) => {
        content.push({
          type: 'text',
          text: `Frame ${index + 1}: ${frame.frameName}`,
        });
        content.push({
          type: 'image',
          source: {
            type: 'base64',
            media_type: 'image/png',
            data: frame.imageData,
          },
        } as any);
      });

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
              content,
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
      console.log('Claude flow analysis complete');
    }

    // Parse the analysis response
    const analysis = parseFlowAnalysisResponse(responseText);

    // Return the analysis
    res.status(200).json(analysis);
  } catch (error) {
    console.error('Error in analyze-flow-needs handler:', error);

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    res.status(500).json({
      error: 'Failed to analyze flow needs',
      message: errorMessage,
    });
  }
}

/**
 * Build system prompt for flow analysis
 */
function buildFlowAnalysisSystemPrompt(): string {
  return `You are an expert UX designer analyzing multi-screen user flows to identify improvements and variations needed.

YOUR TASK:
Analyze the sequence of screens provided and determine:
1. How many variations would be meaningful (3-5 variations recommended for flows)
2. What flow-level improvements should be made
3. What screen-specific improvements are needed

FLOW ANALYSIS CRITERIA:

1. CONSISTENCY & COHESION:
   - Visual consistency across screens
   - Navigation patterns consistency
   - Information architecture alignment
   - Component reuse opportunities

2. USER JOURNEY OPTIMIZATION:
   - Identify friction points in the flow
   - Spot missing states (loading, error, success)
   - Find opportunities to reduce steps
   - Improve information progression

3. INTERACTION PATTERNS:
   - Consistent interaction models
   - Clear feedback mechanisms
   - Predictable user actions
   - Progressive disclosure

4. FLOW VARIATIONS TO CONSIDER:
   - Different user paths (new vs returning users)
   - Alternative navigation approaches
   - Different information densities
   - Various visual treatments
   - Different state handling

QUALITY PRINCIPLES:
- Focus on the flow as a whole, not just individual screens
- Each variation should explore a distinct approach to the flow
- Consider how screens connect and transition
- Think about the overall user goal

LIMITS:
- Minimum: 3 variations (flows benefit from multiple approaches)
- Maximum: 5 variations (to keep variations meaningful)
- Each variation should improve the entire flow, not just one screen

RESPONSE FORMAT:
Return ONLY a JSON object with this structure:
{
  "variationCount": [number between 3-5],
  "rationale": "[1-2 sentence explanation of variation strategy]",
  "flowImprovements": ["improvement1", "improvement2", ...],
  "frameSpecificNeeds": [
    {
      "frameName": "Screen name",
      "improvements": ["need1", "need2"]
    }
  ]
}

No markdown, no code blocks, just the JSON object.`;
}

/**
 * Build user prompt for flow analysis
 */
function buildFlowAnalysisUserPrompt(
  userPrompt: string,
  frames: FlowFrame[],
  flowName: string,
  designSystem?: DesignSystemData
): string {
  let prompt = `User's request: "${userPrompt}"\n\n`;
  prompt += `Flow name: ${flowName}\n`;
  prompt += `Number of screens: ${frames.length}\n`;
  prompt += `Screen names: ${frames.map(f => f.frameName).join(', ')}\n\n`;

  if (designSystem) {
    prompt += `Available design system components: ${designSystem.components.slice(0, 10).map(c => c.name).join(', ')}...\n`;
    prompt += `Color styles: ${designSystem.colors.length} colors available\n`;
    prompt += `Text styles: ${designSystem.textStyles.length} text styles available\n\n`;
  }

  prompt += `Analyze the provided screens as a connected user flow and determine:
1. How many meaningful variations should be created (3-5)
2. What overall flow improvements are needed
3. What specific improvements each screen needs within the flow context

Remember: Focus on flow cohesion and user journey optimization.`;

  return prompt;
}

/**
 * Parse the AI's analysis response
 */
function parseFlowAnalysisResponse(responseText: string): FlowAnalysisResponse {
  try {
    // Try to extract JSON from the response
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No JSON found in response');
    }

    const parsed = JSON.parse(jsonMatch[0]);

    // Validate and sanitize the response
    const variationCount = Math.min(5, Math.max(3, parsed.variationCount || 3));

    return {
      variationCount,
      rationale: parsed.rationale || `Creating ${variationCount} flow variations to explore different user journey approaches.`,
      flowImprovements: parsed.flowImprovements || [
        'Improve visual consistency across screens',
        'Optimize navigation patterns',
        'Add missing states and transitions',
      ],
      frameSpecificNeeds: parsed.frameSpecificNeeds || [],
    };
  } catch (error) {
    console.error('Failed to parse flow analysis response:', error);

    // Return sensible defaults for flow analysis
    return {
      variationCount: 3,
      rationale: 'Creating 3 flow variations to explore different approaches to the user journey.',
      flowImprovements: [
        'Improve flow consistency',
        'Optimize user journey',
        'Add transitions and states',
      ],
      frameSpecificNeeds: [],
    };
  }
}