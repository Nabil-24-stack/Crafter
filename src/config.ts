/**
 * Configuration for Crafter plugin
 *
 * IMPORTANT: Update BACKEND_URL after deploying to Vercel
 */

export const config = {
  // Backend API endpoint - Vercel deployment
  BACKEND_URL: 'https://crafter-ai-kappa.vercel.app/api/generate',

  // Multi-phase generation endpoint (optimized single-call with smart component limiting)
  BACKEND_URL_MULTI_PHASE: 'https://crafter-ai-kappa.vercel.app/api/generate-multi-phase',

  // Use multi-phase generation (same speed, better component handling)
  USE_MULTI_PHASE: false, // You can enable this after testing

  // For local testing, uncomment below and comment out the lines above:
  // BACKEND_URL: 'http://localhost:3000/api/generate',
  // BACKEND_URL_MULTI_PHASE: 'http://localhost:3000/api/generate-multi-phase',
  // USE_MULTI_PHASE: true,
};
