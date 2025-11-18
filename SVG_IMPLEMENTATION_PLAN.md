# SVG Implementation Plan

## Overview

Switch from Figma JSON generation to SVG generation for faster ideation while maintaining design system integration.

**Key Decision**: Use Claude 4.5 only (disable Together AI fine-tuned model until retrained on SVG examples)

---

## Goals

1. ✅ **Faster generation**: SVG is simpler for AI to output (~5-15s vs ~20-40s)
2. ✅ **Lower error rate**: SVG is more forgiving than Figma JSON
3. ✅ **Design system integration**: Use scanned components to inform SVG styling
4. ✅ **Keep workflow**: Same plugin UI, same queue system, same variation rendering
5. ✅ **Prepare for fine-tuning**: Once working, export SVG examples to retrain Together AI model

---

## Architecture Changes

### Current Flow:
```
User Prompt
  → Together AI (rough Figma JSON)
  → Claude (refined Figma JSON)
  → Plugin expands to full Figma
  → Create Figma nodes
```

### New Flow:
```
User Prompt
  → Claude 4.5 ONLY (generate SVG with design system styling)
  → Plugin imports SVG to Figma
  → SVG rendered as vector shapes
```

---

## Phase 1: Design System Scanning Enhancement

### Current Behavior:
- Scans components (name, key, width, height, category)
- Scans color styles (name, hex)
- Scans text styles (name, font, size, weight)

### New Behavior (Enhanced for SVG):

Extract **visual properties** from components to guide SVG generation:

```typescript
interface EnhancedComponentData {
  id: string;
  name: string;
  category: string;

  // Visual properties for SVG styling
  dominantColors: string[];      // Extract 2-3 main colors from component
  borderRadius?: number;         // Extract corner radius if present
  hasShadow: boolean;           // Detect if component has drop shadow
  shadowStyle?: string;         // CSS box-shadow equivalent
  hasStroke: boolean;           // Detect if component has border
  strokeColor?: string;         // Border color
  strokeWidth?: number;         // Border width
  typography?: {                // Extract text styling
    fontSize: number;
    fontWeight: string;
    fontFamily: string;
    color: string;
  };
  spacing?: {                   // Extract internal padding
    padding: number;
    gap: number;
  };
}
```

**Implementation**:
- `scanComponentVisuals()` - Analyze component fills, effects, strokes
- `extractDominantColors()` - Find 2-3 most used colors in component
- `extractTypography()` - Get text properties from TEXT nodes in component
- `extractShadow()` - Convert Figma effects to CSS box-shadow
- `extractSpacing()` - Analyze Auto Layout padding/spacing

**Why**: Claude can use these properties to style SVG elements to match your design system visually.

---

## Phase 2: Claude Prompt Changes

### Current Prompt Structure:
```
SYSTEM: [Auto Layout rules, Figma JSON schema, component list]
USER: Generate a banking dashboard using design system
CLAUDE: {complex Figma JSON with 50+ properties per node}
```

### New Prompt Structure:
```
SYSTEM:
You are a UI design assistant that generates SVG mockups.

DESIGN SYSTEM VISUAL LANGUAGE:
- Primary colors: #0066cc, #ffffff, #f5f5f5
- Border radius: 8px (buttons), 12px (cards)
- Shadows: 0 2px 4px rgba(0,0,0,0.1) (subtle)
- Typography: Inter 14px/400 (body), Inter 18px/600 (headings)
- Button style: rounded, blue background, white text, 8px radius
- Card style: white background, 12px radius, subtle shadow
- Input style: gray border, white background, 8px radius

AVAILABLE COMPONENTS (visual characteristics):
- Button/Primary: Blue (#0066cc), white text, 8px radius, no shadow
- Card: White background, 12px radius, shadow (0 2px 4px rgba(0,0,0,0.1))
- Input: Gray border (#e5e7eb), white background, 8px radius
- Text/Heading: Inter 18px/600, dark gray (#1f2937)
- Text/Body: Inter 14px/400, medium gray (#6b7280)

OUTPUT FORMAT: Pure SVG (no markdown, no explanations)

<svg width="1920" height="1080" xmlns="http://www.w3.org/2000/svg">
  <!-- Use design system colors, radius, shadows, typography -->
  <rect x="0" y="0" width="1920" height="80" fill="#ffffff" />
  <text x="40" y="50" font-family="Inter" font-size="18" font-weight="600" fill="#1f2937">Dashboard</text>
  ...
</svg>

USER: Generate a banking dashboard
CLAUDE: <svg>...</svg>
```

