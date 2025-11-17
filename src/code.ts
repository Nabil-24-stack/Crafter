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

// Show the plugin UI
figma.showUI(__html__, { width: 400, height: 600 });

console.log('Crafter plugin loaded');

// Global state for tracking variations in current generation session
let currentVariationsSession: {
  basePosition: { x: number; y: number };
  createdNodes: SceneNode[];
  totalVariations: number;
  completedCount: number;
} | null = null;

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
  console.log('Received message:', msg.type);

  try {
    switch (msg.type) {
      case 'get-design-system':
        await handleGetDesignSystem();
        break;

      case 'get-selected-frame':
        await handleGetSelectedFrame();
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
 * Scans for all LOCAL component definitions in the current file
 */
async function handleGetDesignSystem() {
  console.log('Extracting design system from current file...');

  // Find all local component definitions (COMPONENT and COMPONENT_SET nodes)
  const allNodes = figma.root.findAll(
    (node) => node.type === 'COMPONENT' || node.type === 'COMPONENT_SET'
  );

  console.log(`Found ${allNodes.length} component nodes in file`);

  const allComponents: ComponentData[] = allNodes.map((node) => {
    // Both ComponentNode and ComponentSetNode have these properties
    const component = node as ComponentNode | ComponentSetNode;

    return {
      id: node.id,
      name: node.name,
      key: (node as any).key || node.id, // Use key if available, fallback to id
      description: (node as any).description || '',
      type: node.type as 'COMPONENT' | 'COMPONENT_SET',
      // Add size information
      width: Math.round(component.width),
      height: Math.round(component.height),
      // Infer category from component name
      category: inferComponentCategory(component.name),
    };
  });

  console.log(`Found ${allComponents.length} local components in file`);

  // Get local color styles using async version
  const localPaintStyles = await figma.getLocalPaintStylesAsync();
  const colorStyles: ColorStyle[] = localPaintStyles
    .map((style) => {
      // Extract solid color if available
      const paints = style.paints;
      if (paints.length > 0 && paints[0].type === 'SOLID') {
        const solidPaint = paints[0] as SolidPaint;
        return {
          id: style.id,
          name: style.name,
          color: {
            r: solidPaint.color.r,
            g: solidPaint.color.g,
            b: solidPaint.color.b,
            a: solidPaint.opacity !== undefined ? solidPaint.opacity : 1,
          },
        };
      }
      return null;
    })
    .filter((style): style is NonNullable<typeof style> => style !== null);

  // Get local text styles using async version
  const localTextStyles = await figma.getLocalTextStylesAsync();
  const textStyles: TextStyle[] = localTextStyles.map((style) => ({
    id: style.id,
    name: style.name,
    fontSize: style.fontSize as number,
    fontFamily: style.fontName.family,
    fontWeight: style.fontName.style === 'Bold' ? 700 : 400,
  }));

  const designSystem: DesignSystemData = {
    components: allComponents,
    colors: colorStyles,
    textStyles: textStyles,
  };

  console.log('Design system extracted:', {
    totalComponents: allComponents.length,
    colorsCount: colorStyles.length,
    textStylesCount: textStyles.length,
  });

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
 */
async function handleGenerateSingleVariation(payload: {
  variation: { layout: LayoutNode; reasoning?: string };
  variationIndex: number;
  totalVariations: number;
}) {
  console.log(`Generating variation ${payload.variationIndex + 1} of ${payload.totalVariations} on canvas...`);

  const { variation, variationIndex, totalVariations } = payload;
  const { layout, reasoning } = variation;
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

    // Create the layout node
    const rootNode = await createNodeFromLayout(layout);

    if (rootNode) {
      // Add to current page
      figma.currentPage.appendChild(rootNode);

      // Update the name to include variation number
      rootNode.name = `${layout.name} - Variation ${variationIndex + 1}`;

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
 */
async function handleGetSelectedFrame() {
  console.log('Getting selected frame...');

  const selection = figma.currentPage.selection;

  if (selection.length === 0) {
    figma.ui.postMessage({
      type: 'selected-frame-data',
      payload: { frame: null, message: 'No frame selected' },
    });
    return;
  }

  const selectedNode = selection[0];

  // Check if it's a frame
  if (selectedNode.type !== 'FRAME') {
    figma.ui.postMessage({
      type: 'selected-frame-data',
      payload: { frame: null, message: 'Selected node is not a frame' },
    });
    return;
  }

  // Serialize the frame
  const serializedFrame = await serializeFrame(selectedNode as FrameNode);

  figma.ui.postMessage({
    type: 'selected-frame-data',
    payload: { frame: serializedFrame, frameId: selectedNode.id },
  });
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

/**
 * Handles iteration request - applies changes to selected frame
 */
async function handleIterateDesign(payload: any) {
  console.log('Handling iteration request...');

  const { updatedLayout, frameId } = payload;

  if (!frameId) {
    figma.ui.postMessage({
      type: 'iteration-error',
      payload: { error: 'No frame ID provided' },
    });
    return;
  }

  // Find the frame by ID
  const frame = await figma.getNodeByIdAsync(frameId);

  if (!frame || frame.type !== 'FRAME') {
    figma.ui.postMessage({
      type: 'iteration-error',
      payload: { error: 'Frame not found or invalid' },
    });
    return;
  }

  try {
    // Apply the iteration changes
    await applyIteration(frame as FrameNode, updatedLayout);

    figma.ui.postMessage({
      type: 'iteration-complete',
      payload: { message: 'Design iteration applied successfully' },
    });

    console.log('Iteration applied successfully');
  } catch (error) {
    console.error('Error applying iteration:', error);
    figma.ui.postMessage({
      type: 'iteration-error',
      payload: { error: error instanceof Error ? error.message : 'Failed to apply iteration' },
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

// Listen for selection changes to update iteration mode
figma.on('selectionchange', async () => {
  const selection = figma.currentPage.selection;

  if (selection.length === 1 && selection[0].type === 'FRAME') {
    const frame = selection[0] as FrameNode;
    const serialized = await serializeFrame(frame);

    figma.ui.postMessage({
      type: 'selected-frame-data',
      payload: { frame: serialized, frameId: frame.id },
    });
  } else {
    figma.ui.postMessage({
      type: 'selected-frame-data',
      payload: { frame: null, message: selection.length === 0 ? 'No frame selected' : 'Selected node is not a frame' },
    });
  }
});
