// ============================================================================
// MVP TYPES (Day 1) - Frame-Scoped Design System & Iteration Pipeline
// ============================================================================

/**
 * Component role classification for semantic understanding
 */
export type ComponentRole =
  | "shell"      // App frame, containers
  | "navigation" // Sidebar, navbar, tabs
  | "header"     // Page headers, toolbars
  | "content"    // Main content areas
  | "card"       // Card components
  | "form"       // Inputs, buttons, form fields
  | "list"       // List items, table rows
  | "modal"      // Dialogs, popovers
  | "control";   // Buttons, toggles, dropdowns

/**
 * Minimal component summary for design system palette
 * Only includes essential info to reduce token usage
 */
export interface DesignSystemComponentSummaryMVP {
  key: string;              // Component key (unique identifier)
  name: string;             // "Sidebar Navigation"
  role: ComponentRole;      // Inferred from name/structure
  usageCount: number;       // How many instances in selected frame
  size: { w: number; h: number }; // Estimated size

  // Only if it's a component set with variants:
  variants?: string[];      // ["Type", "Size", "State"]
}

/**
 * Frame-scoped design system palette (only components used in frame)
 */
export interface DesignPaletteMVP {
  components: DesignSystemComponentSummaryMVP[];
}

// ============================================================================
// FRAME SNAPSHOT TYPES (Structural representation)
// ============================================================================

export type SnapshotNodeTypeMVP =
  | "FRAME"
  | "INSTANCE"
  | "TEXT"
  | "RECTANGLE";

/**
 * Minimal snapshot node for structural understanding
 */
export type SnapshotNodeMVP = {
  id: string;
  type: SnapshotNodeTypeMVP;
  name: string;

  // Only for INSTANCE:
  componentKey?: string;

  // Only for FRAME:
  layoutMode?: "HORIZONTAL" | "VERTICAL" | "NONE";
  children?: SnapshotNodeMVP[];

  // Only for TEXT:
  text?: string;
};

/**
 * Frame snapshot with minimal metadata
 */
export interface FrameSnapshotMVP {
  id: string;
  name: string;
  width: number;
  height: number;
  children: SnapshotNodeMVP[];
}

// ============================================================================
// LLM OUTPUT TYPES (What the AI returns) - HTML/CSS FORMAT
// ============================================================================

/**
 * HTML/CSS layout structure returned by AI
 * This leverages LLM's strong training on web layouts
 */
export interface HTMLCSSLayoutMVP {
  html: string;        // Semantic HTML structure with class names
  css: string;         // CSS styles (Flexbox-based layouts)
  componentMap: {      // Maps HTML class names to Figma component keys
    [className: string]: {
      componentKey: string;
      componentName: string;
      variant?: Record<string, string>;
    };
  };
}

/**
 * Complete AI response with reasoning (HTML/CSS format)
 */
export interface LLMResponseMVP {
  reasoning: string;
  htmlLayout: HTMLCSSLayoutMVP;  // Changed from figmaStructure
}

// ============================================================================
// REQUEST/RESPONSE TYPES (Plugin <-> Backend)
// ============================================================================

/**
 * Request payload sent from plugin to backend
 */
export interface IterationRequestMVP {
  frameSnapshot: FrameSnapshotMVP;
  designPalette: DesignPaletteMVP;
  imagePNG: string;  // base64
  instructions: string;
  model: "gemini-3-pro" | "claude";
}

/**
 * Response from backend to plugin (HTML/CSS format)
 */
export interface IterationResponseMVP {
  reasoning: string;
  htmlLayout: HTMLCSSLayoutMVP;
}
