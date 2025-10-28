# 🚀 Crafter - Complete Deployment Guide

This guide will help you deploy the Crafter Figma plugin with a secure backend on Vercel.

## 📋 Table of Contents

1. [Overview](#overview)
2. [Prerequisites](#prerequisites)
3. [Step-by-Step Deployment](#step-by-step-deployment)
4. [Configuration](#configuration)
5. [Testing](#testing)
6. [Troubleshooting](#troubleshooting)

---

## 🎯 Overview

**Crafter** consists of two components:

1. **Figma Plugin** (Client) - Runs in Figma, sends requests to backend
2. **Vercel Backend** (Server) - Securely handles Claude API calls

**Security Flow:**
```
Figma Plugin → Vercel Backend → Claude API
     ↑              ↓ (has API key)
     ←─── Response ──
```

Your Anthropic API key is **never exposed** to plugin users - it's stored securely in Vercel.

---

## ✅ Prerequisites

Before you begin, make sure you have:

- [ ] **Anthropic API Key** - Get one from [console.anthropic.com](https://console.anthropic.com/)
- [ ] **Vercel Account** - Sign up at [vercel.com](https://vercel.com) (free)
- [ ] **Node.js** - Version 18+ installed ([nodejs.org](https://nodejs.org))
- [ ] **Figma Desktop App** - Download from [figma.com](https://www.figma.com/downloads/)

---

## 🚀 Step-by-Step Deployment

### Part 1: Deploy Backend to Vercel

#### 1.1 Install Vercel CLI

```bash
npm install -g vercel
```

#### 1.2 Login to Vercel

```bash
vercel login
```

Follow the prompts to authenticate (you can use GitHub, GitLab, Bitbucket, or email).

#### 1.3 Navigate to Server Directory

```bash
cd ~/Desktop/crafter/server
```

#### 1.4 Install Dependencies

```bash
npm install
```

#### 1.5 Deploy to Vercel

```bash
vercel
```

**You'll be asked:**

- **Set up and deploy?** → `Yes`
- **Which scope?** → Select your Vercel account
- **Link to existing project?** → `No`
- **Project name?** → `crafter-backend` (or your preferred name)
- **Directory location?** → `./` (press Enter)
- **Override settings?** → `No`

Vercel will deploy and give you a **Preview URL** like:
```
https://crafter-backend-xxx.vercel.app
```

#### 1.6 Add Environment Variable

Add your Anthropic API key to Vercel:

**Option A: Using Vercel Dashboard (Recommended)**

1. Go to [vercel.com/dashboard](https://vercel.com/dashboard)
2. Click on your `crafter-backend` project
3. Go to **Settings** → **Environment Variables**
4. Click **Add New**
5. Fill in:
   - **Name:** `ANTHROPIC_API_KEY`
   - **Value:** Your API key (starts with `sk-ant-...`)
   - **Environments:** Select all (Production, Preview, Development)
6. Click **Save**

**Option B: Using CLI**

```bash
vercel env add ANTHROPIC_API_KEY
```

When prompted:
- Paste your Anthropic API key
- Select: **Production, Preview, and Development** (use spacebar to select, Enter to confirm)

#### 1.7 Deploy to Production

```bash
vercel --prod
```

You'll get a **Production URL** like:
```
https://crafter-backend.vercel.app
```

**✅ Save this URL - you'll need it for the plugin configuration!**

---

### Part 2: Configure Figma Plugin

#### 2.1 Update Backend URL

Edit `/Users/nabilhasan/Desktop/crafter/src/config.ts`:

```typescript
export const config = {
  // Replace with your Vercel production URL
  BACKEND_URL: 'https://crafter-backend.vercel.app/api/generate',
};
```

**Replace `crafter-backend` with your actual Vercel project name!**

#### 2.2 Rebuild the Plugin

```bash
cd ~/Desktop/crafter
npm run build
```

#### 2.3 Load Plugin in Figma

1. Open **Figma Desktop App**
2. Go to **Plugins** → **Development** → **Import plugin from manifest...**
3. Navigate to `~/Desktop/crafter` and select `manifest.json`
4. The plugin will now appear in your Plugins menu as **"Crafter"**

---

### Part 3: Test the Integration

#### 3.1 Open the Plugin

1. Open any Figma file (or create a new one)
2. Go to **Plugins** → **Development** → **Crafter**
3. The plugin panel should open

#### 3.2 Scan Design System

1. Click the **"Scan Design System"** button
2. Wait for it to detect components (you should see counts)

#### 3.3 Generate Layout

1. Make sure **"Use Mock Mode"** is **UNCHECKED** ✅
2. Enter a prompt like:
   ```
   Create a dashboard layout with navigation and content cards
   ```
3. Click **"Generate Layout"**

#### 3.4 Verify Success

If everything works:
- ✅ You'll see a success message
- ✅ A layout will appear on your Figma canvas
- ✅ The layout uses your actual design system components

---

## ⚙️ Configuration

### Updating the Backend URL

If you need to change the backend URL later:

1. Edit `src/config.ts`
2. Run `npm run build`
3. Reload the plugin in Figma

### Updating the API Key

To change your Anthropic API key:

1. Go to [Vercel Dashboard](https://vercel.com/dashboard)
2. Select your project
3. **Settings** → **Environment Variables**
4. Edit `ANTHROPIC_API_KEY`
5. Redeploy: `vercel --prod`

### Network Access (Manifest)

The `manifest.json` is configured to allow:

- **Production:** `https://*.vercel.app` (all Vercel deployments)
- **Development:** `http://localhost:3000` (local testing)

If you deploy to a custom domain, update `allowedDomains` in `manifest.json`.

---

## 🧪 Testing

### Test Locally (Optional)

You can test the backend locally before deploying:

1. Create `.env` file in `/server`:
   ```bash
   cd ~/Desktop/crafter/server
   cp .env.example .env
   ```

2. Edit `.env` and add your API key:
   ```
   ANTHROPIC_API_KEY=sk-ant-your-key-here
   ```

3. Run local dev server:
   ```bash
   npm run dev
   ```

4. In `src/config.ts`, temporarily use:
   ```typescript
   BACKEND_URL: 'http://localhost:3000/api/generate',
   ```

5. Test the plugin in Figma

6. **Don't forget to switch back to your Vercel URL before sharing!**

### Test API Endpoint

You can test the API directly:

```bash
curl -X POST https://your-project.vercel.app/api/generate \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "Create a login screen",
    "designSystem": {
      "components": [],
      "colors": [],
      "textStyles": []
    }
  }'
```

---

## 🐛 Troubleshooting

### Error: "Failed to fetch" or CORS error

**Cause:** Backend URL is incorrect or not accessible

**Solution:**
1. Verify your Vercel deployment URL
2. Check `src/config.ts` has the correct URL
3. Make sure you rebuilt the plugin after changing config
4. Verify `manifest.json` includes `https://*.vercel.app` in `allowedDomains`

### Error: "Server configuration error: API key not found"

**Cause:** Anthropic API key not set in Vercel

**Solution:**
1. Go to Vercel Dashboard → Your Project → Settings → Environment Variables
2. Add `ANTHROPIC_API_KEY` with your key
3. Redeploy: `vercel --prod`

### Error: "Claude API error: 401"

**Cause:** Invalid or expired API key

**Solution:**
1. Check your API key is correct at [console.anthropic.com](https://console.anthropic.com/)
2. Update it in Vercel environment variables
3. Redeploy

### Plugin shows "Design system not loaded"

**Cause:** You haven't scanned the design system yet

**Solution:**
1. Click **"Scan Design System"** button
2. Wait for it to complete
3. Then try generating a layout

### Mock mode keeps generating simple layouts

**Cause:** "Use Mock Mode" checkbox is enabled

**Solution:**
1. **Uncheck** the "Use Mock Mode" checkbox
2. Verify the status text says "🤖 Using Claude AI via proxy server"
3. Try generating again

### Vercel function timeout

**Cause:** Claude API response took too long

**Solution:**
1. Vercel free tier has a 10-second timeout
2. Upgrade to Pro for 60-second timeout
3. Or simplify your design system (reduce number of components)

---

## 📊 Monitoring & Logs

### View Deployment Logs

```bash
vercel logs
```

Or visit the Vercel dashboard → Your Project → Deployments → View Logs

### Monitor API Usage

- **Anthropic:** Check usage at [console.anthropic.com](https://console.anthropic.com/)
- **Vercel:** Check function invocations in dashboard

---

## 💰 Cost Estimate

### Vercel (Free Tier)
- ✅ 100GB bandwidth/month
- ✅ 100 hours serverless execution/month
- ✅ Unlimited deployments
- **Cost:** FREE for personal use

### Anthropic API
- Claude 4.5 Sonnet: ~$3 per million input tokens, ~$15 per million output tokens
- Typical layout generation: ~500-2000 tokens
- **Estimate:** $0.01 - $0.05 per generation
- **Cost:** Pay-as-you-go

For a personal project with ~100 generations/month: **~$1-5/month**

---

## 🔐 Security Best Practices

✅ **DO:**
- Store API key only in Vercel environment variables
- Use environment variable references (never hardcode keys)
- Enable CORS only for your plugin
- Monitor API usage regularly

❌ **DON'T:**
- Never commit API keys to Git
- Never expose keys in client-side code
- Don't share your Vercel project publicly with env vars

---

## 📚 Additional Resources

- [Vercel Documentation](https://vercel.com/docs)
- [Vercel Serverless Functions](https://vercel.com/docs/functions)
- [Anthropic API Docs](https://docs.anthropic.com/)
- [Figma Plugin API](https://www.figma.com/plugin-docs/)

---

## 🎉 Success Checklist

After completing this guide, you should have:

- [x] Backend deployed to Vercel
- [x] Environment variable (`ANTHROPIC_API_KEY`) configured
- [x] Plugin configured with Vercel URL
- [x] Plugin loaded in Figma
- [x] Successfully generated a layout using Claude AI

---

## 🆘 Need Help?

If you encounter issues:

1. Check this troubleshooting guide
2. Review Vercel deployment logs
3. Verify API key is valid
4. Test the endpoint with curl
5. Check browser console in Figma (Right-click plugin → Inspect)

---

**Happy designing with AI! 🎨✨**
