# MVP Implementation Guide - Frame-Scoped Component Reuse Pipeline

## Overview

This guide explains how to integrate the new MVP iteration pipeline that solves the component reuse problem.

## Problem Summary

**Before:**
- Scanning 8370 components (every variant counted separately)
- Sending all components to LLM regardless of relevance
- LLM rebuilding components (like sidebars) from primitives instead of reusing them
- Schema validation failures (malformed `padding`, etc.)
- Missing font loading causing runtime errors

**After (MVP):**
- Scan only components used in selected frame (~20-50 components)
- Send frame-scoped `FrameSnapshot` + `DesignPalette` to LLM
- Explicit prompts emphasizing component reuse via `componentKey`
- Zod schema validation with retry logic
- Preload fonts before reconstruction

---

## File Structure

```
src/
├── mvpTypes.ts           ✅ NEW: TypeScript type definitions
├── mvpUtils.ts           ✅ NEW: Utility functions (getComponentKey, buildFrameSnapshot, etc.)
├── mvpReconstruction.ts  ✅ NEW: Reconstruction logic with componentMap
├── mvpIntegration.ts     ✅ NEW: Main iteration flow
└── code.ts               🔧 UPDATE: Wire up MVP functions

api/
├── iterate-mvp.ts        ✅ NEW: Backend with Zod validation & improved prompts
└── iterate.ts            ⏸️  OLD: Keep for backwards compatibility
```

---

## Integration Steps

### Step 1: Update `code.ts` to use MVP functions

Add import at top of `src/code.ts`:

```typescript
import { runIterationMVP } from './mvpIntegration';
```

Replace the `handleIterateDesignVariation` function (around line 1910) with:

```typescript
async function handleIterateDesignVariation(payload: any) {
  const { reasoning, frameId, variationIndex, totalVariations, designSystem, model } = payload;

  if (!frameId) {
    console.log('ERROR: Missing frameId');
    figma.ui.postMessage({
      type: 'iteration-error',
      payload: { error: 'Missing frameId', variationIndex },
    });
    return;
  }

  // Find the original frame
  const originalFrame = await figma.getNodeByIdAsync(frameId);

  if (!originalFrame || originalFrame.type !== 'FRAME') {
    console.log('ERROR: Original frame not found');
    figma.ui.postMessage({
      type: 'iteration-error',
      payload: { error: 'Original frame not found', variationIndex },
    });
    return;
  }

  try {
    const frameNode = originalFrame as FrameNode;

    // Initialize session if it doesn't exist yet
    if (!currentIterationSession) {
      currentIterationSession = {
        createdFrames: [],
        totalVariations: totalVariations,
      };
    }

    // Send status update: designing
    console.log(`Creating variation ${variationIndex + 1} using MVP pipeline...`);
    figma.ui.postMessage({
      type: 'variation-status-update',
      payload: {
        variationIndex,
        status: 'designing',
        statusText: 'Designing with AI',
      },
    });

    // Use MVP iteration pipeline
    const backendURL = 'https://crafter-ai-kappa.vercel.app'; // or your Railway URL
    const newFrame = await runIterationMVP(
      frameNode,
      payload.instructions || "Create a variation of this design",
      model || "claude",
      backendURL
    );

    newFrame.name = `${frameNode.name} (Iteration ${variationIndex + 1})`;

    // Position relative to original + offset for variation index
    const spacing = 100;
    newFrame.x = frameNode.x + frameNode.width + spacing + (variationIndex * (frameNode.width + spacing));
    newFrame.y = frameNode.y;

    // Add to canvas
    figma.currentPage.appendChild(newFrame);

    // Store the newly created frame in the session
    currentIterationSession.createdFrames.push(newFrame);

    // Clear selection to prevent automatic selection of newly created frame
    isUpdatingSelectionProgrammatically = true;
    figma.currentPage.selection = [];
    isUpdatingSelectionProgrammatically = false;

    // Send status update: complete
    console.log(`✅ Variation ${variationIndex + 1} created successfully`);
    figma.ui.postMessage({
      type: 'variation-status-update',
      payload: {
        variationIndex,
        status: 'complete',
        statusText: 'Iteration Complete',
        reasoning: reasoning || undefined,
        createdNodeId: newFrame.id,
      },
    });

    // Check if ALL variations have been created
    if (currentIterationSession.createdFrames.length === totalVariations) {
      console.log(`✨ ${totalVariations} iteration${totalVariations > 1 ? 's' : ''} created successfully`);

      // Clear the session
      currentIterationSession = null;

      // Notify UI that all variations are complete
      figma.ui.postMessage({
        type: 'all-variations-complete',
        payload: {
          totalVariations,
          completedCount: totalVariations,
        },
      });
    }
  } catch (error) {
    console.error('Error creating iteration variation:', error);

    // Send error status update for this specific variation
    figma.ui.postMessage({
      type: 'variation-status-update',
      payload: {
        variationIndex,
        status: 'error',
        statusText: 'Error when trying to create the design',
        error: error instanceof Error ? error.message : 'Failed to create iteration variation',
      },
    });
  }
}
```

