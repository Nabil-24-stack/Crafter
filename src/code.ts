// Main plugin code - runs in the Figma environment
// This has access to the figma global object and the document

import {
  Message,
  DesignSystemData,
  ComponentData,
  ColorStyle,
  TextStyle,
  LayoutNode,
  SerializedFrame,
  SerializedNode,
} from './types';
import { expandSimplifiedLayout } from './schemaExpander';
import { analyzeComponentVisuals, generateVisualLanguageDescription } from './visualAnalyzer';
// MVP iteration pipeline
import { buildFrameSnapshot, extractFrameScopedPalette } from './mvpUtils';
import { reconstructVariationMVP } from './mvpReconstruction';
import { IterationRequestMVP, IterationResponseMVP } from './mvpTypes';

// Debug mode - set to false for production to reduce console noise
const DEBUG_MODE = true;

function debugLog(...args: any[]) {
  if (DEBUG_MODE) {
    console.log(...args);
  }
}

/**
 * Sanitize SVG to be compatible with Figma
 * Removes/fixes features that Figma doesn't support
 */
function sanitizeSvgForFigma(svgString: string): string {
  let cleaned = svgString;

  // Remove undefined gradient references (common issue)
  // Find all url(#...) references and check if they're defined
  const urlRefs = cleaned.match(/url\(#([^)]+)\)/g) || [];
  const definedIds = cleaned.match(/id="([^"]+)"/g) || [];
  const definedIdSet = new Set(definedIds.map(id => id.replace(/id="([^"]+)"/, '$1')));

  urlRefs.forEach(ref => {
    const id = ref.replace(/url\(#([^)]+)\)/, '$1');
    if (!definedIdSet.has(id)) {
      // Replace undefined gradient with solid color
      cleaned = cleaned.replace(new RegExp(`fill="${ref}"`, 'g'), 'fill="#CCCCCC"');
      cleaned = cleaned.replace(new RegExp(`stroke="${ref}"`, 'g'), 'stroke="#CCCCCC"');
    }
  });

  // Fix duplicate font-family attributes (keeps first occurrence)
  cleaned = cleaned.replace(/(<[^>]*font-family="[^"]*")(\s+font-family="[^"]*")/g, '$1');

  // Simplify font-family (Figma doesn't like fallback fonts or unknown fonts)
  // Replace generic/unknown fonts with Inter
  cleaned = cleaned.replace(/font-family="Menlo"/g, 'font-family="Inter"');
  cleaned = cleaned.replace(/font-family="monospace"/g, 'font-family="Inter"');
  cleaned = cleaned.replace(/font-family="sans-serif"/g, 'font-family="Inter"');
  cleaned = cleaned.replace(/font-family="serif"/g, 'font-family="Inter"');

  // Remove fallback fonts (e.g., "Inter, sans-serif" -> "Inter")
  cleaned = cleaned.replace(/font-family="([^",]+),[^"]*"/g, 'font-family="$1"');

  // Remove text-anchor (Figma doesn't support this well)
  cleaned = cleaned.replace(/\s+text-anchor="[^"]*"/g, '');

  // Remove xml:space
  cleaned = cleaned.replace(/\s+xml:space="[^"]*"/g, '');

  //  Remove stroke-dasharray with empty values or zeros
  cleaned = cleaned.replace(/\s+stroke-dasharray="0(,0)*"/g, '');

  return cleaned;
}

// Show the plugin UI
figma.showUI(__html__, { width: 480, height: 700 });

console.log('Crafter plugin loaded');

// Global state for tracking variations in current generation session
let currentVariationsSession: {
  basePosition: { x: number; y: number };
  createdNodes: SceneNode[];
  totalVariations: number;
  completedCount: number;
} | null = null;

// Global state for tracking iteration variations in current session
let currentIterationSession: {
  createdFrames: FrameNode[];
  totalVariations: number;
} | null = null;

// Flag to prevent selectionchange handler from firing during programmatic selection changes
let isUpdatingSelectionProgrammatically = false;

// Global cache for design system (for schema expansion)
let cachedDesignSystem: DesignSystemData | null = null;

// Load all pages on startup (required for dynamic-page access)
async function initPlugin() {
  try {
    await figma.loadAllPagesAsync();
    console.log('All pages loaded');
  } catch (error) {
    console.error('Error loading pages:', error);
  }
}

// Initialize
initPlugin();

// Track last selected frame to avoid duplicate messages
let lastSelectedFrameId: string | null = null;

// Listen for selection changes to detect frame selection for iteration
figma.on('selectionchange', () => {
  // Ignore selection changes that we're making programmatically
  if (isUpdatingSelectionProgrammatically) {
    return;
  }

  const selection = figma.currentPage.selection;

  // If exactly one frame is selected, send frame info to UI (but don't export PNG yet)
  if (selection.length === 1 && selection[0].type === 'FRAME') {
    const frame = selection[0] as FrameNode;

    // Only send message if frame selection actually changed
    if (frame.id !== lastSelectedFrameId) {
      lastSelectedFrameId = frame.id;
      console.log('Frame selected:', frame.name, frame.id);
      figma.ui.postMessage({
        type: 'selected-frame-data',
        payload: {
          frameId: frame.id,
          frameName: frame.name,
          // No imageData yet - will be exported when user clicks Iterate
        },
      });
    }
  } else {
    // No frame selected or not a frame - clear selection
    if (lastSelectedFrameId !== null) {
      lastSelectedFrameId = null;
      console.log('Frame deselected');
      figma.ui.postMessage({
        type: 'selected-frame-data',
        payload: { frameId: null, frameName: null },
      });
    }
  }
});

/**
 * Validates and sanitizes counterAxisAlignItems values
 * Figma only accepts: 'MIN' | 'MAX' | 'CENTER' | 'BASELINE'
 * Claude sometimes returns 'STRETCH' which is invalid
 */
function sanitizeCounterAxisAlignItems(value: string): 'MIN' | 'MAX' | 'CENTER' | 'BASELINE' {
  const validValues = ['MIN', 'MAX', 'CENTER', 'BASELINE'];
  if (validValues.includes(value)) {
    return value as 'MIN' | 'MAX' | 'CENTER' | 'BASELINE';
  }
  // Default to CENTER if invalid value (like STRETCH)
  console.warn(`Invalid counterAxisAlignItems value "${value}", defaulting to "CENTER"`);
  return 'CENTER';
}

/**
 * Validates and sanitizes sizing mode values
 * Figma only accepts: 'FIXED' | 'AUTO'
 * AI sometimes returns invalid values like 'STRETCH'
 */
function sanitizeSizingMode(value: any, fieldName: string): 'FIXED' | 'AUTO' {
  if (value === 'FIXED' || value === 'AUTO') {
    return value;
  }
  // Default to AUTO if invalid value
  console.warn(`Invalid ${fieldName} value "${value}", defaulting to "AUTO"`);
  return 'AUTO';
}

/**
 * Helper function to create Auto Layout frames with proper defaults
 * Enforces Auto Layout best practices across all generated content
 */
interface AutoLayoutConfig {
  name: string;
  layoutMode: 'HORIZONTAL' | 'VERTICAL';
  primaryAxisSizingMode?: 'AUTO' | 'FIXED';
  counterAxisSizingMode?: 'AUTO' | 'FIXED';
  primaryAxisAlignItems?: 'MIN' | 'CENTER' | 'MAX' | 'SPACE_BETWEEN';
  counterAxisAlignItems?: 'MIN' | 'MAX' | 'CENTER' | 'BASELINE';
  itemSpacing?: number;
  paddingLeft?: number;
  paddingRight?: number;
  paddingTop?: number;
  paddingBottom?: number;
  width?: number;  // Only used when counterAxisSizingMode is FIXED
  height?: number; // Only used when primaryAxisSizingMode is FIXED
}

function createAutoLayoutFrame(config: AutoLayoutConfig): FrameNode {
  const frame = figma.createFrame();
  frame.name = config.name;

  // ALWAYS set layoutMode - never leave as NONE
  frame.layoutMode = config.layoutMode;

  // Sanitize and set sizing modes (default to AUTO if not specified or invalid)
  frame.primaryAxisSizingMode = config.primaryAxisSizingMode ?
    sanitizeSizingMode(config.primaryAxisSizingMode, 'primaryAxisSizingMode') : 'AUTO';
  frame.counterAxisSizingMode = config.counterAxisSizingMode ?
    sanitizeSizingMode(config.counterAxisSizingMode, 'counterAxisSizingMode') : 'AUTO';

  // Set alignment with safe defaults
  frame.primaryAxisAlignItems = config.primaryAxisAlignItems || 'MIN';
  frame.counterAxisAlignItems = config.counterAxisAlignItems ?
    sanitizeCounterAxisAlignItems(config.counterAxisAlignItems) : 'MIN';

  // Set spacing
  frame.itemSpacing = config.itemSpacing ?? 16;

  // Set padding (default to 16 if not specified)
  frame.paddingLeft = config.paddingLeft ?? 16;
  frame.paddingRight = config.paddingRight ?? 16;
  frame.paddingTop = config.paddingTop ?? 16;
  frame.paddingBottom = config.paddingBottom ?? 16;

  // Only resize if FIXED mode and dimensions provided
  if (config.layoutMode === 'HORIZONTAL') {
    if (config.primaryAxisSizingMode === 'FIXED' && config.width !== undefined) {
      frame.resize(config.width, frame.height);
    }
    if (config.counterAxisSizingMode === 'FIXED' && config.height !== undefined) {
      frame.resize(frame.width, config.height);
    }
  } else if (config.layoutMode === 'VERTICAL') {
    if (config.counterAxisSizingMode === 'FIXED' && config.width !== undefined) {
      frame.resize(config.width, frame.height);
    }
    if (config.primaryAxisSizingMode === 'FIXED' && config.height !== undefined) {
      frame.resize(frame.width, config.height);
    }
  }

  return frame;
}

// Handle messages from the UI
figma.ui.onmessage = async (msg: Message) => {

  try {
    switch (msg.type) {
      case 'check-auth':
        // Check if user has stored auth token
        const storedToken = await figma.clientStorage.getAsync('auth_token');
        figma.ui.postMessage({
          type: 'auth-status',
          payload: { token: storedToken || null }
        });
        break;

      case 'start-oauth':
        // Generate random state for security
        const state = Math.random().toString(36).substring(7);
        await figma.clientStorage.setAsync('oauth_state', state);

        // Open browser to auth page
        figma.openExternal(
          `https://crafter-ai-kappa.vercel.app/api/auth?action=figma&state=${state}&redirect=figma`
        );
        break;

      case 'store-auth-token':
        // Store the auth token from OAuth callback
        await figma.clientStorage.setAsync('auth_token', msg.payload.token);
        figma.ui.postMessage({
          type: 'auth-complete',
          payload: { token: msg.payload.token }
        });
        break;

      case 'logout':
        // Clear stored auth token
        await figma.clientStorage.deleteAsync('auth_token');
        figma.ui.postMessage({
          type: 'auth-status',
          payload: { token: null }
        });
        break;

      case 'get-design-system':
        await handleGetDesignSystem();
        break;

      case 'get-selected-frame':
        await handleGetSelectedFrame();
        break;

      case 'export-frame-png':
        await handleExportFramePNG(msg.payload);
        break;

      case 'export-frame-json':
        await handleExportFrameJson();
        break;

      case 'generate-layout':
        await handleGenerateLayout(msg.payload);
        break;

      case 'generate-variations':
        await handleGenerateVariations(msg.payload);
        break;

      case 'generate-single-variation':
        await handleGenerateSingleVariation(msg.payload);
        break;

      case 'iterate-design':
        await handleIterateDesign(msg.payload);
        break;

      case 'iterate-design-variation':
        await handleIterateDesignVariation(msg.payload);
        break;

      case 'iterate-design-variation-mvp':
        await handleIterateDesignVariationMVP(msg.payload);
        break;

      case 'iteration-error':
        // Error from UI during iteration - just log it, UI already handles display
        console.error('Iteration error:', msg.payload.error);
        break;

      case 'convert-svg-to-png':
      case 'svg-converted-to-png':
      case 'svg-conversion-failed':
        // These messages are handled by the Promise listener in handleIterateDesignVariation
        // No need to process them in the main handler
        break;

      default:
        console.warn('Unknown message type:', msg.type);
    }
  } catch (error) {
    console.error('Error handling message:', error);
    figma.ui.postMessage({
      type: 'generation-error',
      payload: { error: error instanceof Error ? error.message : 'Unknown error' },
    });
  }
};

/**
 * Infers the category of a component from its name
 */
function inferComponentCategory(name: string): string {
  const lowerName = name.toLowerCase();

  // Common component patterns
  if (lowerName.includes('button') || lowerName.includes('btn')) return 'button';
  if (lowerName.includes('input') || lowerName.includes('textfield') || lowerName.includes('text field')) return 'input';
  if (lowerName.includes('card')) return 'card';
  if (lowerName.includes('icon')) return 'icon';
  if (lowerName.includes('avatar')) return 'avatar';
  if (lowerName.includes('badge') || lowerName.includes('tag') || lowerName.includes('chip')) return 'badge';
  if (lowerName.includes('header') || lowerName.includes('navbar') || lowerName.includes('nav')) return 'navigation';
  if (lowerName.includes('footer')) return 'footer';
  if (lowerName.includes('modal') || lowerName.includes('dialog')) return 'modal';
  if (lowerName.includes('menu') || lowerName.includes('dropdown')) return 'menu';
  if (lowerName.includes('tab')) return 'tab';
  if (lowerName.includes('checkbox')) return 'checkbox';
  if (lowerName.includes('radio')) return 'radio';
  if (lowerName.includes('switch') || lowerName.includes('toggle')) return 'switch';
  if (lowerName.includes('slider')) return 'slider';
  if (lowerName.includes('alert') || lowerName.includes('toast') || lowerName.includes('notification')) return 'alert';
  if (lowerName.includes('list')) return 'list';
  if (lowerName.includes('table')) return 'table';
  if (lowerName.includes('form')) return 'form';
  if (lowerName.includes('image') || lowerName.includes('img')) return 'image';
  if (lowerName.includes('text') || lowerName.includes('label') || lowerName.includes('heading')) return 'text';
  if (lowerName.includes('divider') || lowerName.includes('separator')) return 'divider';
  if (lowerName.includes('container') || lowerName.includes('wrapper') || lowerName.includes('box')) return 'container';

  return 'component'; // default category
}

/**
 * Extracts the design system from the current Figma file
 * Uses Figma's official API to get ONLY components created in this file
 */
async function handleGetDesignSystem() {
  // Return cached version if available
  if (cachedDesignSystem) {
    console.log('✅ Using cached design system');
    figma.ui.postMessage({
      type: 'design-system-data',
      payload: cachedDesignSystem,
    });
    return;
  }

  console.log('Extracting design system from current file...');

  // Use findAllWithCriteria to get ONLY local components (not from libraries)
  // This matches what's shown in "Created in this file" in Assets panel
  const components = await figma.root.findAllWithCriteria({
    types: ['COMPONENT', 'COMPONENT_SET']
  });

  // Filter to only include components where parent is in current file (not from libraries)
  const allNodes = components.filter(node => {
    // Check if this node is actually defined in this file (not a remote component)
    return node.parent !== null; // Remote components have null parent in this file
  });

  console.log(`Found ${allNodes.length} local components in file (matches "Created in this file")`);

  /**
   * Safely convert value to string or number
   */
  function safeValue(value: any, defaultValue: any = ''): any {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      return value;
    }
    return defaultValue;
  }

  /**
   * Deeply sanitize an object to remove all Symbol values
   */
  function sanitizeObject(obj: any): any {
    if (obj === null || obj === undefined) {
      return obj;
    }

    if (Array.isArray(obj)) {
      return obj.map(item => sanitizeObject(item)).filter(item => item !== undefined);
    }

    if (typeof obj === 'object') {
      const sanitized: any = {};
      for (const key in obj) {
        const value = obj[key];
        if (typeof value === 'symbol') {
          continue; // Skip symbols
        }
        if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
          sanitized[key] = value;
        } else if (typeof value === 'object') {
          sanitized[key] = sanitizeObject(value);
        }
      }
      return sanitized;
    }

    return obj;
  }

  let analyzedCount = 0;
  const allComponents: ComponentData[] = allNodes.map((node) => {
    // Both ComponentNode and ComponentSetNode have these properties
    const component = node as ComponentNode | ComponentSetNode;

    // Analyze visual properties for SVG generation
    let visuals;
    try {
      if (node.type === 'COMPONENT') {
        visuals = analyzeComponentVisuals(node as ComponentNode);
        analyzedCount++;
      }
    } catch (error) {
      console.warn(`Failed to analyze visuals for ${node.name}:`, error);
    }

    // Safely extract all properties to avoid Symbol issues
    const id = safeValue(node.id, `component-${Math.random()}`);
    const name = safeValue(node.name, 'Unnamed Component');
    const key = safeValue((node as any).key, id);
    const description = safeValue((node as any).description, '');
    const width = typeof component.width === 'number' ? Math.round(component.width) : 0;
    const height = typeof component.height === 'number' ? Math.round(component.height) : 0;

    return {
      id,
      name,
      key,
      description,
      type: node.type as 'COMPONENT' | 'COMPONENT_SET',
      width,
      height,
      category: inferComponentCategory(name),
      visuals: visuals ? sanitizeObject(visuals) : undefined,
    };
  });

  console.log(`Found ${allComponents.length} local components in file`);
  console.log(`✅ Analyzed visual properties for ${analyzedCount} components`);

  // Get local color styles using async version
  const localPaintStyles = await figma.getLocalPaintStylesAsync();
  const colorStyles: ColorStyle[] = localPaintStyles
    .map((style) => {
      try {
        // Extract solid color if available - safely check paints
        const paints = style.paints;
        if (Array.isArray(paints) && paints.length > 0 && paints[0] && paints[0].type === 'SOLID') {
          const solidPaint = paints[0] as SolidPaint;

          // Safely convert to hex
          const r = Math.round(solidPaint.color.r * 255);
          const g = Math.round(solidPaint.color.g * 255);
          const b = Math.round(solidPaint.color.b * 255);

          const rHex = r.toString(16).padStart(2, '0');
          const gHex = g.toString(16).padStart(2, '0');
          const bHex = b.toString(16).padStart(2, '0');
          const hex = `#${rHex}${gHex}${bHex}`;

          // Safely extract properties to avoid Symbol issues
          const styleId = safeValue(style.id, `color-${Math.random()}`);
          const styleName = safeValue(style.name, 'Unnamed Color');

          return {
            id: styleId,
            name: styleName,
            hex, // Add hex for easier use
            color: {
              r: solidPaint.color.r,
              g: solidPaint.color.g,
              b: solidPaint.color.b,
              a: solidPaint.opacity !== undefined ? solidPaint.opacity : 1,
            },
          };
        }
      } catch (error) {
        console.warn(`Failed to extract color from style ${style.name}:`, error);
      }
      return null;
    })
    .filter((style): style is NonNullable<typeof style> => style !== null);

  // Get local text styles using async version
  const localTextStyles = await figma.getLocalTextStylesAsync();
  const textStyles: TextStyle[] = localTextStyles.map((style) => {
    // Safely extract properties to avoid Symbol issues
    const styleId = safeValue(style.id, `text-${Math.random()}`);
    const styleName = safeValue(style.name, 'Unnamed Text Style');
    const fontSize = typeof style.fontSize === 'number' ? style.fontSize : 14;
    const fontFamily = safeValue(style.fontName?.family, 'Inter');
    const fontStyle = safeValue(style.fontName?.style, 'Regular');
    const fontWeight = fontStyle === 'Bold' ? 700 : 400;

    return {
      id: styleId,
      name: styleName,
      fontSize,
      fontFamily,
      fontWeight,
    };
  });

  // Generate visual language description for AI
  const visualLanguage = generateVisualLanguageDescription(
    allComponents,
    colorStyles,
    textStyles
  );

  console.log('📝 Generated visual language (first 500 chars):\n', visualLanguage.substring(0, 500) + '...');

  const designSystem: DesignSystemData = {
    components: allComponents,
    colors: colorStyles,
    textStyles: textStyles,
    visualLanguage, // Add visual language for SVG generation
  };

  console.log('Design system extracted:', {
    totalComponents: allComponents.length,
    colorsCount: colorStyles.length,
    textStylesCount: textStyles.length,
  });

  // Cache the design system for future requests
  cachedDesignSystem = designSystem;

  // Send the design system back to UI
  figma.ui.postMessage({
    type: 'design-system-data',
    payload: designSystem,
  });
}

/**
 * Generates and renders a layout to the Figma canvas
 */
async function handleGenerateLayout(payload: { layout: LayoutNode; reasoning?: string }) {
  console.log('Generating layout on canvas...');

  const { layout, reasoning } = payload;

  try {
    // Create the layout on the canvas
    const rootNode = await createNodeFromLayout(layout);

    if (rootNode) {
      // Add to current page
      figma.currentPage.appendChild(rootNode);

      // Position next to existing content or at viewport center
      const nodes = figma.currentPage.children;
      if (nodes.length > 1) {
        // Position to the right of existing content
        const lastNode = nodes[nodes.length - 2];
        rootNode.x = lastNode.x + lastNode.width + 100;
        rootNode.y = lastNode.y;
      } else {
        // Center in viewport
        rootNode.x = figma.viewport.center.x - rootNode.width / 2;
        rootNode.y = figma.viewport.center.y - rootNode.height / 2;
      }

      // Select and focus on the new layout
      figma.currentPage.selection = [rootNode];
      figma.viewport.scrollAndZoomIntoView([rootNode]);

      console.log('Layout created successfully:', rootNode.name);

      figma.ui.postMessage({
        type: 'generation-complete',
        payload: { success: true, reasoning },
      });

      figma.notify('✨ Layout generated successfully!');
    } else {
      throw new Error('Failed to create layout node');
    }
  } catch (error) {
    console.error('Error creating layout:', error);
    figma.ui.postMessage({
      type: 'generation-error',
      payload: { error: error instanceof Error ? error.message : 'Failed to create layout' },
    });
    figma.notify('❌ Failed to generate layout', { error: true });
  }
}

/**
 * Generates and renders multiple design variations side-by-side on the Figma canvas
 */
async function handleGenerateVariations(payload: { variations: Array<{ layout: LayoutNode; reasoning?: string }>; numberOfVariations: number }) {
  console.log(`Generating ${payload.numberOfVariations} design variations on canvas...`);

  const { variations, numberOfVariations } = payload;

  try {
    const createdNodes: SceneNode[] = [];
    const VARIATION_SPACING = 1200; // Horizontal spacing between variations

    // Create all variations in parallel
    for (let i = 0; i < numberOfVariations; i++) {
      const variation = variations[i];
      if (!variation) continue;

      const { layout, reasoning } = variation;

      // Create the layout node
      const rootNode = await createNodeFromLayout(layout);

      if (rootNode) {
        // Add to current page
        figma.currentPage.appendChild(rootNode);

        // Update the name to include variation number
        rootNode.name = `${layout.name} - Variation ${i + 1}`;

        // Position variations side-by-side
        if (i === 0) {
          // First variation: position at viewport center or next to existing content
          const nodes = figma.currentPage.children;
          const existingContent = nodes.filter(n => n !== rootNode);

          if (existingContent.length > 0) {
            // Position to the right of existing content
            const rightmostNode = existingContent.reduce((rightmost, node) => {
              const nodeRight = node.x + node.width;
              const rightmostRight = rightmost.x + rightmost.width;
              return nodeRight > rightmostRight ? node : rightmost;
            });
            rootNode.x = rightmostNode.x + rightmostNode.width + 100;
            rootNode.y = rightmostNode.y;
          } else {
            // Center in viewport
            rootNode.x = figma.viewport.center.x - rootNode.width / 2;
            rootNode.y = figma.viewport.center.y - rootNode.height / 2;
          }
        } else {
          // Subsequent variations: place to the right with spacing
          const previousNode = createdNodes[i - 1];
          rootNode.x = previousNode.x + VARIATION_SPACING;
          rootNode.y = previousNode.y;
        }

        createdNodes.push(rootNode);
        console.log(`Variation ${i + 1} created successfully:`, rootNode.name);
      }
    }

    if (createdNodes.length > 0) {
      // Select all created variations
      figma.currentPage.selection = createdNodes;
      figma.viewport.scrollAndZoomIntoView(createdNodes);

      const reasoningSummary = variations[0]?.reasoning || '';
      figma.ui.postMessage({
        type: 'generation-complete',
        payload: {
          success: true,
          reasoning: `Generated ${createdNodes.length} design variation${createdNodes.length > 1 ? 's' : ''}. ${reasoningSummary}`
        },
      });

      figma.notify(`✨ ${createdNodes.length} design variation${createdNodes.length > 1 ? 's' : ''} generated successfully!`);
    } else {
      throw new Error('Failed to create any variation nodes');
    }
  } catch (error) {
    console.error('Error creating variations:', error);
    figma.ui.postMessage({
      type: 'generation-error',
      payload: { error: error instanceof Error ? error.message : 'Failed to create variations' },
    });
    figma.notify('❌ Failed to generate variations', { error: true });
  }
}

/**
 * Handles a single variation as soon as it's ready (streaming approach)
 * SVG MODE: Accepts SVG string instead of layout
 */
async function handleGenerateSingleVariation(payload: {
  variation: { svg: string; reasoning?: string };
  variationIndex: number;
  totalVariations: number;
}) {
  console.log(`Generating variation ${payload.variationIndex + 1} of ${payload.totalVariations} on canvas...`);

  const { variation, variationIndex, totalVariations } = payload;
  const { svg, reasoning } = variation;
  const VARIATION_SPACING = 1200;

  try {
    // Initialize session on first variation
    if (currentVariationsSession === null || currentVariationsSession.totalVariations !== totalVariations) {
      // Calculate base position for first variation
      const nodes = figma.currentPage.children;
      let baseX: number;
      let baseY: number;

      if (nodes.length > 0) {
        // Position to the right of existing content
        const rightmostNode = nodes.reduce((rightmost, node) => {
          const nodeRight = node.x + node.width;
          const rightmostRight = rightmost.x + rightmost.width;
          return nodeRight > rightmostRight ? node : rightmost;
        });
        baseX = rightmostNode.x + rightmostNode.width + 100;
        baseY = rightmostNode.y;
      } else {
        // Center in viewport
        baseX = figma.viewport.center.x - 600; // Offset to account for multiple variations
        baseY = figma.viewport.center.y - 400;
      }

      currentVariationsSession = {
        basePosition: { x: baseX, y: baseY },
        createdNodes: [],
        totalVariations,
        completedCount: 0,
      };
    }

    // Import SVG as Figma node
    const rootNode = await importSVGToFigma(svg, `SVG Mockup - Variation ${variationIndex + 1}`);

    if (rootNode) {
      // Add to current page
      figma.currentPage.appendChild(rootNode);

      // Name is already set in importSVGToFigma()

      // Position based on variation index
      rootNode.x = currentVariationsSession.basePosition.x + (variationIndex * VARIATION_SPACING);
      rootNode.y = currentVariationsSession.basePosition.y;

      // Track the created node
      currentVariationsSession.createdNodes.push(rootNode);
      currentVariationsSession.completedCount++;

      console.log(`Variation ${variationIndex + 1} created successfully:`, rootNode.name);

      // Select and zoom to show all created variations so far
      figma.currentPage.selection = currentVariationsSession.createdNodes;
      figma.viewport.scrollAndZoomIntoView(currentVariationsSession.createdNodes);

      // Check if all variations are complete
      if (currentVariationsSession.completedCount === totalVariations) {
        const message = `Generated ${totalVariations} design variation${totalVariations > 1 ? 's' : ''}. ${reasoning || ''}`;

        figma.ui.postMessage({
          type: 'generation-complete',
          payload: {
            success: true,
            reasoning: message,
          },
        });

        figma.notify(`✨ All ${totalVariations} variation${totalVariations > 1 ? 's' : ''} generated successfully!`);

        // Reset session
        currentVariationsSession = null;
      } else {
        // Partial completion notification
        figma.notify(`✅ Variation ${variationIndex + 1} of ${totalVariations} ready`);
      }
    } else {
      throw new Error(`Failed to create variation ${variationIndex + 1} node`);
    }
  } catch (error) {
    console.error(`Error creating variation ${variationIndex + 1}:`, error);
    figma.ui.postMessage({
      type: 'generation-error',
      payload: { error: error instanceof Error ? error.message : `Failed to create variation ${variationIndex + 1}` },
    });
    figma.notify(`❌ Failed to generate variation ${variationIndex + 1}`, { error: true });
  }
}

/**
 * Import SVG markup into Figma as a node
 */
async function importSVGToFigma(svgString: string, name: string = 'SVG Mockup'): Promise<FrameNode | null> {
  try {
    console.log('Importing SVG to Figma:', name);
    console.log('SVG length:', svgString.length, 'characters');

    // Use Figma's built-in SVG import
    const svgNode = figma.createNodeFromSvg(svgString);

    if (!svgNode) {
      throw new Error('figma.createNodeFromSvg() returned null');
    }

    // Wrap SVG in a frame for better organization
    const frame = figma.createFrame();
    frame.name = name;
    frame.resize(svgNode.width, svgNode.height);
    frame.appendChild(svgNode);

    // Position SVG node at 0,0 within frame
    svgNode.x = 0;
    svgNode.y = 0;

    console.log('✅ SVG imported successfully as', name);

    return frame;
  } catch (error) {
    console.error('❌ Failed to import SVG:', error);
    figma.notify(`Failed to import SVG: ${error instanceof Error ? error.message : 'Unknown error'}`);
    return null;
  }
}

/**
 * Recursively creates Figma nodes from layout specification
 */
async function createNodeFromLayout(layoutNode: LayoutNode): Promise<SceneNode | null> {
  let node: SceneNode | null = null;

  switch (layoutNode.type) {
    case 'FRAME': {
      // ENFORCE AUTO LAYOUT: All frames MUST use Auto Layout
      // Default to VERTICAL if not specified
      const layoutMode = (layoutNode.layoutMode && layoutNode.layoutMode !== 'NONE')
        ? layoutNode.layoutMode
        : 'VERTICAL';

      const frame = createAutoLayoutFrame({
        name: layoutNode.name,
        layoutMode: layoutMode,
        primaryAxisSizingMode: layoutNode.primaryAxisSizingMode || 'AUTO',
        counterAxisSizingMode: layoutNode.counterAxisSizingMode || 'AUTO',
        primaryAxisAlignItems: layoutNode.primaryAxisAlignItems,
        counterAxisAlignItems: layoutNode.counterAxisAlignItems,
        itemSpacing: layoutNode.itemSpacing,
        paddingLeft: layoutNode.paddingLeft,
        paddingRight: layoutNode.paddingRight,
        paddingTop: layoutNode.paddingTop,
        paddingBottom: layoutNode.paddingBottom,
        width: layoutNode.width,
        height: layoutNode.height,
      });

      // Only set x/y position for root-level frames (those explicitly positioned)
      // Children inside auto layout should NOT have x/y set
      if (layoutNode.x !== undefined) frame.x = layoutNode.x;
      if (layoutNode.y !== undefined) frame.y = layoutNode.y;

      // Apply fills if specified
      if (layoutNode.fills) {
        frame.fills = layoutNode.fills.map((fill) => ({
          type: 'SOLID',
          color: { r: fill.color.r, g: fill.color.g, b: fill.color.b },
          opacity: fill.color.a ?? 1,
        }));
      }

      // Apply corner radius
      if (layoutNode.cornerRadius !== undefined) {
        frame.cornerRadius = layoutNode.cornerRadius;
      }

      // Apply strokes
      if (layoutNode.strokes && layoutNode.strokes.length > 0) {
        frame.strokes = layoutNode.strokes.map((stroke) => ({
          type: 'SOLID',
          color: { r: stroke.color.r, g: stroke.color.g, b: stroke.color.b },
          opacity: stroke.color.a ?? 1,
        }));
        if (layoutNode.strokeWeight !== undefined) {
          frame.strokeWeight = layoutNode.strokeWeight;
        }
      }

      // Apply opacity
      if (layoutNode.opacity !== undefined) {
        frame.opacity = layoutNode.opacity;
      }

      // Create children recursively
      if (layoutNode.children) {
        for (const child of layoutNode.children) {
          const childNode = await createNodeFromLayout(child);
          if (childNode) {
            frame.appendChild(childNode);
          }
        }
      }

      node = frame;
      break;
    }

    case 'COMPONENT_INSTANCE': {
      // Try to find and instantiate the component
      if (layoutNode.componentKey) {
        try {
          console.log('Creating component instance:', layoutNode.name, 'with key:', layoutNode.componentKey);

          // First, try to find the component locally in the file
          const localComponent = figma.root.findOne(
            (node) =>
              (node.type === 'COMPONENT' || node.type === 'COMPONENT_SET') &&
              (node as ComponentNode | ComponentSetNode).key === layoutNode.componentKey
          ) as ComponentNode | ComponentSetNode | null;

          let instance: InstanceNode | null = null;

          if (localComponent && localComponent.type === 'COMPONENT') {
            // Local component found - create instance directly
            instance = localComponent.createInstance();
            console.log('✓ Created instance from local component:', layoutNode.name);
          } else if (localComponent && localComponent.type === 'COMPONENT_SET') {
            // Component set - get default variant
            const defaultVariant = localComponent.defaultVariant;
            if (defaultVariant) {
              instance = defaultVariant.createInstance();
              console.log('✓ Created instance from local component set:', layoutNode.name);
            } else {
              console.warn('Component set has no default variant:', layoutNode.name);
            }
          } else {
            // Not found locally, try importing from library (published components)
            console.log('Component not found locally, importing from library...');
            const component = await figma.importComponentByKeyAsync(layoutNode.componentKey);
            instance = component.createInstance();
            console.log('✓ Created instance from library component:', layoutNode.name);
          }

          if (instance) {
            instance.name = layoutNode.name;

            // REMOVE x/y positioning - Auto Layout handles all positioning
            // Components inside auto layout should use layoutAlign and layoutGrow instead

            // DO NOT resize component instances - let them use their natural size
            // Components are designed at specific sizes and should maintain them
            // Auto Layout will handle spacing and alignment

            // Apply layoutAlign and layoutGrow for Auto Layout sizing
            if (layoutNode.layoutAlign) {
              instance.layoutAlign = layoutNode.layoutAlign as 'INHERIT' | 'STRETCH' | 'MIN' | 'CENTER' | 'MAX';
            }
            if (layoutNode.layoutGrow !== undefined) {
              instance.layoutGrow = layoutNode.layoutGrow;
            }

            // Apply text override if specified
            if (layoutNode.text) {
              await setComponentText(instance, layoutNode.text);
            }

            node = instance;
          } else {
            console.error('✗ Failed to create component instance for:', layoutNode.name);
            node = createPlaceholderForComponent(layoutNode);
          }
        } catch (error) {
          console.error('✗ Error creating component:', layoutNode.componentKey, error);
          // Create a placeholder rectangle instead
          node = createPlaceholderForComponent(layoutNode);
        }
      } else {
        console.error('✗ Component instance missing componentKey:', layoutNode.name);
        node = createPlaceholderForComponent(layoutNode);
      }
      break;
    }

    case 'RECTANGLE': {
      const rect = figma.createRectangle();
      rect.name = layoutNode.name;

      // AUTO LAYOUT: Set size based on context
      // If we have explicit dimensions, use them
      const width = layoutNode.width ?? 100;
      const height = layoutNode.height ?? 100;
      rect.resize(width, height);

      // AUTO LAYOUT: Only set x/y for root-level nodes
      // Children inside auto layout should NOT have x/y set
      // Instead, they'll use layoutAlign and layoutGrow

      // Apply layoutAlign and layoutGrow for Auto Layout behavior
      if (layoutNode.layoutAlign) {
        rect.layoutAlign = layoutNode.layoutAlign as 'INHERIT' | 'STRETCH' | 'MIN' | 'CENTER' | 'MAX';
      }
      if (layoutNode.layoutGrow !== undefined) {
        rect.layoutGrow = layoutNode.layoutGrow;
      }

      if (layoutNode.fills) {
        rect.fills = layoutNode.fills.map((fill) => ({
          type: 'SOLID',
          color: { r: fill.color.r, g: fill.color.g, b: fill.color.b },
          opacity: fill.color.a ?? 1,
        }));
      }

      node = rect;
      break;
    }

    case 'TEXT': {
      const text = figma.createText();
      text.name = layoutNode.name;

      // Load font before setting text
      await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });
      text.characters = layoutNode.text || layoutNode.name;

      // AUTO LAYOUT: Text nodes should use textAutoResize to work with Auto Layout
      // Set to "HEIGHT" so width can be controlled by parent, height hugs content
      text.textAutoResize = 'HEIGHT';

      // If explicit width is provided, set it
      if (layoutNode.width !== undefined) {
        text.resize(layoutNode.width, text.height);
      }

      // AUTO LAYOUT: Only set x/y for root-level nodes
      // Children inside auto layout should NOT have x/y set
      // Instead, they'll use layoutAlign and layoutGrow

      // Apply layoutAlign and layoutGrow for Auto Layout behavior
      if (layoutNode.layoutAlign) {
        text.layoutAlign = layoutNode.layoutAlign as 'INHERIT' | 'STRETCH' | 'MIN' | 'CENTER' | 'MAX';
      }
      if (layoutNode.layoutGrow !== undefined) {
        text.layoutGrow = layoutNode.layoutGrow;
      }

      node = text;
      break;
    }

    default:
      console.warn('Unknown node type:', layoutNode.type);
  }

  return node;
}

