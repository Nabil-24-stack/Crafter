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
 * Get the next queued job (legacy - keeping for compatibility)
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
 * Get multiple queued jobs for parallel processing
 */
async function getQueuedJobs(limit = 3) {
  const { data, error } = await supabase
    .from('jobs')
    .select('*')
    .eq('status', 'queued')
    .order('created_at', { ascending: true })
    .limit(limit);

  if (error) {
    console.error('Error fetching queued jobs:', error);
    throw error;
  }

  return data || [];
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

📐 SIMPLIFIED JSON OUTPUT FORMAT

Use this simplified schema for faster generation. The plugin will expand it to full Figma properties.

{
  "reasoning": "Explain the design approach and key layout decisions.",
  "layout": {
    "type": "frame",
    "name": "Root Frame Name",
    "layout": "vertical",        // "vertical" | "horizontal"
    "spacing": 16,               // gap between children (default: 16)
    "padding": 24,               // all sides OR {"x": 24, "y": 16}
    "align": "start",            // "start" | "center" | "end" | "stretch" | "space-between"
    "bg": "#ffffff",             // hex color OR "white" | "gray-50" | "transparent"
    "radius": 8,                 // corner radius (optional)
    "children": [
      {
        // Frame (container)
        "type": "frame",
        "name": "Container",
        "layout": "horizontal",
        "spacing": 12,
        "padding": 16,
        "children": [...]
      },
      {
        // Component instance
        "type": "component",
        "component": "Primary Button",  // component name (fuzzy matched)
        "text": "Click me",              // text override (optional)
        "fill": true                     // makes it grow (layoutGrow: 1)
      },
      {
        // Text node
        "type": "text",
        "text": "Hello World",
        "style": "heading-1",  // text style name (optional)
        "color": "#333333"     // text color (optional)
      },
      {
        // Spacer (flexible gap)
        "type": "spacer",
        "size": 24  // fixed size OR "flex" for flexible
      }
    ]
  }
}

IMPORTANT SIMPLIFICATIONS:
• Use "frame" not "FRAME" (lowercase, simpler)
• Use "layout" not "layoutMode" (shorter property name)
• Use single "spacing" value (not itemSpacing + 4 padding values)
• Use single "padding" value or {"x": 24, "y": 16} (not 4 separate values)
• Use "component" with name string (not componentKey + componentName)
• Use simple alignment: "start" | "center" | "end" (not complex Figma enums)
• Use hex colors "#ffffff" or named "white" (not RGB objects)
• Plugin will expand this to full Figma Auto Layout properties

📌 SIMPLIFIED PATTERN EXAMPLES

**Example 1: Dashboard Header**
{
  "type": "frame",
  "name": "Header",
  "layout": "horizontal",
  "padding": {"x": 32, "y": 16},
  "align": "space-between",
  "bg": "white",
  "children": [
    {"type": "component", "component": "Logo"},
    {
      "type": "frame",
      "layout": "horizontal",
      "spacing": 12,
      "children": [
        {"type": "component", "component": "Notification Icon"},
        {"type": "component", "component": "User Avatar"}
      ]
    }
  ]
}

**Example 2: Card with Content**
{
  "type": "frame",
  "name": "Card",
  "layout": "vertical",
  "spacing": 16,
  "padding": 24,
  "bg": "white",
  "radius": 8,
  "children": [
    {"type": "text", "text": "Account Balance", "style": "heading-2"},
    {"type": "text", "text": "$12,450.00", "style": "display"},
    {"type": "component", "component": "View Details Button", "text": "View Details"}
  ]
}

**Example 3: Two-Column Layout**
{
  "type": "frame",
  "layout": "horizontal",
  "spacing": 24,
  "children": [
    {
      "type": "frame",
      "name": "Left Column",
      "layout": "vertical",
      "spacing": 16,
      "fill": true,
      "children": [...]
    },
    {
      "type": "frame",
      "name": "Right Column",
      "layout": "vertical",
      "spacing": 16,
      "fill": true,
      "children": [...]
    }
  ]
}

**Key Simplified Patterns:**
• Use **"spacing"** for gaps between items (not 4 separate padding values)
• Use **"padding"** as single number or {"x": 32, "y": 16} for horizontal/vertical
• Use **"align": "space-between"** for distributing items
• Use **"fill": true** to make child fill available space
• Use **"component"** with component name (plugin will fuzzy match)
• Keep nesting simple and semantic
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
 * Call Claude with vision (image + text)
 */
async function callClaudeWithVision(systemPrompt, userPrompt, imageDataBase64) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-5',
      max_tokens: 16384,
      system: systemPrompt,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: 'image/png',
                data: imageDataBase64,
              },
            },
            {
              type: 'text',
              text: userPrompt,
            },
          ],
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
 * Call Gemini with vision (image + text)
 */
