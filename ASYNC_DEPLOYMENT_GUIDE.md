# Crafter Async Pipeline Deployment Guide

This guide walks you through deploying the scalable async generation pipeline for Crafter.

## Architecture Overview

```
Figma Plugin → Vercel (Fast APIs) → Supabase (Job Queue) → Railway Worker → Claude API
     ↓                                       ↑
     └──────── Poll for results ────────────┘
```

**Benefits:**
- ✅ No more 504 timeouts
- ✅ Handles complex prompts and large design systems
- ✅ Horizontally scalable (add more workers)
- ✅ Users get immediate feedback

---

## Step 1: Set Up Supabase

### 1.1 Create Supabase Project

1. Go to [https://supabase.com](https://supabase.com)
2. Click "New Project"
3. Fill in:
   - **Name:** Crafter
   - **Database Password:** (create a strong password)
   - **Region:** Choose closest to your users
4. Click "Create new project"

### 1.2 Create Jobs Table

1. In your Supabase dashboard, go to **SQL Editor**
2. Click "New query"
3. Copy and paste the contents of `supabase/schema.sql`
4. Click "Run" to execute

### 1.3 Get API Keys

1. Go to **Settings** → **API**
2. Copy these values:
   - **Project URL** (e.g., `https://xxxxx.supabase.co`)
   - **anon public** key (for Vercel)
   - **service_role** key (for Railway worker - keep this secret!)

---

## Step 2: Deploy Vercel Fast APIs

### 2.1 Install Dependencies

```bash
cd server
npm install
```

### 2.2 Set Environment Variables

In your Vercel project dashboard, add these environment variables:

```
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_ANON_KEY=your-anon-key
```

**Note:** Do NOT add `ANTHROPIC_API_KEY` to Vercel. That belongs on Railway.

### 2.3 Deploy to Vercel

```bash
cd server
vercel --prod
```

After deployment, note your Vercel URL (e.g., `https://your-app.vercel.app`)

---

## Step 3: Deploy Railway Background Worker

### 3.1 Create Railway Project

1. Go to [https://railway.app](https://railway.app)
2. Click "New Project"
3. Select "Deploy from GitHub repo"
4. Choose your `Crafter` repository

### 3.2 Set Environment Variables

In Railway dashboard, go to **Variables** and add:

```
ANTHROPIC_API_KEY=your-claude-api-key
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

⚠️ **Important:** Use the **service_role** key here, not the anon key!

### 3.3 Verify Deployment

The `railway.json` config will automatically:
- Install dependencies from `worker-package.json`
- Start `worker.js`

Check the logs to see:
```
🚀 Crafter Background Worker Started
Listening for jobs in Supabase queue...
```

---

## Step 4: Update Figma Plugin Configuration

### 4.1 Update Backend URL

Edit `src/config.ts`:

```typescript
export const config = {
  BACKEND_URL: 'https://your-vercel-url.vercel.app/api/generate',
  // Keep the same for multi-phase (not used with async pipeline)
  BACKEND_URL_MULTI_PHASE: 'https://your-vercel-url.vercel.app/api/generate-multi-phase',
  USE_MULTI_PHASE: false,
};
```

### 4.2 Rebuild Plugin

```bash
npm run build
```

### 4.3 Reload in Figma

1. In Figma, go to **Plugins** → **Development** → **Crafter**
2. Click the "..." menu → **Run**

---

## Step 5: Test the System

### 5.1 Test Generation

1. In Figma, open Crafter plugin
2. Scan your design system
3. Enter a complex prompt (e.g., "Create a dashboard with navigation, cards, and charts")
4. Click "Generate Design"
5. You should see: "Generating design… this may take a moment."

### 5.2 Monitor in Supabase

1. Go to Supabase dashboard → **Table Editor** → **jobs**
2. You should see a new row with `status: 'queued'`
3. After a few seconds, it changes to `status: 'processing'`
4. Finally: `status: 'done'` with output

### 5.3 Monitor Railway Logs

In Railway dashboard, check logs:
```
📦 Processing job: abc-123-def (generate)
✅ Job abc-123-def completed successfully
```

---

## Troubleshooting

### Issue: Jobs stuck in "queued"

**Cause:** Railway worker not running

**Fix:**
1. Check Railway logs for errors
2. Verify environment variables are set correctly
3. Make sure `worker.js` is starting (check start command)

### Issue: Jobs fail immediately

**Cause:** Invalid Claude API key or Supabase permissions

**Fix:**
1. Verify `ANTHROPIC_API_KEY` in Railway
2. Check Supabase service_role key is correct
3. Look at Railway logs for specific error

### Issue: Plugin shows "Job timed out"

**Cause:** Worker crashed or Claude API very slow

**Fix:**
1. Check Railway worker logs
2. Increase `MAX_POLL_ATTEMPTS` in `src/claudeService.ts` (currently 60)
3. Verify Claude API is responding

---

## Scaling

### Adding More Workers

To handle more concurrent jobs:

1. In Railway, **duplicate** your worker service
2. Both workers will poll the same Supabase queue
3. They'll automatically distribute work

### Monitoring Performance

In Supabase, run this query to see job stats:

```sql
SELECT
  status,
  COUNT(*) as count,
  AVG(EXTRACT(EPOCH FROM (updated_at - created_at))) as avg_duration_seconds
FROM jobs
WHERE created_at > NOW() - INTERVAL '24 hours'
GROUP BY status;
```

---

## Environment Variables Summary

### Vercel (Fast APIs)
```
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_ANON_KEY=xxx
```

### Railway (Worker)
```
ANTHROPIC_API_KEY=sk-ant-xxx
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=xxx
```

---

## Next Steps

1. ✅ Set up monitoring/alerts in Railway
2. ✅ Add job retention policy (delete old jobs after 7 days)
3. ✅ Implement job priority queue for paid users
4. ✅ Add webhooks for real-time updates (instead of polling)

---

🎉 **You're done!** Crafter now runs on a fully scalable async pipeline.
