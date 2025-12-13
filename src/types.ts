// Shared types between UI and plugin code

// Message types for communication between UI and plugin
export type MessageType =
  | 'generate-layout'
  | 'generate-with-claude'
  | 'generate-variations'
  | 'generate-single-variation'
  | 'iterate-design'
  | 'iterate-design-variation'
  | 'iterate-design-variation-mvp' // MVP iteration pipeline
  | 'iteration-mvp-complete' // MVP iteration completion callback
  | 'mvp-call-railway' // DEPRECATED: Old HTML/CSS pipeline
  | 'mvp-call-railway-json' // NEW: Direct Figma JSON generation pipeline
  | 'mvp-railway-response' // Railway response from UI back to plugin
  | 'get-design-system'
  | 'design-system-scan-progress' // Progress updates during scanning
  | 'get-selected-frame'
  | 'export-frame-png'
  | 'frame-png-exported'
  | 'export-frame-json'
  | 'frame-json-exported'
  | 'selected-frame-data'
  | 'design-system-data'
  | 'generation-complete'
  | 'iteration-complete'
  | 'generation-error'
  | 'iteration-error'
  | 'set-api-key'
  | 'variation-status-update' // Progress update for individual variation
  | 'variation-job-started' // When worker job starts for a variation
  | 'all-variations-complete' // When all variations are done
  | 'check-auth' // Check if user has auth token
  | 'auth-status' // Response with auth status
  | 'start-oauth' // Start OAuth flow
  | 'auth-complete' // OAuth complete with token
  | 'store-auth-token' // Store token from OAuth callback
  | 'logout' // Log out user
  | 'convert-svg-to-png' // Request UI to convert SVG to PNG
  | 'svg-converted-to-png' // Response with PNG bytes
  | 'svg-conversion-failed'; // Response when conversion fails

export interface Message {
  type: MessageType;
  payload?: any;
}

// Design system data structures
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

export interface ComponentData {
  id: string;
  name: string;
  key: string;
  description?: string;
  type: 'COMPONENT' | 'COMPONENT_SET';
  // Component metadata for better AI understanding
  width?: number;
  height?: number;
  category?: string; // e.g., "button", "input", "card", "icon"
  // Visual properties for SVG generation
  visuals?: ComponentVisuals;
}

export interface ColorStyle {
  id: string;
  name: string;
  hex: string; // Added hex for easier use
  color: {
    r: number;
    g: number;
    b: number;
    a: number;
  };
}

export interface TextStyle {
  id: string;
  name: string;
  fontSize: number;
  fontFamily: string;
  fontWeight: number;
}

export interface DesignSystemData {
  components: ComponentData[];
  colors: ColorStyle[];
  textStyles: TextStyle[];
  visualLanguage?: string; // Formatted visual language description for AI
}

// Claude API structures
export interface ClaudeMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ClaudeRequest {
  model: string;
  max_tokens: number;
  messages: ClaudeMessage[];
}

export interface ClaudeResponse {
  id: string;
  type: string;
  role: string;
  content: Array<{
    type: string;
    text: string;
  }>;
  model: string;
  stop_reason: string;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

// Layout generation structures
export interface LayoutNode {
  type: 'FRAME' | 'COMPONENT_INSTANCE' | 'TEXT' | 'RECTANGLE';
  name: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  componentKey?: string; // For component instances
  componentName?: string;
  text?: string; // For text nodes
  textOverrides?: Record<string, string>; // For overriding text in component instances (nodeId -> text)
  fills?: Array<{
    type: 'SOLID';
    color: { r: number; g: number; b: number; a?: number };
  }>;
  children?: LayoutNode[];

  // Auto Layout properties
  layoutMode?: 'NONE' | 'HORIZONTAL' | 'VERTICAL';
  primaryAxisSizingMode?: 'FIXED' | 'AUTO';
  counterAxisSizingMode?: 'FIXED' | 'AUTO';
  primaryAxisAlignItems?: 'MIN' | 'CENTER' | 'MAX' | 'SPACE_BETWEEN';
  counterAxisAlignItems?: 'MIN' | 'CENTER' | 'MAX';
  paddingLeft?: number;
  paddingRight?: number;
  paddingTop?: number;
  paddingBottom?: number;
  itemSpacing?: number;

