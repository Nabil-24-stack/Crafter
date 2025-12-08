// ============================================================================
// SCHEMA VALIDATOR - Strict validation with fuzzy matching and suggestions
// ============================================================================

import {
  FigmaNode,
  FigmaFrameNode,
  FigmaTextNode,
  isFrameNode,
  isTextNode,
  VALID_LAYOUT_MODES,
  VALID_SIZING_MODES,
  VALID_FONT_WEIGHTS,
  VALID_TEXT_ALIGN,
  VALID_PRIMARY_ALIGN,
  VALID_COUNTER_ALIGN,
} from '../types/figma-schema';

/**
 * Validation result
 */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  suggestions: string[];
}

/**
 * Common typo/synonym mappings for fuzzy matching
 */
const TYPO_MAP: Record<string, string> = {
  // Font weights
  'heavy': 'bold',
  'light': 'normal',
  'regular': 'normal',

  // Layout modes
  'vertical': 'VERTICAL',
  'horizontal': 'HORIZONTAL',
  'row': 'HORIZONTAL',
  'column': 'VERTICAL',
  'none': 'NONE',

  // Alignment
  'center': 'CENTER',
  'left': 'MIN',
  'right': 'MAX',
  'start': 'MIN',
  'end': 'MAX',
  'top': 'MIN',
  'bottom': 'MAX',

  // Sizing
  'fixed': 'FIXED',
  'auto': 'AUTO',
  'hug': 'AUTO',
  'fill': 'FIXED', // Note: Figma doesn't have FILL in Auto Layout API
};

/**
 * Find closest match using fuzzy matching
 */
function findClosestMatch(input: string, options: readonly string[]): string | null {
  const inputLower = input.toLowerCase();

  // Exact case-insensitive match
  const exact = options.find(opt => opt.toLowerCase() === inputLower);
  if (exact) return exact;

  // Check typo map
  if (TYPO_MAP[inputLower]) {
    const mapped = TYPO_MAP[inputLower];
    if (options.includes(mapped as any)) {
      return mapped;
    }
  }

  // Substring match
  const substring = options.find(opt =>
    opt.toLowerCase().includes(inputLower) ||
    inputLower.includes(opt.toLowerCase())
  );
  if (substring) return substring;

  return null;
}

/**
 * Validate enum value
 */
function validateEnum(
  value: any,
  validValues: readonly string[],
  fieldPath: string
): { valid: boolean; error?: string; suggestion?: string } {

  if (!validValues.includes(value)) {
    const suggestion = findClosestMatch(value, validValues);

    return {
      valid: false,
      error: `Invalid value "${value}" for ${fieldPath}. Must be one of: ${validValues.join(', ')}`,
      suggestion: suggestion ? `Did you mean "${suggestion}"?` : undefined
    };
  }

  return { valid: true };
}

/**
 * Validate RGB color (must be 0-1 range, not 0-255)
 */
function validateColor(
  color: any,
  fieldPath: string
): { valid: boolean; error?: string; suggestion?: string } {

  if (!color || typeof color !== 'object') {
    return {
      valid: false,
      error: `${fieldPath}: color must be an object with r, g, b properties`
    };
  }

  const { r, g, b } = color;

  if (typeof r !== 'number' || typeof g !== 'number' || typeof b !== 'number') {
    return {
      valid: false,
      error: `${fieldPath}: r, g, b must be numbers`
    };
  }

  // Check if values are in 0-255 range (common mistake)
  if (r > 1 || g > 1 || b > 1) {
    return {
      valid: false,
      error: `${fieldPath}: RGB values must be 0-1 (NOT 0-255). Current: r=${r}, g=${g}, b=${b}`,
      suggestion: `Use {r: ${(r/255).toFixed(3)}, g: ${(g/255).toFixed(3)}, b: ${(b/255).toFixed(3)}} instead`
    };
  }

  if (r < 0 || g < 0 || b < 0 || r > 1 || g > 1 || b > 1) {
    return {
      valid: false,
      error: `${fieldPath}: RGB values must be between 0 and 1. Current: r=${r}, g=${g}, b=${b}`
    };
  }

  return { valid: true };
}

/**
 * Validate number is positive
 */
function validatePositiveNumber(
  value: any,
  fieldPath: string,
  allowZero: boolean = true
): { valid: boolean; error?: string } {

  if (typeof value !== 'number') {
    return {
      valid: false,
      error: `${fieldPath}: must be a number, got ${typeof value}`
    };
  }

  if (isNaN(value) || !isFinite(value)) {
    return {
      valid: false,
      error: `${fieldPath}: must be a finite number`
    };
  }

  const min = allowZero ? 0 : 0.01;
  if (value < min) {
    return {
      valid: false,
      error: `${fieldPath}: must be ${allowZero ? '>= 0' : '> 0'}, got ${value}`
    };
  }

  return { valid: true };
}

