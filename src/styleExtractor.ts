// ============================================================================
// STYLE EXTRACTOR - Extract visual style from selected frame
// ============================================================================

/**
 * Structural element in the frame
 */
export interface StructuralElement {
  type: 'navigation' | 'header' | 'sidebar' | 'main-content' | 'footer' | 'card' | 'form' | 'unknown';
  name: string;
  nodeId: string; // NEW: Figma node ID for exact cloning
  role: 'shell' | 'content' | 'global-nav' | 'local-nav'; // NEW: Region role for preservation rules
  bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  children: number;
  hasText: boolean;
  isAutoLayout: boolean;
  styleToken?: string; // NEW: If this matches a known token
}

/**
 * Style token for consistent components
 */
export interface StyleToken {
  tokenId: string; // e.g., "button/primary", "card/default"
  nodeId: string; // Figma node ID that uses this token
}

/**
 * Structural context of the frame
 */
export interface StructuralContext {
  elements: StructuralElement[];
  layout: {
    type: 'sidebar-layout' | 'header-layout' | 'dashboard' | 'single-page' | 'unknown';
    hasNavigation: boolean;
    hasHeader: boolean;
    hasSidebar: boolean;
    hasFooter: boolean;
  };
  hierarchy: {
    topLevel: string[]; // Names of top-level sections
    contentArea: string | null; // Name of main content area
  };
  styleTokens: StyleToken[]; // NEW: Detected style tokens
}

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
  structure?: StructuralContext; // NEW: Structural context
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
 * Predefined style tokens (start small and stable)
 */
const STYLE_TOKEN_REGISTRY = {
  'button/primary': { matches: (node: SceneNode) => {
    const name = node.name.toLowerCase();
    return (name.includes('button') || name.includes('btn')) &&
           'fills' in node && Array.isArray(node.fills) && node.fills[0]?.type === 'SOLID';
  }},
  'button/secondary': { matches: (node: SceneNode) => {
    const name = node.name.toLowerCase();
    return (name.includes('button') || name.includes('btn')) &&
           name.includes('secondary');
  }},
  'card/default': { matches: (node: SceneNode) => {
    const name = node.name.toLowerCase();
    return name.includes('card') && 'cornerRadius' in node;
  }},
  'input/default': { matches: (node: SceneNode) => {
    const name = node.name.toLowerCase();
    return name.includes('input') || name.includes('field') || name.includes('textbox');
  }},
  'container/section': { matches: (node: SceneNode) => {
    return node.type === 'FRAME' && 'layoutMode' in node && node.layoutMode !== 'NONE';
  }}
};

/**
 * Detect style token for a node
 */
function detectStyleToken(node: SceneNode): string | undefined {
  for (const [tokenId, token] of Object.entries(STYLE_TOKEN_REGISTRY)) {
    if (token.matches(node)) {
      return tokenId;
    }
  }
  return undefined;
}

/**
 * Assign role to element based on type and name
 */
function assignElementRole(element: { type: string; name: string }): 'shell' | 'content' | 'global-nav' | 'local-nav' {
  const name = element.name.toLowerCase();
  const type = element.type;

  // Global navigation elements
  if (type === 'sidebar' || type === 'navigation' ||
      name.includes('sidebar') || name.includes('sidenav')) {
    return 'global-nav';
  }

  // Shell elements (header, footer)
  if (type === 'header' || type === 'footer' ||
      name.includes('header') || name.includes('toolbar') || name.includes('footer')) {
    return 'shell';
  }

  // Local navigation (tabs, menus)
  if (name.includes('tab') || name.includes('menu') || name.includes('nav')) {
    return 'local-nav';
  }

  // Main content area
  if (type === 'main-content' || name.includes('content') || name.includes('main')) {
    return 'content';
  }

  // Default: treat as shell (preserve by default)
  return 'shell';
}

/**
 * Identify the type of a structural element based on its name and position
 */