/**
 * Sets text content in a component instance
 * Finds the first text node within the component and updates its content
 */
async function setComponentText(instance: InstanceNode, text: string): Promise<void> {
  try {
    // Find all text nodes within the component instance
    const textNodes = instance.findAll((node) => node.type === 'TEXT') as TextNode[];

    if (textNodes.length === 0) {
      console.log('No text nodes found in component:', instance.name);
      return;
    }

    // Update the first text node (usually the main text)
    const primaryTextNode = textNodes[0];

    // Try multiple fallback fonts
    const fallbackFonts = [
      primaryTextNode.fontName as FontName, // Original font
      { family: 'Inter', style: 'Regular' },
      { family: 'Roboto', style: 'Regular' },
      { family: 'Arial', style: 'Regular' },
    ];

    let updated = false;
    for (const font of fallbackFonts) {
      try {
        await figma.loadFontAsync(font);
        primaryTextNode.characters = text;
        if (font === primaryTextNode.fontName) {
          console.log(`✓ Updated text in ${instance.name}: "${text}"`);
        } else {
          console.log(`✓ Updated text in ${instance.name} with fallback font: "${text}"`);
        }
        updated = true;
        break;
      } catch (error) {
        continue; // Try next font
      }
    }

    if (!updated) {
      console.error(`✗ Failed to update text in ${instance.name} - no available fonts`);
    }
  } catch (error) {
    console.error(`✗ Error setting component text for ${instance.name}:`, error);
  }
}

