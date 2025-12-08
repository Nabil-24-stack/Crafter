# High-Fidelity Design Generation Implementation Status

## Completed ✅

### 1. Enhanced Data Extraction (styleExtractor.ts)
- Added `nodeId` field to track Figma node IDs for exact cloning
- Added `role` field ('shell', 'content', 'global-nav', 'local-nav') for preservation rules
- Added style token detection with predefined registry
- Added `styleTokens` array to structural context
- Created `detectStyleToken()` function for matching nodes to tokens
- Created `assignElementRole()` function for role assignment

### 2. Updated Types (types.ts)
- Changed `COMPONENT` to `INSTANCE` (Figma-aligned terminology)
- Added `sourceNodeId` field to all node types for preservation
- Added `styleToken` field to FigmaInstanceNode
- Added `role` field to FigmaFrameNode
- Updated union type: `FigmaLayoutNode = FigmaFrameNode | FigmaInstanceNode | FigmaTextNode`

### 3. Three-Mode Prompt System (server-mvp.js - Partial)
- Added STYLE_TOKENS registry with 6 predefined tokens
- Updated `buildGeminiFigmaJsonPrompt()` with:
  - Element inventory with node IDs
  - Preservation rules by role
  - Three-mode output system explanation
  - Emphasis on PNG as primary visual reference
  - Example showing sourceNodeId and styleToken usage
  - Simplified technical rules

## TODO 🔄

### 1. Complete server-mvp.js Updates
- [ ] Update `buildClaudeFigmaJsonPrompt()` with same three-mode system
- [ ] Ensure both prompts emphasize "preserve by default"
- [ ] Add stronger PNG utilization instructions

### 2. Smart Reconstruction Logic (code.ts)
- [ ] Add reconstruction function that handles three modes:
  1. If `sourceNodeId` → clone exact node
  2. If `styleToken` → create from token registry
  3. Else → create bare layout frame
- [ ] Add token-to-component mapping
- [ ] Implement node cloning by ID

### 3. Testing & Validation
- [ ] Test with dashboard layout (sidebar + header)
- [ ] Test with single-page layout (no navigation)
- [ ] Test with "Team tab" request
- [ ] Verify preservation of shell elements
- [ ] Verify token-based component creation

## Key Innovation Points

1. **Three-Mode System**: Every node must be either preserved (sourceNodeId), use a token (styleToken), or be a bare layout frame
2. **Role-Based Preservation**: Shell and global-nav always preserved, content modified
3. **No Custom Styles**: LLM cannot invent pixel values, only use predefined tokens
4. **PNG as Primary**: Visual reference drives spacing and density decisions

## Next Steps

1. Complete Claude prompt updates
2. Implement reconstruction logic in code.ts
3. Build and test the system
4. Iterate based on results