/**
 * Schema Expander - Converts simplified JSON to full Figma properties
 *
 * Simplified schema has 80% fewer properties for faster AI generation.
 * This expander applies smart defaults and converts to full Figma Auto Layout.
 */

import { LayoutNode, DesignSystemData } from './types';

interface SimplifiedNode {
  type: string;
  name?: string;
  layout?: 'vertical' | 'horizontal' | 'none';
  spacing?: number;
  gap?: number; // alias for spacing
  padding?: number | { x?: number; y?: number; left?: number; right?: number; top?: number; bottom?: number };
  align?: 'start' | 'center' | 'end' | 'stretch' | 'space-between';
  bg?: string; // hex or named color
  radius?: number;
  children?: SimplifiedNode[];

  // Component-specific
  component?: string; // component name for fuzzy matching
  text?: string;
  fill?: boolean; // layoutGrow: 1

  // Text-specific
  style?: string; // text style name
  color?: string;

  // Spacer-specific
  size?: number | 'flex';
}

/**
 * Expand simplified layout to full Figma JSON
 */
export function expandSimplifiedLayout(
  simplified: any,
  designSystem?: DesignSystemData
): LayoutNode {
  // If already in full format, return as-is
  if (simplified.layoutMode || simplified.primaryAxisSizingMode) {
    return simplified as LayoutNode;
  }

  return expandNode(simplified, designSystem);
}

/**
 * Expand a single node
 */
function expandNode(node: SimplifiedNode, designSystem?: DesignSystemData): LayoutNode {
  const type = normalizeType(node.type);

  switch (type) {
    case 'FRAME':
      return expandFrameNode(node, designSystem);
    case 'COMPONENT_INSTANCE':
      return expandComponentNode(node, designSystem);
    case 'TEXT':
      return expandTextNode(node);
    case 'RECTANGLE':
      return expandSpacerNode(node);
    default:
      console.warn(`Unknown node type: ${node.type}, treating as FRAME`);
      return expandFrameNode(node, designSystem);
  }
}

/**
 * Normalize type from simplified to Figma
 */
function normalizeType(type: string): string {
  const typeMap: Record<string, string> = {
    'frame': 'FRAME',
    'Frame': 'FRAME',
    'FRAME': 'FRAME',
    'component': 'COMPONENT_INSTANCE',
    'Component': 'COMPONENT_INSTANCE',
    'COMPONENT_INSTANCE': 'COMPONENT_INSTANCE',
    'INSTANCE': 'COMPONENT_INSTANCE',
    'text': 'TEXT',
    'Text': 'TEXT',
    'TEXT': 'TEXT',
    'spacer': 'RECTANGLE',
    'Spacer': 'RECTANGLE',
  };

  return typeMap[type] || 'FRAME';
}

/**
 * Expand frame node
 */
function expandFrameNode(node: SimplifiedNode, designSystem?: DesignSystemData): LayoutNode {
  const layout = node.layout || 'vertical';
  const spacing = node.spacing ?? node.gap ?? 16;
  const padding = expandPadding(node.padding);
  const alignment = expandAlignment(node.align || 'start');
  const fills = expandBackground(node.bg);

  const expanded: LayoutNode = {
    type: 'FRAME',
    name: node.name || 'Container',
    layoutMode: layout === 'horizontal' ? 'HORIZONTAL' : 'VERTICAL',
    primaryAxisSizingMode: 'AUTO',
    counterAxisSizingMode: 'AUTO',
    primaryAxisAlignItems: alignment.primary,
    counterAxisAlignItems: alignment.counter,
    itemSpacing: spacing,
    paddingLeft: padding.left,
    paddingRight: padding.right,
    paddingTop: padding.top,
    paddingBottom: padding.bottom,
    fills,
    cornerRadius: node.radius || 0,
    children: (node.children || []).map(child => expandNode(child, designSystem)),
  };

  // Add layoutGrow if fill is true
  if (node.fill) {
    expanded.layoutGrow = 1;
  }

  return expanded;
}

/**
 * Expand component instance node
 */
function expandComponentNode(node: SimplifiedNode, designSystem?: DesignSystemData): LayoutNode {
  const componentName = node.component || node.name || 'Component';

  // Fuzzy match component
  const matchedComponent = designSystem
    ? fuzzyMatchComponent(componentName, designSystem.components)
    : null;

  const expanded: LayoutNode = {
    type: 'COMPONENT_INSTANCE',
    name: node.name || componentName,
    componentKey: matchedComponent?.key || '',
    componentName: matchedComponent?.name || componentName,
  };

  // Add text override if provided
  if (node.text) {
    expanded.text = node.text;
  }

  // Add layoutGrow if fill is true
  if (node.fill) {
    expanded.layoutGrow = 1;
  }

  return expanded;
}

