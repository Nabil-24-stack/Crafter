// ============================================================================
// MVP INTEGRATION - Wires together the MVP pipeline
// ============================================================================

import { IterationRequestMVP, IterationResponseMVP } from './mvpTypes';
import { buildFrameSnapshot, extractFrameScopedPalette } from './mvpUtils';
import { reconstructVariationMVP } from './mvpReconstruction';

/**
 * Main iteration function - called when user clicks "Iterate" in UI
 */
export async function runIterationMVP(
  frame: FrameNode,
  instructions: string,
  model: "gemini-3-pro" | "claude",
  backendURL: string
): Promise<FrameNode> {
  console.log(`🎯 Starting MVP iteration on frame: ${frame.name}`);

  // 1. Build frame snapshot (structural understanding)
  console.log("📸 Building frame snapshot...");
  const frameSnapshot = await buildFrameSnapshot(frame, 5);
  console.log(`  → ${frameSnapshot.children.length} top-level nodes captured`);

  // 2. Extract frame-scoped design palette
  console.log("🎨 Extracting design palette...");
  const designPalette = await extractFrameScopedPalette(frame);
  console.log(`  → ${designPalette.components.length} components in palette`);

  // 3. Export frame as PNG
  console.log("🖼️  Exporting frame to PNG...");
  const pngBytes = await frame.exportAsync({
    format: "PNG",
    constraint: { type: "SCALE", value: 1 }, // 1x scale for speed
  });
  const imagePNG = btoa(String.fromCharCode(...pngBytes));
  console.log(`  → ${Math.round(imagePNG.length / 1024)} KB`);

  // 4. Send to backend
  console.log(`🚀 Sending to ${model}...`);
  const request: IterationRequestMVP = {
    frameSnapshot,
    designPalette,
    imagePNG,
    instructions,
    model,
  };

  const response = await fetch(`${backendURL}/api/iterate-mvp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Backend error: ${error}`);
  }

  const result: IterationResponseMVP = await response.json();
  console.log(`✅ Received response: ${result.reasoning}`);

  // 5. Reconstruct variation in Figma
  console.log("🔨 Reconstructing variation...");
  const newFrame = await reconstructVariationMVP(
    result.figmaStructure,
    designPalette
  );

  // 6. Position new frame next to original
  newFrame.x = frame.x + frame.width + 100;
  newFrame.y = frame.y;

  console.log("✅ MVP iteration complete!");
  return newFrame;
}

/**
 * Export frame to PNG as base64
 */
export async function exportFrameToPngBase64MVP(frame: FrameNode): Promise<string> {
  const bytes = await frame.exportAsync({
    format: "PNG",
    constraint: { type: "SCALE", value: 1 },
  });
  return btoa(String.fromCharCode(...bytes));
}
