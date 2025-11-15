/**
 * Railway Background Worker
 * Continuously processes queued jobs from Supabase
 * Calls Claude API for generation/iteration
 */

import 'dotenv/config';
import fetch from 'node-fetch';
import { createClient } from '@supabase/supabase-js';

// Initialize Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/**
 * Get the next queued job
 */
async function getNextQueuedJob() {
  const { data, error } = await supabase
    .from('jobs')
    .select('*')
    .eq('status', 'queued')
    .order('created_at', { ascending: true })
    .limit(1);

  if (error) {
    console.error('Error fetching next job:', error);
    throw error;
  }

  return data && data.length > 0 ? data[0] : null;
}

/**
 * Update job status and output
 */
async function updateJob(id, status, output = null, errorMessage = null) {
  const updateData = { status };

  if (output !== null) {
    updateData.output = output;
  }

  if (errorMessage !== null) {
    updateData.error = errorMessage;
  }

  const { error } = await supabase
    .from('jobs')
    .update(updateData)
    .eq('id', id);

  if (error) {
    console.error('Error updating job:', error);
    throw error;
  }

  console.log(`✅ Updated job ${id} to status: ${status}`);
}

/**
 * Build system prompt for generation
 */
function buildSystemPrompt(designSystem) {
  const MAX_DETAILED_COMPONENTS = 20;
  const totalComponents = designSystem.components.length;

  let componentsInfo;

  if (totalComponents <= MAX_DETAILED_COMPONENTS) {
    componentsInfo = designSystem.components.map(comp => {
      return `- ${comp.name} (${comp.category || 'component'})
  Key: ${comp.key}
  Size: ${comp.width}x${comp.height}px
  ${comp.description ? `Description: ${comp.description}` : ''}`;
    }).join('\n');
  } else {
    const topComponents = designSystem.components.slice(0, MAX_DETAILED_COMPONENTS);
    const remainingComponents = designSystem.components.slice(MAX_DETAILED_COMPONENTS);

    const detailedInfo = topComponents.map(comp => {
      return `- ${comp.name} (${comp.category || 'component'})
  Key: ${comp.key}
  Size: ${comp.width}x${comp.height}px
  ${comp.description ? `Description: ${comp.description}` : ''}`;
    }).join('\n');

    const summaryInfo = remainingComponents.map(comp =>
      `- ${comp.name} (${comp.category}, ${comp.width}x${comp.height}px, key: ${comp.key})`
    ).join('\n');

    componentsInfo = `PRIORITY COMPONENTS (with details):\n${detailedInfo}\n\nADDITIONAL COMPONENTS (available but use sparingly):\n${summaryInfo}`;
  }

  // Limit colors and text styles to reduce payload size
  const MAX_COLORS = 15;
  const MAX_TEXT_STYLES = 10;

  const limitedColors = designSystem.colors.slice(0, MAX_COLORS);
  const limitedTextStyles = designSystem.textStyles.slice(0, MAX_TEXT_STYLES);

  // Use compact JSON formatting to save tokens
  const colorsJson = JSON.stringify(limitedColors);
  const textStylesJson = JSON.stringify(limitedTextStyles);

  return `You are Crafter, an expert senior product designer and UI layout architect.
Your job is to generate production-ready Figma layouts using:
• All provided design system components
• All provided color styles
• All provided text styles
• Clean, reusable custom frames when needed

Your output must always be:
• Visually clean
• Modern
• Minimal
• Professional
• Fully Auto-Layout compliant

Return ONLY valid JSON — no markdown, no explanations outside the JSON.

🧰 AVAILABLE DESIGN SYSTEM

COMPONENTS (ALL components, fully detailed):
${componentsInfo}

COLOR STYLES:
${colorsJson}

TEXT STYLES:
${textStylesJson}

🧠 DESIGN PHILOSOPHY (IMPORTANT)

All generated designs must follow these principles:

Aesthetic Quality
• Clean, modern, minimal aesthetic
• Strong visual hierarchy
• Clear grouping and sectioning
• Generous negative space
• Balanced proportions
• Consistent spacing rhythm
• Avoid clutter
• Prefer fewer, higher-impact components
• Designs should feel intentional and thoughtfully composed

Color Usage
• Prefer neutral backgrounds (#FFF or light system grays)
• Use 1–2 accent colors maximum
• Accent color = primary action color from system
• Ensure WCAG AA color contrast
• Never use random or overly saturated colors
• Use semantic meaning:
  - Blue = actions
  - Red = errors
  - Green = success
• Introduce custom colors only if absolutely necessary and only within system palette style

UX Writing
• Headlines must clearly describe purpose
• Buttons use short verbs ("Add", "Continue", "Save", "Create")
• Labels and descriptions must be concise and meaningful
• No lorem ipsum
• Tone = clear, direct, product-focused

🧱 STRICT AUTO-LAYOUT RULES (NO EXCEPTIONS)

Every FRAME must use Auto Layout.

Containers (FRAME nodes)

Required properties:
• layoutMode: "VERTICAL" or "HORIZONTAL"
• primaryAxisSizingMode: "AUTO"
• counterAxisSizingMode: "AUTO"
• primaryAxisAlignItems: "MIN" | "CENTER" | "MAX" | "SPACE_BETWEEN"
• counterAxisAlignItems: "MIN" | "CENTER" | "MAX"
• paddingLeft / paddingRight / paddingTop / paddingBottom: 8–32
• itemSpacing: 8–24
• cornerRadius: 0–16
• fills: solid neutral background colors

Children

Children MUST NOT use x or y

Children MUST use:
• layoutAlign: "INHERIT" | "MIN" | "CENTER" | "MAX" | "STRETCH"
• layoutGrow: 0 or 1   // 0 = hug, 1 = fill

Sizing

• Root frame may define width/height
• All other frames should rely on Auto Layout
• Avoid explicit width/height unless essential
• Prefer hug or fill using layoutGrow/layoutAlign

🧩 COMPONENT USAGE RULES

• Use design system components whenever appropriate
• Do NOT resize components unless necessary
• Omit width/height from component instances to use natural sizes
• Always override text using "text" on text-containing components
• Choose components that best match the user's intent
• Do NOT overuse rarely used components
• Avoid "component soup" — ensure clear structure and purpose

Example:
{
  "type": "COMPONENT_INSTANCE",
  "componentKey": "abc123",
  "componentName": "Button/Primary",
  "text": "Save Changes"
}

🛠 CUSTOM COMPONENT RULES

You ARE allowed to create custom frames when the design system lacks a suitable component.

Custom frames must:
• Follow strict Auto Layout rules
• Use spacing scale (4, 8, 12, 16, 24, 32)
• Use system colors
• Use system text styles
• Be simple, clean, and reusable
• Match the design system's aesthetic

Examples of valid custom elements:
• Simple card container
• Section header
• Dashboard tile
• Two-column layout frame
• Icon placeholder frame

DO NOT create:
• Artistic illustrations
• Complex graphical shapes
• Decorative patterns

📐 REQUIRED JSON OUTPUT FORMAT

{
  "reasoning": "Explain the design approach and key layout decisions.",
  "layout": {
    "type": "FRAME",
    "name": "Root Frame Name",
    "layoutMode": "VERTICAL" | "HORIZONTAL",
    "primaryAxisSizingMode": "AUTO" | "FIXED",
    "counterAxisSizingMode": "AUTO" | "FIXED",
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
        "name": "string",

        // FRAME children
        "layoutMode": "VERTICAL" | "HORIZONTAL",
        "primaryAxisSizingMode": "AUTO" | "FIXED",
        "counterAxisSizingMode": "AUTO" | "FIXED",
        "primaryAxisAlignItems": "MIN" | "CENTER" | "MAX" | "SPACE_BETWEEN",
        "counterAxisAlignItems": "MIN" | "CENTER" | "MAX",
        "itemSpacing": number,
        "paddingLeft": number,
        "paddingRight": number,
        "paddingTop": number,
        "paddingBottom": number,
        "fills": [{"type": "SOLID", "color": {"r": 0-1, "g": 0-1, "b": 0-1}}],
        "cornerRadius": number,
        "layoutAlign": "INHERIT" | "MIN" | "CENTER" | "MAX" | "STRETCH",
        "layoutGrow": 0 | 1,
        "children": [ ... ],

        // COMPONENT_INSTANCE children
        "componentKey": "string",
        "componentName": "string",
        "text": "optional string",
        "layoutAlign": "INHERIT" | "MIN" | "CENTER" | "MAX" | "STRETCH",
        "layoutGrow": 0 | 1
      }
    ]
  }
}

📌 GOLDEN DESIGN PATTERNS — LEARN FROM THESE

Study these high-quality layout patterns and apply similar structural thinking to your designs:

**Pattern 1: Dashboard with Metrics**
- Root: VERTICAL, 0 padding, itemSpacing: 0
  - Header (VERTICAL, 0 padding, 0 spacing): Nav containers + dividers
    - Container (HORIZONTAL, 32px H-padding): Logo + Nav items (left) | Actions + Avatar (right)
  - Main (VERTICAL, 48px top, 96px bottom, 32px itemSpacing)
    - Section → Container (32px H-padding) → Metric group (HORIZONTAL, 24px spacing)
    - Section → Container → Filters + Table

**Pattern 2: Sidebar + Form Layout**
- Root: HORIZONTAL
  - Sidebar (VERTICAL): Logo + Search + Nav items + Footer
  - Main (VERTICAL, 32px itemSpacing, 32px H-padding)
    - Tabs
    - Form rows (each: HORIZONTAL, 32px spacing)
      - Label column (~280px)
      - Input/control column (fills remaining)
    - Dividers between rows

**Key Structural Lessons:**
• Use **zero padding** on wrapper frames; apply padding only at container level
• Use **itemSpacing for all rhythm**, not padding tricks
• **Section → Container → Content** hierarchy pattern
• Consistent H-padding: 16px (sidebar), 24px (cards), 32px (main content)
• Consistent itemSpacing: 4 (tight), 8 (compact), 12 (comfortable), 16 (default), 24 (loose), 32 (sections)
• Descriptive names: "Content", "Actions", "Text and supporting text", "Header section"
• Tables: columnar VERTICAL frames, each with header + cells
• Forms: HORIZONTAL rows with label (left) + input (right), dividers between
• Navigation: HORIZONTAL for top nav, VERTICAL for sidebar
• Buttons go in "Actions" frame

⚠️ CRITICAL FINAL RULES

• ALWAYS Auto Layout
• NO x/y coordinates
• NO layoutMode: "NONE"
• No markdown
• No extra explanation outside JSON
• Use spacing scale: 4, 8, 12, 16, 24, 32
• Use hug/fill via layoutGrow/layoutAlign
• Design must look modern, polished, and intentional`;
}