/**
 * Creates a placeholder rectangle for components that couldn't be loaded
 */
function createPlaceholderForComponent(layoutNode: LayoutNode): RectangleNode {
  const rect = figma.createRectangle();
  rect.name = `[Placeholder] ${layoutNode.componentName || layoutNode.name}`;

  // AUTO LAYOUT: Set size based on context
  const width = layoutNode.width ?? 200;
  const height = layoutNode.height ?? 100;
  rect.resize(width, height);

  // AUTO LAYOUT: Only set x/y for root-level nodes
  // Children inside auto layout should NOT have x/y set
  // Instead, they'll use layoutAlign and layoutGrow

  // Apply layoutAlign and layoutGrow for Auto Layout behavior
  if (layoutNode.layoutAlign) {
    rect.layoutAlign = layoutNode.layoutAlign as 'INHERIT' | 'STRETCH' | 'MIN' | 'CENTER' | 'MAX';
  }
  if (layoutNode.layoutGrow !== undefined) {
    rect.layoutGrow = layoutNode.layoutGrow;
  }

  // Style as a placeholder
  rect.fills = [
    {
      type: 'SOLID',
      color: { r: 0.9, g: 0.9, b: 0.95 },
      opacity: 1,
    },
  ];
  rect.strokes = [
    {
      type: 'SOLID',
      color: { r: 0.5, g: 0.5, b: 0.7 },
    },
  ];
  rect.strokeWeight = 2;
  rect.dashPattern = [5, 5];

  return rect;
}
// Iteration Mode Functions for code.ts
// Add these functions to the end of code.ts

