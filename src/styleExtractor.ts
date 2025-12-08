// ============================================================================
// STYLE EXTRACTOR - Extract visual style from selected frame
// ============================================================================

/**
 * Extracted style guide from a frame
 */
export interface ExtractedStyle {
  colors: {
    primary: string;
    secondary: string;
    text: string;
    background: string;
  };
  typography: {
    sizes: number[];
    weights: string[];
    families: string[];
  };
  spacing: {
    padding: number[];
    gaps: number[];
  };
  layout: {
    containerWidths: number[];
    commonLayouts: string[];
  };
}

/**
 * Default style values (used when frame has no discernible style)
 */
const DEFAULT_STYLE: ExtractedStyle = {
  colors: {
    primary: '#000000',
    secondary: '#666666',
    text: '#000000',
    background: '#FFFFFF',
  },
  typography: {
    sizes: [14, 16, 18, 24, 32],
    weights: ['normal', 'semibold', 'bold'],
    families: ['Inter'],
  },
  spacing: {
    padding: [8, 16, 24, 32, 48],
    gaps: [8, 12, 16, 24, 32],
  },
  layout: {
    containerWidths: [320, 768, 1024, 1440],
    commonLayouts: ['VERTICAL', 'HORIZONTAL'],
  }
};

/**
 * Validate frame before style extraction
 */
export function validateFrameForExtraction(node: SceneNode): {
  valid: boolean;
  error?: string;
} {
  if (node.type !== 'FRAME') {
    return {
      valid: false,
      error: `Please select a frame, not a ${node.type}. Convert to frame first if needed.`
    };
  }

  if (node.children.length === 0) {
    return {
      valid: false,
      error: 'Selected frame is empty. Please select a frame with content for style reference.'
    };
  }

  return { valid: true };
}

/**
 * Convert RGB color to hex string
 */
