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

        // Basic validation for HTML/CSS output
        if (!parsed.reasoning || !parsed.htmlLayout) {
          throw new Error('Response missing required fields: reasoning or htmlLayout');
        }

        if (!parsed.htmlLayout.html) {
          throw new Error('htmlLayout.html is required');
        }

        if (!parsed.htmlLayout.css) {
          throw new Error('htmlLayout.css is required');
        }

        if (!parsed.htmlLayout.componentMap || typeof parsed.htmlLayout.componentMap !== 'object') {
          throw new Error('htmlLayout.componentMap must be an object');
        }

        console.log(`✅ Validation passed (attempt ${attempt})`);

        return res.json({
          reasoning: parsed.reasoning,
          htmlLayout: parsed.htmlLayout
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

You have access to the ENTIRE design system (${designPalette.components.length} components).
Components with usageCount > 0 are currently in the frame.
You can use ANY component to create high-fidelity designs:

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

4. **You can use ANY componentKey from the list above.** Components with usageCount=0 are available but not currently used - feel free to use them to enhance the design (e.g., pricing cards, charts, tables, badges).

5. **Output valid JSON only.** The root must be a FRAME.

6. **For FRAME nodes with children, include Auto Layout properties** (layoutMode, itemSpacing, padding, sizing modes, alignment) to create properly structured layouts.

## OUTPUT FORMAT (HTML/CSS)

Return a JSON object with HTML/CSS layout structure:

\`\`\`json
{
  "reasoning": "Brief explanation of what you changed and why (1-2 sentences)",
  "htmlLayout": {
    "html": "<div class=\\"screen\\">\\n  <div class=\\"app-logo\\"></div>\\n  <div class=\\"login-form\\"></div>\\n  <section class=\\"pricing\\">\\n    <div class=\\"card-starter\\"></div>\\n    <div class=\\"card-pro\\"></div>\\n  </section>\\n</div>",
    "css": ".screen { display: flex; flex-direction: column; gap: 48px; padding: 80px; }\\n.pricing { display: flex; flex-direction: row; gap: 24px; }\\n.card-starter, .card-pro { width: 320px; }",
    "componentMap": {
      "app-logo": {
        "componentKey": "9181c660...",
        "componentName": "App Logo"
      },
      "login-form": {
        "componentKey": "248d7d71...",
        "componentName": "Login Form"
      },
      "card-starter": {
        "componentKey": "abc123...",
        "componentName": "Pricing Card - Starter"
      }
    }
  }
}
\`\`\`

### HTML RULES:
- Use semantic tags (<div>, <section>, <header>, etc.)
- Use descriptive class names for each element
- For design system components, use class names and map them in componentMap
- Keep HTML structure simple and clean

### CSS RULES:
- Use Flexbox for all layouts (display: flex)
- Use flex-direction: column or row
- Use gap for spacing between children
- Use padding for container spacing
- Specify width/height for components when needed
- Use simple property: value format

### COMPONENT MAPPING:
- Map each component class name to its Figma componentKey
- This allows us to create actual Figma component instances

Now create the new layout variation based on the user's instructions.`;
}

function buildClaudePrompt(frameSnapshot, designPalette, instructions) {
  return `You are an expert Figma plugin developer helping to create layout variations while preserving design system consistency.

# Current Frame Structure

<frame_snapshot>
${JSON.stringify(frameSnapshot, null, 2)}
</frame_snapshot>

# Available Components

You have access to the ENTIRE design system (${designPalette.components.length} components).
Components with usageCount > 0 are currently in the frame.
You can use ANY component to create high-fidelity designs:

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

You can use ANY component from the design palette above. Components with usageCount=0 are available but not currently in the frame - feel free to use them to enhance the design (e.g., pricing cards, charts, tables, badges).

## 2. Auto Layout Properties

For FRAME nodes with children, you SHOULD include Auto Layout properties (layoutMode, itemSpacing, padding, sizing modes, alignment) to create properly structured layouts.

## 3. Output Format (HTML/CSS)

Return ONLY a valid JSON object with HTML/CSS structure:

\`\`\`json
{
  "reasoning": "1-2 sentence explanation of changes",
  "htmlLayout": {
    "html": "<div class=\\"container\\">...</div>",
    "css": ".container { display: flex; flex-direction: column; gap: 24px; padding: 32px; }",
    "componentMap": {
      "class-name": {
        "componentKey": "component-key-here",
        "componentName": "Component Name"
      }
    }
  }
}
\`\`\`

### HTML Requirements:
- Use semantic HTML5 tags
- Use descriptive class names
- Map component classes in componentMap
- Keep structure simple

### CSS Requirements:
- Use Flexbox (display: flex, flex-direction, gap, padding)
- Avoid absolute positioning
- Use px units for dimensions
- Keep it minimal and focused on layout

### Component Mapping:
- For each design system component, assign a class name
- Map that class to the componentKey in componentMap
- Example: "app-logo" → { componentKey: "9181c660...", componentName: "App Logo" }

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
        model: 'claude-sonnet-4-5',
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
const RAILWAY_URL = process.env.RAILWAY_PUBLIC_DOMAIN
  ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
  : `http://localhost:${PORT}`;

app.listen(PORT, () => {
  console.log(`🚀 Crafter MVP Server running on port ${PORT}`);
  console.log(`   Health: ${RAILWAY_URL}/api/health`);
  console.log(`   Endpoint: ${RAILWAY_URL}/api/iterate-mvp`);
  console.log(`   Environment: ${process.env.NODE_ENV || 'development'}`);
});
