-- Automatic Job Cleanup Migration
-- Deletes jobs older than 7 days to save database space
-- reasoning_chunks and svg_chunks are auto-deleted via CASCADE

-- Step 1: Create cleanup function
CREATE OR REPLACE FUNCTION cleanup_old_jobs()
RETURNS TABLE(deleted_jobs_count bigint, message text) AS $$
DECLARE
  jobs_deleted bigint;
BEGIN
  -- Delete old completed and errored jobs
  -- Note: reasoning_chunks and svg_chunks will be auto-deleted via ON DELETE CASCADE
  DELETE FROM jobs
  WHERE created_at < NOW() - INTERVAL '7 days'
    AND status IN ('done', 'error');

  GET DIAGNOSTICS jobs_deleted = ROW_COUNT;

  RETURN QUERY SELECT
    jobs_deleted,
    format('Deleted %s jobs older than 7 days. Associated chunks auto-deleted via CASCADE.', jobs_deleted);
END;
$$ LANGUAGE plpgsql;

-- Step 2: Grant execute permission to service role
GRANT EXECUTE ON FUNCTION cleanup_old_jobs() TO service_role;

-- Step 3: Schedule daily cleanup at 2 AM UTC using pg_cron
-- NOTE: pg_cron is only available on Supabase Pro plan or higher
-- If you're on Free tier, you'll need to manually run: SELECT * FROM cleanup_old_jobs();

-- Uncomment the following lines after upgrading to Supabase Pro:
/*
SELECT cron.schedule(
  'cleanup-old-jobs-daily',
  '0 2 * * *',  -- Every day at 2 AM UTC
  $$SELECT cleanup_old_jobs()$$
);
*/

-- Step 4: Create a manual cleanup function for Free tier users
-- Run this weekly to clean up old jobs
COMMENT ON FUNCTION cleanup_old_jobs() IS
  'Deletes jobs older than 7 days with status done or error. Run manually with: SELECT * FROM cleanup_old_jobs();';

-- Optional: One-time cleanup of existing old jobs
-- Uncomment to run immediately:
-- SELECT * FROM cleanup_old_jobs();
