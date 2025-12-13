import type { VercelRequest, VercelResponse } from '@vercel/node';

interface VariationResult {
  index: number;
  status: 'complete' | 'error';
  subPrompt?: string;
  reasoning?: string;
  error?: string;
}

/**
 * API endpoint to generate an iteration summary
 * Uses Claude 4.5 to analyze all variations and create a concise summary
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
    const { masterPrompt, variations, model } = req.body as {
      masterPrompt: string;
      variations: VariationResult[];
      model?: 'claude' | 'gemini';
    };

    const selectedModel = model || 'claude';

    console.log('Received summary request:', {
      hasMasterPrompt: !!masterPrompt,
      hasVariations: !!variations,
      numVariations: variations?.length,
      model: selectedModel,
    });

    if (!masterPrompt || !variations || !Array.isArray(variations)) {
      const missingFields = [];
      if (!masterPrompt) missingFields.push('masterPrompt');
      if (!variations) missingFields.push('variations');
      if (variations && !Array.isArray(variations)) missingFields.push('variations (must be array)');

      res.status(400).json({
        error: 'Missing or invalid required fields',
        missingFields,
        received: { masterPrompt: !!masterPrompt, variations: !!variations, isArray: Array.isArray(variations) },
      });
      return;
    }

    // Build the prompt
    const systemPrompt = buildSummarySystemPrompt();
    const userPrompt = buildSummaryUserPrompt(masterPrompt, variations);

    console.log(`Calling ${selectedModel === 'gemini' ? 'Gemini' : 'Claude'} API to generate iteration summary...`);

    let summary = '';

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
      summary = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || '';
    } else {
      // Call Claude API
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) {
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
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-5',
          max_tokens: 512, // Summaries should be concise
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

      const data = await claudeResponse.json() as any;
      summary = data.content?.[0]?.text || '';
    }

    console.log('Summary generated successfully');

    // Return the summary
    res.status(200).json({ summary: summary.trim() });
  } catch (error) {
    console.error('Error in generate-iteration-summary handler:', error);

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    res.status(500).json({
      error: 'Failed to generate iteration summary',
      message: errorMessage,
    });
  }
}

/**
 * Build system prompt for summary generation
 */
function buildSummarySystemPrompt(): string {
  return `You are an AI design assistant summarizing iteration results for a user.

Your task is to write a concise, helpful summary of design variations that were just created.

TONE & STYLE:
- Conversational and supportive (use "I've" not "The system has")
- Concise (2-4 sentences maximum)
- Focus on what makes each variation distinct
- If some variations failed, acknowledge it without dwelling on it

WHAT TO INCLUDE:
- Count of successful variations
- Key differences between the variations (what axes they explored)
- Brief mention of approach diversity

WHAT TO AVOID:
- Technical jargon or implementation details
- Overly enthusiastic or marketing language
- Listing every single detail
- Making it sound like a status report

EXAMPLES:

Good:
"I've designed 3 variations for your dashboard. Each explores a different layout approach — one uses a grid-based, data-dense style, another has a sidebar with card layout in a minimal mood, and the third features a timeline view with asymmetrical composition."

"I've created 2 out of 3 requested variations. The first takes a hero-driven approach with bold typography, while the second uses a split layout with editorial styling. The third variation encountered an error during generation."

Bad (too technical):
"I have successfully completed the iteration process and generated 3 design variations using the Claude 4.5 model with your design system parameters."

Bad (too brief):
"Done. 3 variations created."

Bad (too long):
"I've designed 3 variations. The first variation uses components X, Y, Z with a grid layout and features... The second variation takes a different approach by implementing... The third variation explores..."`;
}

/**
 * Build user prompt for summary generation
 */
function buildSummaryUserPrompt(
  masterPrompt: string,
  variations: VariationResult[]
): string {
  const totalVariations = variations.length;
  const completedVariations = variations.filter(v => v.status === 'complete');
  const errorVariations = variations.filter(v => v.status === 'error');

  let prompt = `User's original request: "${masterPrompt}"\n\n`;
  prompt += `Total variations requested: ${totalVariations}\n`;
  prompt += `Completed: ${completedVariations.length}\n`;
  if (errorVariations.length > 0) {
    prompt += `Failed: ${errorVariations.length}\n`;
  }
  prompt += `\nVariation details:\n`;

  variations.forEach((variation, index) => {
    prompt += `\nVariation ${index + 1}:\n`;
    prompt += `Status: ${variation.status}\n`;
    if (variation.subPrompt) {
      prompt += `Direction: ${variation.subPrompt}\n`;
    }
    if (variation.reasoning) {
      prompt += `Reasoning: ${variation.reasoning}\n`;
    }
    if (variation.error) {
      prompt += `Error: ${variation.error}\n`;
    }
  });

  prompt += `\nWrite a concise summary (2-4 sentences) for the user explaining what was created.`;

  return prompt;
}
