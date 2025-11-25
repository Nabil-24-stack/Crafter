-- Migration to change id column from UUID to TEXT
-- Run this in Supabase SQL Editor

-- Step 1: Drop existing policies that reference the id column
DROP POLICY IF EXISTS "Users can view own data" ON public.users;
DROP POLICY IF EXISTS "Users can update own data" ON public.users;

-- Step 2: Drop the existing table and recreate with TEXT id
-- (Safe since table should be empty or you can backup data first)
DROP TABLE IF EXISTS public.users CASCADE;

-- Step 3: Recreate the table with TEXT id
CREATE TABLE public.users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  full_name TEXT,
  avatar_url TEXT,
  auth_provider TEXT DEFAULT 'figma',

  -- Subscription info
  tier TEXT DEFAULT 'free' CHECK (tier IN ('free', 'pro', 'team', 'enterprise')),
  iterations_used INTEGER DEFAULT 0,
  iterations_limit INTEGER DEFAULT 10,

  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  last_login TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS users_email_idx ON public.users(email);
CREATE INDEX IF NOT EXISTS users_tier_idx ON public.users(tier);
CREATE INDEX IF NOT EXISTS users_id_idx ON public.users(id);

-- Enable Row Level Security
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

-- Policy: Allow reading all user data
CREATE POLICY "Users can view own data"
  ON public.users
  FOR SELECT
  USING (true);

-- Policy: Allow updating
CREATE POLICY "Users can update own data"
  ON public.users
  FOR UPDATE
  USING (true);

-- Policy: Anyone can insert (for new user registration)
CREATE POLICY "Anyone can insert users"
  ON public.users
  FOR INSERT
  WITH CHECK (true);

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Trigger to automatically update updated_at
CREATE TRIGGER update_users_updated_at
  BEFORE UPDATE ON public.users
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Function to reset monthly usage (run as cron job)
CREATE OR REPLACE FUNCTION public.reset_monthly_usage()
RETURNS void AS $$
BEGIN
  UPDATE public.users
  SET iterations_used = 0
  WHERE EXTRACT(MONTH FROM last_login) < EXTRACT(MONTH FROM NOW())
    OR EXTRACT(YEAR FROM last_login) < EXTRACT(YEAR FROM NOW());
END;
$$ language 'plpgsql';
