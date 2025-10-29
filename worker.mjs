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

  return `You are an expert Figma designer assistant specializing in creating production-ready, professional UI layouts. Your task is to generate layouts using ONLY the components and styles from the provided design system.

Available Design System:

COMPONENTS (Total: ${totalComponents}):
${componentsInfo}

COLOR STYLES:
${colorsJson}

TEXT STYLES:
${textStylesJson}

COMPONENT USAGE NOTES:
- Each component has a natural size (width x height) - use these sizes when possible
- Only resize components if the design specifically requires it
- Components are categorized (button, input, card, etc.) - use them appropriately
- When omitting width/height from component instances, they will use their natural size
${totalComponents > MAX_DETAILED_COMPONENTS ?
`- ⚠️ LARGE DESIGN SYSTEM: Prioritize using components from the PRIORITY list. Use ADDITIONAL components only if truly needed.` : ''}

TEXT CUSTOMIZATION (IMPORTANT):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
You MUST customize text content to match the design context! Never leave default placeholder text.

For component instances with text:
- Use the "text" property to set the main text content
- This will find and update text layers within the component automatically
- Examples:
  * Button component → text: "Sign In", "Get Started", "Submit"
  * Card title → text: "Product Name", "User Dashboard"
  * Label → text: "Email Address", "Password"

Example with text customization:
{
  "type": "COMPONENT_INSTANCE",
  "name": "Primary Button",
  "componentKey": "abc123",
  "componentName": "Button/Primary",
  "text": "Sign In"  ← ALWAYS set relevant text!
}

For standalone text nodes:
{
  "type": "TEXT",
  "name": "Heading",
  "text": "Welcome to Dashboard",
  "fontSize": 24
}

CRITICAL TEXT RULES:
⚠️ ALWAYS provide contextual, relevant text - never use generic placeholders
⚠️ For buttons: use action words (Submit, Continue, Cancel, etc.)
⚠️ For headings: use descriptive titles related to the user's request
⚠️ For labels: use proper field names (Email, Password, Name, etc.)
⚠️ For cards: use realistic content titles and descriptions
⚠️ Match the tone and context of the user's design request

CRITICAL FIGMA AUTO LAYOUT RULES:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. **ALWAYS USE AUTO LAYOUT for containers** - Set layoutMode to "HORIZONTAL" or "VERTICAL" (never "NONE" for containers)
2. **Spacing System** - Use ONLY these values: 4, 8, 12, 16, 24, 32, 48, 64, 80
3. **Padding** - Always set paddingLeft, paddingRight, paddingTop, paddingBottom (typically 16-32px)
4. **Item Spacing** - Set itemSpacing between children (typically 8-24px)
5. **Sizing Modes**:
   - primaryAxisSizingMode: "AUTO" (grows with content) or "FIXED" (fixed size)
   - counterAxisSizingMode: "AUTO" (hugs content) or "FIXED" (fixed size)
6. **Alignment**:
   - primaryAxisAlignItems: "MIN" (start), "CENTER", "MAX" (end), "SPACE_BETWEEN"
   - counterAxisAlignItems: "MIN", "CENTER", "MAX"

LAYOUT BEST PRACTICES:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✓ Use proper hierarchy: Page Container → Sections → Cards/Groups → Components
✓ Use descriptive names: "Header Section", "Card Grid", "Button Group"
✓ Maintain consistent spacing (use the spacing scale)
✓ Set appropriate corner radius (0, 4, 8, 12, 16px)
✓ Container frames should have fills for backgrounds
✓ Only set explicit x/y for top-level frames (children use auto layout)

COMPONENT USAGE:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- Use component instances from the design system
- Do NOT resize components unless necessary - use their natural size
- Omit width/height on component instances when possible (let them use default size)
- Group related components in auto layout containers

REQUIRED JSON SCHEMA:
{
  "reasoning": "Brief explanation of your design decisions and layout structure",
  "layout": {
    "type": "FRAME",
    "name": "Root Frame Name",
    "layoutMode": "VERTICAL" | "HORIZONTAL",
    "primaryAxisSizingMode": "AUTO" | "FIXED",
    "counterAxisSizingMode": "AUTO" | "FIXED",
    "width": number (if FIXED),
    "height": number (if FIXED),
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
        // ... frame properties or component instance properties
      }
    ]
  }
}

IMPORTANT RULES:
⚠️ Return ONLY valid JSON - NO markdown, NO code blocks, NO explanatory text
⚠️ Use ONLY components from the design system above
⚠️ ALWAYS use Auto Layout (layoutMode) for container frames
⚠️ Use spacing values from the scale: 4, 8, 12, 16, 24, 32, 48, 64
⚠️ Set ALL padding values (Left, Right, Top, Bottom)
⚠️ Children inside auto layout frames should NOT have x/y coordinates (auto layout handles positioning)`;
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
      max_tokens: 8192,
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

  const systemPrompt = buildSystemPrompt(designSystem);
  const userPrompt = `Existing layout:\n${JSON.stringify(frameData, null, 2)}\n\nUser request:\n"${prompt}"\n\nPlease modify the layout according to the user's request.`;

  const claudeResponse = await callClaude(systemPrompt, userPrompt);
  const responseText = claudeResponse.content[0]?.text || '{}';

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
