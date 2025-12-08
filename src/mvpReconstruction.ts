// ============================================================================
// MVP RECONSTRUCTION - HTML/CSS TO FIGMA
// ============================================================================

import { HTMLCSSLayoutMVP, DesignPaletteMVP } from './mvpTypes';
import { buildComponentMap, preloadFonts } from './mvpUtils';
import { convertHTMLToFigma } from './htmlToFigmaConverter';

/**
 * Converts HTML/CSS layout to Figma frame
 * This replaces the old Figma JSON reconstruction
 */
export async function reconstructVariationMVP(
  htmlLayout: HTMLCSSLayoutMVP,
  designPalette: DesignPaletteMVP
): Promise<FrameNode> {
  console.log("🔨 Starting HTML/CSS → Figma conversion...");

  // 1. Preload all fonts
  await preloadFonts();

  // 2. Build component key lookup
  const componentMap = buildComponentMap();

  // 3. Convert HTML/CSS to Figma using parser
  const rootFrame = await convertHTMLToFigma(htmlLayout, componentMap);

  console.log(`✅ Conversion complete: ${rootFrame.name}`);

  return rootFrame;
}
