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
async function getQueuedJobs(limit = 5) {
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
 * Insert a reasoning chunk into the database for live streaming
 */
async function insertReasoningChunk(jobId, chunkText, chunkIndex) {
  const { error } = await supabase
    .from('reasoning_chunks')
    .insert({
      job_id: jobId,
      chunk_text: chunkText,
      chunk_index: chunkIndex,
    });

  if (error) {
    console.error('Error inserting reasoning chunk:', error);
    // Don't throw - we don't want to fail the whole job if chunk insertion fails
  } else {
    console.log(`📝 Inserted reasoning chunk ${chunkIndex} for job ${jobId}`);
  }
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
 * Call Claude with vision in STREAMING mode (for live reasoning)
 * Processes tokens in real-time and calls onToken callback with each chunk
 */
async function callClaudeWithVisionStreaming(systemPrompt, userPrompt, imageDataBase64, onToken) {
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
      stream: true, // ← Enable streaming
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

  // Process Server-Sent Events (SSE) stream
  const reader = response.body;
  let fullText = '';
  let buffer = '';

  // Helper to parse SSE events
  const processLine = (line) => {
    if (line.startsWith('data: ')) {
      const data = line.slice(6);

      if (data === '[DONE]') {
        return null; // Stream complete
      }

      try {
        const parsed = JSON.parse(data);

        // Claude SSE event types:
        // - message_start: metadata about the message
        // - content_block_start: start of a content block
        // - content_block_delta: incremental content (this is what we want!)
        // - content_block_stop: end of content block
        // - message_delta: metadata updates
        // - message_stop: stream complete

        if (parsed.type === 'content_block_delta') {
          const delta = parsed.delta;
          if (delta.type === 'text_delta' && delta.text) {
            return delta.text;
          }
        }
      } catch (e) {
        // Ignore parse errors
      }
    }
    return null;
  };

  // Read the stream
  for await (const chunk of reader) {
    const text = new TextDecoder().decode(chunk);
    buffer += text;

    // Process complete lines
    const lines = buffer.split('\n');
    buffer = lines.pop() || ''; // Keep incomplete line in buffer

    for (const line of lines) {
      const token = processLine(line.trim());
      if (token) {
        fullText += token;
        // Call the callback with the new token and accumulated text
        if (onToken) {
          await onToken(token, fullText);
        }
      }
    }
  }

  return {
    content: [{ type: 'text', text: fullText }],
    stop_reason: 'stop',
  };
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
 * Call Gemini with vision in STREAMING mode (for live reasoning)
 * Processes tokens in real-time and calls onToken callback with each chunk
 */
async function callGeminiWithVisionStreaming(systemPrompt, userPrompt, imageDataBase64, onToken) {
  const geminiApiKey = process.env.GEMINI_API_KEY;

  if (!geminiApiKey) {
    throw new Error('GEMINI_API_KEY not configured');
  }

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-preview:streamGenerateContent?alt=sse`,
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
              // Image FIRST - allows Gemini to start processing visual context immediately
              {
                inlineData: {
                  mimeType: 'image/png',
                  data: imageDataBase64,
                },
              },
              // Instructions SECOND - Gemini can reference the image while reading instructions
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

  // Process Server-Sent Events (SSE) stream
  const reader = response.body;
  let fullText = '';
  let buffer = '';

  // Helper to parse SSE events
  const processLine = (line) => {
    if (line.startsWith('data: ')) {
      const data = line.slice(6);

      try {
        const parsed = JSON.parse(data);

        // Gemini streaming response structure:
        // candidates[0].content.parts[0].text
        const text = parsed.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) {
          return text;
        }
      } catch (e) {
        // Ignore parse errors
      }
    }
    return null;
  };

  // Read the stream
  for await (const chunk of reader) {
    const text = new TextDecoder().decode(chunk);
    buffer += text;

    // Process complete lines
    const lines = buffer.split('\n');
    buffer = lines.pop() || ''; // Keep incomplete line in buffer

    for (const line of lines) {
      const token = processLine(line.trim());
      if (token) {
        fullText += token;
        // Call the callback with the new token and accumulated text
        if (onToken) {
          await onToken(token, fullText);
        }
      }
    }
  }

  return {
    content: [{ type: 'text', text: fullText }],
    stop_reason: 'stop',
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

**Button Text Centering (CRITICAL - STRICTLY ENFORCED):**
• Button text MUST be perfectly centered BOTH horizontally AND vertically
• Horizontal centering formula: textX = buttonX + (buttonWidth / 2)
• Vertical centering formula: textY = buttonY + (buttonHeight / 2) + (fontSize × 0.35)
• Example: 160px wide, 40px tall button at (40, 240) with 14px text:
  - textX = 40 + (160 / 2) = 120
  - textY = 240 + (40 / 2) + (14 × 0.35) = 240 + 20 + 5 = 265
• ALWAYS set text-anchor="middle" for horizontal centering
• NEVER use text-anchor="start" or left-aligned text in buttons
• NEVER offset text to the left or right - it must be precisely centered
• Test your math: if buttonX=40, buttonWidth=160, then textX MUST BE 120 (not 60, not 80)

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
❌ NEVER use: text-anchor="start" in buttons (causes left-aligned text)
❌ NEVER use: button text x-coordinate that doesn't equal buttonX + (buttonWidth / 2)
❌ NEVER offset button text to one side - it MUST be mathematically centered

✅ CORRECT PATTERNS (GRID-ALIGNED, FIGMA-READY)

✅ Container with centered text:
<rect x="40" y="120" width="320" height="80" rx="8" fill="#ffffff"/>
<text x="60" y="152" font-size="16" font-weight="600">Title</text>
<text x="60" y="176" font-size="14" fill="#666666">Subtitle</text>

✅ Button with PERFECTLY centered text (FOLLOW THIS PATTERN EXACTLY):
<rect x="40" y="240" width="160" height="40" rx="8" fill="#0066cc"/>
<text x="120" y="265" font-size="14" font-weight="600" fill="#ffffff" text-anchor="middle">Click Here</text>
<!-- Math check: textX = buttonX + (buttonWidth / 2) = 40 + 80 = 120 ✓ -->
<!-- Math check: textY = buttonY + 20 + 5 = 240 + 25 = 265 ✓ -->

✅ Another button example (wider button):
<rect x="200" y="120" width="240" height="48" rx="8" fill="#16a34a"/>
<text x="320" y="150" font-size="16" font-weight="600" fill="#ffffff" text-anchor="middle">Submit Form</text>
<!-- Math check: textX = 200 + (240 / 2) = 200 + 120 = 320 ✓ -->
<!-- Math check: textY = 120 + (48 / 2) + (16 × 0.35) = 120 + 24 + 6 = 150 ✓ -->

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

CRITICAL RULES FOR TEXT ALIGNMENT (MOST COMMON ERROR - READ CAREFULLY):
• ALWAYS include text labels for every UI element
• Add text to ALL buttons, headers, cards, navigation items, forms
• Use meaningful, realistic text (e.g., "Dashboard", "Revenue: $45k", "Submit", "Profile")
• NO lorem ipsum or placeholder text
• Match font family from design system typography (SF Pro Text, Inter, etc.)
• Use appropriate font sizes: headings (18-32px), body (14-16px), labels (12-14px)
• Use appropriate font weights: headings (600-700), body (400-500)
• ALWAYS set font-style="normal" on ALL <text> elements (never use italic unless explicitly requested)

**TEXT CENTERING IN BUTTONS (VERIFY YOUR MATH BEFORE OUTPUTTING):**
1. For horizontal centering:
   - ALWAYS set text-anchor="middle"
   - textX = buttonX + (buttonWidth / 2)
   - Example: button at x="40" width="160" → textX MUST BE "120"
   - Example: button at x="200" width="240" → textX MUST BE "320"

2. For vertical centering:
   - textY = buttonY + (buttonHeight / 2) + (fontSize × 0.35)
   - Example: button at y="240" height="40", fontSize="14" → textY = 240 + 20 + 5 = "265"
   - Example: button at y="120" height="48", fontSize="16" → textY = 120 + 24 + 6 = "150"

3. COMMON MISTAKES TO AVOID:
   - ❌ Using text-anchor="start" (causes left-aligned text)
   - ❌ Using textX = buttonX + padding (text appears left-aligned)
   - ❌ Forgetting to add half the width (textX = buttonX is WRONG)
   - ❌ Not using text-anchor="middle" attribute

4. SELF-CHECK BEFORE OUTPUTTING:
   - Does textX = buttonX + (buttonWidth / 2)? If not, fix it.
   - Is text-anchor="middle" present? If not, add it.
   - Is the text visually centered when you imagine the coordinates? If not, recalculate.

🚫 FIGMA SVG LIMITATIONS (CRITICAL):

Figma's SVG importer does NOT support:
• ❌ <style> tags - NEVER USE <style> AT ALL (not even for @font-face or CSS)
• ❌ SVG filters (<filter>, <feDropShadow>, <feGaussianBlur>) - Use simple shadows with opacity
• ❌ <foreignObject> or embedded HTML - Use native SVG elements only
• ❌ <image> tags - NEVER USE <image> AT ALL (not even with empty href="")
• ❌ External references (xlink:href to external files)
• ❌ <script> tags or JavaScript

INSTEAD, use Figma-compatible alternatives:
• ✅ Inline styles: <text font-family="Inter" font-size="16" fill="#000">
• ✅ Font families: Use SINGLE font names only - NO commas or fallbacks
  - ✅ CORRECT: font-family="Inter"
  - ❌ WRONG: font-family="Inter, sans-serif" (comma-separated fallbacks not supported)
  - ✅ CORRECT: font-family="Menlo"
  - ❌ WRONG: font-family="Menlo, monospace"
• ✅ Simple shadows: Overlapping shapes with reduced opacity
• ✅ Native SVG shapes: <rect>, <circle>, <path>, <text>, <g>
• ✅ Solid fills and strokes: fill="#0066cc" stroke="#dddddd"
• ✅ For avatars/profile pictures: Use <circle fill="#D0D5DD"> with initials in <text>
• ✅ For placeholder images: Use <rect fill="#F2F4F7"> with an icon in <path>
• ✅ Gradients ARE supported - but you MUST define them in <defs> before using them!

CORRECT GRADIENT USAGE:
<defs>
  <linearGradient id="gradient1" x1="0%" y1="0%" x2="100%" y2="100%">
    <stop offset="0%" stop-color="#7F56D9"/>
    <stop offset="100%" stop-color="#6941C6"/>
  </linearGradient>
  <linearGradient id="gradient2" x1="0%" y1="0%" x2="0%" y2="100%">
    <stop offset="0%" stop-color="#F9FAFB"/>
    <stop offset="100%" stop-color="#FFFFFF"/>
  </linearGradient>
</defs>

<!-- THEN use them: -->
<rect fill="url(#gradient1)" x="0" y="0" width="200" height="100"/>
<circle fill="url(#gradient2)" cx="50" cy="50" r="40"/>

IMPORTANT: Every gradient MUST be defined in <defs> BEFORE you reference it with url(#...)
NEVER reference url(#paint0_linear) or url(#someGradient) without defining it first!

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
  const changes = [];

  // Remove ALL <style> tags (Figma doesn't support CSS in SVG)
  // This includes @import, @font-face, and any other CSS rules
  if (svg.includes('<style')) {
    sanitized = sanitized.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
    changes.push('Removed <style> tags (use inline attributes instead)');
  }

  // Remove entire <defs> containing complex filters (feDropShadow, feGaussianBlur, etc.)
  // Keep simple defs (gradients, clipPath) but remove filter defs
  if (svg.includes('<filter')) {
    sanitized = sanitized.replace(/<defs>[\s\S]*?<filter[\s\S]*?<\/filter>[\s\S]*?<\/defs>/gi, function(match) {
      // If the <defs> ONLY contains filters, remove it entirely
      const hasNonFilterContent = /<(?!filter|\/filter|\/defs)/.test(match);
      return hasNonFilterContent ? match.replace(/<filter[\s\S]*?<\/filter>/gi, '') : '';
    });

    // Remove standalone <filter> tags (outside defs)
    sanitized = sanitized.replace(/<filter[\s\S]*?<\/filter>/gi, '');
    changes.push('Removed SVG filters');
  }

  // Remove filter attribute references (filter="url(#shadow-sm)")
  if (svg.includes('filter="')) {
    sanitized = sanitized.replace(/\s+filter="[^"]*"/gi, '');
    changes.push('Removed filter attributes');
  }

  // Remove foreignObject (Figma doesn't support)
  if (svg.includes('foreignObject')) {
    sanitized = sanitized.replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, '');
    changes.push('Removed foreignObject');
  }

  // Remove ALL <image> tags (Figma doesn't support <image> elements at all)
  // This includes data URIs, empty hrefs, external URLs, etc.
  if (svg.includes('<image')) {
    sanitized = sanitized.replace(/<image[^>]*\/?>/gi, '');
    changes.push('Removed <image> tags (use <circle> or <rect> instead)');
  }

  // Fix font-family with comma-separated fallbacks (Figma has issues with these)
  // Convert "Inter, sans-serif" to just "Inter"
  // Convert "Menlo, monospace" to just "Menlo"
  if (svg.includes('font-family="') && svg.includes(',')) {
    sanitized = sanitized.replace(/font-family="([^",]+),[^"]*"/gi, 'font-family="$1"');
    changes.push('Simplified font-family (removed fallbacks)');
  }

  // Fix invalid stroke attributes (stroke-right, stroke-left, etc.)
  if (/stroke-(right|left|top|bottom)=/.test(svg)) {
    sanitized = sanitized.replace(/\s+stroke-(right|left|top|bottom)="[^"]*"/gi, '');
    changes.push('Removed invalid stroke-* attributes');
  }

  // Remove invalid CSS-like attributes in SVG
  sanitized = sanitized.replace(/\s+stroke-width-right="[^"]*"/gi, '');
  sanitized = sanitized.replace(/\s+border-[^=]*="[^"]*"/gi, '');

  // Remove url() references to undefined gradients/patterns
  // Extract all defined IDs from <defs>
  const defsMatch = sanitized.match(/<defs>[\s\S]*?<\/defs>/);
  const definedIds = new Set();

  if (defsMatch) {
    const defsContent = defsMatch[0];
    // Extract all id="..." from gradient/pattern definitions
    const idMatches = defsContent.matchAll(/id="([^"]+)"/g);
    for (const match of idMatches) {
      definedIds.add(match[1]);
    }
  }

  // Find all url(#...) references
  const urlMatches = sanitized.matchAll(/(?:fill|stroke)="url\(#([^)]+)\)"/g);
  const undefinedRefs = [];

  for (const match of urlMatches) {
    const refId = match[1];
    if (!definedIds.has(refId)) {
      undefinedRefs.push(refId);
    }
  }

  // Remove only undefined url() references
  if (undefinedRefs.length > 0) {
    undefinedRefs.forEach(refId => {
      const regex = new RegExp(`\\s*(?:fill|stroke)="url\\(#${refId}\\)"`, 'gi');
      sanitized = sanitized.replace(regex, '');
    });
    changes.push(`Removed ${undefinedRefs.length} undefined gradient references`);
  }

  // Remove empty <defs> tags
  if (sanitized.includes('<defs>') && sanitized.includes('</defs>')) {
    sanitized = sanitized.replace(/<defs>\s*<\/defs>/gi, '');
  }

  // Log if sanitization made changes
  if (changes.length > 0) {
    console.log('⚠️ SVG sanitized - removed Figma-unsupported features:');
    changes.forEach(change => console.log(`  - ${change}`));
  }

  return sanitized;
}

// ============================================================================
// Editable Layout System Functions (Milestone A)
// ============================================================================

/**
 * Extract Figma JSON from AI response
 * Handles ```json blocks or raw JSON objects
 */
function extractFigmaJSON(responseText) {
  let text = responseText.trim();

  console.log('Raw JSON response (first 300 chars):', text.substring(0, 300));

  // 1. Prefer ```json ... ``` block
  const jsonBlockMatch = text.match(/```json\s*\n([\s\S]*?)\n```/);
  if (jsonBlockMatch) {
    console.log('Found JSON block');
    return JSON.parse(jsonBlockMatch[1]);
  }

  // 2. Fallback: First { ... } object
  const objectMatch = text.match(/\{[\s\S]*\}/);
  if (objectMatch) {
    console.log('Found JSON object');
    return JSON.parse(objectMatch[0]);
  }

  throw new Error('No JSON object found in response');
}

/**
 * Validate Figma structure against schema
 * Returns { valid, type, errors/warnings }
 */
function validateFigmaStructure(json, designSystem) {
  const errors = [];

  // Schema validation (triggers retry)
  if (!json.version) {
    return {
      valid: false,
      type: 'SCHEMA_ERROR',
      message: 'Missing required field: version'
    };
  }

  if (!json.figmaStructure) {
    return {
      valid: false,
      type: 'SCHEMA_ERROR',
      message: 'Missing required field: figmaStructure'
    };
  }

  if (json.version !== '1.0') {
    return {
      valid: false,
      type: 'SCHEMA_ERROR',
      message: `Unsupported version: ${json.version}. Expected: 1.0`
    };
  }

  // Recursively validate node structure
  function validateNode(node, path = 'figmaStructure') {
    if (!node.type) {
      errors.push({ path, message: 'Missing required field: type' });
      return;
    }

    if (!node.name) {
      errors.push({ path, message: 'Missing required field: name' });
    }

    // Type-specific validation
    switch (node.type) {
      case 'COMPONENT':
        // COMPONENT must have componentName
        if (!node.componentName) {
          errors.push({ path, message: 'COMPONENT node missing required field: componentName' });
        }
        // COMPONENT cannot have children
        if (node.children && node.children.length > 0) {
          errors.push({ path, message: 'COMPONENT nodes cannot have children' });
        }
        // COMPONENT cannot have layout properties
        if (node.layoutMode || node.itemSpacing || node.padding) {
          errors.push({ path, message: 'COMPONENT nodes cannot have layoutMode, itemSpacing, or padding' });
        }
        break;

      case 'TEXT':
        // TEXT must have text content
        if (!node.text && node.text !== '') {
          errors.push({ path, message: 'TEXT node missing required field: text' });
        }
        // TEXT cannot have children
        if (node.children && node.children.length > 0) {
          errors.push({ path, message: 'TEXT nodes cannot have children' });
        }
        // TEXT cannot have component properties
        if (node.componentName || node.componentVariant) {
          errors.push({ path, message: 'TEXT nodes cannot have componentName or componentVariant' });
        }
        break;

      case 'FRAME':
        // FRAME can have children - validate recursively
        if (node.children && Array.isArray(node.children)) {
          node.children.forEach((child, i) => {
            validateNode(child, `${path}.children[${i}]`);
          });
        }
        // FRAME cannot have TEXT-specific properties
        if (node.text || node.textStyleName) {
          errors.push({ path, message: 'FRAME nodes cannot have text or textStyleName' });
        }
        // FRAME cannot have COMPONENT-specific properties
        if (node.componentName || node.componentVariant) {
          errors.push({ path, message: 'FRAME nodes cannot have componentName or componentVariant' });
        }
        break;

      default:
        errors.push({ path, message: `Unknown node type: ${node.type}` });
    }

    // Validate padding structure if present
    if (node.padding) {
      if (typeof node.padding !== 'object' || Array.isArray(node.padding)) {
        errors.push({ path, message: 'padding must be an object with {top, right, bottom, left}' });
      } else if (
        typeof node.padding.top !== 'number' ||
        typeof node.padding.right !== 'number' ||
        typeof node.padding.bottom !== 'number' ||
        typeof node.padding.left !== 'number'
      ) {
        errors.push({ path, message: 'padding must have numeric top, right, bottom, left properties' });
      }
    }
  }

  validateNode(json.figmaStructure);

  if (errors.length > 0) {
    return {
      valid: false,
      type: 'SCHEMA_ERROR',
      errors
    };
  }

  // Success - return warnings if any
  return {
    valid: true,
    warnings: json.warnings || []
  };
}

/**
 * Build retry prompt for schema/parse errors
 * Surgical prompt, doesn't re-paste full system prompt
 */
function buildRetryPrompt(originalPrompt, error, invalidJSON) {
  const errorDetails = error.errors
    ? error.errors.map(e => `- ${e.path}: ${e.message}`).join('\n')
    : error.message;

  return `RETRY: Invalid JSON response

ERROR:
${errorDetails}

YOUR INVALID OUTPUT:
${invalidJSON.substring(0, 500)}${invalidJSON.length > 500 ? '...' : ''}

REQUIREMENTS:
- Return single JSON object only
- Wrap in \`\`\`json code block
- Must have: version, reasoning, figmaStructure
- COMPONENT nodes: must have componentName, cannot have children
- TEXT nodes: must have text, cannot have children or componentName
- FRAME nodes: can have children, cannot have text or componentName
- padding must be object: {top, right, bottom, left}

${originalPrompt}`;
}

/**
 * Build system prompt for layout generation using HTML/CSS mental model
 */
function buildLayoutSystemPrompt(designSystem) {
  // Get ALL component names (no truncation - user files have ~1900 components)
  const componentList = designSystem.components
    .map(c => `- "${c.name}"`)
    .join('\n');

  console.log(`📋 Sending ${designSystem.components.length} components to AI prompt`);

  // Get text style list
  const textStyleList = designSystem.textStyles
    .slice(0, 50)
    .map(ts => `- ${ts.name}`)
    .join('\n');

  return `You are a UI designer generating Figma Auto Layout structures.

MENTAL MODEL: Think in HTML/CSS

When designing, think using familiar HTML/CSS concepts:
- <div style="display: flex; flex-direction: column"> → layoutMode: "VERTICAL"
- <div style="display: flex; flex-direction: row"> → layoutMode: "HORIZONTAL"
- gap: 16px → itemSpacing: 16
- padding: 24px → padding: {top: 24, right: 24, bottom: 24, left: 24}
- justify-content: space-between → primaryAxisAlignItems: "SPACE_BETWEEN"
- justify-content: center → primaryAxisAlignItems: "CENTER"
- align-items: center → counterAxisAlignItems: "CENTER"

Think in HTML/CSS internally but DO NOT output HTML in your response.

OUTPUT FORMAT: Figma JSON only

WORKED EXAMPLE:

Input:
{
  "structural_hints": {
    "frameName": "Dashboard",
    "usesAutoLayout": true,
    "layoutMode": "VERTICAL",
    "itemSpacing": 24,
    "padding": { "top": 32, "right": 32, "bottom": 32, "left": 32 },
    "children": [
      { "type": "TEXT", "name": "Dashboard Title", "text": "Dashboard" },
      { "type": "INSTANCE", "componentName": "Button/Primary", "name": "Settings" }
    ],
    "usedComponents": ["Button/Primary"],
    "usedTextStyles": ["Heading/L"]
  },
  "user_request": "Make this more minimal"
}

Output (ONLY this JSON format, no HTML):
\`\`\`json
{
  "version": "1.0",
  "reasoning": "Reduced spacing from 24px to 12px and padding from 32px to 16px for a more compact, minimal appearance. Changed button to Secondary variant for subtle styling.",
  "figmaStructure": {
    "type": "FRAME",
    "name": "Dashboard",
    "layoutMode": "VERTICAL",
    "itemSpacing": 12,
    "padding": { "top": 16, "right": 16, "bottom": 16, "left": 16 },
    "children": [
      {
        "type": "TEXT",
        "name": "Title",
        "text": "Dashboard",
        "textStyleName": "Heading/L"
      },
      {
        "type": "COMPONENT",
        "componentName": "Button/Secondary"
      }
    ]
  }
}
\`\`\`

FIELD USAGE RULES (STRICT):

FRAME nodes can have:
- type: "FRAME" (required)
- name: string (required)
- layoutMode: "VERTICAL" | "HORIZONTAL" | "NONE" (optional)
- itemSpacing: number (optional)
- padding: {top, right, bottom, left} - ALWAYS object form (optional)
- primaryAxisAlignItems: "MIN" | "CENTER" | "MAX" | "SPACE_BETWEEN" (optional)
- counterAxisAlignItems: "MIN" | "CENTER" | "MAX" (optional)
- children: array of nodes (optional)
- role: semantic hint like "header", "section" (optional)
- fillStyleName: exact design system color name (optional)

FRAME nodes CANNOT have: componentName, componentVariant, text, textStyleName

COMPONENT nodes can have:
- type: "COMPONENT" (required)
- name: string (required)
- componentName: string (required - exact name from available components)
- componentVariant: {property: "value"} (optional)
- text: string (optional - for overriding text inside component)

COMPONENT nodes CANNOT have: children, layoutMode, itemSpacing, padding

TEXT nodes can have:
- type: "TEXT" (required)
- name: string (required)
- text: string (required)
- textStyleName: exact design system text style name (optional)

TEXT nodes CANNOT have: children, componentName, layoutMode, padding

OPTIONAL vs REQUIRED:

REQUIRED fields:
- type (always)
- name (always)
- componentName (for COMPONENT nodes)
- text (for TEXT nodes)

OPTIONAL fields (only use if you know exact design system name):
- fillStyleName
- textStyleName

NEVER invent arbitrary token names. If you're unsure about a style name, omit the field.

AVAILABLE COMPONENTS (${designSystem.components.length} total - from "Created in this file"):
${componentList || '(No components available)'}

AVAILABLE TEXT STYLES:
${textStyleList || '(No text styles available)'}

CRITICAL RULES FOR COMPONENT USAGE:

1. You MUST use EXACT componentName strings from AVAILABLE COMPONENTS above.
2. Do NOT invent or guess component names like "Button/Primary" or "Input/Search".
3. If you need a button, find the closest EXACT match from the list above.
4. If uncertain, choose the closest match from AVAILABLE COMPONENTS - DO NOT make up names.
5. Component names are case-sensitive and must match EXACTLY including spacing and slashes.

WORKED EXAMPLES:
❌ WRONG: componentName: "Button/Primary"
✅ CORRECT: componentName: "Buttons / Primary / Large"

❌ WRONG: componentName: "Input/Search"
✅ CORRECT: componentName: "Inputs / Text / Default"

❌ WRONG: componentName: "Card"
✅ CORRECT: componentName: "Cards / Basic / Default"

Remember: Think in HTML/CSS Flexbox concepts, but output Figma JSON structure with EXACT component names.`;
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
 * Process an iterate job - SVG MODE with image context
 * Uses PNG screenshot + design system to generate pure SVG
 */
async function processIterateJob(job) {
  const { prompt, imageData, designSystem, model, chatHistory } = job.input;

  const selectedModel = model || 'claude';
  console.log(`🎨 SVG Mode (Iteration): Using ${selectedModel === 'gemini' ? 'Gemini 3 Pro' : 'Claude 4.5'} with image context for SVG generation`);

  const systemPrompt = buildSVGSystemPrompt(designSystem);

  // Build user prompt with chat history context
  let contextSection = '';
  if (chatHistory && chatHistory.trim()) {
    contextSection = `\n${chatHistory}\n\nNow, using this context from previous iterations, `;
  }

  const userPrompt = `You are looking at an existing design (see the image).${contextSection}

User wants: "${prompt}"

CRITICAL: Your response must be ONLY the SVG code. No explanations, no markdown, no text before or after the SVG.

ITERATION RULES:
1. Analyze the existing design in the image
2. Make the changes the user requested while maintaining visual consistency
3. Use the design system's visual language (colors, typography, shadows, etc.)
4. Include realistic text labels on ALL elements
5. Start your response immediately with <svg and end with </svg>

Generate a complete SVG mockup now:`;

  // Try up to 2 times to get valid SVG
  let svg = null;
  let responseText = '';

  for (let attempt = 1; attempt <= 2; attempt++) {
    console.log(`🔄 Attempt ${attempt} to generate SVG...`);

    // Call the selected AI model with vision
    const aiResponse = selectedModel === 'gemini'
      ? await callGeminiWithVision(systemPrompt, userPrompt, imageData)
      : await callClaudeWithVision(systemPrompt, userPrompt, imageData);

    responseText = aiResponse.content[0]?.text || '';

    // Log response for debugging
    console.log(`📝 AI response length: ${responseText.length} characters`);
    console.log(`📝 Response preview (first 500 chars): ${responseText.substring(0, 500)}`);

    // Extract SVG from response
    svg = extractSVG(responseText);

    if (svg && svg.includes('<svg')) {
      console.log(`✅ Valid SVG extracted on attempt ${attempt}`);
      break;
    } else {
      console.warn(`⚠️  Attempt ${attempt} failed to extract valid SVG`);
      if (attempt === 2) {
        console.error('❌ Failed to extract SVG after 2 attempts. Last response:', responseText.substring(0, 2000));
        throw new Error('Failed to extract valid SVG from AI response after 2 attempts');
      }
    }
  }

  // Sanitize SVG to remove Figma-unsupported features
  svg = sanitizeSVG(svg);

  console.log('✅ SVG generated successfully for iteration');

  return {
    svg,
    reasoning: `SVG mockup iterated with ${selectedModel === 'gemini' ? 'Gemini 3 Pro' : 'Claude 4.5'}`
  };
}

/**
 * Process a single job (helper function for parallel processing)
 */
async function processSingleJob(job) {
  try {
    console.log(`\n📦 Processing job: ${job.id} (${job.mode})`);

    // Check if job was cancelled before starting
    const { data: currentJob } = await supabase
      .from('jobs')
      .select('status')
      .eq('id', job.id)
      .single();

    if (currentJob?.status === 'cancelled') {
      console.log(`⏹️  Job ${job.id} was cancelled, skipping...`);
      return;
    }

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

    // Check again if job was cancelled during processing
    const { data: finalCheck } = await supabase
      .from('jobs')
      .select('status')
      .eq('id', job.id)
      .single();

    if (finalCheck?.status === 'cancelled') {
      console.log(`⏹️  Job ${job.id} was cancelled during processing, discarding results...`);
      return;
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
  console.log('⚡ Parallel processing enabled (max 5 concurrent jobs)');
  console.log('Listening for jobs in Supabase queue...\n');

  const MAX_CONCURRENT_JOBS = 5;

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
