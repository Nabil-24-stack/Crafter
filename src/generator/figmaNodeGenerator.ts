// ============================================================================
// FIGMA NODE GENERATOR - Convert Figma JSON to actual Figma nodes
// ============================================================================

import {
  FigmaNode,
  FigmaFrameNode,
  FigmaTextNode,
  isFrameNode,
  isTextNode,
  FontWeight,
} from '../types/figma-schema';

/**
 * Font loading result
 */
interface FontLoadResult {
  family: string;
  style: string;
  loaded: boolean;
}

/**
 * Font variant fallbacks for each weight
 */
const FONT_WEIGHT_VARIANTS: Record<FontWeight, string[]> = {
  'normal': ['Regular', 'Normal', 'Book', 'Roman'],
  'medium': ['Medium', 'Semi Bold', 'SemiBold', 'Semibold', 'Regular'],
  'semibold': ['Semi Bold', 'SemiBold', 'Semibold', 'Demi Bold', 'DemiBold', 'Bold'],
  'bold': ['Bold', 'Heavy', 'Black', 'Extra Bold', 'ExtraBold', 'Semi Bold'],
};

/**
 * Default fallback font
 */
const DEFAULT_FONT_FAMILY = 'Inter';
const DEFAULT_FONT_STYLE = 'Regular';

/**
 * Scan JSON tree and collect all required fonts
 */
function collectRequiredFonts(node: FigmaNode): Set<string> {
  const fonts = new Set<string>();

  function traverse(n: FigmaNode) {
    if (isTextNode(n)) {
      const family = n.fontFamily || DEFAULT_FONT_FAMILY;
      const weight = n.fontWeight || 'normal';

      // Add all variants for this weight
      FONT_WEIGHT_VARIANTS[weight].forEach(variant => {
        fonts.add(`${family}|${variant}`);
      });
    }

    if (isFrameNode(n) && n.children) {
      n.children.forEach(child => traverse(child));
    }
  }

  traverse(node);
  return fonts;
}

/**
 * Load a font with fallback variants
 * Returns the first successfully loaded variant
 */
async function loadFontWithFallbacks(
  family: string,
  variants: string[]
): Promise<FontLoadResult> {

  // Try each variant in order
  for (const variant of variants) {
    try {
      await figma.loadFontAsync({ family, style: variant });
      console.log(`✅ Loaded font: ${family} ${variant}`);
      return { family, style: variant, loaded: true };
    } catch (error) {
      // Try next variant
      continue;
    }
  }

  // None worked, return failure
  console.warn(`⚠️  Failed to load any variant of ${family}`);
  return { family, style: variants[0], loaded: false };
}

/**
 * Load all fonts upfront
 * Returns a map of family|weight -> loaded style
 */
async function loadAllFonts(
  requiredFonts: Set<string>
): Promise<Map<string, string>> {

  const fontMap = new Map<string, string>();

  // Parse and group by family
  const fontsByFamily = new Map<string, Set<string>>();

  requiredFonts.forEach(fontKey => {
    const [family, variant] = fontKey.split('|');
    if (!fontsByFamily.has(family)) {
      fontsByFamily.set(family, new Set());
    }
    fontsByFamily.get(family)!.add(variant);
  });

  // Try to load each family with its variants
  for (const [family, variants] of fontsByFamily.entries()) {
    const result = await loadFontWithFallbacks(family, Array.from(variants));

    if (result.loaded) {
      // Map this family to the loaded style
      fontMap.set(family, result.style);
    } else {
      // Family not available, fall back to Inter
      console.warn(`⚠️  Font family "${family}" not available, falling back to ${DEFAULT_FONT_FAMILY}`);

      // Try to load Inter with the same weight variants
      const interResult = await loadFontWithFallbacks(DEFAULT_FONT_FAMILY, Array.from(variants));

      if (interResult.loaded) {
        fontMap.set(family, interResult.style); // Map original family to Inter style
      } else {
        // Last resort: use default Inter Regular
        fontMap.set(family, DEFAULT_FONT_STYLE);
      }
    }
  }

  // Always ensure default font is loaded
  try {
    await figma.loadFontAsync({ family: DEFAULT_FONT_FAMILY, style: DEFAULT_FONT_STYLE });
    console.log(`✅ Loaded default font: ${DEFAULT_FONT_FAMILY} ${DEFAULT_FONT_STYLE}`);
  } catch (error) {
    console.error(`❌ Failed to load default font: ${error}`);
  }

  return fontMap;
}

/**
 * Get loaded font style for a given family and weight
 */
