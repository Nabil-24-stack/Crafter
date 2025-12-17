/**
 * Configuration for Crafter plugin
 *
 * IMPORTANT: Update BACKEND_URL after deploying to Vercel
 */

export const config = {
  // Backend API endpoint - Vercel deployment
  BACKEND_URL: 'https://crafter-ai-kappa-eight.vercel.app/api/generate',

  // Multi-phase generation endpoint (optimized single-call with smart component limiting)
  BACKEND_URL_MULTI_PHASE: 'https://crafter-ai-kappa-eight.vercel.app/api/generate-multi-phase',

  // Use multi-phase generation (same speed, better component handling)
  USE_MULTI_PHASE: false, // You can enable this after testing

  // For local testing, uncomment below and comment out the lines above:
  // BACKEND_URL: 'http://localhost:3000/api/generate',
  // BACKEND_URL_MULTI_PHASE: 'http://localhost:3000/api/generate-multi-phase',
  // USE_MULTI_PHASE: true,

  // Supabase configuration for realtime reasoning updates
  // Note: Using anon key is safe for read-only realtime subscriptions
  // RLS policies ensure data is only accessible to authorized users
  SUPABASE_URL: 'https://tsqfwommnuhtbeupuwwm.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRzcWZ3b21tbnVodGJldXB1d3dtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDI1MjA1NTcsImV4cCI6MjA1ODA5NjU1N30.2566JJwlN717YvNAr0lnzj6XlUu29Zj5alfSx2Nesyo',
};