function identifyElementType(node: SceneNode, parentFrame: FrameNode): StructuralElement['type'] {
  const name = node.name.toLowerCase();
  const x = 'x' in node ? node.x : 0;
  const y = 'y' in node ? node.y : 0;
  const width = 'width' in node ? node.width : 0;
  const height = 'height' in node ? node.height : 0;

  // Check name patterns
  if (name.includes('nav') || name.includes('sidebar') || name.includes('menu')) {
    return x < parentFrame.width / 3 ? 'sidebar' : 'navigation';
  }
  if (name.includes('header') || name.includes('toolbar') || name.includes('topbar')) {
    return 'header';
  }
  if (name.includes('footer') || name.includes('bottom')) {
    return 'footer';
  }
  if (name.includes('main') || name.includes('content') || name.includes('body')) {
    return 'main-content';
  }
  if (name.includes('card') || name.includes('tile')) {
    return 'card';
  }
  if (name.includes('form') || name.includes('input')) {
    return 'form';
  }

  // Check position patterns
  if (y < 100 && width >= parentFrame.width * 0.8) {
    return 'header';
  }
  if (x < 300 && height >= parentFrame.height * 0.7) {
    return 'sidebar';
  }
  if (y > parentFrame.height - 200 && width >= parentFrame.width * 0.8) {
    return 'footer';
  }

  // Check if it's likely main content (large central area)
  if (width > parentFrame.width * 0.5 && height > parentFrame.height * 0.5) {
    return 'main-content';
  }

  return 'unknown';
}

/**
 * Extract structural context from a frame
 */
export function extractStructuralContext(frame: FrameNode): StructuralContext {
  const elements: StructuralElement[] = [];
  const topLevelNames: string[] = [];
  const styleTokens: StyleToken[] = [];
  let hasSidebar = false;
  let hasHeader = false;
  let hasFooter = false;
  let hasNavigation = false;
  let mainContentArea: string | null = null;

  // Analyze only top-level children for main structure
  frame.children.forEach((child, index) => {
    if (child.type === 'FRAME' || child.type === 'GROUP' || child.type === 'INSTANCE') {
      const elementType = identifyElementType(child, frame);
      const styleToken = detectStyleToken(child);

      const element: StructuralElement = {
        type: elementType,
        name: child.name,
        nodeId: child.id, // NEW: Store Figma node ID
        role: assignElementRole({ type: elementType, name: child.name }), // NEW: Assign role
        bounds: {
          x: 'x' in child ? child.x : 0,
          y: 'y' in child ? child.y : 0,
          width: 'width' in child ? child.width : 0,
          height: 'height' in child ? child.height : 0,
        },
        children: 'children' in child ? child.children.length : 0,
        hasText: 'children' in child ? child.children.some(c => c.type === 'TEXT') : false,
        isAutoLayout: child.type === 'FRAME' && child.layoutMode !== 'NONE',
        styleToken: styleToken, // NEW: Add detected style token
      };

      elements.push(element);
      topLevelNames.push(child.name);

      // Track style tokens
      if (styleToken) {
        styleTokens.push({ tokenId: styleToken, nodeId: child.id });
      }

      // Update flags
      if (elementType === 'sidebar') hasSidebar = true;
      if (elementType === 'header') hasHeader = true;
      if (elementType === 'footer') hasFooter = true;
      if (elementType === 'navigation') hasNavigation = true;
      if (elementType === 'main-content' && !mainContentArea) {
        mainContentArea = child.name;
      }
    }
  });

  // Determine overall layout type
  let layoutType: StructuralContext['layout']['type'] = 'unknown';
  if (hasSidebar && hasHeader) {
    layoutType = 'dashboard';
  } else if (hasSidebar) {
    layoutType = 'sidebar-layout';
  } else if (hasHeader) {
    layoutType = 'header-layout';
  } else if (topLevelNames.length === 1) {
    layoutType = 'single-page';
  }

  // If no explicit main content area found, try to identify it
  if (!mainContentArea && elements.length > 0) {
    // Find the largest element that's not navigation/header/footer
    const contentElements = elements.filter(e =>
      !['navigation', 'header', 'footer', 'sidebar'].includes(e.type)
    );
    if (contentElements.length > 0) {
      const largest = contentElements.reduce((prev, curr) =>
        (curr.bounds.width * curr.bounds.height) > (prev.bounds.width * prev.bounds.height) ? curr : prev
      );
      mainContentArea = largest.name;
    }
  }

  return {
    elements,
    layout: {
      type: layoutType,
      hasNavigation: hasNavigation || hasSidebar,
      hasHeader,
      hasSidebar,
      hasFooter,
    },
    hierarchy: {
      topLevel: topLevelNames,
      contentArea: mainContentArea,
    },
    styleTokens, // NEW: Include detected style tokens
  };
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

    // Extract structural context
    const structuralContext = extractStructuralContext(frame);

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
      },
      structure: structuralContext, // NEW: Include structural context
    };

  } catch (error) {
    console.error('Error extracting style:', error);
    console.warn('Using default style values');
    return DEFAULT_STYLE;
  }
}
