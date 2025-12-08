// ============================================================================
// HTML/CSS TO FIGMA CONVERTER
// ============================================================================

import { parse as parseHTML, HTMLElement as ParsedHTMLElement } from 'node-html-parser';
import * as csstree from 'css-tree';

/**
 * Parsed HTML node with computed CSS styles
 */
export interface ParsedNode {
  tagName: string;
  className: string;
  attributes: Record<string, string>;
  textContent?: string;  // Direct text content of this node
  children: ParsedNode[];
  styles: ComputedStyles;
}

/**
 * Computed CSS styles for a node
 */
export interface ComputedStyles {
  display?: string;
  flexDirection?: string;
  gap?: string;
  padding?: string;
  paddingTop?: string;
  paddingRight?: string;
  paddingBottom?: string;
  paddingLeft?: string;
  margin?: string;
  width?: string;
  height?: string;
  backgroundColor?: string;
  borderRadius?: string;
  justifyContent?: string;
  alignItems?: string;
  flexGrow?: string;
  flexShrink?: string;
  // Text styles
  color?: string;
  fontSize?: string;
  fontWeight?: string;
  fontFamily?: string;
  textAlign?: string;
  lineHeight?: string;
}

/**
 * CSS rule extracted from stylesheet
 */
interface CSSRule {
  selector: string;
  declarations: Record<string, string>;
}

/**
 * Parse CSS string into rules
 */
function parseCSS(cssString: string): CSSRule[] {
  const rules: CSSRule[] = [];

  try {
    const ast = csstree.parse(cssString);

    csstree.walk(ast, {
      visit: 'Rule',
      enter(node: any) {
        if (node.type === 'Rule' && node.prelude && node.block) {
          // Extract selector
          const selector = csstree.generate(node.prelude);

          // Extract declarations
          const declarations: Record<string, string> = {};

          csstree.walk(node.block, {
            visit: 'Declaration',
            enter(declNode: any) {
              if (declNode.type === 'Declaration') {
                const property = declNode.property;
                const value = csstree.generate(declNode.value);
                declarations[property] = value;
              }
            }
          });

          rules.push({ selector, declarations });
        }
      }
    });
  } catch (error) {
    console.warn('CSS parsing error:', error);
  }

  return rules;
}

/**
 * Apply CSS rules to an HTML element
 */
function computeStyles(
  element: ParsedHTMLElement,
  cssRules: CSSRule[]
): ComputedStyles {
  const styles: ComputedStyles = {};
  const className = element.getAttribute('class') || '';
  const classList = className.split(' ').filter(c => c.trim());

  // Apply styles from matching CSS rules
  for (const rule of cssRules) {
    // Simple class selector matching (.class-name)
    if (rule.selector.startsWith('.')) {
      const selectorClass = rule.selector.slice(1);
      if (classList.includes(selectorClass)) {
        Object.assign(styles, rule.declarations);
      }
    }

    // Tag selector matching (div, section, etc.)
    if (!rule.selector.startsWith('.') && !rule.selector.startsWith('#')) {
      if (element.tagName.toLowerCase() === rule.selector.toLowerCase()) {
        Object.assign(styles, rule.declarations);
      }
    }
  }

  return styles;
}

/**
 * Parse HTML with applied CSS styles
 */
export function parseHTMLWithStyles(html: string, css: string): ParsedNode {
  console.log('🔍 Parsing HTML...');
  const root = parseHTML(html);

  console.log('🎨 Parsing CSS...');
  const cssRules = parseCSS(css);
  console.log(`  → Found ${cssRules.length} CSS rules`);

  function traverseNode(element: ParsedHTMLElement): ParsedNode {
    const tagName = element.tagName || 'div';
    const className = element.getAttribute('class') || '';

    // Get all attributes
    const attributes: Record<string, string> = {};
    if (element.attributes) {
      Object.keys(element.attributes).forEach(key => {
        attributes[key] = element.getAttribute(key) || '';
      });
    }

    // Compute styles for this element
    const styles = computeStyles(element, cssRules);

    // Extract direct text content (not including children's text)
    let textContent: string | undefined;
    if (element.childNodes) {
      // Get only the direct text nodes, not nested element text
      const directTextNodes = element.childNodes.filter(
        node => node.nodeType === 3 // Text node
      );
      if (directTextNodes.length > 0) {
        textContent = directTextNodes
          .map(node => node.text || '')
          .join('')
          .trim();
        if (textContent === '') {
          textContent = undefined;
        }
      }
    }

    // Recursively traverse children
    const children: ParsedNode[] = [];
    if (element.childNodes) {
      for (const child of element.childNodes) {
        if (child.nodeType === 1) { // Element node
          children.push(traverseNode(child as ParsedHTMLElement));
        }
      }
    }

    return {
      tagName: tagName.toLowerCase(),
      className,
      attributes,
      textContent,
      styles,
      children
    };
  }

  // Find the root element (skip text nodes)
  const rootElement = root.childNodes.find(
    node => node.nodeType === 1
  ) as ParsedHTMLElement;

  if (!rootElement) {
    throw new Error('No root element found in HTML');
  }

  const parsed = traverseNode(rootElement);
  console.log(`✅ Parsed HTML tree with ${countNodes(parsed)} nodes`);

  return parsed;
}

