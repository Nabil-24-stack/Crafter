/**
 * Visual Analyzer - Extracts visual properties from Figma components
 * Used to generate design system visual language for SVG generation
 */

export interface ComponentVisuals {
  colors: string[];              // Dominant colors (2-3 main colors)
  borderRadius?: number;         // Corner radius in px
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
  spacing?: {
    padding?: number;
    gap?: number;
  };
}

/**
 * Analyze visual properties of a component
 */
export function analyzeComponentVisuals(node: ComponentNode): ComponentVisuals {
  const fills = node.fills as Paint[];
  const effects = node.effects as Effect[];
  const strokes = node.strokes as Paint[];

  // Extract dominant colors from component tree
  const colors = extractDominantColors(node, 3);

  // Extract shadow effects
  const shadow = effects.find(e => e.type === 'DROP_SHADOW' && e.visible);
  const shadowCSS = shadow ? convertFigmaShadowToCSS(shadow as DropShadowEffect) : undefined;

  // Extract border radius
  const radius = (node as any).cornerRadius || 0;

  // Extract stroke/border
  const hasStroke = strokes.length > 0 && strokes[0].visible;
  const strokeData = hasStroke ? {
    color: rgbToHex((strokes[0] as SolidPaint).color),
    width: node.strokeWeight as number || 1
  } : undefined;

  // Extract typography from TEXT children
  const typography = extractTypography(node);

  // Extract spacing (if Auto Layout)
  const spacing = extractSpacing(node);

  return {
    colors,
    borderRadius: radius > 0 ? radius : undefined,
    shadow: shadowCSS,
    stroke: strokeData,
    typography,
    spacing
  };
}

/**
 * Extract 2-3 dominant colors from a node tree
 */
function extractDominantColors(node: SceneNode, maxColors = 3): string[] {
  const colorMap = new Map<string, number>();

  function traverse(n: SceneNode) {
    // Extract fills
    if ('fills' in n && n.fills) {
      const fills = n.fills as Paint[];
      fills.forEach(fill => {
        if (fill.type === 'SOLID' && fill.visible !== false) {
          const hex = rgbToHex(fill.color);
          // Ignore white and very light grays (likely backgrounds)
          if (hex !== '#ffffff' && hex !== '#fafafa' && hex !== '#f5f5f5') {
            colorMap.set(hex, (colorMap.get(hex) || 0) + 1);
          }
        }
      });
    }

    // Recursively traverse children
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
 * Extract typography from TEXT nodes in component
 */
function extractTypography(node: ComponentNode): ComponentVisuals['typography'] | undefined {
  const textNodes = node.findAll(n => n.type === 'TEXT') as TextNode[];

  if (textNodes.length === 0) {
    return undefined;
  }

  // Use the first text node as representative
  const textNode = textNodes[0];

  try {
    const fontSize = textNode.fontSize as number;
    const fontWeight = textNode.fontWeight as number;
    const fontFamily = textNode.fontName ? (textNode.fontName as FontName).family : 'Inter';

    // Extract text color
    const fills = textNode.fills as Paint[];
    const textColor = fills.length > 0 && fills[0].type === 'SOLID'
      ? rgbToHex((fills[0] as SolidPaint).color)
      : '#000000';

    return {
      fontSize,
      fontWeight,
      fontFamily,
      color: textColor
    };
  } catch (error) {
    console.warn('Error extracting typography:', error);
    return undefined;
  }
}

/**
 * Extract spacing from Auto Layout properties
 */
function extractSpacing(node: ComponentNode): ComponentVisuals['spacing'] | undefined {
  try {
    if ('layoutMode' in node && node.layoutMode !== 'NONE') {
      const padding = (node.paddingLeft as number) || 0;
      const gap = (node.itemSpacing as number) || 0;

      if (padding > 0 || gap > 0) {
        return {
          padding: padding > 0 ? padding : undefined,
          gap: gap > 0 ? gap : undefined
        };
      }
    }
  } catch (error) {
    console.warn('Error extracting spacing:', error);
  }

  return undefined;
}

/**
 * Convert Figma DROP_SHADOW effect to CSS box-shadow
 */
function convertFigmaShadowToCSS(shadow: DropShadowEffect): string {
  const { offset, radius, color } = shadow;
  const r = Math.round(color.r * 255);
  const g = Math.round(color.g * 255);
  const b = Math.round(color.b * 255);
  const a = color.a ?? 1;

  const rgba = `rgba(${r}, ${g}, ${b}, ${a.toFixed(2)})`;
  return `${offset.x}px ${offset.y}px ${radius}px ${rgba}`;
}

/**
 * Convert RGB (0-1 range) to hex color
 */
function rgbToHex(color: RGB): string {
  const r = Math.round(color.r * 255).toString(16).padStart(2, '0');
  const g = Math.round(color.g * 255).toString(16).padStart(2, '0');
  const b = Math.round(color.b * 255).toString(16).padStart(2, '0');
  return `#${r}${g}${b}`;
}

/**
 * Generate visual language description for AI prompts
 */
export function generateVisualLanguageDescription(
  components: Array<{ name: string; category: string; visuals?: ComponentVisuals }>,
  colors: Array<{ name: string; hex: string }>,
  textStyles: Array<{ name: string; fontFamily: string; fontSize: number; fontWeight: number }>
): string {
  const lines: string[] = [];

  // Primary colors
  const primaryColors = colors.slice(0, 8).map(c => c.hex).join(', ');
  lines.push(`PRIMARY COLORS: ${primaryColors}`);
  lines.push('');

  // Component visual characteristics grouped by category
  lines.push('COMPONENT VISUAL CHARACTERISTICS:');

  const categorized = new Map<string, Array<{ name: string; visuals?: ComponentVisuals }>>();
  components.forEach(comp => {
    const category = comp.category || 'other';
    if (!categorized.has(category)) {
      categorized.set(category, []);
    }
    categorized.get(category)!.push(comp);
  });

  // Describe visual characteristics for each category
  categorized.forEach((comps, category) => {
    const comp = comps[0]; // Use first component as representative
    if (!comp.visuals) return;

    const v = comp.visuals;
    const parts: string[] = [];

    if (v.colors.length > 0) {
      parts.push(`colors: ${v.colors.join(', ')}`);
    }
    if (v.borderRadius) {
      parts.push(`border-radius: ${v.borderRadius}px`);
    }
    if (v.shadow) {
      parts.push(`shadow: ${v.shadow}`);
    }
    if (v.stroke) {
      parts.push(`border: ${v.stroke.width}px solid ${v.stroke.color}`);
    }
    if (v.typography) {
      const t = v.typography;
      parts.push(`font: ${t.fontFamily} ${t.fontSize}px/${t.fontWeight}`);
    }
    if (v.spacing) {
      if (v.spacing.padding) parts.push(`padding: ${v.spacing.padding}px`);
      if (v.spacing.gap) parts.push(`gap: ${v.spacing.gap}px`);
    }

    if (parts.length > 0) {
      lines.push(`- ${category}: ${parts.join(', ')}`);
    }
  });

  lines.push('');

  // Typography styles
  lines.push('TYPOGRAPHY:');
  textStyles.slice(0, 6).forEach(style => {
    lines.push(`- ${style.name}: ${style.fontFamily} ${style.fontSize}px/${style.fontWeight}`);
  });

  return lines.join('\n');
}
