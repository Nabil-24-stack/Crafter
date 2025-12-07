# Deploy MVP Server to Railway

## Quick Deploy (5 minutes)

### Option 1: Using Railway Dashboard (Easiest)

1. **Go to Railway**
   - Visit https://railway.app
   - Sign in with GitHub

2. **Create New Project**
   - Click "New Project"
   - Select "Deploy from GitHub repo"
   - Choose your `Crafter` repository
   - Railway will auto-detect the configuration

3. **Set Environment Variables**
   - In the Railway dashboard, go to your project
   - Click "Variables"
   - Add:
     ```
     ANTHROPIC_API_KEY=your-claude-api-key
     GEMINI_API_KEY=your-gemini-api-key
     NODE_ENV=production
     ```

4. **Deploy**
   - Railway will automatically deploy
   - Wait for deployment to complete (~2 minutes)
   - Copy the deployment URL (e.g., `https://your-app.up.railway.app`)

5. **Update Plugin**
   - In `src/code.ts`, line 2364, change:
     ```typescript
     const backendURL = 'https://your-app.up.railway.app';
     ```
   - Rebuild: `npm run build`
   - Reload plugin in Figma

6. **Test**
   - Open Figma
   - Select a frame
   - Trigger iteration
   - Check console logs

---

### Option 2: Using Railway CLI

1. **Login to Railway**
   ```bash
   railway login
   ```

2. **Link to Project**
   ```bash
   cd /Users/nabilhasan/Desktop/Crafter
   railway link
   ```

   Or create new project:
   ```bash
   railway init
   ```

3. **Set Environment Variables**
   ```bash
   railway variables set ANTHROPIC_API_KEY="your-claude-api-key"
   railway variables set GEMINI_API_KEY="your-gemini-api-key"
   railway variables set NODE_ENV="production"
   ```

4. **Deploy**
   ```bash
   railway up
   ```

5. **Get URL**
   ```bash
   railway domain
   ```

---

## What Gets Deployed

Railway will deploy `server-mvp.js` which includes:

✅ Express server
✅ CORS enabled
✅ `/api/iterate-mvp` endpoint
✅ Gemini & Claude API integration
✅ Frame-scoped component prompts
✅ Automatic retry logic
✅ Health check endpoint

---

## Verify Deployment

### Test Health Endpoint

```bash
curl https://your-app.up.railway.app/api/health
```

Should return:
```json
{
  "status": "healthy",
  "timestamp": "2025-12-07T..."
}
```

### Test Iteration Endpoint

```bash
curl -X POST https://your-app.up.railway.app/api/iterate-mvp \
  -H "Content-Type: application/json" \
  -d '{
    "frameSnapshot": {"id": "test", "name": "Test", "width": 100, "height": 100, "children": []},
    "designPalette": {"components": []},
    "imagePNG": "test",
    "instructions": "test",
    "model": "claude"
  }'
```

Should return error about API keys (which means endpoint is working).

---

## Troubleshooting

### "Cannot find module 'express'"

Railway should auto-install dependencies. If not:
1. Make sure `package.json` lists `express` and `cors` as dependencies
2. Check Railway build logs

### "API key not configured"

Set environment variables in Railway dashboard:
- Settings → Variables → Add Variable

### "Port already in use" (local testing)

```bash
# Kill existing server
lsof -ti:3001 | xargs kill -9

# Or use different port
PORT=3002 node server-mvp.js
```

### "CORS error"

Already handled in server-mvp.js - CORS is enabled for all origins.

---

## Cost

Railway pricing:
- **Hobby Plan**: $5/month (includes $5 credit)
- First 500 hours free per month
- Additional usage: $0.000231/GB-hour

For this MVP server, costs should be minimal (~$1-2/month).

---

## Next Steps After Deploy

1. ✅ Get Railway deployment URL
2. ✅ Update `src/code.ts` line 2364 with Railway URL
3. ✅ Rebuild plugin: `npm run build`
4. ✅ Reload plugin in Figma
5. ✅ Test iteration
6. ✅ Check logs in Railway dashboard

---

## Alternative: Test Locally First

Before deploying, test the server locally:

```bash
# Set env vars
export ANTHROPIC_API_KEY="your-key"
export GEMINI_API_KEY="your-key"

# Run server
node server-mvp.js

# In another terminal, update code.ts to use:
# const backendURL = 'http://localhost:3001';

# Rebuild and test
npm run build
```

---

## Railway Dashboard

Access your deployment:
- Logs: https://railway.app → Your Project → Deployments → Logs
- Variables: https://railway.app → Your Project → Settings → Variables
- Metrics: https://railway.app → Your Project → Metrics

Monitor:
- Request count
- Response times
- Error rates
- Memory usage

---

## Summary

1. **Create Railway project** from GitHub repo
2. **Set environment variables** (ANTHROPIC_API_KEY, GEMINI_API_KEY)
3. **Deploy automatically** (Railway detects railway.toml)
4. **Copy deployment URL**
5. **Update code.ts** with Railway URL
6. **Rebuild and test**

You're ready to deploy! 🚀