/**
 * Count total nodes in tree
 */
function countNodes(node: ParsedNode): number {
  return 1 + node.children.reduce((sum, child) => sum + countNodes(child), 0);
}

/**
 * Convert CSS layout properties to Figma Auto Layout
 */
export function cssToFigmaLayout(styles: ComputedStyles): {
  layoutMode: 'HORIZONTAL' | 'VERTICAL' | 'NONE';
  itemSpacing: number;
  padding: { top: number; right: number; bottom: number; left: number };
  primaryAxisSizingMode: 'AUTO' | 'FIXED';
  counterAxisSizingMode: 'AUTO' | 'FIXED';
  primaryAxisAlignItems?: 'MIN' | 'CENTER' | 'MAX' | 'SPACE_BETWEEN';
  counterAxisAlignItems?: 'MIN' | 'CENTER' | 'MAX';
} {
  // Determine layout mode from display and flex-direction
  let layoutMode: 'HORIZONTAL' | 'VERTICAL' | 'NONE' = 'NONE';

  if (styles.display === 'flex') {
    if (styles.flexDirection === 'column' || styles.flexDirection === 'column-reverse') {
      layoutMode = 'VERTICAL';
    } else {
      layoutMode = 'HORIZONTAL'; // row is default
    }
  }

  // Extract gap (itemSpacing)
  const itemSpacing = parseCSSUnit(styles.gap);

  // Extract padding
  const padding = parsePadding(styles);

  // Sizing modes are now determined in convertNodeToFigma() based on context
  // Set to default values here (will be overridden)
  const primaryAxisSizingMode = 'FIXED';
  const counterAxisSizingMode = 'FIXED';

  // Map justify-content to primaryAxisAlignItems
  let primaryAxisAlignItems: 'MIN' | 'CENTER' | 'MAX' | 'SPACE_BETWEEN' | undefined;
  switch (styles.justifyContent) {
    case 'flex-start':
    case 'start':
      primaryAxisAlignItems = 'MIN';
      break;
    case 'center':
      primaryAxisAlignItems = 'CENTER';
      break;
    case 'flex-end':
    case 'end':
      primaryAxisAlignItems = 'MAX';
      break;
    case 'space-between':
      primaryAxisAlignItems = 'SPACE_BETWEEN';
      break;
  }

  // Map align-items to counterAxisAlignItems
  let counterAxisAlignItems: 'MIN' | 'CENTER' | 'MAX' | undefined;
  switch (styles.alignItems) {
    case 'flex-start':
    case 'start':
      counterAxisAlignItems = 'MIN';
      break;
    case 'center':
      counterAxisAlignItems = 'CENTER';
      break;
    case 'flex-end':
    case 'end':
      counterAxisAlignItems = 'MAX';
      break;
  }

  return {
    layoutMode,
    itemSpacing,
    padding,
    primaryAxisSizingMode,
    counterAxisSizingMode,
    primaryAxisAlignItems,
    counterAxisAlignItems
  };
}

/**
 * Parse CSS unit (px, rem, etc.) to number
 */
function parseCSSUnit(value: string | undefined): number {
  if (!value) return 0;

  // Remove 'px', 'rem', etc. and parse as float
  const num = parseFloat(value);

  // Convert rem to px (assuming 1rem = 16px)
  if (value.includes('rem')) {
    return num * 16;
  }

  return num || 0;
}

/**
 * Parse CSS padding shorthand to individual values
 */