function rgbToHex(color: RGB): string {
  const r = Math.round(color.r * 255);
  const g = Math.round(color.g * 255);
  const b = Math.round(color.b * 255);
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

/**
 * Normalize values by clustering similar ones
 * Clusters values within 10% of each other
 */
function normalizeValues(values: number[], maxCount: number = 5): number[] {
  if (values.length === 0) return [];
  if (values.length <= maxCount) return [...new Set(values)].sort((a, b) => a - b);

  // Cluster similar values (within 10% of each other)
  const clusters: number[][] = [];
  const sorted = [...values].sort((a, b) => a - b);

  sorted.forEach(val => {
    const existingCluster = clusters.find(cluster => {
      const avg = cluster.reduce((sum, v) => sum + v, 0) / cluster.length;
      return Math.abs(val - avg) / Math.max(avg, 1) < 0.1; // within 10%
    });

    if (existingCluster) {
      existingCluster.push(val);
    } else {
      clusters.push([val]);
    }
  });

  // Take average of each cluster, sort by frequency, take top N
  const normalized = clusters
    .map(cluster => ({
      value: Math.round(cluster.reduce((sum, v) => sum + v, 0) / cluster.length),
      frequency: cluster.length
    }))
    .sort((a, b) => b.frequency - a.frequency)
    .slice(0, maxCount)
    .map(c => c.value)
    .sort((a, b) => a - b);

  return normalized;
}

/**
 * Find most common text color (darkest color, likely used for text)
 */
function findTextColor(colors: string[]): string {
  if (colors.length === 0) return DEFAULT_STYLE.colors.text;

  // Find darkest color (lowest luminance)
  let darkest = colors[0];
  let minLuminance = 1;

  colors.forEach(color => {
    const r = parseInt(color.slice(1, 3), 16) / 255;
    const g = parseInt(color.slice(3, 5), 16) / 255;
    const b = parseInt(color.slice(5, 7), 16) / 255;
    const luminance = 0.299 * r + 0.587 * g + 0.114 * b;

    if (luminance < minLuminance) {
      minLuminance = luminance;
      darkest = color;
    }
  });

  return darkest;
}

/**
 * Find most common background color (lightest color)
 */
function findBackgroundColor(colors: string[]): string {
  if (colors.length === 0) return DEFAULT_STYLE.colors.background;

  // Find lightest color (highest luminance)
  let lightest = colors[0];
  let maxLuminance = 0;

  colors.forEach(color => {
    const r = parseInt(color.slice(1, 3), 16) / 255;
    const g = parseInt(color.slice(3, 5), 16) / 255;
    const b = parseInt(color.slice(5, 7), 16) / 255;
    const luminance = 0.299 * r + 0.587 * g + 0.114 * b;

    if (luminance > maxLuminance) {
      maxLuminance = luminance;
      lightest = color;
    }
  });

  return lightest;
}

/**
 * Detect common layout patterns in frame
 */
function detectCommonLayouts(frame: FrameNode): string[] {
  const layouts = new Set<string>();

  function traverse(node: SceneNode) {
    if (node.type === 'FRAME' && 'layoutMode' in node && node.layoutMode !== 'NONE') {
      layouts.add(node.layoutMode);
    }

    if ('children' in node) {
      node.children.forEach(child => traverse(child));
    }
  }

  traverse(frame);

  return layouts.size > 0
    ? Array.from(layouts)
    : DEFAULT_STYLE.layout.commonLayouts;
}

/**
 * Extract style from a frame
 */
export function extractStyleFromFrame(frame: FrameNode): ExtractedStyle {
  try {
    const colors: string[] = [];
    const fontSizes: number[] = [];
    const fontWeights: string[] = [];
    const fontFamilies: string[] = [];
    const paddings: number[] = [];
    const gaps: number[] = [];

    // Traverse frame and collect style properties
    function traverse(node: SceneNode) {
      // Extract fills (colors)
      if ('fills' in node && Array.isArray(node.fills)) {
        node.fills.forEach(fill => {
          if (fill.type === 'SOLID' && fill.color) {
            colors.push(rgbToHex(fill.color));
          }
        });
      }

      // Extract text styles
      if (node.type === 'TEXT') {
        if (node.fontSize && typeof node.fontSize === 'number') {
          fontSizes.push(node.fontSize);
        }

        if (node.fontName && typeof node.fontName === 'object') {
          if (node.fontName.family) fontFamilies.push(node.fontName.family);
        }

        // Infer weight from style
        if (node.fontName && typeof node.fontName === 'object' && node.fontName.style) {
          const style = node.fontName.style.toLowerCase();
          if (style.includes('bold') || style.includes('heavy') || style.includes('black')) {
            fontWeights.push('bold');
          } else if (style.includes('semibold') || style.includes('semi bold')) {
            fontWeights.push('semibold');
          } else if (style.includes('medium')) {
            fontWeights.push('medium');
          } else {
            fontWeights.push('normal');
          }
        }

        // Extract text color
        if (Array.isArray(node.fills)) {
          node.fills.forEach(fill => {
            if (fill.type === 'SOLID' && fill.color) {
              colors.push(rgbToHex(fill.color));
            }
          });
        }
      }

      // Extract spacing from Auto Layout
      if (node.type === 'FRAME' && 'layoutMode' in node && node.layoutMode !== 'NONE') {
        if (node.itemSpacing) gaps.push(node.itemSpacing);
        if (node.paddingTop) paddings.push(node.paddingTop);
        if (node.paddingRight) paddings.push(node.paddingRight);
        if (node.paddingBottom) paddings.push(node.paddingBottom);
        if (node.paddingLeft) paddings.push(node.paddingLeft);
      }

      // Recurse into children
      if ('children' in node) {
        node.children.forEach(child => traverse(child));
      }
    }

    traverse(frame);

    // Check if we collected enough data
    const hasMinimalData =
      colors.length > 0 ||
      fontSizes.length > 0 ||
      paddings.length > 0;

    if (!hasMinimalData) {
      console.warn('⚠️  Selected frame has no discernible style, using defaults');
      return DEFAULT_STYLE;
    }

    // Build extracted style with fallbacks
    return {
      colors: {
        primary: colors[0] || DEFAULT_STYLE.colors.primary,
        secondary: colors[1] || DEFAULT_STYLE.colors.secondary,
        text: findTextColor(colors) || DEFAULT_STYLE.colors.text,
        background: findBackgroundColor(colors) || DEFAULT_STYLE.colors.background,
      },
      typography: {
        sizes: fontSizes.length > 0
          ? normalizeValues(fontSizes, 5)
          : DEFAULT_STYLE.typography.sizes,
        weights: fontWeights.length > 0
          ? [...new Set(fontWeights)].slice(0, 3)
          : DEFAULT_STYLE.typography.weights,
        families: fontFamilies.length > 0
          ? [...new Set(fontFamilies)].slice(0, 2)
          : DEFAULT_STYLE.typography.families,
      },
      spacing: {
        padding: paddings.length > 0
          ? normalizeValues(paddings, 4)
          : DEFAULT_STYLE.spacing.padding,
        gaps: gaps.length > 0
          ? normalizeValues(gaps, 4)
          : DEFAULT_STYLE.spacing.gaps,
      },
      layout: {
        containerWidths: frame.width > 0
          ? [Math.round(frame.width)]
          : DEFAULT_STYLE.layout.containerWidths,
        commonLayouts: detectCommonLayouts(frame),
      }
    };

  } catch (error) {
    console.error('Error extracting style:', error);
    console.warn('Using default style values');
    return DEFAULT_STYLE;
  }
}