/**
 * Handles getting the currently selected frame for iteration
 * Exports the frame as PNG for visual reference
 */
async function handleGetSelectedFrame() {
  console.log('Getting current selection state...');

  const selection = figma.currentPage.selection;

  // Just send the current frame info (if any) to sync UI state
  if (selection.length === 1 && selection[0].type === 'FRAME') {
    const frame = selection[0] as FrameNode;

    // Update tracking variable
    lastSelectedFrameId = frame.id;

    figma.ui.postMessage({
      type: 'selected-frame-data',
      payload: {
        frameId: frame.id,
        frameName: frame.name,
      },
    });
    console.log('Current selection:', frame.name);
  } else {
    // No frame selected
    lastSelectedFrameId = null;

    figma.ui.postMessage({
      type: 'selected-frame-data',
      payload: { frameId: null, frameName: null },
    });
    console.log('No frame currently selected');
  }
}

/**
 * Exports a specific frame as PNG (called when user clicks Iterate button)
 */
async function handleExportFramePNG(payload: any) {
  const { frameId } = payload;

  if (!frameId) {
    figma.ui.postMessage({
      type: 'frame-png-exported',
      payload: { error: 'No frame ID provided' },
    });
    return;
  }

  try {
    // Find the frame by ID
    const frameNode = await figma.getNodeByIdAsync(frameId);

    if (!frameNode || frameNode.type !== 'FRAME') {
      figma.ui.postMessage({
        type: 'frame-png-exported',
        payload: { error: 'Frame not found or invalid' },
      });
      return;
    }

    // Export frame as PNG
    const pngData = await (frameNode as FrameNode).exportAsync({
      format: 'PNG',
      constraint: { type: 'SCALE', value: 2 }, // 2x for better quality
    });

    // Convert Uint8Array to base64
    const base64 = figma.base64Encode(pngData);

    // Extract structural hints for editable layout system
    const structuralHints = extractStructuralHints(frameNode as FrameNode);

    figma.ui.postMessage({
      type: 'frame-png-exported',
      payload: {
        imageData: base64,
        frameId: frameNode.id,
        structuralHints, // Include structural hints
      },
    });

  } catch (error) {
    console.error('Error exporting frame PNG:', error);
    figma.ui.postMessage({
      type: 'frame-png-exported',
      payload: { error: 'Failed to export frame as PNG' },
    });
  }
}

