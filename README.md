# ✨ Crafter - The AI Twin for Designers

A Figma plugin that uses Claude AI to generate layouts using your design system components.

## 🎯 What is Crafter?

Crafter allows designers to:
1. **Extract their design system** (components, styles, color tokens) from the current Figma file
2. **Describe layouts in natural language** like "Create a dashboard with navigation and card grid"
3. **Generate layouts automatically** using Claude AI that understands your design system
4. **Insert components directly** into the Figma canvas

## 📁 Project Structure

```
Crafter/
├── manifest.json          # Figma plugin manifest
├── package.json          # Dependencies and build scripts
├── tsconfig.json         # TypeScript configuration
├── webpack.config.js     # Webpack bundler configuration
├── src/
│   ├── code.ts          # Main plugin code (runs in Figma)
│   ├── ui.tsx           # React UI component
│   ├── ui.html          # HTML template
│   ├── ui.css           # UI styles
│   ├── types.ts         # Shared TypeScript types
│   └── claudeService.ts # Claude API integration
└── dist/                # Built files (generated)
    ├── code.js
    ├── ui.js
    └── ui.html
```

## 🚀 Setup Instructions

### 1. Install Dependencies

```bash
cd ~/Desktop/Crafter
npm install
```

### 2. Build the Plugin

For development with auto-rebuild:
```bash
npm run watch
```

For production build:
```bash
npm run build
```

### 3. Load in Figma

1. Open Figma Desktop App
2. Go to **Plugins** → **Development** → **Import plugin from manifest...**
3. Navigate to `~/Desktop/Crafter` and select `manifest.json`
4. The plugin will now appear in your Plugins menu

### 4. Run the Plugin

1. Open any Figma file (preferably one with components)
2. Go to **Plugins** → **Development** → **Crafter**
3. The plugin panel will open

## 🎨 Usage

### Using Mock Mode (No API Key Required)

The plugin includes a mock mode for testing without a real API key:

1. Keep the API key as `MOCK_API_KEY` (default)
2. Enter a prompt like: "Create a dashboard layout with navigation"
3. Click **Generate Layout**
4. A mock layout will be created using placeholder components

### Using Real Claude API

1. Get an API key from [Anthropic](https://console.anthropic.com/)
2. In the plugin, click **API Settings**
3. Enter your API key (starts with `sk-ant-...`)
4. Enter your design prompt
5. Click **Generate Layout**

### Example Prompts

- "Create a dashboard layout with navigation and content cards"
- "Design a login screen with our components"
- "Generate three variations of a profile card layout"
- "Build a settings page with tabs and form fields"

## 🏗️ How It Works

### Architecture

```
┌─────────────┐         ┌──────────────┐         ┌─────────────┐
│   UI (TSX)  │ ◄─────► │  Main Code   │ ◄─────► │   Figma     │
│  Browser    │  msgs   │  (Figma API) │  API    │  Document   │
└─────────────┘         └──────────────┘         └─────────────┘
       │
       ▼
┌──────────────┐
│  Claude API  │
│  (Anthropic) │
└──────────────┘
```

### Flow

1. **Extract Design System**: Plugin scans current Figma file for components, colors, and text styles
2. **User Input**: Designer enters a natural language prompt
3. **AI Generation**: Claude API receives design system + prompt and generates layout JSON
4. **Render**: Plugin creates Figma nodes (frames, component instances) on the canvas

### Key Files Explained

#### `src/code.ts`
- Main plugin code with access to Figma API
- Extracts design system from Figma document
- Creates nodes on the canvas
- Handles messages from UI

#### `src/ui.tsx`
- React-based plugin interface
- Input form for prompts and API key
- Calls Claude API via `claudeService`
- Sends generated layouts to plugin code

#### `src/claudeService.ts`
- Interfaces with Claude API
- Formats design system data for Claude
- Parses Claude's response into layout structure
- Includes mock mode for testing

#### `src/types.ts`
- Shared TypeScript interfaces
- Message types for UI ↔ Plugin communication
- Design system data structures
- Layout node specifications

## 🔧 Development

### Watch Mode

```bash
npm run watch
```

This will rebuild automatically when you save files. To see changes:
1. In Figma, close and reopen the plugin
2. Or reload using **Plugins** → **Development** → **Reload plugin**

### Debugging

**Plugin Code (code.ts)**:
- Open Developer Console in Figma: **Plugins** → **Development** → **Open Console**
- View logs with `console.log()`

**UI Code (ui.tsx)**:
- Right-click in plugin panel → **Inspect Element**
- Opens Chrome DevTools for the iframe

### Linting

```bash
npm run lint        # Check for issues
npm run lint:fix    # Auto-fix issues
```

## 🎯 MVP Features

- ✅ Extract design system from Figma file
- ✅ React-based UI with prompt input
- ✅ Claude API integration (with mock mode)
- ✅ Generate layouts on canvas
- ✅ Component instance creation
- ✅ Placeholder rectangles for missing components
- ✅ Error handling and user feedback

## 🔮 Future Enhancements

- [ ] Import design systems from other files
- [ ] Save and reuse prompt templates
- [ ] Layout variation generation (A/B testing)
- [ ] Auto-apply color styles
- [ ] Text content generation
- [ ] Responsive layout variations
- [ ] Design system documentation
- [ ] Team collaboration features

## 📝 API Key Setup

### Getting an Anthropic API Key

1. Visit [console.anthropic.com](https://console.anthropic.com/)
2. Sign up or log in
3. Go to **API Keys**
4. Click **Create Key**
5. Copy your key (starts with `sk-ant-`)

### Using the API Key

**Option 1: In the Plugin UI**
- Click "API Settings" in the plugin
- Paste your key
- It's stored in browser memory (not saved between sessions)

**Option 2: Environment Variable** (Future)
- Set `ANTHROPIC_API_KEY` environment variable
- Plugin will auto-detect it

## 🐛 Troubleshooting

### Plugin won't load
- Ensure you've run `npm run build`
- Check that `dist/` folder contains `code.js` and `ui.html`
- Verify manifest.json points to correct paths

### "Design system not loaded"
- Make sure your Figma file has some components
- Try reloading the plugin
- Check console for errors

### API errors
- Verify your API key is correct
- Check network access in manifest.json
- Use mock mode to test without API

### Components not rendering
- Components must be in the same file or published library
- Check component keys are valid
- Plugin will create placeholders for missing components

## 📄 License

MIT

## 🤝 Contributing

This is an MVP. Feel free to extend it with:
- Better error handling
- More layout types
- Style application
- Responsive designs
- And more!

---

Built with ❤️ using Claude AI, React, and TypeScript
