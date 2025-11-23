-- Reasoning Chunks Table for Live Streaming LLM Reasoning
-- Run this migration after the initial schema.sql

-- Create table for reasoning chunks
CREATE TABLE IF NOT EXISTS reasoning_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  chunk_text TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for fast lookups by job_id
CREATE INDEX IF NOT EXISTS idx_reasoning_chunks_job_id ON reasoning_chunks(job_id, chunk_index);

-- Enable realtime for live streaming
ALTER PUBLICATION supabase_realtime ADD TABLE reasoning_chunks;

-- RLS policies (optional, for production)
ALTER TABLE reasoning_chunks ENABLE ROW LEVEL SECURITY;

CREATE POLICY service_role_policy_chunks ON reasoning_chunks
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