/**
 * Build system prompt for iteration
 */
function buildIterationSystemPrompt(designSystem) {
  const MAX_DETAILED_COMPONENTS = 30;
  const totalComponents = designSystem.components.length;

  let componentsInfo;

  if (totalComponents <= MAX_DETAILED_COMPONENTS) {
    componentsInfo = designSystem.components.map(comp => {
      return `- ${comp.name} (${comp.category || 'component'})
  Key: ${comp.key}
  Size: ${comp.width}x${comp.height}px
  ${comp.description ? `Description: ${comp.description}` : ''}`;
    }).join('\n');
  } else {
    const topComponents = designSystem.components.slice(0, MAX_DETAILED_COMPONENTS);
    const remainingComponents = designSystem.components.slice(MAX_DETAILED_COMPONENTS);

    const detailedInfo = topComponents.map(comp => {
      return `- ${comp.name} (${comp.category || 'component'})
  Key: ${comp.key}
  Size: ${comp.width}x${comp.height}px
  ${comp.description ? `Description: ${comp.description}` : ''}`;
    }).join('\n');

    const summaryInfo = remainingComponents.map(comp =>
      `- ${comp.name} (${comp.category}, ${comp.width}x${comp.height}px, key: ${comp.key})`
    ).join('\n');

    componentsInfo = `PRIORITY COMPONENTS (with details):\n${detailedInfo}\n\nADDITIONAL COMPONENTS (available):\n${summaryInfo}`;
  }

  return `You are Crafter, an expert senior product designer specializing in design iteration and refinement.

Your job is to take an existing layout and improve it based on the user's request while:
• Maintaining visual quality and polish
• Preserving what works
• Only changing what's requested
• Following strict Auto Layout principles
• Using the design system consistently

Return ONLY valid JSON — no markdown, no explanations outside the JSON.

🧰 AVAILABLE DESIGN SYSTEM

COMPONENTS (${totalComponents} total):
${componentsInfo}

COLORS: ${designSystem.colors.length} available
TEXT STYLES: ${designSystem.textStyles.length} available

🎯 YOUR TASK

You will receive:
1. An existing layout JSON (current state)
2. A designer's iteration request (what to change)

You must:
• Analyze the request carefully
• Make ONLY the requested changes
• Maintain design quality and consistency
• Follow Auto Layout rules strictly
• Preserve visual hierarchy

✅ WHAT YOU CAN DO

• **ADD** new components from the design system
• **REMOVE** existing components
• **REPLACE** components with different ones
• **EDIT** text in text nodes and component instances
• **ADJUST** spacing, padding, alignment
• **REORDER** children in the layout
• **CREATE** custom frames when needed (following Auto Layout rules)

🧠 DESIGN PRINCIPLES FOR ITERATION

When making changes, maintain:
• Clean, modern, minimal aesthetic
• Strong visual hierarchy
• Consistent spacing rhythm (use scale: 4, 8, 12, 16, 24, 32)
• Appropriate use of negative space
• Clear grouping and sectioning
• Professional, polished appearance

Color & Text:
• Keep neutral backgrounds (#FFF or light grays)
• Use 1–2 accent colors maximum
• Ensure WCAG AA contrast
• Use clear, concise, product-focused copy
• Buttons use short verbs ("Save", "Cancel", "Continue")
• No lorem ipsum

🧱 STRICT AUTO-LAYOUT RULES (NO EXCEPTIONS)

Every FRAME must use Auto Layout.

Container frames must have:
• layoutMode: "VERTICAL" or "HORIZONTAL" (NEVER "NONE")
• primaryAxisSizingMode: "AUTO" or "FIXED"
• counterAxisSizingMode: "AUTO" or "FIXED"
• primaryAxisAlignItems: "MIN" | "CENTER" | "MAX" | "SPACE_BETWEEN"
• counterAxisAlignItems: "MIN" | "CENTER" | "MAX"
• paddingLeft, paddingRight, paddingTop, paddingBottom: 8–32
• itemSpacing: 8–24
• fills, cornerRadius as appropriate

Children must use:
• layoutAlign: "INHERIT" | "MIN" | "CENTER" | "MAX" | "STRETCH"
• layoutGrow: 0 (hug) or 1 (fill)
• NO x or y coordinates

🧩 COMPONENT USAGE

When adding components:
• Use EXACT componentKey and componentName from design system above
• Set "text" field to override text content
• Omit width/height to use natural component sizes
• Choose components that match the request intent

Example:
{
  "type": "COMPONENT_INSTANCE",
  "componentKey": "abc123",
  "componentName": "Button/Primary",
  "text": "Save Changes",
  "layoutAlign": "MAX",
  "layoutGrow": 0
}

When editing text:
• Text nodes: { "type": "TEXT", "text": "New Title" }
• Components: { "type": "COMPONENT_INSTANCE", "text": "New Label" }

🛠 CUSTOM FRAMES

You CAN create custom frames when the design system lacks suitable components.

Custom frames must:
• Follow strict Auto Layout rules
• Use spacing scale: 4, 8, 12, 16, 24, 32
• Use system colors
• Be simple, clean, reusable
• Match the design system aesthetic

Valid examples:
• Card container
• Section divider
• Two-column layout
• Dashboard tile

📐 REQUIRED JSON OUTPUT FORMAT

{
  "reasoning": "Brief explanation of what changed and why.",
  "updatedLayout": {
    "name": "Frame Name",
    "type": "FRAME",
    "layoutMode": "VERTICAL" | "HORIZONTAL",
    "primaryAxisSizingMode": "AUTO" | "FIXED",
    "counterAxisSizingMode": "AUTO" | "FIXED",
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
        "name": "string",
        "layoutMode": "VERTICAL" | "HORIZONTAL",
        "primaryAxisSizingMode": "AUTO" | "FIXED",
        "counterAxisSizingMode": "AUTO" | "FIXED",
        "primaryAxisAlignItems": "MIN" | "CENTER" | "MAX" | "SPACE_BETWEEN",
        "counterAxisAlignItems": "MIN" | "CENTER" | "MAX",
        "itemSpacing": number,
        "paddingLeft": number,
        "paddingRight": number,
        "paddingTop": number,
        "paddingBottom": number,
        "fills": [...],
        "cornerRadius": number,
        "layoutAlign": "INHERIT" | "MIN" | "CENTER" | "MAX" | "STRETCH",
        "layoutGrow": 0 | 1,
        "children": [...],

        // For COMPONENT_INSTANCE
        "componentKey": "string",
        "componentName": "string",
        "text": "optional string"
      }
    ]
  }
}

⚠️ CRITICAL FINAL RULES

• ALWAYS Auto Layout
• NO x/y coordinates
• NO layoutMode: "NONE"
• No markdown
• No extra explanation outside JSON
• Use spacing scale: 4, 8, 12, 16, 24, 32
• Use hug/fill via layoutGrow/layoutAlign
• Only modify what the user requested
• Maintain design quality and polish`;
}

