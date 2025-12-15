# Crafter Plugin - Subscription Setup Guide

## 🎉 What's Been Implemented

### ✅ Completed (Plugin Side)
1. **Supabase Database Schema** - SQL migration file ready to run
2. **Backend API Endpoints** - 6 serverless functions for subscription management
3. **Plugin UI Components** - IterationCounter and updated ChatHeader
4. **Usage Limit Enforcement** - Checks before each iteration
5. **Subscription State Management** - Real-time usage tracking in UI

### 📋 Remaining Setup Steps
1. Run Supabase SQL migration
2. Configure Stripe products and webhooks
3. Add environment variables
4. (Optional) Create payment portal website

---

## Step 1: Set Up Supabase Database

### Run the SQL Migration

1. Open your Supabase project dashboard
2. Go to **SQL Editor**
3. Open the file: `supabase/migrations/001_create_subscription_tables.sql`
4. Copy and paste the entire SQL content
5. Click **Run** to execute the migration

This will create:
- `subscriptions` table - User subscription data
- `usage_tracking` table - Monthly iteration usage
- `iteration_packs` table - Purchased extra iterations
- Indexes for performance
- Row-Level Security (RLS) policies
- Automatic timestamps

### Verify Tables Created

Run this query to verify:
```sql
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
AND table_name IN ('subscriptions', 'usage_tracking', 'iteration_packs');
```

You should see all 3 tables listed.

---

## Step 2: Configure Stripe (Test Mode)

### 2.1 Create Stripe Products

1. Go to https://dashboard.stripe.com/test/products
2. Create these 4 products:

#### Product 1: Crafter Pro Subscription
- **Name:** Crafter Pro
- **Description:** 40 iterations/month with both Claude & Gemini
- **Pricing:** $18 AUD/month (recurring)
- **Billing period:** Monthly
- Copy the **Price ID** (starts with `price_...`)

#### Product 2: 10 Iteration Pack
- **Name:** 10 Iterations Pack
- **Description:** Add 10 extra iterations to your account
- **Pricing:** $5 AUD (one-time)
- Copy the **Price ID**

#### Product 3: 20 Iteration Pack
- **Name:** 20 Iterations Pack
- **Description:** Add 20 extra iterations to your account
- **Pricing:** $9 AUD (one-time)
- Copy the **Price ID**

#### Product 4: 50 Iteration Pack
- **Name:** 50 Iterations Pack
- **Description:** Add 50 extra iterations to your account
- **Pricing:** $20 AUD (one-time)
- Copy the **Price ID**

### 2.2 Set Up Webhook

1. Go to https://dashboard.stripe.com/test/webhooks
2. Click **Add endpoint**
3. **Endpoint URL:** `https://crafter-ai-kappa.vercel.app/api/subscription/webhook`
4. **Events to send:**
   - `checkout.session.completed`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.payment_succeeded`
   - `invoice.payment_failed`
5. Click **Add endpoint**
6. Copy the **Signing secret** (starts with `whsec_...`)

---

## Step 3: Add Environment Variables

### Add to Vercel Project

Go to your Vercel project settings → Environment Variables and add:

```env
# Stripe (Test Mode)
STRIPE_SECRET_KEY=sk_test_...
STRIPE_PUBLISHABLE_KEY=pk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...

# Stripe Product Price IDs
STRIPE_PRO_PRICE_ID=price_...
STRIPE_PACK_10_PRICE_ID=price_...
STRIPE_PACK_20_PRICE_ID=price_...
STRIPE_PACK_50_PRICE_ID=price_...

# Payment Portal URL (for now, can be temporary)
PAYMENT_PORTAL_URL=https://billing.crafter.ai
```

### Redeploy

After adding environment variables, redeploy your Vercel project:
```bash
git add .
git commit -m "Add subscription system"
git push
```

---

## Step 4: Test the System

### Test Free Tier

1. Open the plugin in Figma
2. Log in with Figma OAuth
3. You should see: "0/10 iterations" at the bottom
4. Try iterating on a design
5. Counter should increment: "1/10 iterations"

### Test Limit Enforcement

1. In Supabase, manually set your iterations_used to 10:
```sql
UPDATE usage_tracking
SET iterations_used = 10
WHERE user_id = '[your_user_id]'
AND month = '2025-12';
```

2. Try to iterate - you should see upgrade prompt!

### Test Upgrade Flow (Once Portal Ready)

1. Click "Upgrade Plan" button
2. Should open payment portal in new tab
3. Complete checkout with Stripe test card: `4242 4242 4242 4242`
4. Webhook should update subscription to Pro
5. Counter should show: "0/40 iterations"

---

## Step 5: Payment Portal Website (Optional - Can Build Later)

For now, you can create a simple landing page that:
1. Shows pricing plans ($18 AUD/month Pro plan)
2. Links to Stripe Checkout using the API endpoints
3. Allows users to manage subscriptions

### Quick Temp Solution:

Create a simple HTML page and host on Vercel:

```html
<!DOCTYPE html>
<html>
<head>
  <title>Crafter - Pricing</title>