/**
 * Handles export frame to JSON request
 * Downloads the selected frame as a JSON file
 */
async function handleExportFrameJson() {
  const selection = figma.currentPage.selection;

  if (selection.length === 0) {
    figma.ui.postMessage({
      type: 'generation-error',
      payload: { error: 'Please select a frame to export' },
    });
    return;
  }

  const selectedNode = selection[0];

  if (selectedNode.type !== 'FRAME') {
    figma.ui.postMessage({
      type: 'generation-error',
      payload: { error: 'Please select a frame (not a component or other node type)' },
    });
    return;
  }

  try {
    const serializedFrame = await serializeFrame(selectedNode as FrameNode);

    figma.ui.postMessage({
      type: 'frame-json-exported',
      payload: {
        json: serializedFrame,
        fileName: `${selectedNode.name.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.json`
      },
    });
  } catch (error) {
    console.error('Error exporting frame:', error);
    figma.ui.postMessage({
      type: 'generation-error',
      payload: { error: error instanceof Error ? error.message : 'Failed to export frame' },
    });
  }
}

/**
 * Serializes a FrameNode into a lightweight JSON structure
 */
async function serializeFrame(frame: FrameNode): Promise<any> {
  const children = await Promise.all(frame.children.map(child => serializeNode(child)));

  return {
    name: frame.name,
    type: frame.type,
    layoutMode: frame.layoutMode,
    primaryAxisSizingMode: frame.primaryAxisSizingMode,
    counterAxisSizingMode: frame.counterAxisSizingMode,
    primaryAxisAlignItems: frame.primaryAxisAlignItems,
    counterAxisAlignItems: frame.counterAxisAlignItems,
    paddingLeft: frame.paddingLeft,
    paddingRight: frame.paddingRight,
    paddingTop: frame.paddingTop,
    paddingBottom: frame.paddingBottom,
    itemSpacing: frame.itemSpacing,
    fills: frame.fills && Array.isArray(frame.fills) ? frame.fills.map((fill: any) => ({
      type: fill.type,
      color: fill.color,
    })) : [],
    cornerRadius: typeof frame.cornerRadius === 'number' ? frame.cornerRadius : undefined,
    children: children,
  };
}

/**
 * Serializes a child node (recursive)
 */
async function serializeNode(node: SceneNode): Promise<any> {
  const baseData: any = {
    name: node.name,
    type: node.type,
  };

  // Handle component instances
  if (node.type === 'INSTANCE') {
    const instance = node as InstanceNode;
    const mainComponent = await instance.getMainComponentAsync();
    baseData.componentKey = mainComponent?.key || '';
    baseData.componentName = mainComponent?.name || instance.name;

    // Capture current text in component instance
    const textNodes = instance.findAll((n) => n.type === 'TEXT') as TextNode[];
    if (textNodes.length > 0) {
      baseData.text = textNodes[0].characters; // Capture first text node
    }
  }

  // Handle text nodes
  if (node.type === 'TEXT') {
    const textNode = node as TextNode;
    baseData.text = textNode.characters;
  }

  // Handle frames with auto layout
  if (node.type === 'FRAME') {
    const frameNode = node as FrameNode;
    baseData.layoutMode = frameNode.layoutMode;
    baseData.itemSpacing = frameNode.itemSpacing;
    baseData.paddingLeft = frameNode.paddingLeft;
    baseData.paddingRight = frameNode.paddingRight;
    baseData.paddingTop = frameNode.paddingTop;
    baseData.paddingBottom = frameNode.paddingBottom;
    baseData.children = await Promise.all(frameNode.children.map(child => serializeNode(child)));
  }

  return baseData;
}

// ============================================================================
// Editable Layout System Functions (Milestone A)
// ============================================================================

/**
 * Extract structural hints from a frame for iteration context
 * Provides semantic information without perfect serialization
 */
async function extractStructuralHints(frameNode: FrameNode): Promise<any> {
  const children = frameNode.children;
  const usesAutoLayout = frameNode.layoutMode !== 'NONE';

  // Extract children hints with tiering
  let childrenHints: any;

  if (children.length <= 20) {
    // Full detail for small frames
    childrenHints = await Promise.all(children.map(child => extractChildInfo(child)));
  } else {
    // Pattern detection for large frames
    const pattern = await detectRepeatingPattern(children);
    if (pattern) {
      childrenHints = {
        summary: `List of ${children.length} ${pattern.type} items`,
        example: await extractChildInfo(children[0]),
        count: children.length
      };
    } else {
      // Mixed content - show first 10 + summary
      const first10 = await Promise.all(children.slice(0, 10).map(child => extractChildInfo(child)));
      childrenHints = [
        ...first10,
        { summary: `...and ${children.length - 10} more children` }
      ];
    }
  }

  // Extract used components and text styles
  const usedComponents = new Set<string>();
  const usedTextStyles = new Set<string>();

  async function scanNode(node: SceneNode) {
    if (node.type === 'INSTANCE') {
      const instance = node as InstanceNode;
      try {
        const mainComponent = await instance.getMainComponentAsync();
        if (mainComponent) {
          usedComponents.add(mainComponent.name);
        }
      } catch (e) {
        // Component not found, skip
      }
    }
    if (node.type === 'TEXT') {
      const textNode = node as TextNode;
      if (textNode.textStyleId && typeof textNode.textStyleId === 'string') {
        try {
          const textStyle = figma.getStyleById(textNode.textStyleId);
          if (textStyle) {
            usedTextStyles.add(textStyle.name);
          }
        } catch (e) {
          // Style not found, skip
        }
      }
    }
    if ('children' in node) {
      for (const child of node.children) {
        await scanNode(child);
      }
    }
  }

  await scanNode(frameNode);

  // Get fill style name if present
  let fillStyleName: string | undefined;
  if (frameNode.fillStyleId) {
    try {
      const fillStyle = figma.getStyleById(frameNode.fillStyleId as string);
      if (fillStyle) {
        fillStyleName = fillStyle.name;
      }
    } catch (e) {
      // Style not found
    }
  }

  return {
    hintsVersion: '1.0',
    frameName: frameNode.name,
    usesAutoLayout,
    layoutMode: frameNode.layoutMode,
    itemSpacing: frameNode.itemSpacing,
    padding: {
      top: frameNode.paddingTop,
      right: frameNode.paddingRight,
      bottom: frameNode.paddingBottom,
      left: frameNode.paddingLeft
    },
    children: childrenHints,
    usedComponents: Array.from(usedComponents),
    usedTextStyles: Array.from(usedTextStyles),
    fillStyleName
  };
}

