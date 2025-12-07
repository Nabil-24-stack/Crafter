import type { VercelRequest, VercelResponse } from '@vercel/node';
import { z } from 'zod';

// ============================================================================
// ZOD SCHEMAS FOR VALIDATION
// ============================================================================

const ComponentRoleSchema = z.enum([
  "shell", "navigation", "header", "content", "card", "form", "list", "modal", "control"
]);

const DesignSystemComponentSummarySchema = z.object({
  key: z.string(),
  name: z.string(),
  role: ComponentRoleSchema,
  usageCount: z.number(),
  size: z.object({ w: z.number(), h: z.number() }),
  variants: z.array(z.string()).optional(),
});

const DesignPaletteSchema = z.object({
  components: z.array(DesignSystemComponentSummarySchema),
});

const SnapshotNodeSchema: z.ZodType<any> = z.lazy(() => z.object({
  id: z.string(),
  type: z.enum(["FRAME", "INSTANCE", "TEXT", "RECTANGLE"]),
  name: z.string(),
  componentKey: z.string().optional(),
  layoutMode: z.enum(["HORIZONTAL", "VERTICAL", "NONE"]).optional(),
  children: z.array(SnapshotNodeSchema).optional(),
  text: z.string().optional(),
}));

const FrameSnapshotSchema = z.object({
  id: z.string(),
  name: z.string(),
  width: z.number(),
  height: z.number(),
  children: z.array(SnapshotNodeSchema),
});

const IterationRequestSchema = z.object({
  frameSnapshot: FrameSnapshotSchema,
  designPalette: DesignPaletteSchema,
  imagePNG: z.string(),
  instructions: z.string(),
  model: z.enum(["gemini-3-pro", "claude"]),
});

// Output schemas
const LayoutNodeSchema: z.ZodType<any> = z.lazy(() => z.discriminatedUnion("type", [
  z.object({
    type: z.literal("INSTANCE"),
    name: z.string(),
    componentKey: z.string(),
  }),
  z.object({
    type: z.literal("FRAME"),
    name: z.string(),
    layoutMode: z.enum(["HORIZONTAL", "VERTICAL", "NONE"]).optional(),
    children: z.array(LayoutNodeSchema),
  }),
  z.object({
    type: z.literal("TEXT"),
    name: z.string(),
    characters: z.string(),
  }),
  z.object({
    type: z.literal("RECTANGLE"),
    name: z.string(),
    width: z.number(),
    height: z.number(),
  }),
]));

const LayoutStructureSchema = z.object({
  type: z.literal("FRAME"),
  name: z.string(),
  children: z.array(LayoutNodeSchema),
});

const LLMResponseSchema = z.object({
  reasoning: z.string(),
  figmaStructure: LayoutStructureSchema,
});

// ============================================================================
// HANDLER
// ============================================================================

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed. Use POST.' });
    return;
  }

  try {
    // Validate request body
    const validatedRequest = IterationRequestSchema.parse(req.body);
    const { frameSnapshot, designPalette, imagePNG, instructions, model } = validatedRequest;

    console.log(`📊 Frame: ${frameSnapshot.name} (${frameSnapshot.width}x${frameSnapshot.height})`);
    console.log(`🎨 Design palette: ${designPalette.components.length} components`);
    console.log(`📸 Image size: ${Math.round(imagePNG.length / 1024)} KB`);
    console.log(`🤖 Model: ${model}`);
    console.log(`💬 Instructions: ${instructions}`);

    // Build prompt based on model
    const prompt = model === "gemini-3-pro"
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

        // Parse and validate
        const parsed = JSON.parse(rawResponse);
        const validated = LLMResponseSchema.parse(parsed);

        console.log(`✅ Schema validation passed (attempt ${attempt})`);

        res.status(200).json(validated);
        return;

      } catch (error) {
        console.error(`❌ Attempt ${attempt} failed:`, error);

        if (error instanceof z.ZodError) {
          console.error("Schema errors:", error.errors);

          if (attempt < maxAttempts) {
            console.log(`Retrying with schema error feedback...`);
            // Append error feedback to prompt for retry
            const errorFeedback = `\n\n## PREVIOUS ATTEMPT FAILED\n\nYour previous output had these schema errors:\n${error.errors.map(e => `- ${e.path.join(".")}: ${e.message}`).join("\n")}\n\nPlease fix these and try again.`;
            // Re-add to prompt (simple concatenation)
            continue;
          }
        }

        if (attempt >= maxAttempts) {
          throw new Error(`Failed after ${maxAttempts} attempts: ${error}`);
        }
      }
    }

    throw new Error("Unexpected: exceeded retry loop");

  } catch (error) {
    console.error('Error in iterate-mvp handler:', error);

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    if (error instanceof z.ZodError) {
      res.status(400).json({
        error: 'Validation Error',
        message: 'Invalid request or response format',
        details: error.errors,
      });
      return;
    }

    res.status(500).json({
      error: 'Internal Server Error',
      message: 'An unexpected error occurred during iteration.',
      details: errorMessage,
    });
  }
}