### Step 2: Update Backend URL

In your UI code (wherever you call the backend), change:

```typescript
// OLD
const response = await fetch(`${BACKEND_URL}/api/iterate`, { ... });

// NEW
const response = await fetch(`${BACKEND_URL}/api/iterate-mvp`, { ... });
```

### Step 3: Deploy Backend Changes

Deploy to Vercel/Railway:

```bash
cd /Users/nabilhasan/Desktop/Crafter
vercel --prod
# or
railway up
```

### Step 4: Build Plugin

```bash
cd /Users/nabilhasan/Desktop/Crafter
npm run build
```

Then reload the plugin in Figma.

---

## Testing Checklist

### Test 1: Simple Frame with Components

1. Open Untitled UI file in Figma
2. Select a frame with a sidebar + content area (e.g., "Desktop/Settings")
3. Run iteration: "Change the content area to show a grid of profile cards"
4. ✅ Verify:
   - Console shows: "Found X unique components used in frame" (should be ~20-50, not 8370)
   - Console shows: "Extracted X components for design palette"
   - New frame created next to original
   - **Sidebar is an INSTANCE of the original Sidebar component (not rebuilt from rectangles)**
   - Content area has new layout

### Test 2: Component Key Consistency

1. In Figma, inspect the new variation frame
2. Right-click on the sidebar → "Go to main component"
3. ✅ Verify:
   - It takes you to the original Sidebar component in the design system
   - The sidebar instance has the correct component key

### Test 3: Logging Verification

Check console logs during iteration:

```
🎯 Starting MVP iteration on frame: Desktop/Settings
📸 Building frame snapshot...
  → 3 top-level nodes captured
🎨 Extracting design palette...
📊 Found 12 unique components used in frame
🎨 Extracted 12 components for design palette
🖼️  Exporting frame to PNG...
  → 145 KB
🚀 Sending to claude...
✅ Received response: Replaced content area with grid of profile cards
🔨 Reconstructing variation...
🔤 Preloading fonts...
✅ Fonts preloaded
📚 Built component map with 47 entries
📦 Reconstructing: Desktop/Settings (Iteration 1)
  ✅ Created instance: Sidebar (abc123-component-key)
  ✅ Created instance: ProfileCard (def456-component-key)
  ...
✅ Created 15 nodes, skipped 0
✅ MVP iteration complete!
```

### Test 4: Schema Validation

1. Check backend logs (Vercel/Railway)
2. ✅ Verify:
   - No schema errors in first attempt
   - If schema error occurs, retry logic kicks in

---

## Troubleshooting

### Issue: "Component key not found in map"

**Cause**: Mismatch between how keys are resolved in snapshot vs. componentMap

**Fix**: Ensure `getComponentKey()` is used consistently everywhere

```typescript
// ❌ WRONG
const key = component.key;

// ✅ RIGHT
import { getComponentKey } from './mvpUtils';
const key = getComponentKey(component);
```

### Issue: "Schema validation failed: padding must have numeric properties"

**Cause**: LLM returning malformed JSON

**Fix**: The Zod validation will catch this and retry automatically. Check backend logs for error details.

### Issue: Still seeing 8370 components in logs

**Cause**: Old `handleGetDesignSystem` is being called instead of `extractFrameScopedPalette`

**Fix**: Make sure you're using the MVP integration code, not the old iteration flow.

---

## Next Steps (After MVP Works)

1. **Week 2**: Add `padding`, `itemSpacing`, `size` fields for proper auto-layout
2. **Week 3**: Add `fills`, `textStyleId`, `cornerRadius` for styling
3. **Week 4**: Add variant selection logic (choose specific variant, not just default)
4. **Week 5**: Add fuzzy matching for component names (when LLM uses slightly different name)

---

## Key Insights

### Why This Works

1. **Frame-scoped scanning**: Only send components actually used in the selected frame (20-50 vs 8370)

2. **Structural snapshot**: LLM sees the CURRENT structure with `componentKey` for each instance, so it knows "this frame already has Sidebar instance with key abc123"

3. **Explicit prompts**: Both Gemini and Claude prompts have side-by-side examples showing:
   - ❌ Wrong: Rebuild sidebar from primitives
   - ✅ Right: Reuse sidebar via `{ type: "INSTANCE", componentKey: "abc123" }`

4. **Component key consistency**: Single source of truth (`getComponentKey()`) ensures plugin, backend, and reconstruction all use the same key resolution logic

5. **Validation**: Zod catches malformed outputs before they reach Figma, preventing runtime errors

---

## Performance Impact

- **Before**: ~1.6M tokens sent to LLM (8370 components × ~200 tokens each)
- **After**: ~5-10K tokens (20-50 components × ~150 tokens + frame snapshot)
- **Improvement**: ~99% reduction in token usage = faster responses + lower cost

---

## Contact

If you encounter issues, check:
1. Browser console (for plugin errors)
2. Vercel/Railway logs (for backend errors)
3. `console.log` output in Figma (for reconstruction errors)

Enable DEBUG_MODE in code.ts for more verbose logging.