/**
 * Extract basic info about a single child node
 */
async function extractChildInfo(child: SceneNode): Promise<any> {
  const info: any = {
    type: child.type,
    name: child.name
  };

  if (child.type === 'INSTANCE') {
    const instance = child as InstanceNode;
    info.isComponent = true;
    try {
      const mainComponent = await instance.getMainComponentAsync();
      info.componentName = mainComponent?.name;
    } catch (e) {
      // Component not found
      info.componentName = 'unknown';
    }
  }

  if (child.type === 'TEXT') {
    const textNode = child as TextNode;
    info.text = textNode.characters.substring(0, 100); // Truncate long text
  }

  return info;
}

/**
 * Detect if children follow a repeating pattern
 */
async function detectRepeatingPattern(children: readonly SceneNode[]): Promise<{ type: string } | null> {
  if (children.length < 3) return null;

  // Check if most children are the same type
  const typeCounts = new Map<string, number>();
  for (const child of children) {
    let key: string = child.type;
    if (child.type === 'INSTANCE') {
      const instance = child as InstanceNode;
      try {
        const mainComponent = await instance.getMainComponentAsync();
        key = `INSTANCE:${mainComponent?.name || 'unknown'}`;
      } catch (e) {
        key = 'INSTANCE:unknown';
      }
    }
    typeCounts.set(key, (typeCounts.get(key) || 0) + 1);
  }

  // Find most common type
  let maxCount = 0;
  let maxType = '';
  for (const [type, count] of typeCounts) {
    if (count > maxCount) {
      maxCount = count;
      maxType = type;
    }
  }

  // If >70% are the same type, consider it a pattern
  if (maxCount / children.length > 0.7) {
    return { type: maxType.replace('INSTANCE:', '') };
  }

  return null;
}

/**
 * Construct Figma layout from JSON structure (Milestone A - exact matching only)
 */
async function constructFigmaLayout(structure: any, designSystem: any): Promise<SceneNode> {
  switch (structure.type) {
    case 'FRAME':
      return await buildFrameNode(structure, designSystem);
    case 'COMPONENT':
      return await instantiateComponent(structure, designSystem);
    case 'TEXT':
      return buildTextNode(structure, designSystem);
    default:
      throw new Error(`Unknown node type: ${structure.type}`);
  }
}

/**
 * Build a FRAME node with Auto Layout
 */
async function buildFrameNode(spec: any, designSystem: any): Promise<FrameNode> {
  const frame = figma.createFrame();
  frame.name = spec.name;

  // Apply Auto Layout if specified
  if (spec.layoutMode && spec.layoutMode !== 'NONE') {
    frame.layoutMode = spec.layoutMode;

    if (spec.itemSpacing !== undefined) {
      frame.itemSpacing = spec.itemSpacing;
    }

    if (spec.padding) {
      frame.paddingTop = spec.padding.top || 0;
      frame.paddingRight = spec.padding.right || 0;
      frame.paddingBottom = spec.padding.bottom || 0;
      frame.paddingLeft = spec.padding.left || 0;
    }

    if (spec.primaryAxisAlignItems) {
      frame.primaryAxisAlignItems = spec.primaryAxisAlignItems;
    }

    if (spec.counterAxisAlignItems) {
      frame.counterAxisAlignItems = spec.counterAxisAlignItems;
    }
  }

  // Apply fill style if specified
  if (spec.fillStyleName) {
    const colorStyle = designSystem.colors.find((c: any) => c.name === spec.fillStyleName);
    if (colorStyle) {
      try {
        const style = figma.getStyleById(colorStyle.id);
        if (style && style.type === 'PAINT') {
          frame.fillStyleId = style.id;
        }
      } catch (e) {
        console.warn(`Fill style not found: ${spec.fillStyleName}`);
      }
    }
  }

  // Recursively build children (ASYNC)
  if (spec.children && Array.isArray(spec.children)) {
    for (const childSpec of spec.children) {
      try {
        const childNode = await constructFigmaLayout(childSpec, designSystem);
        frame.appendChild(childNode);
      } catch (error) {
        console.error(`Failed to create child: ${error}`);
        // Continue with other children
      }
    }
  }

  return frame;
}

/**
 * Create a fallback frame when a component is not found
 * TODO: Milestone B - Replace with styled archetype-based fallback
 */
function createFallbackFrame(spec: any): FrameNode {
  const frame = figma.createFrame();
  frame.name = `[Missing] ${spec.componentName}`;
  frame.resize(200, 48);

  // Add visible warning
  frame.fills = [{
    type: 'SOLID',
    color: { r: 1, g: 0.9, b: 0.9 }, // Light red background
  }];

  frame.strokes = [{
    type: 'SOLID',
    color: { r: 1, g: 0, b: 0 }, // Red border
  }];
  frame.strokeWeight = 2;

  const text = figma.createText();
  text.characters = `⚠️ ${spec.componentName}`;
  text.x = 8;
  text.y = 16;

  frame.appendChild(text);

  return frame;
}

/**
 * Find similar component names (for debugging)
 */
function findSimilarNames(searchName: string, components: ComponentData[]): string[] {
  const lower = searchName.toLowerCase();
  return components
    .filter(c => c.name.toLowerCase().includes(lower))
    .slice(0, 5)
    .map(c => c.name);
}

/**
 * Instantiate a COMPONENT node (Milestone A - exact match only)
 */
async function instantiateComponent(spec: any, designSystem: any): Promise<InstanceNode | FrameNode> {
  // Find component by exact name match
  const component = designSystem.components.find((c: any) => c.name === spec.componentName);

  if (!component) {
    console.error(`❌ Component not found: "${spec.componentName}"`);
    debugLog(`📋 Available components (first 20):`,
      designSystem.components.slice(0, 20).map((c: any) => c.name));

    const similar = findSimilarNames(spec.componentName, designSystem.components);
    if (similar.length > 0) {
      debugLog(`💡 Did you mean one of these?`, similar);
    }

    // Return fallback instead of throwing
    return createFallbackFrame(spec);
  }

  // Get component from Figma (ASYNC)
  const componentNode = await figma.getNodeByIdAsync(component.id);
  if (!componentNode || (componentNode.type !== 'COMPONENT' && componentNode.type !== 'COMPONENT_SET')) {
    console.error(`❌ Component node not found or invalid: ${spec.componentName}`);
    return createFallbackFrame(spec);
  }

  // Create instance
  let instance: InstanceNode;
  if (componentNode.type === 'COMPONENT') {
    instance = (componentNode as ComponentNode).createInstance();
  } else {
    // Component set - use default variant
    const componentSet = componentNode as ComponentSetNode;
    const defaultComponent = componentSet.defaultVariant as ComponentNode;
    instance = defaultComponent.createInstance();
  }

  instance.name = spec.name;

  // Apply text override if specified
  if (spec.text) {
    // Find text nodes within the instance
    const textNodes = instance.findAll(n => n.type === 'TEXT') as TextNode[];
    if (textNodes.length > 0) {
      // Override the first text node (simple approach for Milestone A)
      const textNode = textNodes[0];
      try {
        textNode.characters = spec.text;
      } catch (error) {
        console.warn(`Could not override text: ${error}`);
      }
    }
  }

  return instance;
}

/**
 * Build a TEXT node
 */
function buildTextNode(spec: any, designSystem: any): TextNode {
  const textNode = figma.createText();
  textNode.name = spec.name;

  // Load font before setting characters
  figma.loadFontAsync(textNode.fontName as FontName).then(() => {
    textNode.characters = spec.text;

    // Apply text style if specified
    if (spec.textStyleName) {
      const textStyle = designSystem.textStyles.find((ts: any) => ts.name === spec.textStyleName);
      if (textStyle) {
        try {
          const style = figma.getStyleById(textStyle.id);
          if (style && style.type === 'TEXT') {
            textNode.textStyleId = style.id;
          }
        } catch (e) {
          console.warn(`Text style not found: ${spec.textStyleName}`);
        }
      }
    }
  }).catch(error => {
    console.error('Failed to load font:', error);
    // Set text anyway with default font
    textNode.characters = spec.text;
  });

  return textNode;
}

/**
 * Handles iteration request - applies changes to selected frame
 */