async function callGeminiWithVision(systemPrompt, userPrompt, imageDataBase64) {
  const geminiApiKey = process.env.GEMINI_API_KEY;

  if (!geminiApiKey) {
    throw new Error('GEMINI_API_KEY not configured');
  }

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-preview:generateContent`,
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
              {
                inlineData: {
                  mimeType: 'image/png',
                  data: imageDataBase64,
                },
              },
            ],
          },
        ],
      }),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini API error ${response.status}: ${errorText}`);
  }

  const data = await response.json();

  // Convert Gemini response format to Claude-like format for consistency
  return {
    content: [
      {
        type: 'text',
        text: data.candidates?.[0]?.content?.parts?.[0]?.text || '',
      },
    ],
    stop_reason: data.candidates?.[0]?.finishReason === 'MAX_TOKENS' ? 'max_tokens' : 'stop',
    usage: {
      input_tokens: data.usageMetadata?.promptTokenCount || 0,
      output_tokens: data.usageMetadata?.candidatesTokenCount || 0,
    },
  };
}

/**
 * Call Gemini (text only, no vision)
 */
async function callGemini(systemPrompt, userPrompt) {
  const geminiApiKey = process.env.GEMINI_API_KEY;

  if (!geminiApiKey) {
    throw new Error('GEMINI_API_KEY not configured');
  }

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-preview:generateContent`,
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

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini API error ${response.status}: ${errorText}`);
  }

  const data = await response.json();

  // Convert Gemini response format to Claude-like format
  return {
    content: [
      {
        type: 'text',
        text: data.candidates?.[0]?.content?.parts?.[0]?.text || '',
      },
    ],
    stop_reason: data.candidates?.[0]?.finishReason === 'MAX_TOKENS' ? 'max_tokens' : 'stop',
    usage: {
      input_tokens: data.usageMetadata?.promptTokenCount || 0,
      output_tokens: data.usageMetadata?.candidatesTokenCount || 0,
    },
  };
}

/**
 * Call Together AI API (fine-tuned Llama model)
 */