**Key Changes**:
1. Remove all Figma JSON schema and Auto Layout rules
2. Add "DESIGN SYSTEM VISUAL LANGUAGE" section (extracted from scanned components)
3. Provide component visual characteristics (not component keys)
4. Request pure SVG output (no JSON wrapper)
5. Emphasize using design system colors, radius, shadows, fonts

---

## Phase 3: Worker Changes

### File: `worker.mjs`

#### Disable Together AI (temporarily)
```javascript
async function processGenerateJob(job) {
  // FORCE Claude-only mode (disable Together AI until retrained)
  const useTwoStage = false; // Was: check env vars

  console.log('🎨 Using Claude 4.5 for SVG generation');

  const systemPrompt = buildSVGSystemPrompt(designSystem); // NEW
  const userPrompt = `User Request: ${prompt}

Generate an SVG mockup that fulfills this request. Use the design system's
visual language (colors, radius, shadows, typography). Return ONLY the SVG
markup, no markdown or explanations.`;

  const claudeResponse = await callClaude(systemPrompt, userPrompt);
  const svgText = claudeResponse.content[0]?.text || '';

  // Extract SVG from response (remove markdown if present)
  const cleanSVG = extractSVG(svgText);

  return {
    svg: cleanSVG,
    reasoning: 'SVG mockup generated with Claude 4.5'
  };
}
```

#### New Functions:
```javascript
/**
 * Build system prompt for SVG generation
 */
function buildSVGSystemPrompt(designSystem) {
  const visualLanguage = extractVisualLanguage(designSystem);

  return `You are a UI design assistant that generates SVG mockups.

DESIGN SYSTEM VISUAL LANGUAGE:
${visualLanguage}

OUTPUT FORMAT: Pure SVG markup (no markdown, no explanations)

<svg width="1920" height="1080" xmlns="http://www.w3.org/2000/svg">
  <!-- Use design system colors, border-radius, shadows, typography -->
  ...
</svg>

RULES:
• Use exact colors from design system
• Match border-radius values (buttons: 8px, cards: 12px, etc.)
• Apply shadows using filter or CSS-like syntax in comments
• Use specified fonts (Inter) with correct sizes and weights
• Create clean, production-ready layouts
• Use semantic grouping with <g> tags
• Add comments for major sections
`;
}

/**
 * Extract visual language from design system
 */
function extractVisualLanguage(designSystem) {
  const colors = designSystem.colors.slice(0, 10).map(c => c.hex).join(', ');

  // Extract common visual properties from components
  const visualProps = analyzeComponentVisuals(designSystem.components);

  return `
PRIMARY COLORS: ${colors}

COMPONENT VISUAL CHARACTERISTICS:
${visualProps.map(v => `- ${v.category}: ${v.description}`).join('\n')}

