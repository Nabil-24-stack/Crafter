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
  try {
    // Safely extract fills, effects, and strokes (can be Symbol in some cases)
    const fills = Array.isArray(node.fills) ? node.fills as Paint[] : [];
    const effects = Array.isArray(node.effects) ? node.effects as Effect[] : [];
    const strokes = Array.isArray(node.strokes) ? node.strokes as Paint[] : [];

    // Extract dominant colors from component tree
    const colors = extractDominantColors(node, 3);

    // Extract shadow effects
    let shadowCSS: string | undefined;
    try {
      const shadow = effects.find(e => e && e.type === 'DROP_SHADOW' && e.visible);
      shadowCSS = shadow ? convertFigmaShadowToCSS(shadow as DropShadowEffect) : undefined;
    } catch (err) {
      // Ignore shadow extraction errors
    }

    // Extract border radius
    let radius = 0;
    try {
      radius = (node as any).cornerRadius || 0;
    } catch (err) {
      // Ignore radius extraction errors
    }

    // Extract stroke/border
    let strokeData: { color: string; width: number } | undefined;
    try {
      const hasStroke = strokes.length > 0 && strokes[0] && strokes[0].visible;
      if (hasStroke && strokes[0].type === 'SOLID') {
        strokeData = {
          color: rgbToHex((strokes[0] as SolidPaint).color),
          width: (node.strokeWeight as number) || 1
        };
      }
    } catch (err) {
      // Ignore stroke extraction errors
    }

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
  } catch (error) {
    // If anything fails, return minimal visuals
    return {
      colors: []
    };
  }
}

/**
 * Extract 2-3 dominant colors from a node tree
 */