function parsePadding(styles: ComputedStyles): {
  top: number;
  right: number;
  bottom: number;
  left: number;
} {
  // Individual properties take precedence
  if (styles.paddingTop || styles.paddingRight || styles.paddingBottom || styles.paddingLeft) {
    return {
      top: parseCSSUnit(styles.paddingTop),
      right: parseCSSUnit(styles.paddingRight),
      bottom: parseCSSUnit(styles.paddingBottom),
      left: parseCSSUnit(styles.paddingLeft)
    };
  }

  // Parse shorthand padding
  if (styles.padding) {
    const parts = styles.padding.trim().split(/\s+/);

    if (parts.length === 1) {
      // padding: 10px (all sides)
      const val = parseCSSUnit(parts[0]);
      return { top: val, right: val, bottom: val, left: val };
    } else if (parts.length === 2) {
      // padding: 10px 20px (top/bottom, left/right)
      const vertical = parseCSSUnit(parts[0]);
      const horizontal = parseCSSUnit(parts[1]);
      return { top: vertical, right: horizontal, bottom: vertical, left: horizontal };
    } else if (parts.length === 3) {
      // padding: 10px 20px 30px (top, left/right, bottom)
      return {
        top: parseCSSUnit(parts[0]),
        right: parseCSSUnit(parts[1]),
        bottom: parseCSSUnit(parts[2]),
        left: parseCSSUnit(parts[1])
      };
    } else if (parts.length === 4) {
      // padding: 10px 20px 30px 40px (top, right, bottom, left)
      return {
        top: parseCSSUnit(parts[0]),
        right: parseCSSUnit(parts[1]),
        bottom: parseCSSUnit(parts[2]),
        left: parseCSSUnit(parts[3])
      };
    }
  }

  return { top: 0, right: 0, bottom: 0, left: 0 };
}

/**
 * Parse CSS color to Figma RGB
 */
export function parseColor(cssColor: string | undefined): { r: number; g: number; b: number } | null {
  if (!cssColor) return null;

  // Hex color (#ffffff or #fff)
  if (cssColor.startsWith('#')) {
    let hex = cssColor.slice(1);

    // Expand shorthand (#fff -> #ffffff)
    if (hex.length === 3) {
      hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
    }

    const r = parseInt(hex.slice(0, 2), 16) / 255;
    const g = parseInt(hex.slice(2, 4), 16) / 255;
    const b = parseInt(hex.slice(4, 6), 16) / 255;

    return { r, g, b };
  }

  // rgb(255, 255, 255) or rgba(255, 255, 255, 1)
  const rgbMatch = cssColor.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (rgbMatch) {
    return {
      r: parseInt(rgbMatch[1]) / 255,
      g: parseInt(rgbMatch[2]) / 255,
      b: parseInt(rgbMatch[3]) / 255
    };
  }

  // Named colors (basic support)
  const namedColors: Record<string, string> = {
    'white': '#ffffff',
    'black': '#000000',
    'red': '#ff0000',
    'green': '#00ff00',
    'blue': '#0000ff',
    'yellow': '#ffff00',
    'cyan': '#00ffff',
    'magenta': '#ff00ff',
    'gray': '#808080',
    'grey': '#808080'
  };

  if (namedColors[cssColor.toLowerCase()]) {
    return parseColor(namedColors[cssColor.toLowerCase()]);
  }

  return null;
}

// ============================================================================
// TEXT NODE CREATION
// ============================================================================

/**
 * Create a Figma text node from HTML text content and CSS styles
 */
async function createTextNode(
  textContent: string,
  styles: ComputedStyles,
  nodeName: string
): Promise<TextNode> {
  const text = figma.createText();
  text.name = nodeName;

  // Load font before setting characters
  const fontFamily = styles.fontFamily?.replace(/['"]/g, '').split(',')[0].trim() || 'Inter';
  const fontWeight = styles.fontWeight === 'bold' || parseInt(styles.fontWeight || '400') >= 700 ? '700' : '400';

  try {
    await figma.loadFontAsync({ family: fontFamily, style: 'Regular' });
  } catch {
    // Fallback to Inter if custom font not available
    await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });
  }

  text.characters = textContent;

  // Apply font size
  const fontSize = parseCSSUnit(styles.fontSize);
  if (fontSize > 0) {
    text.fontSize = fontSize;
  } else {
    text.fontSize = 16; // Default
  }

  // Apply color
  const textColor = parseColor(styles.color);
  if (textColor) {
    text.fills = [{ type: 'SOLID', color: textColor }];
  }

  // Apply text alignment
  if (styles.textAlign) {
    switch (styles.textAlign) {
      case 'left':
        text.textAlignHorizontal = 'LEFT';
        break;
      case 'center':
        text.textAlignHorizontal = 'CENTER';
        break;
      case 'right':
        text.textAlignHorizontal = 'RIGHT';
        break;
    }
  }

  // Apply line height
  const lineHeight = parseCSSUnit(styles.lineHeight);
  if (lineHeight > 0) {
    text.lineHeight = { value: lineHeight, unit: 'PIXELS' };
  }

  return text;
}

