import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
);

const FIGMA_CLIENT_ID = process.env.FIGMA_CLIENT_ID!;
const FIGMA_CLIENT_SECRET = process.env.FIGMA_CLIENT_SECRET!;
const REDIRECT_URI = 'https://crafter-ai-kappa.vercel.app/api/auth?action=callback';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const { action } = req.query;

  // Handle Figma OAuth initiation
  if (action === 'figma') {
    const { state } = req.query;

    if (!state) {
      return res.status(400).send(getErrorPage('Invalid authentication request. Please try again from the Figma plugin.'));
    }

    // Build Figma OAuth URL manually
    const figmaAuthUrl = `https://www.figma.com/oauth?client_id=${FIGMA_CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&scope=file_content:read,library_assets:read,library_content:read,current_user:read&state=${state}&response_type=code`;

    // Redirect to Figma OAuth
    return res.redirect(figmaAuthUrl);
  }

  // Handle OAuth callback
  if (action === 'callback') {
    const { code, state } = req.query;

    if (!code || !state) {
      return res.status(400).send(getErrorPage('Invalid callback parameters. Please try signing in again from the Figma plugin.'));
    }

    try {
      // Exchange code for access token with Figma
      const tokenResponse = await fetch('https://api.figma.com/v1/oauth/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Authorization': `Basic ${Buffer.from(`${FIGMA_CLIENT_ID}:${FIGMA_CLIENT_SECRET}`).toString('base64')}`,
        },
        body: new URLSearchParams({
          code: code as string,
          grant_type: 'authorization_code',
          redirect_uri: REDIRECT_URI,
        }),
      });

      if (!tokenResponse.ok) {
        const errorText = await tokenResponse.text();
        console.error('Token exchange failed:', errorText);
        throw new Error(`Failed to exchange code for token: ${errorText}`);
      }

      const tokenData = await tokenResponse.json() as { access_token: string; refresh_token: string };
      const accessToken = tokenData.access_token;
      const refreshToken = tokenData.refresh_token;

      console.log('Token exchange successful, access_token length:', accessToken?.length);

      // Get user info from Figma
      const userResponse = await fetch('https://api.figma.com/v1/me', {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
        },
      });

      if (!userResponse.ok) {
        const errorText = await userResponse.text();
        console.error('User info fetch failed:', errorText);
        throw new Error(`Failed to fetch user info from Figma: ${errorText}`);
      }

      const figmaUser = await userResponse.json() as {
        id: string;
        email: string;
        handle: string;
        img_url: string
      };

      // Create a deterministic user ID from Figma user ID
      const userId = `figma_${figmaUser.id}`;

      // Store or update user in database
      const { error: upsertError } = await supabase
        .from('users')
        .upsert({
          id: userId,
          email: figmaUser.email,
          full_name: figmaUser.handle || figmaUser.email?.split('@')[0],
          avatar_url: figmaUser.img_url,
          auth_provider: 'figma',
          tier: 'free',
          iterations_used: 0,
          last_login: new Date().toISOString(),
        }, {
          onConflict: 'id',
        });

      if (upsertError) {
        console.error('Error upserting user:', upsertError);
      }

      // Create a session token (combining user ID and Figma access token)
      const sessionToken = Buffer.from(JSON.stringify({
        userId,
        figmaAccessToken: accessToken,
        figmaRefreshToken: refreshToken,
        email: figmaUser.email,
      })).toString('base64');

      const figmaUrl = `figma://auth-callback?token=${sessionToken}&state=${state}`;
      return res.send(getSuccessPage(sessionToken, figmaUrl));

    } catch (error) {
      console.error('Callback error:', error);
      return res.status(500).send(getErrorPage(`Failed to complete sign in. Please try again from the Figma plugin.`, error instanceof Error ? error.message : 'Unknown error'));
    }
  }

  // Invalid action
  return res.status(404).send(getErrorPage('Invalid request'));
}

// Helper function for error pages
function getErrorPage(message: string, details?: string) {
  return `
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
          p { color: #6B7280; line-height: 1.5; }
          .details { font-size: 12px; margin-top: 16px; color: #9CA3AF; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>Authentication Error</h1>
          <p>${message}</p>
          ${details ? `<p class="details">${details}</p>` : ''}
        </div>
      </body>
    </html>
  `;
}

// Helper function for success pages
function getSuccessPage(token: string, figmaUrl?: string) {
  return `
    <!DOCTYPE html>
    <html>
      <head>
        <title>Success - Crafter Auth</title>
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
            max-width: 500px;
          }
          .success-icon {
            width: 64px;
            height: 64px;
            margin: 0 auto 24px;
            background: #10B981;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 32px;
            color: white;
          }
          h1 { color: #10B981; margin-bottom: 16px; font-size: 24px; }
          p { color: #6B7280; line-height: 1.6; margin-bottom: 12px; }
          .token-box {
            background: #F3F4F6;
            padding: 16px;
            border-radius: 8px;
            margin: 24px 0;
            word-break: break-all;
            font-family: 'Courier New', monospace;
            font-size: 12px;
            color: #374151;
            display: ${figmaUrl ? 'block' : 'none'};
          }
          .button {
            background: #36E4D8;
            color: #161616;
            border: none;
            padding: 12px 24px;
            border-radius: 8px;
            font-size: 14px;
            font-weight: 600;
            cursor: pointer;
            margin-top: 16px;
            display: ${figmaUrl ? 'inline-block' : 'none'};
          }
          .button:hover {
            background: #2DD4C7;
          }
          .small-text {
            font-size: 13px;
            color: #9CA3AF;
            margin-top: 16px;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="success-icon">✓</div>
          <h1>Successfully signed in!</h1>
          <p>You can now close this window.</p>
          <p class="small-text">Return to Figma and the plugin will automatically detect your authentication.</p>
        </div>
        <script>
          // Try to communicate with opener
          if (window.opener && !window.opener.closed) {
            try {
              window.opener.postMessage({
                type: 'figma-auth-success',
                token: '${sessionToken}'
              }, '*');
            } catch (e) {
              console.log('Could not post to opener:', e);
            }
          }

          // Auto-close after 2 seconds
          setTimeout(() => {
            window.close();
          }, 2000);
        </script>
      </body>
    </html>
  `;
}