async function handleIterateDesign(payload: any) {
  console.log('Handling SVG iteration request...', payload);

  const { svg, frameId, mode } = payload;

  console.log('Frame ID:', frameId);
  console.log('SVG length:', svg ? svg.length : 0);
  console.log('Iteration mode:', mode);

  if (!frameId) {
    console.log('ERROR: No frame ID provided');
    figma.ui.postMessage({
      type: 'iteration-error',
      payload: { error: 'No frame ID provided' },
    });
    return;
  }

  if (!svg) {
    console.log('ERROR: No SVG content provided');
    figma.ui.postMessage({
      type: 'iteration-error',
      payload: { error: 'No SVG content provided' },
    });
    return;
  }

  // Find the frame by ID
  const frame = await figma.getNodeByIdAsync(frameId);

  if (!frame || frame.type !== 'FRAME') {
    console.log('ERROR: Frame not found or invalid');
    figma.ui.postMessage({
      type: 'iteration-error',
      payload: { error: 'Frame not found or invalid' },
    });
    return;
  }

  try {
    console.log('Applying SVG...');
    const frameNode = frame as FrameNode;

    if (mode === 'new') {
      // Create new frame next to selected frame
      console.log('Creating new frame next to selected...');

      const svgNode = figma.createNodeFromSvg(svg);

      // Create new frame to hold the SVG
      const newFrame = figma.createFrame();
      newFrame.name = `${frameNode.name} (Iteration)`;
      newFrame.appendChild(svgNode);
      newFrame.resize(svgNode.width, svgNode.height);

      // Position next to the original frame with some spacing
      newFrame.x = frameNode.x + frameNode.width + 100;
      newFrame.y = frameNode.y;

      // Add to same parent
      if (frameNode.parent && frameNode.parent.type !== 'PAGE') {
        (frameNode.parent as FrameNode).appendChild(newFrame);
      }

      // Select the new frame
      figma.currentPage.selection = [newFrame];
      figma.viewport.scrollAndZoomIntoView([newFrame]);

      console.log('New frame created successfully');
      figma.ui.postMessage({
        type: 'iteration-complete',
        payload: { message: 'New iteration design created next to original' },
      });
    } else {
      // Replace mode - update existing frame
      console.log('Replacing existing frame contents...');

      const { x, y, name } = frameNode;

      console.log('Removing old children...');
      frameNode.children.forEach(child => child.remove());

      console.log('Importing new SVG...');
      const svgNode = figma.createNodeFromSvg(svg);
      frameNode.appendChild(svgNode);

      // Restore frame properties
      frameNode.name = name;
      frameNode.x = x;
      frameNode.y = y;

      // Resize frame to fit SVG content
      frameNode.resize(svgNode.width, svgNode.height);

      console.log('Frame replaced successfully');
      figma.ui.postMessage({
        type: 'iteration-complete',
        payload: { message: 'Design iteration applied successfully' },
      });
    }

    console.log('SVG iteration complete');
  } catch (error) {
    console.error('Error applying SVG iteration:', error);
    figma.ui.postMessage({
      type: 'iteration-error',
      payload: { error: error instanceof Error ? error.message : 'Failed to apply SVG iteration' },
    });
  }
}

/**
 * Handles iteration variation generation (multiple iterations side-by-side)
 */
async function handleIterateDesignVariation(payload: any) {
  const { figmaStructure, reasoning, frameId, variationIndex, totalVariations, designSystem } = payload;

  if (!frameId || !figmaStructure) {
    console.log('ERROR: Missing frameId or figmaStructure');
    figma.ui.postMessage({
      type: 'iteration-error',
      payload: {
        error: 'Missing frameId or figmaStructure',
        variationIndex,
      },
    });
    return;
  }

  if (!designSystem) {
    console.log('ERROR: Missing designSystem');
    figma.ui.postMessage({
      type: 'iteration-error',
      payload: {
        error: 'Missing designSystem',
        variationIndex,
      },
    });
    return;
  }

  // Find the original frame
  const originalFrame = await figma.getNodeByIdAsync(frameId);

  if (!originalFrame || originalFrame.type !== 'FRAME') {
    console.log('ERROR: Original frame not found');
    figma.ui.postMessage({
      type: 'iteration-error',
      payload: {
        error: 'Original frame not found',
        variationIndex,
      },
    });
    return;
  }

  try {
    const frameNode = originalFrame as FrameNode;

    // Initialize session if it doesn't exist yet
    if (!currentIterationSession) {
      currentIterationSession = {
        createdFrames: [],
        totalVariations: totalVariations,
      };
    }

    // Send status update: rendering (creating in Figma)
    console.log(`Creating variation ${variationIndex + 1} in Figma...`);
    figma.ui.postMessage({
      type: 'variation-status-update',
      payload: {
        variationIndex,
        status: 'rendering',
        statusText: 'Creating in Figma',
      },
    });

    // Construct the editable layout
    const layoutNode = await constructFigmaLayout(figmaStructure, designSystem);

    if (layoutNode.type !== 'FRAME') {
      throw new Error('Root structure must be a FRAME');
    }

    const newFrame = layoutNode as FrameNode;
    newFrame.name = `${frameNode.name} (Iteration ${variationIndex + 1})`;

    // Position to the right of the original frame, with spacing between variations
    const spacing = 100;
    newFrame.x = frameNode.x + frameNode.width + spacing + (variationIndex * (frameNode.width + spacing));
    newFrame.y = frameNode.y;

    // Add to same parent as original frame
    if (frameNode.parent && frameNode.parent.type !== 'PAGE') {
      (frameNode.parent as FrameNode).appendChild(newFrame);
    } else {
      figma.currentPage.appendChild(newFrame);
    }

    // Store the newly created frame in the session
    currentIterationSession.createdFrames.push(newFrame);

    // Clear selection to prevent automatic selection of newly created frame
    isUpdatingSelectionProgrammatically = true;
    figma.currentPage.selection = [];
    isUpdatingSelectionProgrammatically = false;

    // Send status update: complete
    console.log(`✅ Variation ${variationIndex + 1} created successfully`);
    figma.ui.postMessage({
      type: 'variation-status-update',
      payload: {
        variationIndex,
        status: 'complete',
        statusText: 'Iteration Complete',
        reasoning: reasoning || undefined,
        createdNodeId: newFrame.id,
      },
    });

    // Check if ALL variations have been created (not just if this is the last index)
    if (currentIterationSession.createdFrames.length === totalVariations) {
      console.log(`✨ ${totalVariations} iteration${totalVariations > 1 ? 's' : ''} created successfully`);

      // Clear the session
      currentIterationSession = null;

      // Notify UI that all variations are complete
      figma.ui.postMessage({
        type: 'all-variations-complete',
        payload: {
          totalVariations,
          completedCount: totalVariations,
        },
      });
    }
  } catch (error) {
    console.error('Error creating iteration variation:', error);

    // Send error status update for this specific variation
    figma.ui.postMessage({
      type: 'variation-status-update',
      payload: {
        variationIndex,
        status: 'error',
        statusText: 'Error when trying to create the design',
        error: error instanceof Error ? error.message : 'Failed to create iteration variation',
      },
    });
  }
}

/**
 * Applies iteration changes to a frame
 */
async function applyIteration(frame: FrameNode, updatedLayout: any) {
  console.log('Applying iteration to frame:', frame.name);
  console.log('Updated layout from Claude:', JSON.stringify(updatedLayout, null, 2));

  // Apply top-level properties
  // AUTO LAYOUT: Enforce Auto Layout - never allow NONE
  if (updatedLayout.layoutMode) {
    const layoutMode = updatedLayout.layoutMode !== 'NONE' ? updatedLayout.layoutMode : 'VERTICAL';
    frame.layoutMode = layoutMode;
  } else if (frame.layoutMode === 'NONE') {
    // If frame currently has no layout mode, set it to VERTICAL
    frame.layoutMode = 'VERTICAL';
  }

  if (updatedLayout.primaryAxisSizingMode) {
    frame.primaryAxisSizingMode = updatedLayout.primaryAxisSizingMode;
  }

  if (updatedLayout.counterAxisSizingMode) {
    frame.counterAxisSizingMode = updatedLayout.counterAxisSizingMode;
  }

  if (updatedLayout.primaryAxisAlignItems) {
    frame.primaryAxisAlignItems = updatedLayout.primaryAxisAlignItems;
  }

  if (updatedLayout.counterAxisAlignItems) {
    frame.counterAxisAlignItems = sanitizeCounterAxisAlignItems(updatedLayout.counterAxisAlignItems);
  }

  if (typeof updatedLayout.itemSpacing === 'number') {
    frame.itemSpacing = updatedLayout.itemSpacing;
  }

  if (typeof updatedLayout.paddingLeft === 'number') {
    frame.paddingLeft = updatedLayout.paddingLeft;
  }

  if (typeof updatedLayout.paddingRight === 'number') {
    frame.paddingRight = updatedLayout.paddingRight;
  }

  if (typeof updatedLayout.paddingTop === 'number') {
    frame.paddingTop = updatedLayout.paddingTop;
  }

  if (typeof updatedLayout.paddingBottom === 'number') {
    frame.paddingBottom = updatedLayout.paddingBottom;
  }

  if (typeof updatedLayout.cornerRadius === 'number') {
    frame.cornerRadius = updatedLayout.cornerRadius;
  }

  // Apply fills if provided
  if (updatedLayout.fills && Array.isArray(updatedLayout.fills)) {
    frame.fills = updatedLayout.fills;
  }

  // Apply changes to children
  if (updatedLayout.children && Array.isArray(updatedLayout.children)) {
    // Create a map of existing children by name
    const existingChildren = new Map<string, SceneNode>();
    frame.children.forEach(child => {
      existingChildren.set(child.name, child);
    });

    // Track which children are in the updated layout
    const updatedChildNames = new Set(updatedLayout.children.map((c: any) => c.name));

    // Remove children that are no longer in the layout
    for (const [name, child] of existingChildren) {
      if (!updatedChildNames.has(name)) {
        console.log('Removing child:', name);
        child.remove();
      }
    }

    // Process each child in the updated layout (in order)
    const processedChildren: SceneNode[] = [];
    for (const updatedChild of updatedLayout.children) {
      const existingChild = existingChildren.get(updatedChild.name);

      if (existingChild) {
        // Update existing child
        await applyIterationToChild(frame, updatedChild, existingChild);
        processedChildren.push(existingChild);
      } else {
        // Create new child
        console.log('Adding new child:', updatedChild.name, 'Type:', updatedChild.type);
        const newChild = await createNodeFromLayout(updatedChild);
        if (newChild) {
          frame.appendChild(newChild);
          processedChildren.push(newChild);
          console.log('Successfully added new child:', updatedChild.name);
        } else {
          console.error('Failed to create new child:', updatedChild.name, 'Data:', JSON.stringify(updatedChild));
        }
      }
    }

    // Reorder children to match the updated layout
    processedChildren.forEach((child, index) => {
      frame.insertChild(index, child);
    });
  }
}

