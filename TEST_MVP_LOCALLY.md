# Test MVP Pipeline Locally

Since you hit the Vercel Hobby plan limit (12 serverless functions max), you can test the MVP pipeline locally first.

## Setup (5 minutes)

### 1. Start Local Backend Server

Open a terminal and run:

```bash
cd /Users/nabilhasan/Desktop/Crafter
node api/iterate-mvp.ts
```

**Wait!** That won't work because it's a TypeScript file. Instead, we need to use the proxy server or create a simple test script.

Actually, the easiest way is to test with a temporary modification:

### Option A: Test with Mock Response (Fastest)

Temporarily modify `handleIterateDesignVariationMVP` in `code.ts` to skip the backend call:

```typescript
// 4. Send to backend
console.log(`🚀 Sending to ${model}...`);

// TEMPORARY: Mock response for local testing
const result: IterationResponseMVP = {
  reasoning: "Test variation - keeping sidebar, changing content",
  figmaStructure: {
    type: "FRAME",
    name: "Test Variation",
    children: [
      // This will be empty for now - just testing the pipeline
    ]
  }
};
console.log(`✅ Received mock response`);

// Comment out the real backend call:
/*
const backendURL = 'https://crafter-ai-kappa.vercel.app';
const request: IterationRequestMVP = {
  frameSnapshot,
  designPalette,
  imagePNG,
  instructions: instructions || "Create a variation of this design",
  model: model || "claude",
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
*/
```

### Option B: Run Local Express Server (More Complete)

1. Create a simple local server:

```bash
# Create a test server file
cat > /Users/nabilhasan/Desktop/Crafter/test-server.js << 'EOF'
const express = require('express');
const cors = require('cors');
const app = express();

app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Import the MVP handler logic (simplified for testing)
app.post('/api/iterate-mvp', async (req, res) => {
  try {
    const { frameSnapshot, designPalette, imagePNG, instructions, model } = req.body;

    console.log('📊 Received request:');
    console.log(`  Frame: ${frameSnapshot.name}`);
    console.log(`  Components in palette: ${designPalette.components.length}`);
    console.log(`  Instructions: ${instructions}`);
    console.log(`  Model: ${model}`);

    // For now, just return a simple test response
    // You can add actual LLM calls here later
    const response = {
      reasoning: "Test variation keeping all existing components",
      figmaStructure: {
        type: "FRAME",
        name: frameSnapshot.name + " (Test)",
        children: [
          // Return first component from palette as test
          {
            type: "INSTANCE",
            name: designPalette.components[0]?.name || "Test",
            componentKey: designPalette.components[0]?.key || "test-key"
          }
        ]
      }
    };

    res.json(response);
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: error.message });
  }
});

const PORT = 3001;
app.listen(PORT, () => {
  console.log(`🚀 Test MVP server running on http://localhost:${PORT}`);
  console.log(`   Endpoint: http://localhost:${PORT}/api/iterate-mvp`);
});
EOF

# Run it
node test-server.js
```

2. Update `handleIterateDesignVariationMVP` in `code.ts` to use local server:

```typescript
const backendURL = 'http://localhost:3001'; // Change this line
```

3. Rebuild plugin:

```bash
npm run build
```

4. Reload plugin in Figma

---

## Test Steps

1. Open Figma
2. Open Untitled UI file
3. Select a frame with components (e.g., "Desktop/Settings")
4. Open Crafter plugin
5. **Important:** You need to modify your UI code to call the MVP handler

In your UI code, change the message type from:

```typescript
figma.ui.postMessage({
  type: 'iterate-design-variation',
  payload: { ... }
});
```

To:

```typescript
figma.ui.postMessage({
  type: 'iterate-design-variation-mvp',  // Add -mvp
  payload: {
    instructions: "Your iteration instructions",
    frameId: selectedFrameId,
    variationIndex: 0,
    totalVariations: 1,
    model: "claude"
  }
});
```

6. Watch the Figma console for logs:

```
✨ Creating variation 1 using MVP pipeline...
📸 Building frame snapshot...
  → 3 top-level nodes captured
🎨 Extracting design palette...
📊 Found 12 unique components used in frame
  → 12 components in palette
🖼️  Exporting frame to PNG...
  → 145 KB
🚀 Sending to claude...
✅ Received response: ...
🔨 Reconstructing variation...
✅ Created 1 nodes, skipped 0
✅ Variation 1 created successfully
```

---

## What to Look For

✅ **Success indicators:**
- Console shows "Found X unique components" (should be ~20-50, NOT 8370)
- Console shows "Extracted X components for design palette"
- New frame created next to original
- If you're using Option A (mock), it will create an empty frame but you'll see the logging

❌ **Failure indicators:**
- "Found 8370 components" → Still using old code path
- "Component key not found in map" → Check component map building
- Network errors → Check backend URL

---

## Next Steps

Once you verify the logging works locally:

1. Deploy to Railway (if you have that)
2. Or upgrade Vercel to Pro plan
3. Or consolidate some of your existing Vercel functions to free up slots

The code is ready and committed to GitHub - you just need a backend deployment!