async function callTogetherAI(systemPrompt, userPrompt) {
  const togetherApiKey = process.env.TOGETHER_API_KEY;
  const togetherModel = process.env.TOGETHER_MODEL_CRAFTER_FT;

  if (!togetherApiKey) {
    throw new Error('TOGETHER_API_KEY not configured');
  }

  if (!togetherModel) {
    throw new Error('TOGETHER_MODEL_CRAFTER_FT not configured');
  }

  console.log(`🤖 Calling Together AI fine-tuned model: ${togetherModel}`);

  const response = await fetch('https://api.together.xyz/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${togetherApiKey}`,
    },
    body: JSON.stringify({
      model: togetherModel,
      max_tokens: 4096, // Reduced from 16384 to fit within model's context limit
      temperature: 0.1, // Low temperature for consistent JSON output
      messages: [
        {
          role: 'system',
          content: systemPrompt,
        },
        {
          role: 'user',
          content: userPrompt,
        },
      ],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Together AI error ${response.status}: ${errorText}`);
  }

  const data = await response.json();

  // Together AI response format is similar to OpenAI
  return {
    content: [
      {
        text: data.choices[0]?.message?.content || '{}',
      },
    ],
    stop_reason: data.choices[0]?.finish_reason,
    usage: data.usage,
  };
}

/**
 * Build simplified system prompt for fine-tuned Together AI model
 * The fine-tuned model was trained on 76 examples and already knows the patterns
 * ULTRA-COMPACT version to reduce token usage
 */
function buildSimplifiedSystemPrompt(designSystem) {
  // Only use top 15 components to save tokens
  const MAX_COMPONENTS = 15;
  const topComponents = designSystem.components.slice(0, MAX_COMPONENTS);

  // Ultra-compact component list (one line per component)
  const componentsInfo = topComponents.map(comp =>
    `${comp.name}|${comp.key}|${comp.width}x${comp.height}`
  ).join('\n');

  // Simplified prompt for fine-tuned model - it already knows the patterns
  return `You are Crafter, an assistant that generates Figma-style UI layout JSON. You always respond with a single JSON object describing the layout tree. Do not include explanations, markdown, or comments.

AVAILABLE DESIGN SYSTEM

COMPONENTS (name|key|size):
${componentsInfo}

COLORS: ${JSON.stringify(designSystem.colors.slice(0, 10))}
TEXT STYLES: ${JSON.stringify(designSystem.textStyles.slice(0, 5))}`;
}

/**
 * Sanitizes layout JSON to fix common AI errors
 * Fixes invalid sizing mode values that cause Figma errors
 */
function sanitizeLayoutJSON(layoutObj) {
  if (!layoutObj || typeof layoutObj !== 'object') {
    return layoutObj;
  }

  // Fix "id" field - fine-tuned model uses "id" but Figma expects "name"
  if (layoutObj.id && !layoutObj.name) {
    layoutObj.name = layoutObj.id;
    delete layoutObj.id;
  }

  // Normalize type to uppercase (fine-tuned model returns lowercase)
  if (layoutObj.type) {
    const typeUpper = layoutObj.type.toUpperCase();

    // Map common types to Figma types
    const typeMap = {
      'FRAME': 'FRAME',
      'TEXT': 'TEXT',
      'RECTANGLE': 'RECTANGLE',
      'COMPONENT_INSTANCE': 'COMPONENT_INSTANCE',
      'INSTANCE': 'COMPONENT_INSTANCE',
      'COMPONENT': 'COMPONENT_INSTANCE',
      'IMAGE': 'RECTANGLE', // Images become rectangles (placeholders)
      'LIST': 'FRAME', // Lists become frames
      'CHART': 'FRAME', // Charts become frames
      'BUTTON': 'COMPONENT_INSTANCE', // Buttons should be components
      'INPUT': 'COMPONENT_INSTANCE', // Inputs should be components
      'CARD': 'FRAME', // Cards become frames
    };

    const mappedType = typeMap[typeUpper] || 'FRAME'; // Default to FRAME

    if (mappedType !== layoutObj.type) {
      layoutObj.type = mappedType;
    }
  }

  // Fix missing or undefined name (required by Figma)
  if (!layoutObj.name || layoutObj.name === 'undefined') {
    // Generate a default name based on type
    if (layoutObj.type === 'COMPONENT_INSTANCE') {
      layoutObj.name = layoutObj.componentName || 'Component';
    } else if (layoutObj.type === 'FRAME') {
      layoutObj.name = 'Container';
    } else if (layoutObj.type === 'TEXT') {
      layoutObj.name = 'Text';
    } else {
      layoutObj.name = layoutObj.type || 'Node';
    }
  }

  // Fix sizing modes - Figma only accepts 'FIXED' or 'AUTO'
  if (layoutObj.primaryAxisSizingMode &&
      layoutObj.primaryAxisSizingMode !== 'FIXED' &&
      layoutObj.primaryAxisSizingMode !== 'AUTO') {
    console.warn(`⚠️ Invalid primaryAxisSizingMode "${layoutObj.primaryAxisSizingMode}", changing to "AUTO"`);
    layoutObj.primaryAxisSizingMode = 'AUTO';
  }

  if (layoutObj.counterAxisSizingMode &&
      layoutObj.counterAxisSizingMode !== 'FIXED' &&
      layoutObj.counterAxisSizingMode !== 'AUTO') {
    console.warn(`⚠️ Invalid counterAxisSizingMode "${layoutObj.counterAxisSizingMode}", changing to "AUTO"`);
    layoutObj.counterAxisSizingMode = 'AUTO';
  }

  // Fix counterAxisAlignItems - Figma only accepts 'MIN' | 'MAX' | 'CENTER' | 'BASELINE'
  const validCounterAxisAlign = ['MIN', 'MAX', 'CENTER', 'BASELINE'];
  if (layoutObj.counterAxisAlignItems && !validCounterAxisAlign.includes(layoutObj.counterAxisAlignItems)) {
    console.warn(`⚠️ Invalid counterAxisAlignItems "${layoutObj.counterAxisAlignItems}", changing to "CENTER"`);
    layoutObj.counterAxisAlignItems = 'CENTER';
  }

  // Recursively sanitize children
  if (Array.isArray(layoutObj.children)) {
    layoutObj.children = layoutObj.children.map(child => sanitizeLayoutJSON(child));
  }

  return layoutObj;
}

/**
 * Extract JSON from Claude's response (handles comments, markdown, etc.)
 */
function extractJSON(responseText) {
  let text = responseText.trim();

  // Log the raw response for debugging
  console.log('Raw AI response (first 500 chars):', text.substring(0, 500));

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
 * Build SVG system prompt using visual language
 */
function buildSVGSystemPrompt(designSystem) {
  const visualLanguage = designSystem.visualLanguage || 'No visual language available';

  return `You are a UI design assistant that generates pixel-perfect, grid-aligned SVG mockups for Figma.

Use the design system's visual language to style your SVG elements.

${visualLanguage}

🎨 CONCEPT EXPLORATION (CRITICAL FOR VARIATIONS)

When generating design variations, your goal is to explore DISTINCTLY DIFFERENT interpretations of the same idea.
Each variation must change at least TWO of these design axes:

1. LAYOUT STRUCTURE:
   - Single column, split view, grid, sidebar, card-based, timeline, dashboard, masonry

2. VISUAL MOOD:
   - Minimal, bold, editorial, futuristic, playful, data-dense, elegant, professional

3. INTERACTION EMPHASIS:
   - Navigation-centric, analytics-focused, social, input-heavy, browsing-focused, action-driven

4. COMPOSITION RHYTHM:
   - Symmetrical, asymmetrical, stacked, masonry, centered, edge-aligned, floating

5. CONTENT HIERARCHY:
   - Hero-driven, equal-weight sections, progressive disclosure, scannable cards, list-based

Each variation should feel like the same brand system, but represent a UNIQUE DESIGN CONCEPT.
Prioritize creativity and structural contrast over minor tweaks (colors, spacing alone).

Think: "Would a designer look at these variations and say they're meaningfully different approaches, or just slight adjustments?"

OUTPUT FORMAT: Pure SVG markup (no markdown, no JSON wrapper, no explanations)

🎯 CRITICAL: GRID-BASED LAYOUT SYSTEM (NO EXCEPTIONS)

Your SVG must be structured like a Figma Auto Layout design:
• Use a consistent 8px grid for ALL positioning and sizing
• ALL coordinates must be multiples of 8 (x: 0, 8, 16, 24, 32, 40, 48...)
• ALL dimensions must be multiples of 8 (width: 80, 120, 160, 200...)
• NO decimals, NO inline math (40 + 2.5), NO odd numbers
• NO misaligned elements - everything snaps to the 8px grid

📐 PRECISE POSITIONING RULES

**Container Alignment:**
• Containers start at grid coordinates: x="40" y="120" (multiples of 8)
• Container dimensions are grid-based: width="400" height="240"
• Padding inside containers: 16px, 24px, or 32px (all multiples of 8)
• Vertical spacing between sections: 24px, 32px, or 40px

**Text Positioning (CRITICAL FOR FIGMA):**
• Text y-coordinate = container top + padding + (fontSize × 0.75)
• For 16px font: y = containerY + padding + 12
• For 24px font: y = containerY + padding + 18
• For 14px font: y = containerY + padding + 11
• This ensures text appears visually centered in Figma

**Button Text Centering:**
• Button text must be perfectly centered vertically
• Formula: textY = buttonY + (buttonHeight / 2) + (fontSize × 0.35)
• Example: 40px tall button with 14px text: y = buttonY + 20 + 5 = buttonY + 25
• Always set text-anchor="middle" for horizontal centering
• Text x-coordinate: x = buttonX + (buttonWidth / 2)

**Icon + Text Alignment:**
• Icons and adjacent text must share the same baseline
• Icon y = text y - (fontSize × 0.75)
• Example: If text is at y="50", 16px icon should be at y="38"
• Horizontal spacing between icon and text: 8px or 12px

📏 SPACING SCALE (USE ONLY THESE VALUES)

• Tight spacing: 8px (between related items)
• Comfortable spacing: 16px (default padding, gaps)
• Section spacing: 24px (between sections)
• Loose spacing: 32px (major sections, page margins)
• Extra spacing: 40px, 48px, 56px, 64px (use sparingly)

⚠️ FORBIDDEN PATTERNS (WILL CAUSE LAYOUT DRIFT)

❌ NEVER use: x="42.5" or y="157.3" (decimals)
❌ NEVER use: width="243" or height="167" (not divisible by 8)
❌ NEVER use: x="100" y="150" spacing="23px" (inconsistent grid)
❌ NEVER use: text y="50" inside rect y="40" height="40" (clipped text)
❌ NEVER use: unequal top/bottom padding (looks uncentered)

✅ CORRECT PATTERNS (GRID-ALIGNED, FIGMA-READY)

✅ Container with centered text:
<rect x="40" y="120" width="320" height="80" rx="8" fill="#ffffff"/>
<text x="60" y="152" font-size="16" font-weight="600">Title</text>
<text x="60" y="176" font-size="14" fill="#666666">Subtitle</text>

✅ Button with centered text:
<rect x="40" y="240" width="160" height="40" rx="8" fill="#0066cc"/>
<text x="120" y="265" font-size="14" font-weight="600" fill="#ffffff" text-anchor="middle">Click Here</text>

✅ Icon + Text row (aligned baseline):
<circle cx="48" cy="312" r="8" fill="#0066cc"/>
<text x="64" y="318" font-size="16" font-weight="500">Feature Name</text>

✅ Vertically stacked sections (consistent spacing):
<g id="section-1">
  <rect x="40" y="120" width="400" height="80" rx="8" fill="#f5f5f5"/>
  <!-- content at y: 120 + 16 + 12 = 148 -->
</g>
<g id="section-2">
  <rect x="40" y="232" width="400" height="80" rx="8" fill="#f5f5f5"/>
  <!-- 232 = 120 + 80 + 32 (section spacing) -->
</g>

📊 LAYOUT STRUCTURE REQUIREMENTS

**Header/Navigation Bar:**
• Height: 64px or 80px
• Y position: 0
• Logo/title x: 40px from left edge
• Right-aligned items: calculate from viewport width minus 40px margin
• Vertical centering: textY = (headerHeight / 2) + (fontSize × 0.35)

**Card Components:**
• Padding: 24px or 32px on all sides (equal top/bottom)
• Border radius: 8px or 12px (rx="8")
• Minimum height: 120px (divisible by 8)
• Card spacing: 24px vertical, 24px horizontal

**Form Inputs:**
• Height: 40px or 48px
• Padding: 16px horizontal
• Text baseline: inputY + (inputHeight / 2) + 5
• Label above input: 8px gap

**Lists/Tables:**
• Row height: 48px, 56px, or 64px (consistent throughout)
• Row spacing: 0px (touching) or 8px (separated)
• Cell padding: 16px horizontal, centered vertically

CRITICAL RULES FOR TEXT:
• ALWAYS include text labels for every UI element
• Add text to ALL buttons, headers, cards, navigation items, forms
• Use meaningful, realistic text (e.g., "Dashboard", "Revenue: $45k", "Submit", "Profile")
• NO lorem ipsum or placeholder text
• Match font family from design system typography (SF Pro Text, Inter, etc.)
• Use appropriate font sizes: headings (18-32px), body (14-16px), labels (12-14px)
• Use appropriate font weights: headings (600-700), body (400-500)
• ALWAYS set font-style="normal" on ALL <text> elements (never use italic unless explicitly requested)
• Calculate text y-position using formulas above for perfect vertical centering

🚫 FIGMA SVG LIMITATIONS (CRITICAL):

Figma's SVG importer does NOT support:
• ❌ <style> tags with @import (Google Fonts, external CSS) - Use inline font-family instead
• ❌ SVG filters (<filter>, <feDropShadow>, <feGaussianBlur>) - Use simple shadows with opacity
• ❌ <foreignObject> or embedded HTML - Use native SVG elements only
• ❌ External references (xlink:href to external files)
• ❌ <script> tags or JavaScript

INSTEAD, use Figma-compatible alternatives:
• ✅ Inline styles: <text font-family="Inter" font-size="16" fill="#000">
• ✅ Simple shadows: Overlapping shapes with reduced opacity
• ✅ Native SVG shapes: <rect>, <circle>, <path>, <text>, <g>
• ✅ Solid fills and strokes: fill="#0066cc" stroke="#dddddd"

VISUAL DESIGN RULES:
• Use exact colors from design system PRIMARY COLORS
• Match border-radius values using rx/ry attributes on <rect>
• Apply shadows using stroke with low opacity or <filter> elements
• Use specified fonts with correct sizes and weights from design system
• Create clean, production-ready layouts with proper spacing
• Use <g> tags for semantic grouping (header, sidebar, main, cards, etc.)
• Add id attributes to major sections for clarity

CANVAS SIZE:
• Desktop: 1920x1080 or 1440x900
• Mobile: 375x812 or 390x844
• Tablet: 768x1024

IMPORTANT OUTPUT REQUIREMENTS:
• Return ONLY the SVG markup
• No markdown code blocks
• No JSON wrapper
• No explanations before or after
• Start with <svg and end with </svg>
• ALL coordinates and dimensions must be multiples of 8
• Text must be properly baseline-aligned using the formulas provided
• Design must be immediately usable in Figma without manual adjustments`;
}

/**
 * Extract SVG from Claude response (remove markdown)
 */
function extractSVG(responseText) {
  let text = responseText.trim();

  console.log('Raw SVG response (first 300 chars):', text.substring(0, 300));

  // Remove markdown code blocks
  text = text.replace(/```svg\n?/g, '').replace(/```xml\n?/g, '').replace(/```\n?/g, '');

  // Find SVG tags
  const svgStart = text.indexOf('<svg');
  const svgEnd = text.lastIndexOf('</svg>');

  if (svgStart !== -1 && svgEnd > svgStart) {
    text = text.substring(svgStart, svgEnd + 6);
  }

  console.log('Extracted SVG (first 300 chars):', text.substring(0, 300));
  console.log('Extracted SVG length:', text.length, 'characters');

  return text.trim();
}

/**
 * Sanitize SVG to remove Figma-unsupported features
 */
function sanitizeSVG(svg) {
  let sanitized = svg;

  // Remove <style> tags with @import (Google Fonts, external CSS)
  sanitized = sanitized.replace(/<style[^>]*>[\s\S]*?@import[^;]*;[\s\S]*?<\/style>/gi, '');

  // Remove entire <defs> containing complex filters (feDropShadow, feGaussianBlur, etc.)
  // Keep simple defs (gradients, clipPath) but remove filter defs
  sanitized = sanitized.replace(/<defs>[\s\S]*?<filter[\s\S]*?<\/filter>[\s\S]*?<\/defs>/gi, function(match) {
    // If the <defs> ONLY contains filters, remove it entirely
    const hasNonFilterContent = /<(?!filter|\/filter|\/defs)/.test(match);
    return hasNonFilterContent ? match.replace(/<filter[\s\S]*?<\/filter>/gi, '') : '';
  });

  // Remove standalone <filter> tags (outside defs)
  sanitized = sanitized.replace(/<filter[\s\S]*?<\/filter>/gi, '');

  // Remove filter attribute references (filter="url(#shadow-sm)")
  sanitized = sanitized.replace(/\s+filter="[^"]*"/gi, '');

  // Remove foreignObject (Figma doesn't support)
  sanitized = sanitized.replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, '');

  // Log if sanitization made changes
  if (sanitized !== svg) {
    console.log('⚠️ SVG sanitized - removed Figma-unsupported features:');
    if (svg.includes('@import')) console.log('  - Removed @import CSS');
    if (svg.includes('<filter')) console.log('  - Removed SVG filters');
    if (svg.includes('foreignObject')) console.log('  - Removed foreignObject');
  }

  return sanitized;
}

