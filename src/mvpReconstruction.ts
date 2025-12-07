// ============================================================================
// MVP RECONSTRUCTION FUNCTIONS
// ============================================================================

import { LayoutStructureMVP, LayoutNodeMVP, DesignPaletteMVP } from './mvpTypes';
import { buildComponentMap, preloadFonts } from './mvpUtils';

/**
 * Converts validated figmaStructure back into Figma nodes.
 * Reuses components via createInstance when componentKey is present.
 */
export async function reconstructVariationMVP(
  figmaStructure: LayoutStructureMVP,
  designPalette: DesignPaletteMVP
): Promise<FrameNode> {
  console.log("🔨 Starting reconstruction...");

  // 1. Preload all fonts
  await preloadFonts();

  // 2. Build component key lookup (consistent with getComponentKey)
  const componentMap = buildComponentMap();

  console.log(`📦 Reconstructing: ${figmaStructure.name}`);

  // 3. Create root frame
  const rootFrame = figma.createFrame();
  rootFrame.name = figmaStructure.name;

  // 4. Recursively create children
  let successCount = 0;
  let skipCount = 0;

  for (const childSpec of figmaStructure.children) {
    try {
      const childNode = await createNodeMVP(childSpec, componentMap);
      if (childNode) {
        rootFrame.appendChild(childNode);
        successCount++;
      } else {
        skipCount++;
      }
    } catch (error) {
      console.warn(`⚠️  Failed to create node ${childSpec.name}:`, error);
      skipCount++;
    }
  }

  console.log(`✅ Created ${successCount} nodes, skipped ${skipCount}`);

  return rootFrame;
}

/**
 * Creates a Figma node from the MVP layout spec
 */
async function createNodeMVP(
  spec: LayoutNodeMVP,
  componentMap: Map<string, ComponentNode>
): Promise<SceneNode | null> {
  switch (spec.type) {
    case "INSTANCE": {
      const component = componentMap.get(spec.componentKey);

      if (!component) {
        console.warn(`❌ Component key "${spec.componentKey}" not found in map`);
        console.warn(`   Available keys (first 10):`, Array.from(componentMap.keys()).slice(0, 10));
        return null; // Skip instead of throwing
      }

      const instance = component.createInstance();
      instance.name = spec.name;
      console.log(`  ✅ Created instance: ${spec.name} (${spec.componentKey})`);
      return instance;
    }

    case "FRAME": {
      const frame = figma.createFrame();
      frame.name = spec.name;

      if (spec.layoutMode) {
        frame.layoutMode = spec.layoutMode === "NONE" ? "VERTICAL" : spec.layoutMode;
      }

      // Create children recursively
      if (spec.children) {
        for (const childSpec of spec.children) {
          const child = await createNodeMVP(childSpec, componentMap);
          if (child) frame.appendChild(child);
        }
      }

      return frame;
    }

    case "TEXT": {
      const text = figma.createText();
      text.name = spec.name;

      // Font already preloaded, but be defensive
      try {
        await figma.loadFontAsync({ family: "Inter", style: "Regular" });
        text.characters = spec.characters;
      } catch (error) {
        console.warn(`⚠️  Font loading failed for ${spec.name}, using default`);
        text.characters = spec.characters;
      }

      return text;
    }

    case "RECTANGLE": {
      const rect = figma.createRectangle();
      rect.name = spec.name;
      rect.resize(spec.width, spec.height);
      return rect;
    }

    default:
      console.warn(`Unknown node type: ${(spec as any).type}`);
      return null;
  }
}