function getLoadedFont(
  fontMap: Map<string, string>,
  family: string | undefined,
  weight: FontWeight
): { family: string; style: string } {

  const actualFamily = family || DEFAULT_FONT_FAMILY;
  const loadedStyle = fontMap.get(actualFamily);

  if (loadedStyle) {
    return { family: actualFamily, style: loadedStyle };
  }

  // Fallback to default
  console.warn(`⚠️  No loaded font found for ${actualFamily}, using ${DEFAULT_FONT_FAMILY}`);
  return { family: DEFAULT_FONT_FAMILY, style: DEFAULT_FONT_STYLE };
}

/**
 * Create a FrameNode from Figma JSON
 */
function createFrame(
  node: FigmaFrameNode,
  fontMap: Map<string, string>
): FrameNode {

  const frame = figma.createFrame();
  frame.name = node.name;

  // Layout mode (default: NONE)
  const layoutMode = node.layoutMode || 'NONE';
  frame.layoutMode = layoutMode;

  // Sizing modes (default: AUTO)
  frame.primaryAxisSizingMode = node.primaryAxisSizingMode || 'AUTO';
  frame.counterAxisSizingMode = node.counterAxisSizingMode || 'AUTO';

  // Dimensions (default: 100x100 if not specified)
  frame.resize(
    node.width ?? 100,
    node.height ?? 100
  );

  // Spacing (default: 0)
  if (layoutMode !== 'NONE') {
    frame.itemSpacing = node.itemSpacing ?? 0;
    frame.paddingTop = node.paddingTop ?? 0;
    frame.paddingRight = node.paddingRight ?? 0;
    frame.paddingBottom = node.paddingBottom ?? 0;
    frame.paddingLeft = node.paddingLeft ?? 0;

    // Alignment (default: MIN)
    frame.primaryAxisAlignItems = node.primaryAxisAlignItems || 'MIN';
    frame.counterAxisAlignItems = node.counterAxisAlignItems || 'MIN';
  }

  // Fills (default: empty array = transparent)
  if (node.fills && node.fills.length > 0) {
    frame.fills = node.fills.map(fill => ({
      type: 'SOLID',
      color: fill.color,
    }));
  } else {
    frame.fills = [];
  }

  // Corner radius (default: 0)
  if (node.cornerRadius !== undefined) {
    frame.cornerRadius = node.cornerRadius;
  }

  // Children
  if (node.children && node.children.length > 0) {
    node.children.forEach(child => {
      const childNode = createNodeRecursive(child, fontMap);
      frame.appendChild(childNode);
    });
  }

  return frame;
}

/**
 * Create a TextNode from Figma JSON
 */
function createText(
  node: FigmaTextNode,
  fontMap: Map<string, string>
): TextNode {

  const text = figma.createText();
  text.name = node.name || 'Text';

  // Font (must load before setting characters)
  const fontSize = node.fontSize ?? 16;
  const fontWeight = node.fontWeight || 'normal';
  const font = getLoadedFont(fontMap, node.fontFamily, fontWeight);

  text.fontName = { family: font.family, style: font.style };
  text.fontSize = fontSize;

  // Characters
  text.characters = node.characters;

  // Fills (default: black)
  if (node.fills && node.fills.length > 0) {
    text.fills = node.fills.map(fill => ({
      type: 'SOLID',
      color: fill.color,
    }));
  } else {
    text.fills = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  }

  // Text alignment (default: LEFT)
  if (node.textAlignHorizontal) {
    text.textAlignHorizontal = node.textAlignHorizontal;
  }

  // Line height (default: AUTO)
  if (node.lineHeight !== undefined) {
    text.lineHeight = { value: node.lineHeight, unit: 'PIXELS' };
  }

  return text;
}

/**
 * Recursively create nodes from JSON
 */
function createNodeRecursive(
  node: FigmaNode,
  fontMap: Map<string, string>
): SceneNode {

  if (isFrameNode(node)) {
    return createFrame(node, fontMap);
  } else if (isTextNode(node)) {
    return createText(node, fontMap);
  } else {
    throw new Error(`Unknown node type: ${(node as any).type}`);
  }
}

/**
 * Main entry point: Generate Figma nodes from JSON
 */
export async function generateFigmaNodes(figmaJson: FigmaNode): Promise<FrameNode> {

  if (!isFrameNode(figmaJson)) {
    throw new Error('Root node must be a FRAME');
  }

  console.log('📊 Starting Figma node generation...');

  // Step 1: Scan tree and collect all required fonts
  console.log('🔍 Scanning for required fonts...');
  const requiredFonts = collectRequiredFonts(figmaJson);
  console.log(`   Found ${requiredFonts.size} font variants to load`);

  // Step 2: Load all fonts upfront
  console.log('⏳ Loading fonts...');
  const fontMap = await loadAllFonts(requiredFonts);
  console.log(`   Loaded ${fontMap.size} font families`);

  // Step 3: Create nodes recursively
  console.log('🏗️  Creating Figma nodes...');
  const rootFrame = createFrame(figmaJson, fontMap);
  console.log('✅ Generation complete');

  return rootFrame;
}
