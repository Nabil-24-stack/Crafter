/**
 * Standalone Express server for MVP iteration endpoint
 * Deploy this to Railway
 */

const express = require('express');
const cors = require('cors');

const app = express();

// ============================================================================
// STYLE TOKEN REGISTRY (predefined, small, stable)
// ============================================================================
const STYLE_TOKENS = {
  'button/primary': 'Primary button with brand color',
  'button/secondary': 'Secondary button with subtle styling',
  'card/default': 'Standard card container with shadow',
  'input/default': 'Text input field',
  'container/page': 'Page-level container with padding',
  'container/section': 'Section container with vertical spacing'
};

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

// ============================================================================
// NEW ENDPOINT: Direct Figma JSON Generation
// ============================================================================

app.post('/api/iterate-figma-json', async (req, res) => {
  try {
    const { extractedStyle, imagePNG, instructions, model, previousErrors } = req.body;

    // Validate request
    if (!extractedStyle || !imagePNG || !instructions || !model) {
      return res.status(400).json({
        error: 'Missing required fields',
        required: ['extractedStyle', 'imagePNG', 'instructions', 'model']
      });
    }

    console.log(`📊 Received Figma JSON iteration request:`);
    console.log(`  Instructions: ${instructions}`);
    console.log(`  Model: ${model}`);
    console.log(`  Image size: ${Math.round(imagePNG.length / 1024)} KB`);
    console.log(`  Style: ${extractedStyle.colors.primary}, font sizes: ${extractedStyle.typography.sizes.join(', ')}`);
    if (previousErrors) {
      console.log(`  ⚠️  Previous errors detected - retry with corrections`);
    }

    // Build prompt based on model
    const prompt = model === 'gemini-3-pro'
      ? buildGeminiFigmaJsonPrompt(extractedStyle, instructions, previousErrors)
      : buildClaudeFigmaJsonPrompt(extractedStyle, instructions, previousErrors);

    // Call LLM
    const rawResponse = await callLLM(model, prompt, imagePNG);

    // Parse JSON
    let parsed;
    try {
      // Remove markdown code blocks if present
      const cleaned = rawResponse.replace(/```json\n?/g, '').replace(/```\n?/g, '');
      parsed = JSON.parse(cleaned);
    } catch (parseError) {
      return res.status(500).json({
        error: 'Failed to parse JSON response',
        message: parseError.message,
        rawResponse: rawResponse.substring(0, 500) // Return first 500 chars for debugging
      });
    }

    // Basic validation for Figma JSON output
    if (!parsed.figmaJson) {
      return res.status(500).json({
        error: 'Response missing required field: figmaJson'
      });
    }

    if (parsed.figmaJson.type !== 'FRAME') {
      return res.status(500).json({
        error: 'Root node must be type "FRAME"'
      });
    }

    console.log(`✅ Successfully generated Figma JSON`);

    return res.json({
      figmaJson: parsed.figmaJson,
      reasoning: parsed.reasoning
    });

  } catch (error) {
    console.error('Error in iterate-figma-json:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
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
// PROMPT BUILDERS - Direct Figma JSON Generation
// ============================================================================

function buildGeminiFigmaJsonPrompt(extractedStyle, instructions, previousErrors) {
  const errorContext = previousErrors ? `
## PREVIOUS ATTEMPT ERRORS

Your last attempt had validation errors. Please fix them:

**Errors:**
${previousErrors.errors.map(e => `- ${e}`).join('\n')}

**Suggestions:**
${previousErrors.suggestions.map(s => `- ${s}`).join('\n')}

` : '';

  // Build structural context section with roles and node IDs
  let structuralContext = '';
  let preservationRules = '';

  if (extractedStyle.structure && extractedStyle.structure.elements.length > 0) {
    const { structure } = extractedStyle;

    // Group elements by role
    const shellElements = structure.elements.filter(e => e.role === 'shell');
    const globalNavElements = structure.elements.filter(e => e.role === 'global-nav');
    const localNavElements = structure.elements.filter(e => e.role === 'local-nav');
    const contentElements = structure.elements.filter(e => e.role === 'content');

    structuralContext = `
## FRAME STRUCTURE WITH PRESERVATION RULES

**Element Inventory with Node IDs:**
${structure.elements.map(e => `- ${e.name} (role="${e.role}", nodeId="${e.nodeId}")`).join('\n')}

**STRICT PRESERVATION BY ROLE:**
${shellElements.length > 0 ? `- **Shell elements (ALWAYS preserve with sourceNodeId):**\n${shellElements.map(e => `    - ${e.name}: nodeId="${e.nodeId}"`).join('\n')}` : ''}
${globalNavElements.length > 0 ? `- **Global navigation (ALWAYS preserve with sourceNodeId):**\n${globalNavElements.map(e => `    - ${e.name}: nodeId="${e.nodeId}"`).join('\n')}` : ''}
${localNavElements.length > 0 ? `- **Local navigation (preserve unless explicitly mentioned):**\n${localNavElements.map(e => `    - ${e.name}: nodeId="${e.nodeId}"`).join('\n')}` : ''}
${contentElements.length > 0 ? `- **Content areas (MODIFY based on instructions):**\n${contentElements.map(e => `    - ${e.name}: nodeId="${e.nodeId}"`).join('\n')}` : ''}

`;
  }

  const tokenList = Object.keys(STYLE_TOKENS).join(', ');

  return `You are a Figma design expert. You MUST use the three-mode output system for EVERY node.

${errorContext}${structuralContext}
## CRITICAL: THREE-MODE OUTPUT SYSTEM

**You MUST use ONE of these three approaches for EVERY node:**

1. **PRESERVE EXACTLY (sourceNodeId)**
   - For: All shell and global-nav elements, plus any element not mentioned in user request
   - Output: { "type": "FRAME", "name": "Sidebar", "sourceNodeId": "123:456" }
   - Result: Exact clone of original node

2. **USE TOKEN (styleToken)**
   - For: New UI elements that match our design system
   - Output: { "type": "INSTANCE", "name": "Submit", "styleToken": "button/primary" }
   - Available tokens: ${tokenList}
   - NEVER create custom styles - only use these tokens

3. **LAYOUT ONLY (bare FRAME)**
   - For: Pure structural containers with NO visual styling
   - Output: { "type": "FRAME", "name": "Container", "layoutMode": "VERTICAL", "children": [...] }
   - NO colors, padding, or effects - only structure!

**FORBIDDEN: You may NOT output custom fills, strokes, effects, or arbitrary styles**

## VISUAL REFERENCE (PNG IMAGE)

The attached PNG shows the EXACT visual design. Use it for:
1. **Spacing and proportions** - Match the whitespace and relative sizes exactly
2. **Visual density** - Keep similar information density per area
3. **Component identification** - Recognize which components to preserve vs modify

## EXTRACTED VISUAL STYLE (for reference only)

**Colors:** ${extractedStyle.colors.primary}, ${extractedStyle.colors.secondary}, ${extractedStyle.colors.text}, ${extractedStyle.colors.background}
**Typography:** ${extractedStyle.typography.sizes.join(', ')}px sizes, ${extractedStyle.typography.weights.join(', ')} weights
**Spacing:** ${extractedStyle.spacing.padding.join(', ')}px padding, ${extractedStyle.spacing.gaps.join(', ')}px gaps

## USER REQUEST ANALYSIS

User instruction: "${instructions}"

Based on this request, determine:
- Which region does this affect? (shell, navigation, or content?)
- Which specific nodes need modification?
- Which nodes MUST be preserved exactly?

## OUTPUT FORMAT EXAMPLE

For a "Design Team tab" request where Sidebar (nodeId="1:100") and Header (nodeId="1:101") are shell/navigation:

\`\`\`json
{
  "reasoning": "Preserved sidebar and header exactly, created new team content area with member cards",
  "figmaJson": {
    "type": "FRAME",
    "name": "Root",
    "sourceNodeId": "1:1000",
    "children": [
      {
        "type": "FRAME",
        "name": "Sidebar",
        "sourceNodeId": "1:100"
      },
      {
        "type": "FRAME",
        "name": "Header",
        "sourceNodeId": "1:101"
      },
      {
        "type": "FRAME",
        "name": "TeamContent",
        "layoutMode": "VERTICAL",
        "children": [
          {
            "type": "TEXT",
            "name": "Title",
            "text": "Team Members"
          },
          {
            "type": "INSTANCE",
            "name": "TeamCard1",
            "styleToken": "card/default"
          },
          {
            "type": "INSTANCE",
            "name": "InviteButton",
            "styleToken": "button/primary"
          }
        ]
      }
    ]
  }
}
\`\`\`

## TECHNICAL RULES

1. **Node types:** FRAME (containers), INSTANCE (components), TEXT (text only)
2. **Three modes only:** sourceNodeId, styleToken, or bare layout frame
3. **NO custom styles:** Never output fills, strokes, fontSize, fontFamily, etc.
4. **Valid layoutMode:** "HORIZONTAL", "VERTICAL", "NONE" (only for layout frames)
5. **sourceNodeId format:** Use exact nodeId from element inventory
6. **styleToken values:** Only use tokens from the list: ${tokenList}
7. **TEXT nodes:** Must include "text" field with actual content
8. **Preserve by default:** If unsure, preserve with sourceNodeId
9. **Keep JSON minimal:** Only required fields, no extra properties

Return your response now.`;
}

function buildClaudeFigmaJsonPrompt(extractedStyle, instructions, previousErrors) {
  const errorContext = previousErrors ? `
# Previous Attempt Errors

Your last attempt had validation errors. Please fix them:

<errors>
${previousErrors.errors.map(e => `- ${e}`).join('\n')}
</errors>

<suggestions>
${previousErrors.suggestions.map(s => `- ${s}`).join('\n')}
</suggestions>

` : '';

  // Build structural context section
  let structuralContext = '';
  if (extractedStyle.structure && extractedStyle.structure.elements.length > 0) {
    const { structure } = extractedStyle;

    // Build preservation rules dynamically based on what exists
    const navigationElements = structure.elements.filter(e =>
      ['sidebar', 'navigation', 'header'].includes(e.type)
    );
    const contentElements = structure.elements.filter(e =>
      ['main-content', 'unknown', 'card', 'form'].includes(e.type)
    );

    let preservationGuidance = '';
    if (navigationElements.length > 0) {
      preservationGuidance += `\nPreserve these navigation/shell elements:\n${navigationElements.map(e => `- ${e.name} (${e.type})`).join('\n')}`;
    }
    if (contentElements.length > 0) {
      preservationGuidance += `\n\nModify these content areas as per user instructions:\n${contentElements.map(e => `- ${e.name} (${e.type})`).join('\n')}`;
    }

    structuralContext = `
# Current Frame Structure

<identified_sections>
${structure.elements.map(e => `- ${e.name} (${e.type}): ${e.bounds.width}×${e.bounds.height}px`).join('\n')}
</identified_sections>

<design_strategy>${preservationGuidance}

Key Principle: Preserve the overall layout structure and navigation elements. Apply creative changes primarily to content areas.
</design_strategy>

`;
  }

  return `You are a Figma design expert creating layout variations while preserving key UI elements and brand consistency.

${errorContext}${structuralContext}
# Extracted Visual Style

Use this style guide as your design reference:

<style_guide>
Colors:
- Primary: ${extractedStyle.colors.primary}
- Secondary: ${extractedStyle.colors.secondary}
- Text: ${extractedStyle.colors.text}
- Background: ${extractedStyle.colors.background}

Typography:
- Font sizes: ${extractedStyle.typography.sizes.join(', ')}px
- Font weights: ${extractedStyle.typography.weights.join(', ')}
- Font families: ${extractedStyle.typography.families.join(', ')}

Spacing:
- Padding: ${extractedStyle.spacing.padding.join(', ')}px
- Gaps: ${extractedStyle.spacing.gaps.join(', ')}px

Layout:
- Container widths: ${extractedStyle.layout.containerWidths.join(', ')}px
- Common layouts: ${extractedStyle.layout.commonLayouts.join(', ')}
</style_guide>

# User Instructions

<instructions>
${instructions}
</instructions>

# Output Format

Return ONLY valid JSON with this structure:

\`\`\`json
{
  "reasoning": "Brief 1-2 sentence explanation",
  "figmaJson": {
    "type": "FRAME",
    "name": "Root",
    "layoutMode": "VERTICAL",
    "primaryAxisSizingMode": "AUTO",
    "counterAxisSizingMode": "FIXED",
    "width": 1200,
    "height": 800,
    "itemSpacing": 24,
    "paddingTop": 48,
    "paddingRight": 48,
    "paddingBottom": 48,
    "paddingLeft": 48,
    "primaryAxisAlignItems": "MIN",
    "counterAxisAlignItems": "MIN",
    "fills": [{ "type": "SOLID", "color": { "r": 0.96, "g": 0.96, "b": 0.96 } }],
    "cornerRadius": 0,
    "children": [
      {
        "type": "TEXT",
        "characters": "Welcome",
        "fontSize": 48,
        "fontFamily": "Inter",
        "fontWeight": "bold",
        "fills": [{ "type": "SOLID", "color": { "r": 0, "g": 0, "b": 0 } }],
        "textAlignHorizontal": "LEFT"
      }
    ]
  }
}
\`\`\`

# Design Principles

1. **Preserve Brand Consistency** - Keep navigation, headers, and key brand elements unchanged
2. **Focus on Content Area** - Apply creative changes only to the main content area
3. **Maintain Visual Hierarchy** - Respect the established hierarchy and information architecture
4. **Use Consistent Spacing** - Apply the extracted spacing values throughout
5. **Keep Original Structure** - Don't remove or relocate navigation elements

# Technical Requirements

1. **RGB colors MUST be 0-1 range** (NOT 0-255): red = {r: 1, g: 0, b: 0}
2. **Root must be type "FRAME"**
3. **Enum values:**
   - layoutMode: "HORIZONTAL", "VERTICAL", "NONE"
   - sizingMode: "FIXED", "AUTO"
   - fontWeight: "normal", "medium", "semibold", "bold"
   - textAlignHorizontal: "LEFT", "CENTER", "RIGHT"
   - primaryAxisAlignItems: "MIN", "CENTER", "MAX", "SPACE_BETWEEN"
   - counterAxisAlignItems: "MIN", "CENTER", "MAX"
4. **Use extracted style values** from the style guide above
5. **TEXT nodes require "characters" field** with actual text content
6. **FRAME nodes with children should use Auto Layout** (layoutMode, itemSpacing, padding, alignment)
7. **Keep JSON concise** - avoid deeply nested structures (max 3-4 levels deep)

Return your response now.`;
}

// ============================================================================
// PROMPT BUILDERS - HTML/CSS (DEPRECATED)
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
    "html": "<div class=\\"screen\\">\\n  <div class=\\"login-side\\">\\n    <div class=\\"app-logo\\"></div>\\n    <div class=\\"login-form\\"></div>\\n  </div>\\n  <div class=\\"pricing-side\\">\\n    <h1>Choose Your Plan</h1>\\n    <div class=\\"pricing-cards\\">\\n      <div class=\\"card\\">\\n        <h2>Starter</h2>\\n        <p class=\\"price\\">$29/mo</p>\\n        <p>Perfect for small teams</p>\\n      </div>\\n      <div class=\\"card\\">\\n        <h2>Pro</h2>\\n        <p class=\\"price\\">$99/mo</p>\\n        <p>For growing businesses</p>\\n      </div>\\n    </div>\\n  </div>\\n</div>",
    "css": ".screen { display: flex; flex-direction: row; gap: 0; background-color: #f5f5f5; }\\n.login-side { display: flex; flex-direction: column; gap: 48px; padding: 80px; width: 50%; }\\n.pricing-side { display: flex; flex-direction: column; gap: 32px; padding: 80px; width: 50%; background-color: #ffffff; }\\nh1 { font-size: 48px; font-weight: bold; color: #000000; }\\n.pricing-cards { display: flex; flex-direction: row; gap: 24px; }\\n.card { display: flex; flex-direction: column; gap: 16px; padding: 32px; background-color: #f9f9f9; border-radius: 12px; width: 280px; }\\nh2 { font-size: 32px; font-weight: bold; color: #333333; }\\n.price { font-size: 24px; color: #000000; font-weight: bold; }\\np { font-size: 16px; color: #666666; }",
    "componentMap": {
      "app-logo": {
        "componentKey": "9181c660...",
        "componentName": "App Logo"
      },
      "login-form": {
        "componentKey": "248d7d71...",
        "componentName": "Login Form"
      }
    }
  }
}
\`\`\`

### HTML RULES:
- **CRITICAL**: Include actual text content for headings, paragraphs, labels, and buttons
- Use semantic tags: <h1>, <h2>, <p>, <section>, <div>, <header>, <span>
- For text elements like headings and pricing, write the actual text: <h1>Choose Your Plan</h1>, <p>$29/mo</p>
- For design system components, use empty divs with class names mapped in componentMap
- Use descriptive class names for each element
- Keep HTML structure simple and clean

### CSS RULES:
- **CRITICAL**: Use Flexbox for ALL layouts (display: flex)
- Use flex-direction: column or row
- Use gap for spacing between children
- Use padding for container spacing
- **Specify background-color for visual sections** (e.g., cards, panels, containers)
- Specify width/height when needed for proper layout
- Include text styles: font-size, font-weight, color for h1, h2, p, etc.
- Use border-radius for rounded corners on cards/containers

### COMPONENT MAPPING:
- Map ONLY design system components (from the available components list)
- For custom UI elements (pricing cards, headers, text), create them in HTML/CSS directly
- Example: app-logo → maps to Logo component, but pricing cards → created as HTML/CSS divs with text

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
    "html": "<div class=\\"screen\\">\\n  <div class=\\"login-side\\">\\n    <div class=\\"app-logo\\"></div>\\n    <div class=\\"login-form\\"></div>\\n  </div>\\n  <div class=\\"pricing-side\\">\\n    <h1>Choose Your Plan</h1>\\n    <div class=\\"pricing-cards\\">\\n      <div class=\\"card\\">\\n        <h2>Starter</h2>\\n        <p class=\\"price\\">$29/mo</p>\\n        <p>Perfect for small teams</p>\\n      </div>\\n      <div class=\\"card\\">\\n        <h2>Pro</h2>\\n        <p class=\\"price\\">$99/mo</p>\\n        <p>For growing businesses</p>\\n      </div>\\n    </div>\\n  </div>\\n</div>",
    "css": ".screen { display: flex; flex-direction: row; gap: 0; background-color: #f5f5f5; }\\n.login-side { display: flex; flex-direction: column; gap: 48px; padding: 80px; width: 50%; }\\n.pricing-side { display: flex; flex-direction: column; gap: 32px; padding: 80px; width: 50%; background-color: #ffffff; }\\nh1 { font-size: 48px; font-weight: bold; color: #000000; }\\n.pricing-cards { display: flex; flex-direction: row; gap: 24px; }\\n.card { display: flex; flex-direction: column; gap: 16px; padding: 32px; background-color: #f9f9f9; border-radius: 12px; width: 280px; }\\nh2 { font-size: 32px; font-weight: bold; color: #333333; }\\n.price { font-size: 24px; color: #000000; font-weight: bold; }\\np { font-size: 16px; color: #666666; }",
    "componentMap": {
      "app-logo": { "componentKey": "9181c660...", "componentName": "App Logo" },
      "login-form": { "componentKey": "248d7d71...", "componentName": "Login Form" }
    }
  }
}
\`\`\`

### HTML Requirements:
- **CRITICAL**: Include actual text content for headings, paragraphs, labels, and buttons
- Use semantic HTML5 tags: <h1>, <h2>, <p>, <section>, <div>, <header>
- For text elements, write the actual text: <h1>Choose Your Plan</h1>, <p>$29/mo</p>
- For design system components, use empty divs with class names mapped in componentMap
- Use descriptive class names
- Keep structure simple

### CSS Requirements:
- **CRITICAL**: Use Flexbox for ALL layouts (display: flex, flex-direction, gap, padding)
- **Specify background-color for visual sections** (cards, panels, containers)
- Include text styles: font-size, font-weight, color for h1, h2, p, etc.
- Use border-radius for rounded corners
- Use px units for dimensions
- Avoid absolute positioning

### Component Mapping:
- Map ONLY design system components (from available components list)
- For custom UI (pricing cards, headers, text), create them in HTML/CSS directly
- Example: app-logo → Logo component, but pricing cards → HTML/CSS divs with text

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
            maxOutputTokens: 16384, // Increased from 8192 to handle larger JSON structures
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