/**
 * Process a generate job - SVG MODE
 */
async function processGenerateJob(job) {
  const { prompt, designSystem, model } = job.input;

  const selectedModel = model || 'claude';
  console.log(`🎨 SVG Mode: Using ${selectedModel === 'gemini' ? 'Gemini 3 Pro' : 'Claude 4.5'} for SVG generation`);

  const systemPrompt = buildSVGSystemPrompt(designSystem);
  const userPrompt = `User Request: ${prompt}

Generate a complete SVG mockup that fulfills this request.

REQUIREMENTS:
• Use the design system's visual language (colors, border-radius, shadows, typography)
• Include realistic text labels on ALL elements (buttons, headers, cards, navigation, forms, etc.)
• Make it look like a real application with meaningful content
• Use proper spacing and layout
• Return ONLY the SVG markup (no markdown, no explanations)

Remember: Every button, card, header, and UI element MUST have visible text labels!`;

  const aiResponse = selectedModel === 'gemini'
    ? await callGemini(systemPrompt, userPrompt)
    : await callClaude(systemPrompt, userPrompt);

  const responseText = aiResponse.content[0]?.text || '';

  // Check if we hit the token limit
  if (aiResponse.stop_reason === 'max_tokens' || aiResponse.stop_reason === 'length') {
    console.warn('⚠️ Warning: Model hit max_tokens limit. Response may be truncated.');
    console.warn('Usage:', JSON.stringify(aiResponse.usage));
  }

  // Extract SVG from response
  let svg = extractSVG(responseText);

  if (!svg || !svg.includes('<svg')) {
    throw new Error('Failed to extract valid SVG from AI response');
  }

  // Sanitize SVG to remove Figma-unsupported features
  svg = sanitizeSVG(svg);

  console.log('✅ SVG generated successfully');

  return {
    svg,
    reasoning: `SVG mockup generated with ${selectedModel === 'gemini' ? 'Gemini 3 Pro' : 'Claude 4.5'}`
  };
}

