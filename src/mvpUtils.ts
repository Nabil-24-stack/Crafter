// ============================================================================
// MVP UTILITY FUNCTIONS
// ============================================================================

import {
  ComponentRole,
  DesignSystemComponentSummaryMVP,
  DesignPaletteMVP,
  FrameSnapshotMVP,
  SnapshotNodeMVP,
} from './mvpTypes';

/**
 * SINGLE SOURCE OF TRUTH for component key resolution.
 * Use this everywhere: snapshot building, palette extraction, reconstruction.
 * ASYNC: Uses getMainComponentAsync() as required by Figma's async API
 */
export async function getComponentKey(node: ComponentNode | InstanceNode): Promise<string> {
  let component: ComponentNode;

  if (node.type === "INSTANCE") {
    const instance = node as InstanceNode;
    const mainComp = await instance.getMainComponentAsync();
    if (!mainComp) {
      throw new Error(`Instance ${node.name} has no main component`);
    }
    component = mainComp;
  } else {
    component = node as ComponentNode;
  }

  // If component is inside a component set, use the set's key
  // Otherwise use the component's own key
  return component.parent?.type === "COMPONENT_SET"
    ? component.parent.key
    : component.key;
}

/**
 * Infer component role from name for semantic understanding
 */
export function inferComponentRole(name: string): ComponentRole {
  const lower = name.toLowerCase();
  if (lower.includes("sidebar") || lower.includes("nav")) return "navigation";
  if (lower.includes("header") || lower.includes("toolbar")) return "header";
  if (lower.includes("card")) return "card";
  if (lower.includes("button") || lower.includes("toggle")) return "control";
  if (lower.includes("input") || lower.includes("field")) return "form";
  if (lower.includes("modal") || lower.includes("dialog")) return "modal";
  if (lower.includes("list") || lower.includes("row")) return "list";
  if (lower.includes("app") || lower.includes("container") || lower.includes("wrapper")) return "shell";
  return "content";
}

/**
 * Build a frame snapshot with minimal depth (MVP version)
 * ASYNC: Now uses async getComponentKey
 */
export async function buildFrameSnapshot(
  frame: FrameNode,
  maxDepth: number = 5
): Promise<FrameSnapshotMVP> {
  async function buildNode(node: SceneNode, depth: number): Promise<SnapshotNodeMVP | null> {
    if (depth > maxDepth) return null;

    const snapshot: SnapshotNodeMVP = {
      id: node.id,
      type: node.type as any, // We'll handle type narrowing
      name: node.name,
    };

    // Handle INSTANCE nodes
    if (node.type === "INSTANCE") {
      const instance = node as InstanceNode;
      try {
        snapshot.componentKey = await getComponentKey(instance);
      } catch (error) {
        console.warn(`Could not get component key for instance ${node.name}:`, error);
        return null; // Skip instances without valid components
      }
    }

    // Handle FRAME nodes
    if (node.type === "FRAME") {
      const frameNode = node as FrameNode;
      // Filter out GRID layout mode as it's not supported in MVP
      const layoutMode = frameNode.layoutMode;
      snapshot.layoutMode = layoutMode === "GRID" ? "NONE" : layoutMode;

      if (depth < maxDepth && "children" in frameNode) {
        const childPromises = frameNode.children.map(child => buildNode(child, depth + 1));
        const childResults = await Promise.all(childPromises);
        snapshot.children = childResults.filter((n): n is SnapshotNodeMVP => n !== null);
      }
    }

    // Handle TEXT nodes
    if (node.type === "TEXT") {
      const textNode = node as TextNode;
      snapshot.text = textNode.characters.substring(0, 100); // Truncate
    }

    return snapshot;
  }

  const childPromises = frame.children.map(child => buildNode(child, 1));
  const childResults = await Promise.all(childPromises);
  const children = childResults.filter((n): n is SnapshotNodeMVP => n !== null);

  return {
    id: frame.id,
    name: frame.name,
    width: frame.width,
    height: frame.height,
    children,
  };
}

