/**
 * Standalone Express server for MVP iteration endpoint
 * Deploy this to Railway
 */

const express = require('express');
const cors = require('cors');

const app = express();

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Health check
app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'Crafter MVP Iteration Server' });
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// MVP iteration endpoint
app.post('/api/iterate-mvp', async (req, res) => {
  try {
    const { frameSnapshot, designPalette, imagePNG, instructions, model } = req.body;

    // Validate request
    if (!frameSnapshot || !designPalette || !imagePNG || !instructions || !model) {
      return res.status(400).json({
        error: 'Missing required fields',
        required: ['frameSnapshot', 'designPalette', 'imagePNG', 'instructions', 'model']
      });
    }

    console.log(`📊 Received iteration request:`);
    console.log(`  Frame: ${frameSnapshot.name} (${frameSnapshot.width}x${frameSnapshot.height})`);
    console.log(`  Components in palette: ${designPalette.components.length}`);
    console.log(`  Image size: ${Math.round(imagePNG.length / 1024)} KB`);
    console.log(`  Instructions: ${instructions}`);
    console.log(`  Model: ${model}`);

    // Build prompt based on model
    const prompt = model === 'gemini-3-pro'
      ? buildGeminiPrompt(frameSnapshot, designPalette, instructions)
      : buildClaudePrompt(frameSnapshot, designPalette, instructions);

    // Call LLM
    let attempt = 0;
    const maxAttempts = 2;

    while (attempt < maxAttempts) {
      attempt++;

      try {
        console.log(`🔄 Attempt ${attempt}/${maxAttempts}`);

        const rawResponse = await callLLM(model, prompt, imagePNG);

        // Parse JSON
        let parsed;
        try {
          // Remove markdown code blocks if present
          const cleaned = rawResponse.replace(/```json\n?/g, '').replace(/```\n?/g, '');
          parsed = JSON.parse(cleaned);
        } catch (parseError) {
          throw new Error(`Failed to parse JSON: ${parseError.message}`);
        }

        // Basic validation
        if (!parsed.reasoning || !parsed.figmaStructure) {
          throw new Error('Response missing required fields: reasoning or figmaStructure');
        }

        if (parsed.figmaStructure.type !== 'FRAME') {
          throw new Error('figmaStructure.type must be "FRAME"');
        }

        if (!Array.isArray(parsed.figmaStructure.children)) {
          throw new Error('figmaStructure.children must be an array');
        }

        console.log(`✅ Validation passed (attempt ${attempt})`);

        return res.json({
          reasoning: parsed.reasoning,
          figmaStructure: parsed.figmaStructure
        });

      } catch (error) {
        console.error(`❌ Attempt ${attempt} failed:`, error.message);

        if (attempt >= maxAttempts) {
          return res.status(500).json({
            error: 'Failed after retries',
            message: error.message
          });
        }
      }
    }

  } catch (error) {
    console.error('Error in iterate-mvp:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
});

// ============================================================================
// PROMPT BUILDERS
// ============================================================================

function buildGeminiPrompt(frameSnapshot, designPalette, instructions) {
  return `You are a Figma design system expert. Your task is to create a new layout variation based on an existing design.

## CURRENT STRUCTURE (SOURCE OF TRUTH)

The user has selected this frame for iteration:

\`\`\`json
${JSON.stringify(frameSnapshot, null, 2)}
\`\`\`

## AVAILABLE DESIGN SYSTEM COMPONENTS

You have access to these components (ONLY use components from this list):

${designPalette.components.map(c =>
  `- **${c.name}** (key: \`${c.key}\`, role: ${c.role})
  - Used ${c.usageCount}x in current frame
  - Size: ${c.size.w}×${c.size.h}
  ${c.variants ? `- Variants: ${c.variants.join(", ")}` : ""}`
).join("\n")}

## USER INSTRUCTIONS

${instructions}

## CRITICAL RULES

1. **The JSON structure is the source of truth.** The image is for visual reference only.

2. **REUSE existing components via INSTANCE nodes.** When you see a component in the current structure (e.g., Sidebar with componentKey "abc123"), you MUST preserve it by outputting:
   \`\`\`json
   { "type": "INSTANCE", "name": "Sidebar", "componentKey": "abc123" }
   \`\`\`

   **DO NOT rebuild components from primitives.**

3. **Preserve the shell/skeleton.** Unless explicitly instructed otherwise, keep navigation/headers identical.

4. **Only use componentKey values from the AVAILABLE DESIGN SYSTEM COMPONENTS list above.**

5. **Output valid JSON only.** The root must be a FRAME.

## OUTPUT FORMAT

Return a JSON object with this exact structure:

\`\`\`json
{
  "reasoning": "Brief explanation of what you changed and why (1-2 sentences)",
  "figmaStructure": {
    "type": "FRAME",
    "name": "...",
    "children": [
      {
        "type": "INSTANCE",
        "name": "...",
        "componentKey": "..."
      }
    ]
  }
}
\`\`\`

Now create the new layout variation based on the user's instructions.`;
}

function buildClaudePrompt(frameSnapshot, designPalette, instructions) {
  return `You are an expert Figma plugin developer helping to create layout variations while preserving design system consistency.

# Current Frame Structure

<frame_snapshot>
${JSON.stringify(frameSnapshot, null, 2)}
</frame_snapshot>

# Available Components

You may ONLY use components from this list:

<design_palette>
${designPalette.components.map(c => `
Component: ${c.name}
- Key: ${c.key}
- Role: ${c.role}
- Current usage: ${c.usageCount} instance(s)
- Size: ${c.size.w} × ${c.size.h}
${c.variants ? `- Variants: ${c.variants.join(", ")}` : ""}
`).join("\n---\n")}
</design_palette>

# User Instructions

<instructions>
${instructions}
</instructions>

# Critical Requirements

## 1. Component Reuse (MOST IMPORTANT)

When a component instance exists in the current structure, you MUST preserve it by referencing its componentKey.

**DO NOT** rebuild components from rectangles, text, and other primitives. **REUSE THE COMPONENT.**

## 2. Output Format

Return ONLY a valid JSON object with this structure:

\`\`\`json
{
  "reasoning": "1-2 sentence explanation of changes",
  "figmaStructure": {
    "type": "FRAME",
    "name": "New Frame Name",
    "children": [ /* array of nodes */ ]
  }
}
\`\`\`

Node types:
- INSTANCE: { type, name, componentKey }
- FRAME: { type, name, children? }
- TEXT: { type, name, characters }
- RECTANGLE: { type, name, width, height }

Return your response now.`;
}

// ============================================================================
// LLM CALLING
// ============================================================================

async function callLLM(model, prompt, imagePNGBase64) {
  if (model === 'gemini-3-pro') {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY not configured');
    }

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: prompt },
              {
                inline_data: {
                  mime_type: 'image/png',
                  data: imagePNGBase64,
                }
              }
            ]
          }],
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 8192,
          }
        })
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Gemini API error ${response.status}: ${errorText}`);
    }

    const data = await response.json();
    return data.candidates[0].content.parts[0].text;

  } else {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error('ANTHROPIC_API_KEY not configured');
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 8192,
        temperature: 0.2,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: 'image/png',
                data: imagePNGBase64,
              }
            },
            {
              type: 'text',
              text: prompt,
            }
          ]
        }]
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Claude API error ${response.status}: ${errorText}`);
    }

    const data = await response.json();
    return data.content[0].text;
  }
}

// ============================================================================
// START SERVER
// ============================================================================

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🚀 Crafter MVP Server running on port ${PORT}`);
  console.log(`   Health: http://localhost:${PORT}/api/health`);
  console.log(`   Endpoint: http://localhost:${PORT}/api/iterate-mvp`);
  console.log(`   Environment: ${process.env.NODE_ENV || 'development'}`);
});
