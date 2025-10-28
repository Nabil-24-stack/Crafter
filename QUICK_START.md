# ⚡ Crafter - Quick Start Guide

## 🚀 Deploy in 5 Minutes

### 1. Deploy Backend

```bash
# Install Vercel CLI
npm install -g vercel

# Login
vercel login

# Deploy
cd ~/Desktop/crafter/server
npm install
vercel --prod
```

**Save your Vercel URL:** `https://your-project.vercel.app`

### 2. Add API Key to Vercel

Go to [vercel.com/dashboard](https://vercel.com/dashboard) → Your Project → Settings → Environment Variables

Add:
- **Name:** `ANTHROPIC_API_KEY`
- **Value:** `sk-ant-your-key-here`
- **Environments:** All

Then redeploy: `vercel --prod`

### 3. Configure Plugin

Edit `/Users/nabilhasan/Desktop/crafter/src/config.ts`:

```typescript
export const config = {
  BACKEND_URL: 'https://your-project.vercel.app/api/generate',
};
```

### 4. Build & Load in Figma

```bash
cd ~/Desktop/crafter
npm run build
```

In Figma:
- **Plugins** → **Development** → **Import plugin from manifest...**
- Select `/Users/nabilhasan/Desktop/crafter/manifest.json`

### 5. Use the Plugin

1. Open plugin: **Plugins** → **Development** → **Crafter**
2. Click **"Scan Design System"**
3. Uncheck **"Use Mock Mode"**
4. Enter prompt: `"Create a dashboard layout"`
5. Click **"Generate Layout"**

---

## 📁 Project Structure

```
crafter/
├── src/              # Figma plugin source code
├── dist/             # Built plugin (auto-generated)
├── server/           # Vercel backend
│   └── api/
│       └── generate.ts  # Serverless function
├── manifest.json     # Figma plugin manifest
└── DEPLOYMENT_GUIDE.md  # Full documentation
```

---

## 🔧 Common Commands

```bash
# Build plugin
cd ~/Desktop/crafter && npm run build

# Deploy backend
cd ~/Desktop/crafter/server && vercel --prod

# View backend logs
cd ~/Desktop/crafter/server && vercel logs

# Test backend locally
cd ~/Desktop/crafter/server && npm run dev
```

---

## 🐛 Quick Fixes

| Error | Solution |
|-------|----------|
| "Failed to fetch" | Update `BACKEND_URL` in `src/config.ts` |
| "API key not found" | Add `ANTHROPIC_API_KEY` to Vercel env vars |
| "Design system not loaded" | Click "Scan Design System" button |
| Mock layouts only | Uncheck "Use Mock Mode" |

---

## 💡 Tips

- **Local Testing:** Use `http://localhost:3000/api/generate` in config, run `npm run dev` in server folder
- **Monitoring:** Check Vercel dashboard for logs and errors
- **API Usage:** Monitor at [console.anthropic.com](https://console.anthropic.com/)

---

For detailed instructions, see [DEPLOYMENT_GUIDE.md](./DEPLOYMENT_GUIDE.md)