</head>
<body>
  <h1>Crafter Pro</h1>
  <p>$18 AUD/month</p>
  <ul>
    <li>40 iterations/month</li>
    <li>Both Claude & Gemini models</li>
    <li>Multi-frame flow iterations</li>
    <li>Priority queue</li>
  </ul>
  <button onclick="checkout()">Subscribe Now</button>

  <script>
    async function checkout() {
      const params = new URLSearchParams(window.location.search);
      const user_id = params.get('user_id');
      const email = params.get('email');

      const response = await fetch('https://crafter-ai-kappa.vercel.app/api/subscription/create-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id, user_email: email })
      });

      const data = await response.json();
      window.location.href = data.checkout_url;
    }
  </script>
</body>
</html>
```

---

## Monitoring & Testing

### Check Subscription Status

```sql
-- View all subscriptions
SELECT * FROM subscriptions;

-- View usage for current month
SELECT * FROM usage_tracking
WHERE month = to_char(now(), 'YYYY-MM');

-- View active iteration packs
SELECT * FROM iteration_packs
WHERE status = 'active';
```

### Test API Endpoints

```bash
# Check subscription status
curl -X POST https://crafter-ai-kappa.vercel.app/api/subscription/check-status \
  -H "Content-Type: application/json" \
  -d '{"user_id": "your-user-id"}'

# Record iteration
curl -X POST https://crafter-ai-kappa.vercel.app/api/usage/record-iteration \
  -H "Content-Type: application/json" \
  -d '{"user_id": "your-user-id"}'
```

---

## Troubleshooting

### Issue: Subscription status not loading
**Solution:** Check browser console for errors. Verify `user_id` is being extracted from token.

### Issue: Webhook not receiving events
**Solution:**
1. Check Stripe Dashboard → Webhooks → View attempts
2. Verify webhook URL is correct
3. Check Vercel function logs

### Issue: Usage not incrementing
**Solution:**
1. Check that `recordIteration()` is being called
2. Verify user_id is set correctly
3. Check Supabase logs

---

## Production Checklist

Before going live:

- [ ] Switch Stripe keys from test to production
- [ ] Update `STRIPE_WEBHOOK_SECRET` to production webhook
- [ ] Test complete flow with real card
- [ ] Set up proper payment portal website
- [ ] Configure Stripe Customer Portal
- [ ] Add proper error handling/logging
- [ ] Test refund flows
- [ ] Set up monitoring/alerts

---

## Architecture Overview

```
┌─────────────────┐
│  Figma Plugin   │
│                 │
│  - UI displays  │
│    usage count  │
│  - Enforces     │
│    limits       │
└────────┬────────┘
         │
         ├─► Check Status API ──┐
         │                      │
         ├─► Record Usage API   ├──► Supabase DB
         │                      │     - subscriptions
         └─► Create Checkout ───┘     - usage_tracking
                 │                    - iteration_packs
                 ▼
         ┌───────────────┐
         │ Stripe        │
         │ - Checkout    │
         │ - Webhooks    │──► Update DB
         └───────────────┘
```

---

## Support

If you encounter issues:
1. Check Vercel function logs
2. Check Stripe webhook delivery attempts
3. Check Supabase logs
4. Verify environment variables are set

---

## Next Steps

1. **Run the SQL migration in Supabase** ← Start here!
2. **Create Stripe products and get Price IDs**
3. **Set up Stripe webhook**
4. **Add environment variables to Vercel**
5. **Test the flow end-to-end**
6. **Build payment portal website** (when ready)

---

**Status:** Plugin code is complete and ready! Just needs Stripe + Supabase configuration.