/**
 * DEPRECATED: Two-stage pipeline for Figma JSON (keeping for reference)
 */
async function processGenerateJob_OLD_FIGMA_MODE(job) {
  const { prompt, designSystem, model } = job.input;

  // Determine which approach to use
  const useTwoStage = model === 'together' ||
    (!model && process.env.TOGETHER_API_KEY && process.env.TOGETHER_MODEL_CRAFTER_FT);

  let layout;
  let reasoning;

  if (useTwoStage) {
    console.log('🚀 Using two-stage pipeline: Together AI → Claude refinement');

    // STAGE 1: Together AI generates rough layout structure
    console.log('📝 Stage 1: Together AI generating rough layout...');
    const togetherSystemPrompt = buildSimplifiedSystemPrompt(designSystem);
    const togetherUserPrompt = `Design a ${prompt.includes('web') || prompt.includes('mobile') ? '' : 'web '}screen for ${prompt}. Focus on overall structure and hierarchy. Return only the JSON layout object.`;

    let roughLayout;
    try {
      const togetherResponse = await callTogetherAI(togetherSystemPrompt, togetherUserPrompt);
      const togetherText = togetherResponse.content[0]?.text || '{}';

      // Try to extract and parse Together AI's response
      try {
        const togetherJSON = extractJSON(togetherText);
        roughLayout = JSON.parse(togetherJSON);
        console.log('✅ Stage 1 complete: Together AI generated rough layout');
      } catch (parseError) {
        console.warn('⚠️ Together AI returned invalid JSON, using prompt only for Claude');
        roughLayout = null;
      }
    } catch (error) {
      console.warn('⚠️ Together AI failed:', error.message);
      roughLayout = null;
    }

    // STAGE 2: Claude refines the layout
    console.log('🎨 Stage 2: Claude refining layout with design system...');
    const claudeSystemPrompt = buildSystemPrompt(designSystem);

    let claudeUserPrompt;
    if (roughLayout) {
      // Claude refines the rough layout from Together AI
      claudeUserPrompt = `User Request: ${prompt}

A rough layout structure was generated, but it needs refinement:
${JSON.stringify(roughLayout, null, 2)}

Please refine this layout as a senior designer:
1. Fix any structural issues or invalid properties
2. Apply the design system components properly (use correct componentKey values)
3. Ensure strict Auto Layout rules are followed
4. Use proper Figma property names (e.g., "name" not "id", "componentKey" not "component")
5. Add proper spacing, padding, and visual hierarchy
6. Use realistic, production-ready text content
7. Ensure the layout matches the user's original request

Return the refined layout as high-quality JSON following the schema provided.`;
    } else {
      // Together AI failed, Claude generates from scratch
      claudeUserPrompt = `User Request: ${prompt}

Please generate a Figma layout that fulfills this request using the available design system components. Return the layout as JSON following the schema provided.`;
    }

    const claudeResponse = await callClaude(claudeSystemPrompt, claudeUserPrompt);
    const claudeText = claudeResponse.content[0]?.text || '{}';

    // Check if we hit the token limit
    if (claudeResponse.stop_reason === 'max_tokens' || claudeResponse.stop_reason === 'length') {
      console.warn('⚠️ Warning: Claude hit max_tokens limit. Response may be truncated.');
      console.warn('Usage:', JSON.stringify(claudeResponse.usage));
    }

    // Extract and parse Claude's refined layout
    const jsonText = extractJSON(claudeText);

    let parsed;
    try {
      parsed = JSON.parse(jsonText);
    } catch (error) {
      console.error('❌ JSON parse error:', error.message);
      console.error('Failed JSON length:', jsonText.length, 'characters');
      console.error('Failed JSON (first 1000 chars):', jsonText.substring(0, 1000));
      console.error('Failed JSON (last 1000 chars):', jsonText.substring(Math.max(0, jsonText.length - 1000)));
      throw new Error(`Failed to parse AI response: ${error.message}`);
    }

    layout = parsed.layout || parsed;
    reasoning = parsed.reasoning || 'Generated with two-stage pipeline (Together AI + Claude)';

    console.log('✅ Stage 2 complete: Claude refined the layout');

  } else {
    // Single-stage: Claude only
    console.log('🧠 Using Claude Sonnet 4.5 for generation');

    const systemPrompt = buildSystemPrompt(designSystem);
    const userPrompt = `User Request: ${prompt}

Please generate a Figma layout that fulfills this request using the available design system components. Return the layout as JSON following the schema provided.`;

    const aiResponse = await callClaude(systemPrompt, userPrompt);
    const responseText = aiResponse.content[0]?.text || '{}';

    // Check if we hit the token limit
    if (aiResponse.stop_reason === 'max_tokens' || aiResponse.stop_reason === 'length') {
      console.warn('⚠️ Warning: Claude hit max_tokens limit. Response may be truncated.');
      console.warn('Usage:', JSON.stringify(aiResponse.usage));
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
      throw new Error(`Failed to parse AI response: ${error.message}`);
    }

    layout = parsed.layout || parsed;
    reasoning = parsed.reasoning || 'Generated with Claude';
  }

  // Sanitize the layout to fix any remaining AI errors
  layout = sanitizeLayoutJSON(layout);

  return {
    layout,
    reasoning,
  };
}