TYPOGRAPHY:
${designSystem.textStyles.slice(0, 5).map(t =>
  `- ${t.name}: ${t.fontFamily} ${t.fontSize}px/${t.fontWeight}`
).join('\n')}
  `.trim();
}

/**
 * Extract SVG from Claude response (remove markdown)
 */
function extractSVG(responseText) {
  let text = responseText.trim();

  // Remove markdown code blocks
  text = text.replace(/```svg\n?/g, '').replace(/```\n?/g, '');

  // Find SVG tags
  const svgStart = text.indexOf('<svg');
  const svgEnd = text.lastIndexOf('</svg>') + 6;

  if (svgStart !== -1 && svgEnd > svgStart) {
    return text.substring(svgStart, svgEnd);
  }

  return text;
}
```

---

## Phase 4: Plugin Changes

### File: `src/code.ts`

#### Change Output Type:
```typescript
// OLD: Receives { layout: LayoutNode, reasoning: string }
// NEW: Receives { svg: string, reasoning: string }

interface GenerationResult {
  svg: string;        // SVG markup
  reasoning: string;
}
```

#### New SVG Import Function:
```typescript
/**
 * Import SVG to Figma as vector shapes
 */
async function importSVGToFigma(svgMarkup: string, position: { x: number; y: number }): Promise<FrameNode> {
  // Create a container frame
  const container = figma.createFrame();
  container.name = 'SVG Import';
  container.x = position.x;
  container.y = position.y;

  // Parse SVG and create Figma nodes
  // Option 1: Use figma.createNodeFromSvg() if available
  // Option 2: Manual parsing (parse SVG XML, create shapes)

  try {
    // Figma has a built-in SVG import API
    const svgNode = figma.createNodeFromSvg(svgMarkup);
    container.appendChild(svgNode);
    container.resize(svgNode.width, svgNode.height);
  } catch (error) {
    console.error('Error importing SVG:', error);
    // Fallback: create placeholder
    container.resize(1920, 1080);
    const errorText = figma.createText();
    errorText.characters = 'SVG Import Failed';
    container.appendChild(errorText);
  }

  return container;
}
```

#### Update handleGenerateSingleVariation:
```typescript
async function handleGenerateSingleVariation(payload: {
  variation: { svg: string; reasoning?: string };  // Changed from layout
  variationIndex: number;
  totalVariations: number;
}) {
  const { variation, variationIndex, totalVariations } = payload;
  const { svg, reasoning } = variation;

  // Import SVG to Figma
  const position = calculateVariationPosition(variationIndex, totalVariations);
  const svgNode = await importSVGToFigma(svg, position);

  // Update name
  svgNode.name = `SVG Mockup - Variation ${variationIndex + 1}`;

  // Add to page and select
  figma.currentPage.appendChild(svgNode);
  figma.currentPage.selection = [svgNode];
  figma.viewport.scrollAndZoomIntoView([svgNode]);

  // Notify UI
  figma.ui.postMessage({
    type: 'generation-complete',
    payload: { success: true, reasoning }
  });
}
```

---

## Phase 5: Component Visual Analysis

### File: `src/code.ts` (new functions)

```typescript
/**
 * Enhanced design system scanning with visual analysis
 */
async function handleGetDesignSystem() {
  // ... existing component scanning ...

  // NEW: Analyze visual properties
  const enhancedComponents = allComponents.map(component => {
    const node = figma.getNodeById(component.id);
    if (!node) return component;

    return {
      ...component,
      visuals: analyzeComponentVisuals(node as ComponentNode)
    };
  });

  const designSystem = {
    components: enhancedComponents,
    colors: colorStyles,
    textStyles: textStyles,
    visualLanguage: generateVisualLanguage(enhancedComponents, colorStyles, textStyles)
  };

  // Cache and send
  cachedDesignSystem = designSystem;
  figma.ui.postMessage({
    type: 'design-system-data',
    payload: designSystem
  });
}

/**
 * Analyze visual properties of a component
 */
function analyzeComponentVisuals(node: ComponentNode) {
  const fills = node.fills as Paint[];
  const effects = node.effects as Effect[];
  const strokes = node.strokes as Paint[];

  // Extract dominant colors
  const colors = extractDominantColors(node);

  // Extract shadow
  const shadow = effects.find(e => e.type === 'DROP_SHADOW');
  const shadowCSS = shadow ? convertFigmaShadowToCSS(shadow as DropShadowEffect) : null;

  // Extract border radius
  const radius = (node as any).cornerRadius || 0;

  // Extract stroke
  const hasStroke = strokes.length > 0 && strokes[0].visible;
  const strokeColor = hasStroke ? rgbToHex((strokes[0] as SolidPaint).color) : null;
  const strokeWidth = hasStroke ? node.strokeWeight : 0;

  // Extract typography from TEXT children
  const textNodes = node.findAll(n => n.type === 'TEXT') as TextNode[];
  const typography = textNodes.length > 0 ? {
    fontSize: textNodes[0].fontSize as number,
    fontWeight: textNodes[0].fontWeight as number,
    fontFamily: textNodes[0].fontName.family,
    color: rgbToHex((textNodes[0].fills as SolidPaint[])[0]?.color)
  } : null;

  return {
    colors,
    borderRadius: radius,
    shadow: shadowCSS,
    stroke: hasStroke ? { color: strokeColor, width: strokeWidth } : null,
    typography
  };
}

/**
 * Extract 2-3 dominant colors from a node tree
 */
function extractDominantColors(node: SceneNode, maxColors = 3): string[] {
  const colorMap = new Map<string, number>();

  function traverse(n: SceneNode) {
    if ('fills' in n && n.fills) {
      const fills = n.fills as Paint[];
      fills.forEach(fill => {
        if (fill.type === 'SOLID' && fill.visible) {
          const hex = rgbToHex(fill.color);
          colorMap.set(hex, (colorMap.get(hex) || 0) + 1);
        }
      });
    }

    if ('children' in n) {
      (n as ChildrenMixin).children.forEach(child => traverse(child));
    }
  }

  traverse(node);

  // Sort by frequency and take top N
  const sorted = Array.from(colorMap.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxColors)
    .map(([color]) => color);

  return sorted;
}

/**
 * Convert Figma shadow to CSS box-shadow
 */
function convertFigmaShadowToCSS(shadow: DropShadowEffect): string {
  const { offset, radius, color } = shadow;
  const rgba = `rgba(${Math.round(color.r * 255)}, ${Math.round(color.g * 255)}, ${Math.round(color.b * 255)}, ${color.a})`;
  return `${offset.x}px ${offset.y}px ${radius}px ${rgba}`;
}

/**
 * Convert RGB (0-1) to hex
 */
function rgbToHex(color: RGB): string {
  const r = Math.round(color.r * 255).toString(16).padStart(2, '0');
  const g = Math.round(color.g * 255).toString(16).padStart(2, '0');
  const b = Math.round(color.b * 255).toString(16).padStart(2, '0');
  return `#${r}${g}${b}`;
}
```

---

## Phase 6: Type Updates

### File: `src/types.ts`

```typescript
// Add SVG-related types
export interface ComponentVisuals {
  colors: string[];              // Dominant colors
  borderRadius?: number;
  shadow?: string;               // CSS box-shadow format
  stroke?: {
    color: string;
    width: number;
  };
  typography?: {
    fontSize: number;
    fontWeight: number;
    fontFamily: string;
    color: string;
  };
}