/**
 * Extract frame-scoped design palette (only components used in this frame)
 * ASYNC: Now properly awaits getComponentKey calls
 */
export async function extractFrameScopedPalette(
  frame: FrameNode
): Promise<DesignPaletteMVP> {
  const usedComponentKeys = new Set<string>();
  const componentUsageCount = new Map<string, number>();

  // Traverse frame to find all INSTANCE nodes (async version)
  async function traverse(node: SceneNode): Promise<void> {
    if (node.type === "INSTANCE") {
      try {
        const key = await getComponentKey(node as InstanceNode);
        usedComponentKeys.add(key);
        componentUsageCount.set(key, (componentUsageCount.get(key) || 0) + 1);
      } catch (error) {
        console.warn(`Skipping instance ${node.name}: ${error}`);
      }
    }

    if ("children" in node) {
      // Process children in parallel for better performance
      await Promise.all(node.children.map(child => traverse(child)));
    }
  }

  await traverse(frame);

  console.log(`📊 Found ${usedComponentKeys.size} unique components used in frame`);

  // Now fetch component details for used components only
  const components: DesignSystemComponentSummaryMVP[] = [];
  const localComponents = figma.root.findAll(
    n => n.type === "COMPONENT" || n.type === "COMPONENT_SET"
  ) as (ComponentNode | ComponentSetNode)[];

  for (const node of localComponents) {
    const key = (node as ComponentNode | ComponentSetNode).key;
    if (!usedComponentKeys.has(key)) continue; // Skip unused components

    const summary: DesignSystemComponentSummaryMVP = {
      key,
      name: node.name,
      role: inferComponentRole(node.name),
      usageCount: componentUsageCount.get(key) || 0,
      size: {
        w: Math.round((node as ComponentNode | ComponentSetNode).width),
        h: Math.round((node as ComponentNode | ComponentSetNode).height)
      },
    };

    // Add variant info for component sets
    if (node.type === "COMPONENT_SET") {
      const variantProps = (node as ComponentSetNode).componentPropertyDefinitions;
      if (variantProps) {
        summary.variants = Object.keys(variantProps);
      }
    }

    components.push(summary);
  }

  console.log(`🎨 Extracted ${components.length} components for design palette`);

  return { components };
}

/**
 * Build component map for reconstruction (consistent with getComponentKey)
 */
export function buildComponentMap(): Map<string, ComponentNode> {
  const map = new Map<string, ComponentNode>();

  // Find all component sets first
  const componentSets = figma.root.findAll(
    n => n.type === "COMPONENT_SET"
  ) as ComponentSetNode[];

  for (const set of componentSets) {
    // Map set key to the default variant (first child)
    const defaultVariant = set.defaultVariant || set.children[0] as ComponentNode;
    if (defaultVariant) {
      map.set(set.key, defaultVariant); // ✅ Use set key
    }
  }

  // Then individual components (not in sets)
  const standaloneComponents = figma.root.findAll(
    n => n.type === "COMPONENT" && n.parent?.type !== "COMPONENT_SET"
  ) as ComponentNode[];

  for (const comp of standaloneComponents) {
    map.set(comp.key, comp); // ✅ Use component key
  }

  console.log(`📚 Built component map with ${map.size} entries`);

  return map;
}

/**
 * Preload all necessary fonts
 */
export async function preloadFonts() {
  const fontsToLoad = [
    { family: "Inter", style: "Regular" },
    { family: "Inter", style: "Medium" },
    { family: "Inter", style: "Semi Bold" },
    { family: "Inter", style: "Bold" },
  ];

  console.log("🔤 Preloading fonts...");

  await Promise.allSettled(
    fontsToLoad.map(font =>
      figma.loadFontAsync(font).catch(err =>
        console.warn(`Could not load ${font.family} ${font.style}`)
      )
    )
  );

  console.log("✅ Fonts preloaded");
}
