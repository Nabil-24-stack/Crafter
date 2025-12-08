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

  // Determine sizing modes
  const primaryAxisSizingMode = styles.flexGrow === '1' ? 'AUTO' : 'FIXED';
  const counterAxisSizingMode = 'FIXED'; // Default

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

  // 2. Convert parsed tree to Figma nodes
  const rootFrame = await convertNodeToFigma(
    parsedTree,
    htmlLayout.componentMap,
    componentMap
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
  figmaComponentMap: Map<string, ComponentNode>
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

  // 2. Not a component - create a frame (container)
  const frame = figma.createFrame();
  frame.name = node.className || node.tagName;

  // 3. Apply CSS layout → Figma Auto Layout
  const layout = cssToFigmaLayout(node.styles);

  if (layout.layoutMode !== 'NONE') {
    frame.layoutMode = layout.layoutMode;
    frame.itemSpacing = layout.itemSpacing;
    frame.paddingTop = layout.padding.top;
    frame.paddingRight = layout.padding.right;
    frame.paddingBottom = layout.padding.bottom;
    frame.paddingLeft = layout.padding.left;
    frame.primaryAxisSizingMode = layout.primaryAxisSizingMode;
    frame.counterAxisSizingMode = layout.counterAxisSizingMode;

    if (layout.primaryAxisAlignItems) {
      frame.primaryAxisAlignItems = layout.primaryAxisAlignItems;
    }
    if (layout.counterAxisAlignItems) {
      frame.counterAxisAlignItems = layout.counterAxisAlignItems;
    }
  }

  // 4. Apply background color
  const bgColor = parseColor(node.styles.backgroundColor);
  if (bgColor) {
    frame.fills = [{ type: 'SOLID', color: bgColor }];
  }

  // 5. Apply border radius
  const borderRadius = parseCSSUnit(node.styles.borderRadius);
  if (borderRadius) {
    frame.cornerRadius = borderRadius;
  }

  // 6. Apply fixed size if specified
  const width = parseCSSUnit(node.styles.width);
  const height = parseCSSUnit(node.styles.height);
  if (width && height) {
    frame.resize(width, height);
  }

  // 7. Recursively convert children
  for (const child of node.children) {
    try {
      const childNode = await convertNodeToFigma(child, htmlComponentMap, figmaComponentMap);
      frame.appendChild(childNode);
    } catch (error) {
      console.warn(`  ⚠️  Failed to create child node:`, error);
    }
  }

  return frame;
}