export interface EnhancedComponentData extends ComponentData {
  visuals?: ComponentVisuals;
}

export interface DesignSystemData {
  components: EnhancedComponentData[];  // Changed from ComponentData[]
  colors: ColorStyle[];
  textStyles: TextStyle[];
  visualLanguage?: string;  // NEW: Formatted visual language description
}

export interface GenerationResult {
  svg: string;              // Changed from layout: LayoutNode
  reasoning: string;
}
```

---

## Phase 7: Testing Strategy

### Test Cases:

1. **Basic SVG Generation**
   - Prompt: "Create a simple login form"
   - Expected: SVG with inputs, button, logo area
   - Verify: Colors match design system

2. **Design System Integration**
   - Scan design system with button components (blue, 8px radius)
   - Generate dashboard
   - Verify: SVG buttons use blue color, 8px border-radius

3. **Component Visual Matching**
   - Scan design system with cards (shadow, 12px radius)
   - Generate card layout
   - Verify: SVG cards have matching shadow and radius

4. **Variation Rendering**
   - Request 3 variations
   - Verify: All 3 SVGs import and render side-by-side
   - Verify: Parallel processing still works

5. **Error Handling**
   - Invalid SVG from Claude
   - Verify: Graceful fallback, error message shown

---

## Phase 8: Migration Path

### Step 1: Feature Flag (Optional)
Add toggle in UI to switch between JSON and SVG modes:
```typescript
const [outputMode, setOutputMode] = useState<'figma' | 'svg'>('svg');
```

### Step 2: Deploy SVG Mode
- Deploy all changes
- Test thoroughly
- Monitor Railway logs for SVG extraction issues

### Step 3: Collect SVG Examples
- Generate 50-100 high-quality SVG designs
- Export them for training data
- Create `dataset-svg/` folder with examples

### Step 4: Retrain Together AI Model
- Build new training dataset: `npm run build:dataset:svg`
- Upload to Together AI
- Fine-tune on SVG examples instead of Figma JSON

### Step 5: Re-enable Two-Stage Pipeline
- Once fine-tuned model is trained on SVG
- Re-enable `useTwoStage = true` with SVG format
- Together AI generates rough SVG → Claude refines

---

## Files to Create/Modify

### New Files:
- `SVG_IMPLEMENTATION_PLAN.md` ✅ (this file)
- `src/svgImporter.ts` - SVG parsing and Figma import logic
- `src/visualAnalyzer.ts` - Component visual analysis functions
- `dataset-svg/` - Future SVG training examples

### Modified Files:
- `worker.mjs` - Disable Together AI, add SVG prompts, extract SVG
- `src/code.ts` - SVG import, enhanced scanning, visual analysis
- `src/types.ts` - Add SVG types, component visuals
- `src/claudeService.ts` - Change return type to SVG
- `src/ui.tsx` - Handle SVG response (minor changes)

---

## Rollback Plan

If SVG approach doesn't work well:

1. **Quick rollback**: Revert git commits
2. **Selective rollback**: Keep visual analysis, revert SVG generation
3. **Hybrid mode**: Keep both JSON and SVG modes, let user choose

---

## Success Metrics

### Speed:
- **Before**: ~25-40s per variation (Figma JSON)
- **Target**: ~10-20s per variation (SVG)
- **Measurement**: Railway logs, UI timing

### Quality:
- **Visual match**: SVG uses design system colors, radius, shadows
- **Error rate**: < 5% failed generations
- **Usability**: Designers can use SVG as inspiration/reference

### Developer Experience:
- **Simpler prompts**: Less complex than Figma JSON
- **Lower error rate**: SVG more forgiving
- **Easier debugging**: Can view SVG directly in browser

---

## Timeline Estimate

- **Phase 1** (Design system enhancement): 2-3 hours
- **Phase 2** (Claude prompts): 1 hour
- **Phase 3** (Worker changes): 2 hours
- **Phase 4** (Plugin changes): 3-4 hours
- **Phase 5** (Visual analysis): 2-3 hours
- **Phase 6** (Type updates): 30 min
- **Phase 7** (Testing): 2 hours
- **Phase 8** (Migration): Ongoing

**Total**: ~12-15 hours of implementation + testing

---

## Questions to Answer Before Starting

1. ✅ **Disable Together AI?** → Yes, use Claude-only until retrained on SVG
2. ❓ **SVG import method?** → Use `figma.createNodeFromSvg()` or manual parsing?
3. ❓ **Editable in Figma?** → SVG imports as vector shapes (somewhat editable, not Auto Layout)
4. ❓ **Keep simplified schema?** → No, SVG is already simple
5. ❓ **Export capability?** → Keep existing export, add "Export as SVG" option?

---

## Next Steps

1. **Review this plan** - Confirm approach with user
2. **Answer open questions** - SVG import method, editability requirements
3. **Start Phase 1** - Enhance design system scanning with visual analysis
4. **Iterative implementation** - Build and test phase by phase
5. **Collect examples** - Once working, generate SVG examples for fine-tuning

---

Generated with 🤖 Claude Code