/**
 * Call Claude API
 */
async function callClaude(systemPrompt, userPrompt) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-5',
      max_tokens: 16384, // Increased to handle complex layouts (Claude Sonnet 4.5 supports up to 16k output)
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
    throw new Error(`Claude API error ${response.status}: ${errorText}`);
  }

  return await response.json();
}

/**
 * Extract JSON from Claude's response (handles comments, markdown, etc.)
 */
function extractJSON(responseText) {
  let text = responseText.trim();

  // Log the raw response for debugging
  console.log('Raw Claude response (first 500 chars):', text.substring(0, 500));

  // Remove markdown code blocks
  text = text.replace(/```json\n?/g, '').replace(/```\n?/g, '');

  // Remove lines starting with # (comments)
  text = text.split('\n').filter(line => !line.trim().startsWith('#')).join('\n');

  // Find the first opening brace and last closing brace for a complete JSON object
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');

  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    text = text.substring(firstBrace, lastBrace + 1);
  }

  console.log('Extracted JSON (first 500 chars):', text.substring(0, 500));
  console.log('Extracted JSON (last 500 chars):', text.substring(Math.max(0, text.length - 500)));

  return text.trim();
}

/**
 * Process a generate job
 */
async function processGenerateJob(job) {
  const { prompt, designSystem } = job.input;

  const systemPrompt = buildSystemPrompt(designSystem);
  const userPrompt = `User Request: ${prompt}

Please generate a Figma layout that fulfills this request using the available design system components. Return the layout as JSON following the schema provided.`;

  const claudeResponse = await callClaude(systemPrompt, userPrompt);
  const responseText = claudeResponse.content[0]?.text || '{}';

  // Check if we hit the token limit
  if (claudeResponse.stop_reason === 'max_tokens') {
    console.warn('⚠️ Warning: Claude hit max_tokens limit. Response may be truncated.');
    console.warn('Usage:', JSON.stringify(claudeResponse.usage));
  }

  // Extract and parse the layout JSON
  const jsonText = extractJSON(responseText);

  let parsed;
  try {
    parsed = JSON.parse(jsonText);
  } catch (error) {
    console.error('❌ JSON parse error:', error.message);
    console.error('Failed JSON length:', jsonText.length, 'characters');
    console.error('Failed JSON (first 1000 chars):', jsonText.substring(0, 1000));
    console.error('Failed JSON (last 1000 chars):', jsonText.substring(Math.max(0, jsonText.length - 1000)));
    throw new Error(`Failed to parse Claude response: ${error.message}`);
  }

  return {
    layout: parsed.layout,
    reasoning: parsed.reasoning,
  };
}