  // Child positioning within Auto Layout
  layoutAlign?: 'INHERIT' | 'STRETCH' | 'MIN' | 'CENTER' | 'MAX';
  layoutGrow?: number;

  // Additional styling properties
  cornerRadius?: number;
  strokeWeight?: number;
  strokes?: Array<{
    type: 'SOLID';
    color: { r: number; g: number; b: number; a?: number };
  }>;
  opacity?: number;
}

export interface GenerationResult {
  svg: string; // SVG markup string
  reasoning?: string;
}

// Iteration mode structures
export interface SerializedFrame {
  name: string;
  type: string;
  layoutMode?: 'NONE' | 'HORIZONTAL' | 'VERTICAL';
  primaryAxisSizingMode?: 'FIXED' | 'AUTO';
  counterAxisSizingMode?: 'FIXED' | 'AUTO';
  primaryAxisAlignItems?: 'MIN' | 'CENTER' | 'MAX' | 'SPACE_BETWEEN';
  counterAxisAlignItems?: 'MIN' | 'CENTER' | 'MAX';
  paddingLeft?: number;
  paddingRight?: number;
  paddingTop?: number;
  paddingBottom?: number;
  itemSpacing?: number;
  fills?: Array<{
    type: string;
    color: { r: number; g: number; b: number; a?: number };
  }>;
  cornerRadius?: number;
  children?: SerializedNode[];
}

export interface SerializedNode {
  name: string;
  type: string;
  componentKey?: string;
  componentName?: string;
  text?: string;
  layoutMode?: 'NONE' | 'HORIZONTAL' | 'VERTICAL';
  itemSpacing?: number;
  paddingLeft?: number;
  paddingRight?: number;
  paddingTop?: number;
  paddingBottom?: number;
  children?: SerializedNode[];
}

export interface IterationRequest {
  mode: 'iterate';
  frameData: SerializedFrame;
  userPrompt: string;
  designSystem: DesignSystemData;
}

export interface IterationResult {
  svg?: string; // Updated SVG markup (deprecated - for backwards compatibility)
  figmaStructure?: FigmaLayoutNode; // NEW: Editable Figma layout structure
  reasoning?: string;
  job_id?: string; // Job ID for subscribing to realtime reasoning updates
  warnings?: string[];
}

// Chat interface structures
export type VariationStatusType = 'thinking' | 'designing' | 'rendering' | 'complete' | 'error' | 'stopped';

export interface VariationStatus {
  index: number; // 0-based
  status: VariationStatusType;
  statusText: string;
  error?: string;

  // Details (shown when expanded)
  subPrompt?: string; // The variation prompt generated
  reasoning?: string; // From LLM response
  streamingReasoning?: string; // Live streaming reasoning (accumulated chunks)
  isStreamingLive?: boolean; // Whether reasoning is currently streaming
  streamingSVG?: string; // Live streaming SVG code (accumulated chunks)
  isSVGStreaming?: boolean; // Whether SVG is currently being generated
  createdNodeId?: string; // Figma node ID if successfully created
  isExpanded?: boolean; // UI state for expand/collapse
  jobId?: string; // Job ID for realtime subscription
}

export type IterationDataStatus = 'analyzing' | 'generating' | 'generating-prompts' | 'in-progress' | 'complete' | 'stopped' | 'error';

export interface IterationData {
  frameId: string;
  frameName: string;
  model: 'claude' | 'gemini';
  numVariations?: number; // Optional - set after analysis

  status: IterationDataStatus;
  startTime: number;
  endTime?: number;

  variations: VariationStatus[];
  summary?: string; // LLM-generated summary after completion
  wasStopped?: boolean; // True if user clicked Stop

  // Analysis results
  analysisRationale?: string; // Why this variation count was chosen
  variationCategories?: string[]; // Types of variations being generated
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;

  // Only for assistant messages
  iterationData?: IterationData;
}

export interface Chat {
  id: string;
  name: string; // "Blank Chat" or "Iterating on <frame>"
  messages: ChatMessage[];
  currentFrameId?: string; // Frame locked for current iteration
  lockedFrameName?: string; // Frame name locked on first send
  createdAt: number;
}

// ============================================================================
// Editable Layout System (Milestone A)
// ============================================================================

/**
 * Discriminated union for Figma layout nodes
 * Uses strict type checking to prevent invalid structures
 */

// FRAME node: Can have children and Auto Layout properties
export interface FigmaFrameNode {
  type: 'FRAME';
  name: string;

