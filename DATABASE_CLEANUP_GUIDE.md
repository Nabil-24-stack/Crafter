# Database Cleanup & Optimization Guide

## Overview
This guide explains how to manage and optimize your Supabase database to reduce storage usage and costs.

---

## ✅ What's Been Implemented

### 1. **Automatic Job Cleanup Function**
- Location: `supabase/cleanup_old_jobs.sql`
- Deletes jobs older than 7 days (status: done or error)
- Auto-deletes associated reasoning_chunks and svg_chunks via CASCADE

### 2. **Image Compression**
- Reduced PNG export from 2x scale → 1x scale
- Reduces each job payload from ~340 KB → ~85-120 KB (70% reduction)
- Location: `src/code.ts` line 1367

---

## 🚀 How to Run the Database Cleanup

### Step 1: Run the Migration

1. Open your Supabase dashboard
2. Go to **SQL Editor**
3. Copy the contents of `supabase/cleanup_old_jobs.sql`
4. Paste into the SQL Editor
5. Click **Run** to execute

This will:
- Create the `cleanup_old_jobs()` function
- Set up permissions

### Step 2: Run Initial Cleanup (One-Time)

In Supabase SQL Editor, run:

```sql
SELECT * FROM cleanup_old_jobs();
```

This will:
- Delete all jobs older than 7 days
- Show you how many jobs were deleted
- Free up database space immediately

**Expected output:**
```
deleted_jobs_count | message
-------------------+--------------------------------------------------------
1234              | Deleted 1234 jobs older than 7 days. Associated chunks auto-deleted via CASCADE.
```

---

## 🔄 Setting Up Automatic Daily Cleanup

### Option A: Supabase Pro Plan (Recommended)

If you've upgraded to Supabase Pro, you can enable automatic daily cleanup:

1. Open `supabase/cleanup_old_jobs.sql`
2. Find the commented section:
   ```sql
   /*
   SELECT cron.schedule(
     'cleanup-old-jobs-daily',
     '0 2 * * *',
     $$SELECT cleanup_old_jobs()$$
   );
   */
   ```
3. Uncomment it (remove `/*` and `*/`)
4. Run this section in Supabase SQL Editor

Now cleanup runs automatically every day at 2 AM UTC.

### Option B: Free Plan (Manual Cleanup)

If you're on the Free plan:

1. Set a calendar reminder to run cleanup weekly
2. Every week, run in Supabase SQL Editor:
   ```sql
   SELECT * FROM cleanup_old_jobs();
   ```
3. This keeps your database clean

---

## 📊 Monitoring Database Usage

### Check Current Usage

**Supabase Dashboard:**
1. Go to Settings → Usage
2. Check "Database Size" metric

**SQL Query:**
```sql
-- Check current database size
SELECT
  pg_size_pretty(pg_database_size(current_database())) as database_size;

-- Check table sizes
SELECT
  schemaname,
  tablename,
  pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;

-- Count jobs by status
SELECT status, COUNT(*) as count
FROM jobs
GROUP BY status;

-- Count old jobs (ready to be cleaned up)
SELECT COUNT(*) as old_jobs_count
FROM jobs
WHERE created_at < NOW() - INTERVAL '7 days'
  AND status IN ('done', 'error');
```

---

## 🎯 Expected Results

### Before Optimization:
- Database: 465 MB / 500 MB (93%)
- ~1,370 old jobs stored
- Each job: ~340 KB PNG + output

### After Optimization:
- Database: ~80-120 MB / 500 MB (16-24%)
- Only last 7 days of jobs (~50-100 jobs)
- Each new job: ~85-120 KB PNG + output (70% smaller)

**Total savings: ~83% database reduction**

---

## 🔧 Customization Options

### Change Retention Period

Edit the function in Supabase SQL Editor:

```sql
CREATE OR REPLACE FUNCTION cleanup_old_jobs()
...
  DELETE FROM jobs
  WHERE created_at < NOW() - INTERVAL '14 days'  -- Changed from 7 to 14 days
    AND status IN ('done', 'error');
...
```

**Options:**
- `INTERVAL '3 days'` - More aggressive cleanup
- `INTERVAL '14 days'` - Keep jobs longer
- `INTERVAL '30 days'` - Archive mode

### Keep Only Specific Number of Jobs

```sql
-- Keep only the 100 most recent jobs
DELETE FROM jobs
WHERE id NOT IN (
  SELECT id FROM jobs
  ORDER BY created_at DESC
  LIMIT 100
);
```

---

## 🛡️ Safety Features

### What Gets Deleted:
- ✅ Jobs with status 'done' or 'error'
- ✅ Jobs older than 7 days
- ✅ Associated reasoning_chunks (CASCADE)
- ✅ Associated svg_chunks (CASCADE)

### What NEVER Gets Deleted:
- ❌ Jobs with status 'queued' (waiting to process)
- ❌ Jobs with status 'processing' (currently running)
- ❌ Jobs created in the last 7 days
- ❌ User authentication data

### Rollback Protection:
- Supabase Pro includes point-in-time recovery (7 days)
- Can restore database to any point before cleanup
- Free tier has daily backups

---

## 🐛 Troubleshooting

### Cleanup function returns 0 deleted jobs

**Possible causes:**
1. No jobs older than 7 days
2. All old jobs already cleaned up

**Check:**
```sql
SELECT COUNT(*), status
FROM jobs
WHERE created_at < NOW() - INTERVAL '7 days'
GROUP BY status;
```

### Database size not decreasing

**Solution:**
Run VACUUM to reclaim space:
```sql
VACUUM FULL jobs;
VACUUM FULL reasoning_chunks;
VACUUM FULL svg_chunks;
```

Note: VACUUM FULL locks tables during execution.

### pg_cron job not working

**Check if pg_cron is enabled:**
```sql
SELECT * FROM cron.job;
```

If empty or error, pg_cron is not available (Free tier limitation).
Use manual cleanup instead.

---

## 📈 Best Practices

### For Development:
- Run cleanup weekly
- Keep retention at 3-7 days
- Monitor database size in Supabase dashboard

### For Production:
- Upgrade to Supabase Pro
- Enable automatic daily cleanup
- Set retention to 7-14 days
- Monitor egress usage

### For Cost Optimization:
- Keep retention as short as possible (3-5 days)
- Run cleanup 2x per week if on Free tier
- Consider archiving important jobs to external storage before deletion

---

## 📚 Additional Resources

- [Supabase Database Maintenance](https://supabase.com/docs/guides/database/postgres/database-size)
- [PostgreSQL VACUUM](https://www.postgresql.org/docs/current/routine-vacuuming.html)
- [pg_cron Extension](https://github.com/citusdata/pg_cron)

---

## 🆘 Need Help?

If you encounter issues:
1. Check Supabase logs in dashboard
2. Verify migration ran successfully
3. Test cleanup function manually first
4. Check database permissions

**Restore from backup if needed:**
- Supabase Pro: Use point-in-time recovery
- Free tier: Contact Supabase support with backup request