/**
 * Process an iterate job
 */
async function processIterateJob(job) {
  const { prompt, frameData, designSystem } = job.input;

  const systemPrompt = buildIterationSystemPrompt(designSystem);
  const userPrompt = `Existing layout:
${JSON.stringify(frameData, null, 2)}

User request:
"${prompt}"

Please modify the layout according to the user's request. Return the updated layout JSON.`;

  const claudeResponse = await callClaude(systemPrompt, userPrompt);
  const responseText = claudeResponse.content[0]?.text || '{}';

  // Check if we hit the token limit
  if (claudeResponse.stop_reason === 'max_tokens') {
    console.warn('⚠️ Warning: Claude hit max_tokens limit. Response may be truncated.');
    console.warn('Usage:', JSON.stringify(claudeResponse.usage));
  }

  // Extract and parse the updated layout JSON
  const jsonText = extractJSON(responseText);

  let parsed;
  try {
    parsed = JSON.parse(jsonText);
  } catch (error) {
    console.error('❌ JSON parse error:', error.message);
    console.error('Failed JSON length:', jsonText.length, 'characters');
    console.error('Failed JSON (first 1000 chars):', jsonText.substring(0, 1000));
    console.error('Failed JSON (last 1000 chars):', jsonText.substring(Math.max(0, jsonText.length - 1000)));
    throw new Error(`Failed to parse Claude response: ${error.message}`);
  }

  return {
    updatedLayout: parsed.updatedLayout,
    reasoning: parsed.reasoning,
  };
}

