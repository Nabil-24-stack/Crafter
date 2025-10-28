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

      case 'generate-layout':
        await handleGenerateLayout(msg.payload);
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
 * Recursively creates Figma nodes from layout specification
 */
async function createNodeFromLayout(layoutNode: LayoutNode): Promise<SceneNode | null> {
  let node: SceneNode | null = null;

  switch (layoutNode.type) {
    case 'FRAME': {
      const frame = figma.createFrame();
      frame.name = layoutNode.name;

      // Set position (only for root/absolute positioned frames)
      if (layoutNode.x !== undefined) frame.x = layoutNode.x;
      if (layoutNode.y !== undefined) frame.y = layoutNode.y;

      // Apply Auto Layout if specified
      if (layoutNode.layoutMode && layoutNode.layoutMode !== 'NONE') {
        frame.layoutMode = layoutNode.layoutMode;

        // Set sizing modes
        if (layoutNode.primaryAxisSizingMode) {
          frame.primaryAxisSizingMode = layoutNode.primaryAxisSizingMode;
        }
        if (layoutNode.counterAxisSizingMode) {
          frame.counterAxisSizingMode = layoutNode.counterAxisSizingMode;
        }

        // Set alignment
        if (layoutNode.primaryAxisAlignItems) {
          frame.primaryAxisAlignItems = layoutNode.primaryAxisAlignItems;
        }
        if (layoutNode.counterAxisAlignItems) {
          frame.counterAxisAlignItems = layoutNode.counterAxisAlignItems;
        }

        // Set spacing
        if (layoutNode.itemSpacing !== undefined) {
          frame.itemSpacing = layoutNode.itemSpacing;
        }

        // Set padding
        if (layoutNode.paddingLeft !== undefined) frame.paddingLeft = layoutNode.paddingLeft;
        if (layoutNode.paddingRight !== undefined) frame.paddingRight = layoutNode.paddingRight;
        if (layoutNode.paddingTop !== undefined) frame.paddingTop = layoutNode.paddingTop;
        if (layoutNode.paddingBottom !== undefined) frame.paddingBottom = layoutNode.paddingBottom;

        // For auto layout, only set explicit size if FIXED mode
        if (layoutNode.width !== undefined && layoutNode.primaryAxisSizingMode === 'FIXED') {
          if (layoutNode.layoutMode === 'HORIZONTAL') {
            frame.resize(layoutNode.width, frame.height);
          }
        }
        if (layoutNode.height !== undefined && layoutNode.counterAxisSizingMode === 'FIXED') {
          if (layoutNode.layoutMode === 'HORIZONTAL') {
            frame.resize(frame.width, layoutNode.height);
          }
        }
        if (layoutNode.width !== undefined && layoutNode.counterAxisSizingMode === 'FIXED') {
          if (layoutNode.layoutMode === 'VERTICAL') {
            frame.resize(layoutNode.width, frame.height);
          }
        }
        if (layoutNode.height !== undefined && layoutNode.primaryAxisSizingMode === 'FIXED') {
          if (layoutNode.layoutMode === 'VERTICAL') {
            frame.resize(frame.width, layoutNode.height);
          }
        }
      } else {
        // No auto layout - use absolute positioning with explicit size
        if (layoutNode.width !== undefined && layoutNode.height !== undefined) {
          frame.resize(layoutNode.width, layoutNode.height);
        }
      }

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

            // Only set position if specified (for absolute positioning)
            // Auto layout children don't need x/y
            if (layoutNode.x !== undefined) instance.x = layoutNode.x;
            if (layoutNode.y !== undefined) instance.y = layoutNode.y;

            // Only resize if dimensions are explicitly specified
            // Otherwise let the component use its natural size
            if (layoutNode.width !== undefined && layoutNode.height !== undefined) {
              try {
                instance.resize(layoutNode.width, layoutNode.height);
              } catch (error) {
                // Some components can't be resized, that's ok
                console.log('Could not resize component instance:', layoutNode.name);
              }
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

      const width = layoutNode.width ?? 100;
      const height = layoutNode.height ?? 100;
      rect.resize(width, height);

      if (layoutNode.x !== undefined) rect.x = layoutNode.x;
      if (layoutNode.y !== undefined) rect.y = layoutNode.y;

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

      if (layoutNode.x !== undefined) text.x = layoutNode.x;
      if (layoutNode.y !== undefined) text.y = layoutNode.y;

      if (layoutNode.width !== undefined && layoutNode.height !== undefined) {
        text.resize(layoutNode.width, layoutNode.height);
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

  const width = layoutNode.width ?? 200;
  const height = layoutNode.height ?? 100;
  rect.resize(width, height);

  if (layoutNode.x !== undefined) rect.x = layoutNode.x;
  if (layoutNode.y !== undefined) rect.y = layoutNode.y;

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
  if (updatedLayout.layoutMode) {
    frame.layoutMode = updatedLayout.layoutMode;
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
    frame.counterAxisAlignItems = updatedLayout.counterAxisAlignItems;
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

    if (updatedChild.layoutMode) {
      frameChild.layoutMode = updatedChild.layoutMode;
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