/**
 * Validate FrameNode
 */
function validateFrameNode(
  node: any,
  path: string = 'root'
): { errors: string[]; warnings: string[]; suggestions: string[] } {

  const errors: string[] = [];
  const warnings: string[] = [];
  const suggestions: string[] = [];

  // Required fields
  if (!node.name || typeof node.name !== 'string') {
    errors.push(`${path}: "name" is required and must be a string`);
  }

  if (!Array.isArray(node.children)) {
    errors.push(`${path}: "children" is required and must be an array`);
  }

  // Layout mode
  if (node.layoutMode !== undefined) {
    const result = validateEnum(node.layoutMode, VALID_LAYOUT_MODES, `${path}.layoutMode`);
    if (!result.valid) {
      errors.push(result.error!);
      if (result.suggestion) suggestions.push(result.suggestion);
    }
  }

  // Sizing modes
  if (node.primaryAxisSizingMode !== undefined) {
    const result = validateEnum(node.primaryAxisSizingMode, VALID_SIZING_MODES, `${path}.primaryAxisSizingMode`);
    if (!result.valid) {
      errors.push(result.error!);
      if (result.suggestion) suggestions.push(result.suggestion);
    }
  }

  if (node.counterAxisSizingMode !== undefined) {
    const result = validateEnum(node.counterAxisSizingMode, VALID_SIZING_MODES, `${path}.counterAxisSizingMode`);
    if (!result.valid) {
      errors.push(result.error!);
      if (result.suggestion) suggestions.push(result.suggestion);
    }
  }

  // Alignment (only valid when layoutMode !== 'NONE')
  if (node.primaryAxisAlignItems !== undefined) {
    const result = validateEnum(node.primaryAxisAlignItems, VALID_PRIMARY_ALIGN, `${path}.primaryAxisAlignItems`);
    if (!result.valid) {
      errors.push(result.error!);
      if (result.suggestion) suggestions.push(result.suggestion);
    }

    if (node.layoutMode === 'NONE') {
      warnings.push(`${path}.primaryAxisAlignItems is set but layoutMode is "NONE" (will be ignored)`);
    }
  }

  if (node.counterAxisAlignItems !== undefined) {
    const result = validateEnum(node.counterAxisAlignItems, VALID_COUNTER_ALIGN, `${path}.counterAxisAlignItems`);
    if (!result.valid) {
      errors.push(result.error!);
      if (result.suggestion) suggestions.push(result.suggestion);
    }

    if (node.layoutMode === 'NONE') {
      warnings.push(`${path}.counterAxisAlignItems is set but layoutMode is "NONE" (will be ignored)`);
    }
  }

  // Dimensions
  if (node.width !== undefined) {
    const result = validatePositiveNumber(node.width, `${path}.width`);
    if (!result.valid) errors.push(result.error!);
  }

  if (node.height !== undefined) {
    const result = validatePositiveNumber(node.height, `${path}.height`);
    if (!result.valid) errors.push(result.error!);
  }

  // Spacing
  if (node.itemSpacing !== undefined) {
    const result = validatePositiveNumber(node.itemSpacing, `${path}.itemSpacing`);
    if (!result.valid) errors.push(result.error!);
  }

  ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft'].forEach(field => {
    if (node[field] !== undefined) {
      const result = validatePositiveNumber(node[field], `${path}.${field}`);
      if (!result.valid) errors.push(result.error!);
    }
  });

  if (node.cornerRadius !== undefined) {
    const result = validatePositiveNumber(node.cornerRadius, `${path}.cornerRadius`);
    if (!result.valid) errors.push(result.error!);
  }

  // Fills
  if (node.fills !== undefined) {
    if (!Array.isArray(node.fills)) {
      errors.push(`${path}.fills: must be an array`);
    } else {
      node.fills.forEach((fill: any, i: number) => {
        if (fill.type !== 'SOLID') {
          errors.push(`${path}.fills[${i}]: only "SOLID" fill type is supported`);
        }

        if (fill.color) {
          const result = validateColor(fill.color, `${path}.fills[${i}].color`);
          if (!result.valid) {
            errors.push(result.error!);
            if (result.suggestion) suggestions.push(result.suggestion);
          }
        } else {
          errors.push(`${path}.fills[${i}]: "color" is required`);
        }
      });
    }
  }

  // Validate children recursively
  if (Array.isArray(node.children)) {
    node.children.forEach((child: any, i: number) => {
      const childResult = validateNode(child, `${path}.children[${i}]`);
      errors.push(...childResult.errors);
      warnings.push(...childResult.warnings);
      suggestions.push(...childResult.suggestions);
    });
  }

  return { errors, warnings, suggestions };
}

