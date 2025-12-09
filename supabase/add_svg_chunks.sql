-- SVG Chunks Table for Live Streaming SVG Code
-- Run this migration after add_reasoning_chunks.sql

-- Create table for SVG chunks
CREATE TABLE IF NOT EXISTS svg_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  chunk_text TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for fast lookups by job_id
CREATE INDEX IF NOT EXISTS idx_svg_chunks_job_id ON svg_chunks(job_id, chunk_index);

-- Enable realtime for live streaming
ALTER PUBLICATION supabase_realtime ADD TABLE svg_chunks;

-- RLS policies (optional, for production)
ALTER TABLE svg_chunks ENABLE ROW LEVEL SECURITY;

CREATE POLICY service_role_policy_svg_chunks ON svg_chunks
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