// ============================================================================
// MAIN CONVERSION FUNCTION: HTML/CSS → Figma Nodes
// ============================================================================

/**
 * Convert HTML/CSS layout to Figma frame
 * This is the main entry point that replaces reconstructVariationMVP()
 */
export async function convertHTMLToFigma(
  htmlLayout: { html: string; css: string; componentMap: Record<string, { componentKey: string; componentName: string }> },
  componentMap: Map<string, ComponentNode>
): Promise<FrameNode> {
  console.log('🔨 Converting HTML/CSS to Figma...');

  // 1. Parse HTML with CSS styles applied
  const parsedTree = parseHTMLWithStyles(htmlLayout.html, htmlLayout.css);

  // 2. Convert parsed tree to Figma nodes (mark as root)
  const rootFrame = await convertNodeToFigma(
    parsedTree,
    htmlLayout.componentMap,
    componentMap,
    true  // isRoot = true for the top-level frame
  ) as FrameNode;

  console.log('✅ HTML/CSS conversion complete');

  return rootFrame;
}

/**
 * Recursively convert parsed HTML node to Figma node
 */
async function convertNodeToFigma(
  node: ParsedNode,
  htmlComponentMap: Record<string, { componentKey: string; componentName: string }>,
  figmaComponentMap: Map<string, ComponentNode>,
  isRoot: boolean = false
): Promise<SceneNode> {

  // 1. Check if this node maps to a design system component
  const classList = node.className.split(' ').filter(c => c.trim());

  for (const className of classList) {
    if (htmlComponentMap[className]) {
      const { componentKey, componentName } = htmlComponentMap[className];
      const component = figmaComponentMap.get(componentKey);

      if (component) {
        console.log(`  ✅ Creating instance: ${componentName} (${className})`);
        const instance = component.createInstance();
        instance.name = componentName;

        // Apply size from CSS if specified
        const width = parseCSSUnit(node.styles.width);
        const height = parseCSSUnit(node.styles.height);
        if (width && height) {
          instance.resize(width, height);
        }

        return instance;
      } else {
        console.warn(`  ⚠️  Component key "${componentKey}" not found in map`);
      }
    }
  }

  // 2. Check if this is a text-only node (h1, h2, p, span with text content)
  const textOnlyTags = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'span', 'label', 'a'];
  if (textOnlyTags.includes(node.tagName) && node.textContent && node.children.length === 0) {
    console.log(`  📝 Creating text node: ${node.textContent.substring(0, 30)}...`);
    const textNode = await createTextNode(
      node.textContent,
      node.styles,
      node.className || node.tagName
    );
    return textNode;
  }

  // 3. Not a component or text-only - create a frame (container)
  const frame = figma.createFrame();
  frame.name = node.className || node.tagName;

  // 4. Apply CSS layout → Figma Auto Layout
  const layout = cssToFigmaLayout(node.styles);

  if (layout.layoutMode !== 'NONE') {
    frame.layoutMode = layout.layoutMode;
    frame.itemSpacing = layout.itemSpacing;
    frame.paddingTop = layout.padding.top;
    frame.paddingRight = layout.padding.right;
    frame.paddingBottom = layout.padding.bottom;
    frame.paddingLeft = layout.padding.left;

    if (layout.primaryAxisAlignItems) {
      frame.primaryAxisAlignItems = layout.primaryAxisAlignItems;
    }
    if (layout.counterAxisAlignItems) {
      frame.counterAxisAlignItems = layout.counterAxisAlignItems;
    }
  }

  // 5. Apply background color
  const bgColor = parseColor(node.styles.backgroundColor);
  if (bgColor) {
    frame.fills = [{ type: 'SOLID', color: bgColor }];
  } else {
    // No explicit background - make frame transparent (visible in Figma but no fill)
    frame.fills = [];
  }

  // 6. Apply border radius
  const borderRadius = parseCSSUnit(node.styles.borderRadius);
  if (borderRadius) {
    frame.cornerRadius = borderRadius;
  }

  // 7. Determine frame sizing based on CSS
  const width = parseCSSUnit(node.styles.width);
  const height = parseCSSUnit(node.styles.height);
  const hasExplicitWidth = width > 0;
  const hasExplicitHeight = height > 0;

  // Special handling for root frame
  if (isRoot) {
    if (!hasExplicitWidth || !hasExplicitHeight) {
      // Root frame needs reasonable default size
      frame.resize(
        hasExplicitWidth ? width : 1200,
        hasExplicitHeight ? height : 800
      );
    } else {
      frame.resize(width, height);
    }

    // Root frame uses FIXED sizing
    if (layout.layoutMode !== 'NONE') {
      frame.primaryAxisSizingMode = 'FIXED';
      frame.counterAxisSizingMode = 'FIXED';
    }
  } else {
    // Non-root frames: intelligent sizing based on CSS and Auto Layout
    if (hasExplicitWidth && hasExplicitHeight) {
      // Both dimensions specified → FIXED sizing
      frame.resize(width, height);
      if (layout.layoutMode !== 'NONE') {
        frame.primaryAxisSizingMode = 'FIXED';
        frame.counterAxisSizingMode = 'FIXED';
      }
    } else if (layout.layoutMode !== 'NONE') {
      // Auto Layout enabled but no explicit size → AUTO (hug content) in Figma API
      // Note: Figma API uses 'AUTO' for what the UI calls "Hug"
      frame.primaryAxisSizingMode = 'AUTO';
      frame.counterAxisSizingMode = 'AUTO';

      // If width specified, fix the counter axis (for HORIZONTAL) or primary axis (for VERTICAL)
      if (hasExplicitWidth) {
        if (layout.layoutMode === 'HORIZONTAL') {
          frame.counterAxisSizingMode = 'FIXED';
          frame.resize(width, 100); // Temporary height, will adjust to content
        } else {
          frame.primaryAxisSizingMode = 'FIXED';
          frame.resize(width, 100);
        }
      }

      // If height specified, fix the appropriate axis
      if (hasExplicitHeight) {
        if (layout.layoutMode === 'VERTICAL') {
          frame.counterAxisSizingMode = 'FIXED';
          frame.resize(100, height); // Temporary width, will adjust to content
        } else {
          frame.primaryAxisSizingMode = 'FIXED';
          frame.resize(100, height);
        }
      }

      // Note: Figma's Auto Layout doesn't have a "FILL" mode for sizing
      // Instead, we use width/height to control fill behavior
      // For now, we'll keep AUTO (hug) as the default for responsive layouts
    } else {
      // No Auto Layout, need explicit size
      if (hasExplicitWidth && hasExplicitHeight) {
        frame.resize(width, height);
      } else {
        // Default size for non-auto-layout frames
        frame.resize(
          hasExplicitWidth ? width : 200,
          hasExplicitHeight ? height : 200
        );
      }
    }
  }

  // 7. Add direct text content if present (before children)
  if (node.textContent && node.children.length > 0) {
    // Frame has both text content and child elements
    // Create a text node for the direct text
    try {
      const textNode = await createTextNode(
        node.textContent,
        node.styles,
        `${node.className || node.tagName}-text`
      );
      frame.appendChild(textNode);
    } catch (error) {
      console.warn(`  ⚠️  Failed to create text node for "${node.textContent}":`, error);
    }
  }

  // 8. Recursively convert children
  for (const child of node.children) {
    try {
      const childNode = await convertNodeToFigma(child, htmlComponentMap, figmaComponentMap, false);
      frame.appendChild(childNode);
    } catch (error) {
      console.warn(`  ⚠️  Failed to create child node:`, error);
    }
  }

  // 9. Final size validation - ensure frame is visible
  if (frame.width === 0 || frame.height === 0) {
    console.warn(`  ⚠️  Frame "${frame.name}" has zero dimensions, applying minimum size`);
    frame.resize(
      Math.max(100, frame.width),
      Math.max(100, frame.height)
    );
  }

  return frame;
}
