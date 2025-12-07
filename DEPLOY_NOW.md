# 🚀 Deploy to Railway NOW - Step by Step

## Prerequisites
- GitHub account (you have this)
- Railway account (free - create at https://railway.app)
- Your API keys ready (ANTHROPIC_API_KEY and/or GEMINI_API_KEY)

---

## Step 1: Create Railway Account (2 minutes)

1. Go to https://railway.app
2. Click "Start a New Project"
3. Click "Login with GitHub"
4. Authorize Railway

---

## Step 2: Deploy from GitHub (3 minutes)

1. In Railway dashboard, click **"New Project"**

2. Select **"Deploy from GitHub repo"**

3. Choose **"Nabil-24-stack/Crafter"** from the list
   - If you don't see it, click "Configure GitHub App" and grant access

4. Railway will automatically:
   - Detect `railway.toml`
   - Install dependencies from `package.json`
   - Start `server-mvp.js`

5. Wait for deployment (~2 minutes)
   - You'll see build logs in real-time
   - Look for: "Deployment successful"

---

## Step 3: Set Environment Variables (1 minute)

1. In your Railway project, click **"Variables"** tab

2. Click **"+ New Variable"**

3. Add these one by one:

   ```
   Name: ANTHROPIC_API_KEY
   Value: your-actual-claude-api-key
   ```

   ```
   Name: GEMINI_API_KEY
   Value: your-actual-gemini-api-key
   ```

   ```
   Name: NODE_ENV
   Value: production
   ```

4. Click **"Deploy"** to redeploy with new variables

---

## Step 4: Get Your Deployment URL (30 seconds)

1. In Railway dashboard, click **"Settings"** tab

2. Scroll to **"Domains"** section

3. Click **"Generate Domain"**

4. Copy the URL (e.g., `https://crafter-production.up.railway.app`)

---

## Step 5: Update Plugin Code (2 minutes)

1. Open `/Users/nabilhasan/Desktop/Crafter/src/code.ts`

2. Find line 2364 (search for `backendURL`):

   ```typescript
   const backendURL = 'https://crafter-ai-kappa.vercel.app';
   ```

3. Change to your Railway URL:

   ```typescript
   const backendURL = 'https://crafter-production.up.railway.app';
   ```

4. Save the file

---

## Step 6: Rebuild Plugin (1 minute)

```bash
cd /Users/nabilhasan/Desktop/Crafter
npm run build
```

Wait for "compiled successfully"

---

## Step 7: Reload Plugin in Figma (30 seconds)

1. Open Figma
2. Right-click on the Crafter plugin
3. Select **"Reload plugin"** or close and reopen

---

## Step 8: Test It! (2 minutes)

1. In Figma, open your Untitled UI file

2. Select a frame with components (e.g., "Desktop/Settings")

3. Open Figma DevTools Console:
   - Right-click anywhere → **"Inspect"**
   - Click **"Console"** tab

4. In Crafter plugin, trigger an iteration

5. Watch the console logs:

```
✨ Creating variation 1 using MVP pipeline...
📸 Building frame snapshot...
  → 3 top-level nodes captured
🎨 Extracting design palette...
📊 Found 12 unique components used in frame  ← GOOD! (not 8370)
  → 12 components in palette
🖼️  Exporting frame to PNG...
  → 145 KB
🚀 Sending to claude...
✅ Received response: ...
🔨 Reconstructing variation...
✅ Created X nodes, skipped 0
✅ Variation 1 created successfully
```

6. ✅ If you see this, **IT WORKS!**

---

## Troubleshooting

### "Network error" or "Backend error"

**Check Railway logs:**
1. Go to Railway dashboard
2. Click "Deployments"
3. Click latest deployment
4. Check logs for errors

**Common fixes:**
- Make sure environment variables are set
- Check API keys are correct
- Verify domain is generated

### Still seeing "Found 8370 components"

**Problem:** UI is calling old handler

**Fix:** You need to update your UI code to call:
```typescript
type: 'iterate-design-variation-mvp'  // not 'iterate-design-variation'
```

### "Component key not found"

**Expected for first test!** The LLM needs to actually return valid component keys.

Check Railway logs to see what the LLM is returning.

---

## Verify Deployment

Test the health endpoint:

```bash
curl https://your-railway-url.up.railway.app/api/health
```

Should return:
```json
{
  "status": "healthy",
  "timestamp": "2025-12-07T..."
}
```

---

## What Happens Next

Once deployed and tested:

1. **Logging works** → Frame-scoped scanning is working! ✅
2. **Components reused** → LLM is using componentKeys! ✅
3. **Variations created** → Full pipeline working! ✅

---

## Total Time: ~10 minutes

- Create Railway account: 2 min
- Deploy from GitHub: 3 min
- Set env variables: 1 min
- Get URL: 30 sec
- Update code: 2 min
- Rebuild: 1 min
- Reload plugin: 30 sec
- Test: 2 min

---

## Quick Links

- Railway Dashboard: https://railway.app
- Your GitHub Repo: https://github.com/Nabil-24-stack/Crafter
- Deployment Guide: `DEPLOY_TO_RAILWAY.md` (detailed version)
- Test Guide: `READY_TO_TEST.md`

---

## Need Help?

1. Check Railway deployment logs first
2. Check Figma console logs
3. Verify environment variables are set
4. Make sure backendURL in code.ts matches Railway URL

**You're ready to deploy! Go to https://railway.app and start! 🚀**