  // NEW: Preservation mechanism
  sourceNodeId?: string; // If set, clone this exact node from original
  role?: 'shell' | 'content' | 'global-nav' | 'local-nav'; // Region role for preservation

  // Auto Layout properties (optional)
  layoutMode?: 'VERTICAL' | 'HORIZONTAL' | 'NONE';
  itemSpacing?: number;
  padding?: {
    top: number;
    right: number;
    bottom: number;
    left: number;
  };
  primaryAxisAlignItems?: 'MIN' | 'CENTER' | 'MAX' | 'SPACE_BETWEEN';
  counterAxisAlignItems?: 'MIN' | 'CENTER' | 'MAX';

  // Children (only FRAME can have children)
  children?: FigmaLayoutNode[];

  // Fill style (optional)
  fillStyleName?: string;

  // FRAME nodes cannot have these fields (enforced by discriminated union)
  componentName?: never;
  componentVariant?: never;
  styleToken?: never;
  text?: never;
  textStyleName?: never;
}

// INSTANCE node: Instance of a component (not the component definition itself)
export interface FigmaInstanceNode {
  type: 'INSTANCE';
  name: string;

  // NEW: Preservation or token-based creation
  sourceNodeId?: string; // If set, clone this exact instance
  styleToken?: string; // Use predefined token (e.g., "button/primary")

  // Component reference (for non-token instances)
  componentName?: string;

  // Optional: Variant properties
  componentVariant?: Record<string, string>;

  // Optional: Text override for text nodes inside component
  text?: string;

  // INSTANCE nodes cannot have these fields
  children?: never;
  layoutMode?: never;
  itemSpacing?: never;
  padding?: never;
  primaryAxisAlignItems?: never;
  counterAxisAlignItems?: never;
  role?: never;
  fillStyleName?: never;
  textStyleName?: never;
}

// TEXT node: Standalone text, cannot have children or component properties
export interface FigmaTextNode {
  type: 'TEXT';
  name: string;

  // NEW: Preservation mechanism
  sourceNodeId?: string; // If set, clone this exact text node

  // Required: Text content
  text: string;

  // Optional: Text style reference
  textStyleName?: string;

  // TEXT nodes cannot have these fields
  children?: never;
  componentName?: never;
  componentVariant?: never;
  styleToken?: never;
  layoutMode?: never;
  itemSpacing?: never;
  padding?: never;
  primaryAxisAlignItems?: never;
  counterAxisAlignItems?: never;
  role?: never;
  fillStyleName?: never;
}

/**
 * Union type for all Figma layout nodes
 */
export type FigmaLayoutNode = FigmaFrameNode | FigmaInstanceNode | FigmaTextNode;

/**
 * AI output schema (versioned)
 */
export interface GenerationOutput {
  version: '1.0';
  reasoning: string;
  figmaStructure: FigmaLayoutNode;
  warnings?: string[];
}

/**
 * Structural hints for iteration context
 * Provides semantic information about existing frame
 */
export interface StructuralHints {
  hintsVersion: '1.0';
  frameName: string;
  usesAutoLayout: boolean;

  // Layout properties (if Auto Layout enabled)
  layoutMode?: 'VERTICAL' | 'HORIZONTAL' | 'NONE';
  itemSpacing?: number;
  padding?: {
    top: number;
    right: number;
    bottom: number;
    left: number;
  };

  // Children information
  children: ChildHint[] | ChildrenSummary;

  // Used design system elements
  usedComponents: string[];
  usedTextStyles: string[];
  fillStyleName?: string;
}

/**
 * Individual child hint (for ≤20 children)
 */
export interface ChildHint {
  type: string;
  name: string;
  isComponent?: boolean;
  componentName?: string;
  text?: string; // Truncated to 100 chars
}

/**
 * Children summary (for >20 children with pattern detection)
 */
export interface ChildrenSummary {
  summary: string; // e.g., "List of 50 Card items"
  example?: ChildHint;
  count: number;
}

/**
 * Validation result from schema validation
 */
export interface ValidationResult {
  valid: boolean;
  type?: 'SCHEMA_ERROR' | 'WARNING';
  message?: string;
  errors?: Array<{ path: string; message: string }>;
  warnings?: string[];
}
