-- ============================================================================
-- Crafter Plugin Subscription & Usage Tracking Schema
-- Run this in Supabase SQL Editor
-- ============================================================================

-- 1. SUBSCRIPTIONS TABLE
-- Stores user subscription data linked to Stripe
CREATE TABLE IF NOT EXISTS public.subscriptions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Stripe identifiers
  stripe_customer_id TEXT UNIQUE,
  stripe_subscription_id TEXT UNIQUE,

  -- Subscription status
  status TEXT NOT NULL DEFAULT 'free' CHECK (status IN ('free', 'active', 'canceled', 'past_due', 'trialing')),
  plan_type TEXT NOT NULL DEFAULT 'free' CHECK (plan_type IN ('free', 'pro')),

  -- Billing period
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  cancel_at_period_end BOOLEAN DEFAULT FALSE,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Ensure one subscription per user
  UNIQUE(user_id)
);

-- 2. USAGE TRACKING TABLE
-- Tracks monthly iteration usage per user
CREATE TABLE IF NOT EXISTS public.usage_tracking (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Month identifier (format: 'YYYY-MM')
  month TEXT NOT NULL,

  -- Usage counters
  iterations_used INTEGER DEFAULT 0 CHECK (iterations_used >= 0),
  extra_iterations_purchased INTEGER DEFAULT 0 CHECK (extra_iterations_purchased >= 0),

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Unique constraint: one record per user per month
  UNIQUE(user_id, month)
);

-- 3. ITERATION PACKS TABLE
-- Stores purchased iteration pack add-ons
CREATE TABLE IF NOT EXISTS public.iteration_packs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Pack details
  pack_size INTEGER NOT NULL CHECK (pack_size IN (10, 20, 50)),
  iterations_remaining INTEGER NOT NULL CHECK (iterations_remaining >= 0),

  -- Stripe payment reference
  stripe_payment_intent_id TEXT,
  stripe_checkout_session_id TEXT,

  -- Month valid for (format: 'YYYY-MM')
  valid_for_month TEXT NOT NULL,

  -- Status
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'consumed', 'expired')),

  -- Timestamps
  purchased_at TIMESTAMPTZ DEFAULT NOW(),
  consumed_at TIMESTAMPTZ,

  -- Index for efficient queries
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- INDEXES for performance
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_subscriptions_user_id ON public.subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe_customer ON public.subscriptions(stripe_customer_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON public.subscriptions(status);

CREATE INDEX IF NOT EXISTS idx_usage_tracking_user_month ON public.usage_tracking(user_id, month);
CREATE INDEX IF NOT EXISTS idx_usage_tracking_month ON public.usage_tracking(month);

CREATE INDEX IF NOT EXISTS idx_iteration_packs_user_status ON public.iteration_packs(user_id, status);
CREATE INDEX IF NOT EXISTS idx_iteration_packs_month ON public.iteration_packs(valid_for_month);

-- ============================================================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- ============================================================================

-- Enable RLS on all tables
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.usage_tracking ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.iteration_packs ENABLE ROW LEVEL SECURITY;

-- SUBSCRIPTIONS policies
CREATE POLICY "Users can view their own subscription"
  ON public.subscriptions FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Service role can manage all subscriptions"
  ON public.subscriptions FOR ALL
  USING (auth.role() = 'service_role');

-- USAGE TRACKING policies
CREATE POLICY "Users can view their own usage"
  ON public.usage_tracking FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Service role can manage all usage"
  ON public.usage_tracking FOR ALL
  USING (auth.role() = 'service_role');

-- ITERATION PACKS policies
CREATE POLICY "Users can view their own packs"
  ON public.iteration_packs FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Service role can manage all packs"
  ON public.iteration_packs FOR ALL
  USING (auth.role() = 'service_role');

-- ============================================================================
-- HELPER FUNCTIONS
-- ============================================================================

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Triggers for updated_at
CREATE TRIGGER update_subscriptions_updated_at BEFORE UPDATE ON public.subscriptions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_usage_tracking_updated_at BEFORE UPDATE ON public.usage_tracking
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- INITIAL DATA: Create free subscriptions for existing users
-- ============================================================================

-- Insert free plan subscription for all existing auth users (if they don't have one)
INSERT INTO public.subscriptions (user_id, status, plan_type)
SELECT id, 'free', 'free'
FROM auth.users
WHERE NOT EXISTS (
  SELECT 1 FROM public.subscriptions WHERE user_id = auth.users.id
);

-- ============================================================================
-- DONE! Schema created successfully
-- ============================================================================