/**
 * Build iteration system prompt for SVG
 */
function buildSVGIterationPrompt(designSystem) {
  const visualLanguage = designSystem.visualLanguage || 'No visual language available';

  return `You are a UI design assistant that modifies existing SVG mockups based on user feedback.

Use the design system's visual language to maintain consistency.

${visualLanguage}

YOUR TASK:
You will receive an existing SVG design and a user's modification request.
Analyze the current SVG carefully and make ONLY the requested changes while preserving everything else.

OUTPUT FORMAT: Pure SVG markup (no markdown, no JSON wrapper, no explanations)

CRITICAL RULES:
• Preserve the overall structure unless explicitly asked to change it
• Maintain existing colors, fonts, and spacing unless asked to change them
• Keep all existing text content unless asked to modify it
• Only modify what the user specifically requests
• Return a complete, valid SVG (not a partial modification)
• Include ALL text labels (preserve existing + add new if needed)
• Use design system visual language for any new elements

IMPORTANT:
• Return ONLY the modified SVG markup
• No markdown code blocks
• No JSON wrapper
• No explanations before or after
• Start with <svg and end with </svg>`;
}

/**
 * Process an iterate job - VISION MODE
 * Uses PNG screenshot + design system to generate modified SVG
 */
async function processIterateJob(job) {
  const { prompt, imageData, designSystem, model } = job.input;

  const selectedModel = model || 'claude';
  console.log(`🎨 Vision Iteration Mode: Using ${selectedModel === 'gemini' ? 'Gemini 3 Pro' : 'Claude 4.5'} with image`);

  const systemPrompt = buildSVGSystemPrompt(designSystem);

  const userPrompt = `You are looking at an existing design (see image). The user wants to make the following change:

"${prompt}"

CRITICAL ITERATION RULES:

1. PRESERVE EXACTLY (unless user explicitly mentions them):
   • All existing text content and labels - keep the exact same words
   • All UI elements (buttons, cards, inputs, navigation, etc.)
   • Overall layout structure and component arrangement
   • Spacing between elements
   • All icons, images, and visual elements not mentioned
   • Component sizes and proportions
   • ALL grid-aligned coordinates (multiples of 8)

2. CHANGE ONLY:
   • What the user EXPLICITLY requested in their prompt
   • Nothing more, nothing less

3. MAINTAIN GRID ALIGNMENT (CRITICAL):
   • ALL coordinates must remain multiples of 8 (x: 0, 8, 16, 24, 32, 40, 48...)
   • ALL dimensions must remain multiples of 8 (width: 80, 120, 160, 200...)
   • NO decimals, NO inline math, NO odd numbers
   • Text y-coordinates must use proper baseline formulas:
     - Container text: y = containerY + padding + (fontSize × 0.75)
     - Button text: y = buttonY + (buttonHeight / 2) + (fontSize × 0.35)
   • If you add new elements, they must snap to the 8px grid
   • Preserve vertical spacing multiples of 8 (8px, 16px, 24px, 32px)

4. MAKE NATURAL ADJUSTMENTS:
   • If you change one element, adjust nearby spacing/alignment if needed for visual harmony
   • If you change colors, ensure proper contrast is maintained
   • If you resize an element, adjust its container size proportionally (still multiples of 8)
   • Maintain visual balance and hierarchy
   • Maintain equal top/bottom padding in containers

5. REFERENCE THE CURRENT DESIGN:
   • Study the image carefully - count elements, note text, observe layout
   • Recreate the SAME structure with the requested modification
   • Match the existing visual style (rounded corners, shadows, borders, etc.)
   • Use the SAME number of elements (unless user asks to add/remove)
   • Preserve the grid-aligned positioning system

6. OUTPUT REQUIREMENTS:
   • Generate a complete, pixel-perfect SVG
   • Include ALL text labels from the original (unless user changed them)
   • Match fonts, sizes, weights, colors from the design system
   • Maintain design system consistency
   • ALL coordinates and dimensions must be multiples of 8
   • Text must be properly baseline-aligned using the formulas
   • Design must remain immediately usable in Figma without manual adjustments

EXAMPLE - If user says "make the header blue":
✅ DO: Change header fill="#0066cc", adjust text color for contrast, keep all coordinates identical, maintain grid alignment
❌ DON'T: Change x="40" to x="42", change height="80" to height="75", redesign layout, rearrange elements

EXAMPLE - If user says "add a button below the card":
✅ DO: Calculate new button position using grid: cardY + cardHeight + 24 (spacing), use standard button dimensions (width="160" height="40"), center text properly
❌ DON'T: Use x="123.5" or height="37", misalign button with existing grid

This is an ITERATION - you're making a surgical change to an existing design while maintaining pixel-perfect grid alignment.`;

  // Call the selected AI model with vision (image + text)
  const aiResponse = selectedModel === 'gemini'
    ? await callGeminiWithVision(systemPrompt, userPrompt, imageData)
    : await callClaudeWithVision(systemPrompt, userPrompt, imageData);

  const responseText = aiResponse.content[0]?.text || '';

  // Check if we hit the token limit
  if (aiResponse.stop_reason === 'max_tokens' || aiResponse.stop_reason === 'length') {
    console.warn('⚠️ Warning: Model hit max_tokens limit. Response may be truncated.');
    console.warn('Usage:', JSON.stringify(aiResponse.usage));
  }

  // Extract SVG from response
  let updatedSVG = extractSVG(responseText);

  if (!updatedSVG || !updatedSVG.includes('<svg')) {
    throw new Error('Failed to extract valid SVG from Claude response');
  }

  // Sanitize SVG to remove Figma-unsupported features
  updatedSVG = sanitizeSVG(updatedSVG);

  console.log('✅ Vision iteration complete');

  return {
    svg: updatedSVG,
    reasoning: `SVG modified with ${selectedModel === 'gemini' ? 'Gemini 3 Pro' : 'Claude 4.5'} Vision`
  };
}