function extractDominantColors(node: SceneNode, maxColors = 3): string[] {
  const colorMap = new Map<string, number>();

  function traverse(n: SceneNode) {
    try {
      // Extract fills - safely check if it's an array
      if ('fills' in n && n.fills && Array.isArray(n.fills)) {
        const fills = n.fills as Paint[];
        fills.forEach(fill => {
          try {
            if (fill && fill.type === 'SOLID' && fill.visible !== false) {
              const hex = rgbToHex(fill.color);
              // Ignore white and very light grays (likely backgrounds)
              if (hex !== '#ffffff' && hex !== '#fafafa' && hex !== '#f5f5f5') {
                colorMap.set(hex, (colorMap.get(hex) || 0) + 1);
              }
            }
          } catch (err) {
            // Skip this fill if there's an error
          }
        });
      }

      // Recursively traverse children
      if ('children' in n) {
        (n as ChildrenMixin).children.forEach(child => traverse(child));
      }
    } catch (err) {
      // Skip this node if there's an error
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
 * Safely convert value to string
 */
function safeString(value: any): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return String(value);
  return ''; // Skip symbols and other types
}

/**
 * Extract layout tokens from frames in the file
 */
function extractLayoutTokens(): {
  containerWidths: number[];
  paddingScale: number[];
  gapScale: number[];
  layoutStyle: string;
} {
  try {
    const startTime = Date.now();

    // Find top-level frames that look like pages/screens
    const topFrames = figma.currentPage.findAll(node => {
      if (node.type !== 'FRAME') return false;
      const name = node.name.toLowerCase();
      return (
        name.includes('page') ||
        name.includes('screen') ||
        name.includes('dashboard') ||
        name.includes('layout') ||
        node.parent?.type === 'PAGE'
      );
    }) as FrameNode[];

    // Build histograms
    const widthMap = new Map<number, number>();
    const paddingMap = new Map<number, number>();
    const gapMap = new Map<number, number>();
    let cardLayoutCount = 0;
    let fullWidthCount = 0;

    topFrames.slice(0, 50).forEach(frame => {
      try {
        // Collect width (rounded to nearest 10)
        const width = Math.round(frame.width / 10) * 10;
        if (width > 0) {
          widthMap.set(width, (widthMap.get(width) || 0) + 1);
        }

        // Collect Auto Layout properties
        if ('layoutMode' in frame && frame.layoutMode !== 'NONE') {
          const paddings = [
            frame.paddingLeft,
            frame.paddingRight,
            frame.paddingTop,
            frame.paddingBottom
          ].filter((p): p is number => typeof p === 'number' && p > 0);

          paddings.forEach(p => {
            paddingMap.set(p, (paddingMap.get(p) || 0) + 1);
          });

          const gap = frame.itemSpacing as number;
          if (gap > 0) {
            gapMap.set(gap, (gapMap.get(gap) || 0) + 1);
          }
        }

        // Detect layout style - check if content is in cards
        const children = 'children' in frame ? frame.children : [];
        const hasCards = children.some(child => {
          if (child.type !== 'FRAME') return false;
          const childFrame = child as FrameNode;
          const radius = typeof childFrame.cornerRadius === 'number' ? childFrame.cornerRadius : 0;
          return (
            childFrame.fills &&
            Array.isArray(childFrame.fills) &&
            childFrame.fills.length > 0 &&
            radius > 0
          );
        });

        if (hasCards) {
          cardLayoutCount++;
        } else {
          fullWidthCount++;
        }
      } catch (err) {
        // Skip this frame
      }
    });

    // Get top 3 most common values
    const topWidths = Array.from(widthMap.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([w]) => w);

    const topPaddings = Array.from(paddingMap.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([p]) => p);

    const topGaps = Array.from(gapMap.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([g]) => g);

    // Determine layout style
    let layoutStyle = 'mixed';
    if (cardLayoutCount > fullWidthCount * 2) {
      layoutStyle = 'card-based (grouped content in rounded containers)';
    } else if (fullWidthCount > cardLayoutCount * 2) {
      layoutStyle = 'full-width (sections span entire width)';
    }

    const result = {
      containerWidths: topWidths.length > 0 ? topWidths : [1440],
      paddingScale: topPaddings.length > 0 ? topPaddings : [16, 24, 32],
      gapScale: topGaps.length > 0 ? topGaps : [16, 24],
      layoutStyle
    };

    const endTime = Date.now();
    console.log(`⏱️ Layout token extraction took ${endTime - startTime}ms`);

    return result;
  } catch (error) {
    console.warn('Error extracting layout tokens:', error);
    return {
      containerWidths: [1440],
      paddingScale: [16, 24, 32],
      gapScale: [16, 24],
      layoutStyle: 'mixed'
    };
  }
}

/**
 * Generate visual language description for AI prompts
 */
export function generateVisualLanguageDescription(
  components: Array<{ name: string; category?: string; visuals?: ComponentVisuals }>,
  colors: Array<{ name: string; hex: string }>,
  textStyles: Array<{ name: string; fontFamily: string; fontSize: number; fontWeight: number }>
): string {
  try {
    const lines: string[] = [];

    // Extract layout tokens
    const layoutTokens = extractLayoutTokens();

    // Primary colors - safely extract hex values
    const primaryColors = colors
      .slice(0, 8)
      .map(c => safeString(c.hex))
      .filter(hex => hex.length > 0)
      .join(', ');

    if (primaryColors) {
      lines.push(`PRIMARY COLORS: ${primaryColors}`);
      lines.push('');
    }

    // Layout preferences
    lines.push('LAYOUT PREFERENCES:');
    if (layoutTokens.containerWidths.length > 0) {
      const widths = layoutTokens.containerWidths.join('px, ') + 'px';
      lines.push(`- Container widths: ${widths}`);
    }
    if (layoutTokens.paddingScale.length > 0) {
      const paddings = layoutTokens.paddingScale.join('px, ') + 'px';
      lines.push(`- Common padding values: ${paddings}`);
    }
    if (layoutTokens.gapScale.length > 0) {
      const gaps = layoutTokens.gapScale.join('px, ') + 'px';
      lines.push(`- Common spacing between elements: ${gaps}`);
    }
    lines.push(`- Layout style: ${layoutTokens.layoutStyle}`);
    lines.push('');

    // Component visual characteristics grouped by category
    lines.push('COMPONENT VISUAL CHARACTERISTICS:');

    const categorized = new Map<string, Array<{ name: string; visuals?: ComponentVisuals }>>();
    components.forEach(comp => {
      try {
        const category = safeString(comp.category) || 'other';
        if (!categorized.has(category)) {
          categorized.set(category, []);
        }
        categorized.get(category)!.push(comp);
      } catch (err) {
        // Skip this component if there's an error
      }
    });

    // Describe visual characteristics for each category
    categorized.forEach((comps, category) => {
      try {
        const comp = comps[0]; // Use first component as representative
        if (!comp.visuals) return;

        const v = comp.visuals;
        const parts: string[] = [];

        if (v.colors && Array.isArray(v.colors) && v.colors.length > 0) {
          const colorStrs = v.colors.map(c => safeString(c)).filter(c => c.length > 0);
          if (colorStrs.length > 0) {
            parts.push(`colors: ${colorStrs.join(', ')}`);
          }
        }
        if (v.borderRadius && typeof v.borderRadius === 'number') {
          parts.push(`border-radius: ${v.borderRadius}px`);
        }
        if (v.shadow && typeof v.shadow === 'string') {
          parts.push(`shadow: ${safeString(v.shadow)}`);
        }
        if (v.stroke && typeof v.stroke.width === 'number') {
          parts.push(`border: ${v.stroke.width}px solid ${safeString(v.stroke.color)}`);
        }
        if (v.typography) {
          const t = v.typography;
          const fontFamily = safeString(t.fontFamily);
          const fontSize = safeString(t.fontSize);
          const fontWeight = safeString(t.fontWeight);
          if (fontFamily && fontSize && fontWeight) {
            parts.push(`font: ${fontFamily} ${fontSize}px/${fontWeight}`);
          }
        }
        if (v.spacing) {
          if (v.spacing.padding && typeof v.spacing.padding === 'number') {
            parts.push(`padding: ${v.spacing.padding}px`);
          }
          if (v.spacing.gap && typeof v.spacing.gap === 'number') {
            parts.push(`gap: ${v.spacing.gap}px`);
          }
        }

        if (parts.length > 0) {
          const categoryStr = safeString(category);
          if (categoryStr) {
            lines.push(`- ${categoryStr}: ${parts.join(', ')}`);
          }
        }
      } catch (err) {
        // Skip this category if there's an error
      }
    });

    lines.push('');

    // Typography styles
    lines.push('TYPOGRAPHY:');
    textStyles.slice(0, 6).forEach(style => {
      try {
        const name = safeString(style.name);
        const fontFamily = safeString(style.fontFamily);
        const fontSize = safeString(style.fontSize);
        const fontWeight = safeString(style.fontWeight);
        if (name && fontFamily && fontSize && fontWeight) {
          lines.push(`- ${name}: ${fontFamily} ${fontSize}px/${fontWeight}`);
        }
      } catch (err) {
        // Skip this style if there's an error
      }
    });

    return lines.join('\n');
  } catch (error) {
    // If visual language generation fails entirely, return minimal description
    console.error('Error generating visual language:', error);
    return 'PRIMARY COLORS: (unavailable)\n\nCOMPONENT VISUAL CHARACTERISTICS: (unavailable)\n\nTYPOGRAPHY: (unavailable)';
  }
}
