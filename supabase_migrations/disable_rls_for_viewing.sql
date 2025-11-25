-- Temporarily disable RLS to view users in dashboard
-- Run this in Supabase SQL Editor if you can't see users in Table Editor

ALTER TABLE public.users DISABLE ROW LEVEL SECURITY;

-- Or if you want to keep RLS enabled but just view the data, run:
-- SELECT * FROM public.users;