/**
 * Validate TextNode
 */
function validateTextNode(
  node: any,
  path: string
): { errors: string[]; warnings: string[]; suggestions: string[] } {

  const errors: string[] = [];
  const warnings: string[] = [];
  const suggestions: string[] = [];

  // Required field
  if (!node.characters || typeof node.characters !== 'string') {
    errors.push(`${path}: "characters" is required and must be a non-empty string`);
  }

  // Font size
  if (node.fontSize !== undefined) {
    const result = validatePositiveNumber(node.fontSize, `${path}.fontSize`, false);
    if (!result.valid) errors.push(result.error!);
  }

  // Font weight
  if (node.fontWeight !== undefined) {
    const result = validateEnum(node.fontWeight, VALID_FONT_WEIGHTS, `${path}.fontWeight`);
    if (!result.valid) {
      errors.push(result.error!);
      if (result.suggestion) suggestions.push(result.suggestion);
    }
  }

  // Font family
  if (node.fontFamily !== undefined && typeof node.fontFamily !== 'string') {
    errors.push(`${path}.fontFamily: must be a string`);
  }

  // Text align
  if (node.textAlignHorizontal !== undefined) {
    const result = validateEnum(node.textAlignHorizontal, VALID_TEXT_ALIGN, `${path}.textAlignHorizontal`);
    if (!result.valid) {
      errors.push(result.error!);
      if (result.suggestion) suggestions.push(result.suggestion);
    }
  }

  // Fills
  if (node.fills !== undefined) {
    if (!Array.isArray(node.fills)) {
      errors.push(`${path}.fills: must be an array`);
    } else {
      node.fills.forEach((fill: any, i: number) => {
        if (fill.type !== 'SOLID') {
          errors.push(`${path}.fills[${i}]: only "SOLID" fill type is supported`);
        }

        if (fill.color) {
          const result = validateColor(fill.color, `${path}.fills[${i}].color`);
          if (!result.valid) {
            errors.push(result.error!);
            if (result.suggestion) suggestions.push(result.suggestion);
          }
        }
      });
    }
  }

  // Line height
  if (node.lineHeight !== undefined) {
    const result = validatePositiveNumber(node.lineHeight, `${path}.lineHeight`, false);
    if (!result.valid) errors.push(result.error!);
  }

  return { errors, warnings, suggestions };
}

/**
 * Validate any FigmaNode
 */
function validateNode(
  node: any,
  path: string = 'root'
): { errors: string[]; warnings: string[]; suggestions: string[] } {

  const errors: string[] = [];
  const warnings: string[] = [];
  const suggestions: string[] = [];

  // Check type
  if (!node || typeof node !== 'object') {
    errors.push(`${path}: must be an object`);
    return { errors, warnings, suggestions };
  }

  if (!node.type) {
    errors.push(`${path}: "type" is required`);
    return { errors, warnings, suggestions };
  }

  if (node.type === 'FRAME') {
    return validateFrameNode(node, path);
  } else if (node.type === 'TEXT') {
    return validateTextNode(node, path);
  } else {
    errors.push(`${path}: invalid type "${node.type}". Must be "FRAME" or "TEXT"`);
    return { errors, warnings, suggestions };
  }
}

/**
 * Main validation function
 */
export function validateFigmaJson(json: any): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const suggestions: string[] = [];

  // Root must be a FRAME
  if (!json || typeof json !== 'object') {
    return {
      valid: false,
      errors: ['Root must be an object'],
      warnings: [],
      suggestions: []
    };
  }

  if (json.type !== 'FRAME') {
    return {
      valid: false,
      errors: ['Root node must be type "FRAME"'],
      warnings: [],
      suggestions: json.type ? [`Change root type from "${json.type}" to "FRAME"`] : []
    };
  }

  // Validate recursively
  const result = validateNode(json, 'root');
  errors.push(...result.errors);
  warnings.push(...result.warnings);
  suggestions.push(...result.suggestions);

  return {
    valid: errors.length === 0,
    errors: [...new Set(errors)], // Remove duplicates
    warnings: [...new Set(warnings)],
    suggestions: [...new Set(suggestions)]
  };
}