/**
 * Expand text node
 */
function expandTextNode(node: SimplifiedNode): LayoutNode {
  const expanded: LayoutNode = {
    type: 'TEXT',
    name: node.name || 'Text',
    text: node.text || '',
  };

  // TODO: Add text style lookup if node.style is provided
  // TODO: Add color if node.color is provided

  return expanded;
}

/**
 * Expand spacer node (rectangle for spacing)
 */
function expandSpacerNode(node: SimplifiedNode): LayoutNode {
  const size = typeof node.size === 'number' ? node.size : 24;
  const isFlex = node.size === 'flex';

  return {
    type: 'RECTANGLE',
    name: 'Spacer',
    width: size,
    height: size,
    fills: [], // transparent
    layoutGrow: isFlex ? 1 : 0,
  };
}

/**
 * Expand padding
 */
function expandPadding(padding: SimplifiedNode['padding']): {
  left: number;
  right: number;
  top: number;
  bottom: number;
} {
  if (typeof padding === 'number') {
    return { left: padding, right: padding, top: padding, bottom: padding };
  }

  if (typeof padding === 'object' && padding !== null) {
    const { x, y, left, right, top, bottom } = padding;
    return {
      left: left ?? x ?? 0,
      right: right ?? x ?? 0,
      top: top ?? y ?? 0,
      bottom: bottom ?? y ?? 0,
    };
  }

  return { left: 0, right: 0, top: 0, bottom: 0 };
}

/**
 * Expand alignment
 */
function expandAlignment(align: string): {
  primary: 'MIN' | 'CENTER' | 'MAX' | 'SPACE_BETWEEN';
  counter: 'MIN' | 'CENTER' | 'MAX' | 'STRETCH';
} {
  const alignMap: Record<string, { primary: any; counter: any }> = {
    'start': { primary: 'MIN', counter: 'MIN' },
    'center': { primary: 'CENTER', counter: 'CENTER' },
    'end': { primary: 'MAX', counter: 'MAX' },
    'stretch': { primary: 'MIN', counter: 'STRETCH' },
    'space-between': { primary: 'SPACE_BETWEEN', counter: 'MIN' },
  };

  return alignMap[align] || { primary: 'MIN', counter: 'MIN' };
}

/**
 * Expand background color
 */
function expandBackground(bg?: string): Array<{ type: 'SOLID'; color: { r: number; g: number; b: number } }> {
  if (!bg || bg === 'transparent') {
    return [];
  }

  // Named colors
  const namedColors: Record<string, string> = {
    'white': '#ffffff',
    'black': '#000000',
    'gray-50': '#f9fafb',
    'gray-100': '#f3f4f6',
    'gray-200': '#e5e7eb',
  };

  const hexColor = namedColors[bg] || bg;
  const rgb = hexToRgb(hexColor);

  return [
    {
      type: 'SOLID',
      color: rgb,
    },
  ];
}

/**
 * Convert hex color to RGB (0-1 range)
 */
function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const cleanHex = hex.replace('#', '');
  const r = parseInt(cleanHex.substring(0, 2), 16) / 255;
  const g = parseInt(cleanHex.substring(2, 4), 16) / 255;
  const b = parseInt(cleanHex.substring(4, 6), 16) / 255;

  return { r, g, b };
}

/**
 * Fuzzy match component by name
 */
function fuzzyMatchComponent(
  name: string,
  components: Array<{ name: string; key: string }>
): { name: string; key: string } | null {
  if (components.length === 0) {
    return null;
  }

  const lowerName = name.toLowerCase();

  // 1. Exact match
  const exactMatch = components.find(c => c.name.toLowerCase() === lowerName);
  if (exactMatch) {
    return exactMatch;
  }

  // 2. Contains match
  const containsMatch = components.find(c => c.name.toLowerCase().includes(lowerName));
  if (containsMatch) {
    return containsMatch;
  }

  // 3. Levenshtein distance match (best match within threshold)
  let bestMatch = components[0];
  let bestDistance = levenshteinDistance(lowerName, bestMatch.name.toLowerCase());

  for (const component of components) {
    const distance = levenshteinDistance(lowerName, component.name.toLowerCase());
    if (distance < bestDistance) {
      bestDistance = distance;
      bestMatch = component;
    }
  }

  // Only accept if distance is reasonable (less than half the length)
  if (bestDistance < name.length / 2) {
    return bestMatch;
  }

  return null;
}

/**
 * Calculate Levenshtein distance between two strings
 */
function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = [];

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }

  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }

  return matrix[b.length][a.length];
}