// ============================================================================
// PROMPT BUILDERS
// ============================================================================

function buildGeminiPrompt(
  frameSnapshot: any,
  designPalette: any,
  instructions: string
): string {
  return `You are a Figma design system expert. Your task is to create a new layout variation based on an existing design.

## CURRENT STRUCTURE (SOURCE OF TRUTH)

The user has selected this frame for iteration:

\`\`\`json
${JSON.stringify(frameSnapshot, null, 2)}
\`\`\`

## AVAILABLE DESIGN SYSTEM COMPONENTS

You have access to these components (ONLY use components from this list):

${designPalette.components.map((c: any) =>
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

   **DO NOT rebuild components from primitives.** For example, DO NOT create a sidebar by stacking rectangles and text—reuse the Sidebar component.

3. **Preserve the shell/skeleton.** Unless explicitly instructed otherwise:
   - Keep navigation (sidebar, navbar) identical
   - Keep headers/toolbars identical
   - Only modify the content area

4. **Only use componentKey values from the AVAILABLE DESIGN SYSTEM COMPONENTS list above.**

5. **Output valid JSON only.** The root must be a FRAME. All required fields must be present.

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

function buildClaudePrompt(
  frameSnapshot: any,
  designPalette: any,
  instructions: string
): string {
  return `You are an expert Figma plugin developer helping to create layout variations while preserving design system consistency.

# Context

The user has selected a frame in Figma and wants to create a variation of it. You have:
1. A structural snapshot (JSON) of the current frame
2. A palette of available design system components
3. An image of the current frame (for visual reference)
4. User instructions for the new variation

# Current Frame Structure

<frame_snapshot>
${JSON.stringify(frameSnapshot, null, 2)}
</frame_snapshot>

# Available Components

You may ONLY use components from this list:

<design_palette>
${designPalette.components.map((c: any) => `
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

Example - if the current structure contains:
\`\`\`json
{
  "type": "INSTANCE",
  "componentKey": "abc123",
  "name": "Sidebar Navigation"
}
\`\`\`

Your output MUST include:
\`\`\`json
{
  "type": "INSTANCE",
  "name": "Sidebar Navigation",
  "componentKey": "abc123"
}
\`\`\`

**DO NOT** rebuild the sidebar from rectangles, text, and other primitives. **REUSE THE COMPONENT.**

## 2. Preserve Shell Structure

Unless explicitly asked to redesign the entire page:
- Keep shell components (sidebar, header, navigation) identical
- Only modify the content area
- Maintain the overall layout hierarchy

## 3. Schema Compliance

- Root node must be type "FRAME"
- Only use componentKey values from the design palette above
- All INSTANCE nodes must have a valid componentKey

## 4. Output Format

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
- FRAME: { type, name, layoutMode?, children? }
- TEXT: { type, name, characters }
- RECTANGLE: { type, name, width, height }

# Your Task

Create a new layout variation that:
1. Follows the user's instructions
2. Reuses existing components wherever possible
3. Preserves the shell/skeleton unless told otherwise
4. Outputs valid, schema-compliant JSON

Return your response now.`;
}

// ============================================================================
// LLM CALLING
// ============================================================================

async function callLLM(
  model: "gemini-3-pro" | "claude",
  prompt: string,
  imagePNGBase64: string
): Promise<string> {
  if (model === "gemini-3-pro") {
    // Gemini API call
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY not configured");
    }

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: prompt },
              {
                inline_data: {
                  mime_type: "image/png",
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
    // Claude API call
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error("ANTHROPIC_API_KEY not configured");
    }

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-3-5-sonnet-20241022",
        max_tokens: 8192,
        temperature: 0.2,
        messages: [{
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: "image/png",
                data: imagePNGBase64,
              }
            },
            {
              type: "text",
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
