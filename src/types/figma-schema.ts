// ============================================================================
// Figma JSON Schema - Direct Figma Node Representation
// ============================================================================

/**
 * RGB color in 0-1 range (NOT 0-255)
 */
export interface RGBColor {
  r: number; // 0-1
  g: number; // 0-1
  b: number; // 0-1
}

/**
 * Solid fill (only type we support)
 */
export interface SolidFill {
  type: "SOLID";
  color: RGBColor;
}

/**
 * Frame node with Auto Layout support
 */
export interface FigmaFrameNode {
  type: "FRAME";
  name: string;

  // Auto Layout properties
  layoutMode?: "HORIZONTAL" | "VERTICAL" | "NONE";
  primaryAxisSizingMode?: "FIXED" | "AUTO";
  counterAxisSizingMode?: "FIXED" | "AUTO";

  // Dimensions
  width?: number;
  height?: number;

  // Spacing
  itemSpacing?: number; // gap between children
  paddingTop?: number;
  paddingRight?: number;
  paddingBottom?: number;
  paddingLeft?: number;

  // Alignment (only valid when layoutMode !== "NONE")
  primaryAxisAlignItems?: "MIN" | "CENTER" | "MAX" | "SPACE_BETWEEN";
  counterAxisAlignItems?: "MIN" | "CENTER" | "MAX";

  // Visual properties
  fills?: SolidFill[];
  cornerRadius?: number;

  // Children
  children: FigmaNode[];
}

/**
 * Text node
 */
export interface FigmaTextNode {
  type: "TEXT";
  name?: string;

  // Text content
  characters: string;

  // Typography
  fontSize?: number;
  fontFamily?: string;
  fontWeight?: "normal" | "medium" | "semibold" | "bold";

  // Visual properties
  fills?: SolidFill[];
  textAlignHorizontal?: "LEFT" | "CENTER" | "RIGHT";

  // Line height
  lineHeight?: number;
}

/**
 * Union type for all supported Figma nodes
 */
export type FigmaNode = FigmaFrameNode | FigmaTextNode;

/**
 * Type guard: check if node is a FrameNode
 */
export function isFrameNode(node: FigmaNode): node is FigmaFrameNode {
  return node.type === "FRAME";
}

/**
 * Type guard: check if node is a TextNode
 */
export function isTextNode(node: FigmaNode): node is FigmaTextNode {
  return node.type === "TEXT";
}

// ============================================================================
// Validation Constants
// ============================================================================

export const VALID_LAYOUT_MODES = ["HORIZONTAL", "VERTICAL", "NONE"] as const;
export const VALID_SIZING_MODES = ["FIXED", "AUTO"] as const;
export const VALID_FONT_WEIGHTS = ["normal", "medium", "semibold", "bold"] as const;
export const VALID_TEXT_ALIGN = ["LEFT", "CENTER", "RIGHT"] as const;
export const VALID_PRIMARY_ALIGN = ["MIN", "CENTER", "MAX", "SPACE_BETWEEN"] as const;
export const VALID_COUNTER_ALIGN = ["MIN", "CENTER", "MAX"] as const;

export type LayoutMode = typeof VALID_LAYOUT_MODES[number];
export type SizingMode = typeof VALID_SIZING_MODES[number];
export type FontWeight = typeof VALID_FONT_WEIGHTS[number];
export type TextAlign = typeof VALID_TEXT_ALIGN[number];
export type PrimaryAlign = typeof VALID_PRIMARY_ALIGN[number];
export type CounterAlign = typeof VALID_COUNTER_ALIGN[number];