/**
 * Applies iteration changes to a child node
 */
async function applyIterationToChild(parent: FrameNode, updatedChild: any, child: SceneNode) {
  // Child is now passed in, no need to find it

  // Apply layout properties if it's a frame
  if (child.type === 'FRAME' && 'layoutMode' in child) {
    const frameChild = child as FrameNode;

    // AUTO LAYOUT: Enforce Auto Layout - never allow NONE
    if (updatedChild.layoutMode) {
      const layoutMode = updatedChild.layoutMode !== 'NONE' ? updatedChild.layoutMode : 'VERTICAL';
      frameChild.layoutMode = layoutMode;
    } else if (frameChild.layoutMode === 'NONE') {
      // If frame currently has no layout mode, set it to VERTICAL
      frameChild.layoutMode = 'VERTICAL';
    }

    if (typeof updatedChild.itemSpacing === 'number') {
      frameChild.itemSpacing = updatedChild.itemSpacing;
    }

    if (typeof updatedChild.paddingLeft === 'number') {
      frameChild.paddingLeft = updatedChild.paddingLeft;
    }

    if (typeof updatedChild.paddingRight === 'number') {
      frameChild.paddingRight = updatedChild.paddingRight;
    }

    if (typeof updatedChild.paddingTop === 'number') {
      frameChild.paddingTop = updatedChild.paddingTop;
    }

    if (typeof updatedChild.paddingBottom === 'number') {
      frameChild.paddingBottom = updatedChild.paddingBottom;
    }

    // Recursively apply to nested children (use the same logic as parent)
    if (updatedChild.children && Array.isArray(updatedChild.children)) {
      const existingNestedChildren = new Map<string, SceneNode>();
      frameChild.children.forEach(c => existingNestedChildren.set(c.name, c));

      const updatedNestedNames = new Set(updatedChild.children.map((c: any) => c.name));

      // Remove children not in updated layout
      for (const [name, c] of existingNestedChildren) {
        if (!updatedNestedNames.has(name)) {
          c.remove();
        }
      }

      // Process nested children
      const processedNested: SceneNode[] = [];
      for (const nestedChild of updatedChild.children) {
        const existingNested = existingNestedChildren.get(nestedChild.name);
        if (existingNested) {
          await applyIterationToChild(frameChild, nestedChild, existingNested);
          processedNested.push(existingNested);
        } else {
          console.log('Adding new nested child:', nestedChild.name, 'Type:', nestedChild.type);
          const newNested = await createNodeFromLayout(nestedChild);
          if (newNested) {
            frameChild.appendChild(newNested);
            processedNested.push(newNested);
            console.log('Successfully added nested child:', nestedChild.name);
          } else {
            console.error('Failed to create nested child:', nestedChild.name, 'Data:', JSON.stringify(nestedChild));
          }
        }
      }

      // Reorder
      processedNested.forEach((c, i) => frameChild.insertChild(i, c));
    }
  }

  // Apply text changes if it's a text node
  if (child.type === 'TEXT' && updatedChild.text !== undefined) {
    const textChild = child as TextNode;
    const fallbackFonts = [
      textChild.fontName as FontName, // Original font
      { family: 'Inter', style: 'Regular' },
      { family: 'Roboto', style: 'Regular' },
      { family: 'Arial', style: 'Regular' },
    ];

    let updated = false;
    for (const font of fallbackFonts) {
      try {
        await figma.loadFontAsync(font);
        const oldText = textChild.characters;
        textChild.characters = updatedChild.text;
        const newText = textChild.characters;
        if (font === textChild.fontName) {
          console.log(`✓ Updated text node "${child.name}": "${oldText}" → "${newText}"`);
        } else {
          console.log(`✓ Updated text node "${child.name}" with fallback font: "${oldText}" → "${newText}"`);
        }
        updated = true;
        break;
      } catch (error) {
        continue; // Try next font
      }
    }

    if (!updated) {
      console.error(`✗ Failed to update text node "${child.name}" - no available fonts`);
    }
  }

  // Apply text changes to component instances
  if (child.type === 'INSTANCE' && updatedChild.text !== undefined) {
    console.log(`Updating component instance text: ${child.name} -> "${updatedChild.text}"`);
    await setComponentText(child as InstanceNode, updatedChild.text);
  }
}

// ============================================================================
// MVP ITERATION HANDLER
// ============================================================================

/**
 * Handles iteration variation using the new MVP pipeline with frame-scoped components
 */
async function handleIterateDesignVariationMVP(payload: any) {
  const { instructions, frameId, variationIndex, totalVariations, model } = payload;

  if (!frameId) {
    console.log('ERROR: Missing frameId');
    figma.ui.postMessage({
      type: 'iteration-error',
      payload: { error: 'Missing frameId', variationIndex },
    });
    return;
  }

  // Find the original frame
  const originalFrame = await figma.getNodeByIdAsync(frameId);

  if (!originalFrame || originalFrame.type !== 'FRAME') {
    console.log('ERROR: Original frame not found');
    figma.ui.postMessage({
      type: 'iteration-error',
      payload: { error: 'Original frame not found', variationIndex },
    });
    return;
  }

  try {
    const frameNode = originalFrame as FrameNode;

    // Initialize session if it doesn't exist yet
    if (!currentIterationSession) {
      currentIterationSession = {
        createdFrames: [],
        totalVariations: totalVariations,
      };
    }

    // Send status update: designing
    console.log(`✨ Creating variation ${variationIndex + 1} using MVP pipeline...`);
    figma.ui.postMessage({
      type: 'variation-status-update',
      payload: {
        variationIndex,
        status: 'designing',
        statusText: 'Designing with AI',
      },
    });

    // 1. Build frame snapshot (structural understanding)
    console.log("📸 Building frame snapshot...");
    const frameSnapshot = buildFrameSnapshot(frameNode, 5);
    console.log(`  → ${frameSnapshot.children.length} top-level nodes captured`);

    // 2. Extract frame-scoped design palette
    console.log("🎨 Extracting design palette...");
    const designPalette = await extractFrameScopedPalette(frameNode);
    console.log(`  → ${designPalette.components.length} components in palette`);

    // 3. Export frame as PNG
    console.log("🖼️  Exporting frame to PNG...");
    const pngBytes = await frameNode.exportAsync({
      format: "PNG",
      constraint: { type: "SCALE", value: 1 }, // 1x scale for speed
    });
    const imagePNG = btoa(String.fromCharCode(...pngBytes));
    console.log(`  → ${Math.round(imagePNG.length / 1024)} KB`);

    // 4. Send to backend
    console.log(`🚀 Sending to ${model}...`);
    const backendURL = 'https://crafter-ai-kappa.vercel.app'; // Change to your backend URL
    const request: IterationRequestMVP = {
      frameSnapshot,
      designPalette,
      imagePNG,
      instructions: instructions || "Create a variation of this design",
      model: model || "claude",
    };

    const response = await fetch(`${backendURL}/api/iterate-mvp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Backend error: ${error}`);
    }

    const result: IterationResponseMVP = await response.json();
    console.log(`✅ Received response: ${result.reasoning}`);

    // 5. Reconstruct variation in Figma
    console.log("🔨 Reconstructing variation...");
    const newFrame = await reconstructVariationMVP(
      result.figmaStructure,
      designPalette
    );

    newFrame.name = `${frameNode.name} (Iteration ${variationIndex + 1})`;

    // 6. Position relative to original + offset for variation index
    const spacing = 100;
    newFrame.x = frameNode.x + frameNode.width + spacing + (variationIndex * (frameNode.width + spacing));
    newFrame.y = frameNode.y;

    // 7. Add to canvas
    figma.currentPage.appendChild(newFrame);

    // Store the newly created frame in the session
    currentIterationSession.createdFrames.push(newFrame);

    // Clear selection to prevent automatic selection of newly created frame
    isUpdatingSelectionProgrammatically = true;
    figma.currentPage.selection = [];
    isUpdatingSelectionProgrammatically = false;

    // Send status update: complete
    console.log(`✅ Variation ${variationIndex + 1} created successfully`);
    figma.ui.postMessage({
      type: 'variation-status-update',
      payload: {
        variationIndex,
        status: 'complete',
        statusText: 'Iteration Complete',
        reasoning: result.reasoning || undefined,
        createdNodeId: newFrame.id,
      },
    });

    // Check if ALL variations have been created
    if (currentIterationSession.createdFrames.length === totalVariations) {
      console.log(`✨ ${totalVariations} iteration${totalVariations > 1 ? 's' : ''} created successfully`);

      // Clear the session
      currentIterationSession = null;

      // Notify UI that all variations are complete
      figma.ui.postMessage({
        type: 'all-variations-complete',
        payload: {
          totalVariations,
          completedCount: totalVariations,
        },
      });
    }
  } catch (error) {
    console.error('Error creating iteration variation:', error);

    // Send error status update for this specific variation
    figma.ui.postMessage({
      type: 'variation-status-update',
      payload: {
        variationIndex,
        status: 'error',
        statusText: 'Error when trying to create the design',
        error: error instanceof Error ? error.message : 'Failed to create iteration variation',
      },
    });
  }
}
