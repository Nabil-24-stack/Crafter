// Simple proxy server for Crafter Figma plugin
// This server forwards requests to the Anthropic API to avoid CORS issues

const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS for all origins (Figma plugin can call this)
app.use(cors());
app.use(express.json());

// Health check endpoint
app.get('/', (req, res) => {
  res.json({ status: 'Crafter Proxy Server Running', version: '1.0.0' });
});

// Proxy endpoint for Claude API
app.post('/api/generate', async (req, res) => {
  try {
    const { prompt, designSystem } = req.body;

    if (!prompt || !designSystem) {
      return res.status(400).json({ error: 'Missing prompt or designSystem' });
    }

    // Get API key from environment variable
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'Server not configured with API key' });
    }

    // Build the system prompt
    const systemPrompt = buildSystemPrompt(designSystem);
    const userPrompt = buildUserPrompt(prompt);

    // Call Claude API
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4096,
        messages: [
          {
            role: 'user',
            content: `${systemPrompt}\n\n${userPrompt}`,
          },
        ],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Claude API error:', response.status, errorText);
      return res.status(response.status).json({
        error: `Claude API error: ${response.status}`,
        details: errorText
      });
    }

    const data = await response.json();
    const responseText = data.content[0]?.text || '';

    // Parse the JSON response from Claude
    const layoutResult = parseClaudeResponse(responseText);

    res.json(layoutResult);
  } catch (error) {
    console.error('Error in proxy server:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
});

/**
 * Builds the system prompt with design system information
 */
function buildSystemPrompt(designSystem) {
  const componentsJson = JSON.stringify(designSystem.components, null, 2);
  const colorsJson = JSON.stringify(designSystem.colors, null, 2);
  const textStylesJson = JSON.stringify(designSystem.textStyles, null, 2);

  return `You are an expert Figma designer assistant. Your task is to generate UI layouts using ONLY the components and styles from the provided design system.

Available Design System:

COMPONENTS:
${componentsJson}

COLOR STYLES:
${colorsJson}

TEXT STYLES:
${textStylesJson}

INSTRUCTIONS:
1. Generate a layout that uses ONLY the components listed above
2. Use the exact component names and keys provided
3. Create a hierarchical structure with frames and component instances
4. Position elements logically with appropriate spacing
5. Return your response as a JSON object matching this schema:

{
  "reasoning": "Brief explanation of your design decisions",
  "layout": {
    "type": "FRAME",
    "name": "Generated Layout",
    "x": 0,
    "y": 0,
    "width": 1200,
    "height": 800,
    "children": [
      {
        "type": "COMPONENT_INSTANCE",
        "name": "Component Name",
        "componentKey": "component-key-from-system",
        "componentName": "exact-component-name",
        "x": 100,
        "y": 100,
        "width": 200,
        "height": 50
      }
      // ... more children
    ]
  }
}

IMPORTANT: Return ONLY valid JSON. Do not include any markdown formatting or code blocks.`;
}

/**
 * Builds the user prompt
 */
function buildUserPrompt(prompt) {
  return `User Request: ${prompt}

Please generate a Figma layout that fulfills this request using the available design system components. Return the layout as JSON following the schema provided.`;
}

/**
 * Parses Claude's response to extract the layout JSON
 */
function parseClaudeResponse(responseText) {
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

app.listen(PORT, () => {
  console.log(`🚀 Crafter Proxy Server running on http://localhost:${PORT}`);
  console.log(`API Key configured: ${process.env.ANTHROPIC_API_KEY ? 'Yes' : 'No'}`);
});
