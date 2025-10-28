// Shared types between UI and plugin code

// Message types for communication between UI and plugin
export type MessageType =
  | 'generate-layout'
  | 'generate-with-claude'
  | 'iterate-design'
  | 'get-design-system'
  | 'get-selected-frame'
  | 'selected-frame-data'
  | 'design-system-data'
  | 'generation-complete'
  | 'iteration-complete'
  | 'generation-error'
  | 'iteration-error'
  | 'set-api-key';

export interface Message {
  type: MessageType;
  payload?: any;
}

// Design system data structures
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
}

export interface ColorStyle {
  id: string;
  name: string;
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
  layout: LayoutNode;
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
  updatedLayout: LayoutNode;
  reasoning?: string;
}