/**
 * Process a single job (helper function for parallel processing)
 */
async function processSingleJob(job) {
  try {
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
    console.error(`❌ Error processing job ${job.id}:`, error.message);

    // Mark job as error
    try {
      await updateJob(job.id, 'error', null, error.message);
    } catch (updateError) {
      console.error(`Failed to update job ${job.id} error status:`, updateError);
    }

    throw error; // Re-throw to be caught by Promise.allSettled
  }
}

/**
 * Main worker loop with parallel job processing
 */
async function main() {
  console.log('🚀 Crafter Background Worker Started');
  console.log('⚡ Parallel processing enabled (max 3 concurrent jobs)');
  console.log('Listening for jobs in Supabase queue...\n');

  const MAX_CONCURRENT_JOBS = 3;

  while (true) {
    try {
      // Get multiple queued jobs
      const jobs = await getQueuedJobs(MAX_CONCURRENT_JOBS);

      if (jobs.length === 0) {
        // No jobs, wait 1 second (faster polling for better responsiveness)
        await new Promise(resolve => setTimeout(resolve, 1000));
        continue;
      }

      console.log(`\n🔄 Found ${jobs.length} queued job(s), processing in parallel...`);

      // Process all jobs in parallel
      const jobPromises = jobs.map(job => processSingleJob(job));

      // Wait for all jobs to complete (or fail)
      // Using allSettled so one failure doesn't stop others
      const results = await Promise.allSettled(jobPromises);

      // Log summary
      const successful = results.filter(r => r.status === 'fulfilled').length;
      const failed = results.filter(r => r.status === 'rejected').length;

      if (successful > 0) {
        console.log(`\n✨ Batch complete: ${successful} succeeded, ${failed} failed`);
      }

      // Small delay before next batch
      await new Promise(resolve => setTimeout(resolve, 1000));

    } catch (error) {
      console.error('❌ Error in main loop:', error.message);

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