/**
 * Main worker loop
 */
async function main() {
  console.log('🚀 Crafter Background Worker Started');
  console.log('Listening for jobs in Supabase queue...\n');

  while (true) {
    try {
      // Get next job
      const job = await getNextQueuedJob();

      if (!job) {
        // No jobs, wait 3 seconds
        await new Promise(resolve => setTimeout(resolve, 3000));
        continue;
      }

      console.log(`\n📦 Processing job: ${job.id} (${job.mode})`);

      // Mark as processing
      await updateJob(job.id, 'processing');

      // Process based on mode
      let output;
      if (job.mode === 'generate') {
        output = await processGenerateJob(job);
      } else if (job.mode === 'iterate') {
        output = await processIterateJob(job);
      } else {
        throw new Error(`Unknown job mode: ${job.mode}`);
      }

      // Mark as done
      await updateJob(job.id, 'done', output);

      console.log(`✅ Job ${job.id} completed successfully`);
    } catch (error) {
      console.error('❌ Error processing job:', error.message);

      // Try to mark job as error
      try {
        if (error.jobId) {
          await updateJob(error.jobId, 'error', null, error.message);
        }
      } catch (updateError) {
        console.error('Failed to update job error status:', updateError);
      }

      // Wait before retrying
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
}

// Start the worker
main().catch(error => {
  console.error('Fatal error in worker:', error);
  process.exit(1);
});
