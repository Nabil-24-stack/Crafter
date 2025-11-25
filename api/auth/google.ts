import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const { state } = req.query;

  // If no state, show error
  if (!state) {
    return res.status(400).send(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Error - Crafter Auth</title>
          <style>
            body {
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
              display: flex;
              align-items: center;
              justify-content: center;
              min-height: 100vh;
              margin: 0;
              background: #F9FAFB;
            }
            .container {
              text-align: center;
              padding: 40px;
              background: white;
              border-radius: 12px;
              box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
              max-width: 400px;
            }
            h1 { color: #DC2626; margin-bottom: 16px; }
            p { color: #6B7280; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>Authentication Error</h1>
            <p>Invalid authentication request. Please try again from the Figma plugin.</p>
          </div>
        </body>
      </html>
    `);
  }

  // Get the OAuth URL from Supabase
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: `${process.env.VERCEL_URL || 'https://crafter-ai-kappa.vercel.app'}/api/auth/callback?state=${state}&redirect=figma`,
      queryParams: {
        access_type: 'offline',
        prompt: 'consent',
      },
    },
  });

  if (error || !data.url) {
    console.error('OAuth error:', error);
    return res.status(500).send(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Error - Crafter Auth</title>
          <style>
            body {
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
              display: flex;
              align-items: center;
              justify-content: center;
              min-height: 100vh;
              margin: 0;
              background: #F9FAFB;
            }
            .container {
              text-align: center;
              padding: 40px;
              background: white;
              border-radius: 12px;
              box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
              max-width: 400px;
            }
            h1 { color: #DC2626; margin-bottom: 16px; }
            p { color: #6B7280; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>Authentication Error</h1>
            <p>Failed to initialize Google authentication. Please try again.</p>
          </div>
        </body>
      </html>
    `);
  }

  // Redirect to Google OAuth
  res.redirect(data.url);
}
