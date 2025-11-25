import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

// Use service role key for admin operations
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
);

// In-memory storage for pending auth sessions (state -> token)
const pendingAuthSessions = new Map<string, { access_token: string; refresh_token: string; user: any }>();

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const { action } = req.query;

  // Handle Figma OAuth initiation
  if (action === 'figma') {
    const { state } = req.query;

    if (!state) {
      return res.status(400).send(getErrorPage('Invalid authentication request. Please try again from the Figma plugin.'));
    }

    // Redirect to Supabase Auth with Figma provider
    const callbackUrl = `https://crafter-ai-kappa.vercel.app/api/auth-supabase?action=callback&state=${state}`;
    const supabaseAuthUrl = `${process.env.SUPABASE_URL}/auth/v1/authorize?provider=figma&redirect_to=${encodeURIComponent(callbackUrl)}`;

    return res.redirect(supabaseAuthUrl);
  }

  // Handle polling for auth completion
  if (action === 'poll') {
    const { state } = req.query;

    if (!state) {
      return res.status(400).json({ error: 'Missing state parameter' });
    }

    const sessionData = pendingAuthSessions.get(state as string);

    if (sessionData) {
      // Clear the session after retrieving
      pendingAuthSessions.delete(state as string);
      return res.json({
        access_token: sessionData.access_token,
        refresh_token: sessionData.refresh_token,
        user: sessionData.user
      });
    }

    return res.json({ access_token: null });
  }

  // Handle OAuth callback from Supabase
  // Supabase returns tokens in URL hash, so we need to render a page that reads them
  if (action === 'callback') {
    const { state } = req.query;

    if (!state) {
      return res.status(400).send(getErrorPage('Invalid callback parameters. Please try signing in again from the Figma plugin.'));
    }

    // Return a page that extracts tokens from URL hash and sends them to our endpoint
    return res.send(getCallbackPage(state as string));
  }

  // Handle token storage from callback page
  if (action === 'store-tokens') {
    const { access_token, refresh_token, state } = req.body || {};

    if (!access_token || !state) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }

    try {
      // Get user info from Supabase Auth
      const { data: { user }, error: userError } = await supabase.auth.getUser(access_token);

      if (userError || !user) {
        console.error('Failed to get user:', userError);
        throw new Error('Failed to get user information');
      }

      console.log('Supabase Auth user:', user);

      // Extract user metadata
      const email = user.email || '';
      const fullName = user.user_metadata?.full_name || user.user_metadata?.name || email.split('@')[0];
      const avatarUrl = user.user_metadata?.avatar_url || user.user_metadata?.picture || '';

      // Upsert user in our custom users table for app-specific data
      const { data: upsertData, error: upsertError } = await supabase
        .from('users')
        .upsert({
          id: user.id, // Use Supabase auth.uid as primary key
          email: email,
          full_name: fullName,
          avatar_url: avatarUrl,
          auth_provider: 'figma',
          tier: 'free',
          iterations_used: 0,
          last_login: new Date().toISOString(),
        }, {
          onConflict: 'id',
        })
        .select();

      if (upsertError) {
        console.error('Error upserting user to custom table:', JSON.stringify(upsertError, null, 2));
      } else {
        console.log('User upserted successfully:', upsertData);
      }

      // Store session data temporarily for polling (expires in 5 minutes)
      pendingAuthSessions.set(state, {
        access_token,
        refresh_token,
        user
      });

      setTimeout(() => {
        pendingAuthSessions.delete(state);
      }, 5 * 60 * 1000);

      return res.json({ success: true });

    } catch (error) {
      console.error('Token storage error:', error);
      return res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
    }
  }

  // Invalid action
  return res.status(404).send(getErrorPage('Invalid request'));
}

// Helper function for callback page that extracts tokens from URL hash
function getCallbackPage(state: string) {
  return `
    <!DOCTYPE html>
    <html>
      <head>
        <title>Authenticating - Crafter</title>
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
          .spinner {
            width: 48px;
            height: 48px;
            margin: 0 auto 24px;
            border: 4px solid #E5E7EB;
            border-top-color: #36E4D8;
            border-radius: 50%;
            animation: spin 1s linear infinite;
          }
          @keyframes spin {
            to { transform: rotate(360deg); }
          }
          h1 { color: #374151; margin-bottom: 8px; }
          p { color: #6B7280; font-size: 14px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="spinner"></div>
          <h1>Completing sign in...</h1>
          <p>Please wait while we complete your authentication.</p>
        </div>
        <script>
          // Extract tokens from URL hash
          const hash = window.location.hash.substring(1);
          const params = new URLSearchParams(hash);
          const accessToken = params.get('access_token');
          const refreshToken = params.get('refresh_token');

          if (accessToken) {
            // Send tokens to server
            fetch('/api/auth-supabase?action=store-tokens', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                access_token: accessToken,
                refresh_token: refreshToken,
                state: '${state}'
              })
            })
            .then(response => response.json())
            .then(data => {
              if (data.success) {
                // Show success and auto-close
                document.body.innerHTML = \`
                  <div class="container">
                    <div style="width: 64px; height: 64px; margin: 0 auto 24px; background: #10B981; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 32px; color: white;">✓</div>
                    <h1 style="color: #10B981;">Successfully signed in!</h1>
                    <p>You can now close this window.</p>
                  </div>
                \`;
                setTimeout(() => {
                  window.close();
                }, 2000);
              } else {
                throw new Error('Failed to store tokens');
              }
            })
            .catch(error => {
              console.error('Error:', error);
              document.body.innerHTML = \`
                <div class="container">
                  <h1 style="color: #DC2626;">Authentication Error</h1>
                  <p>Failed to complete sign in. Please try again.</p>
                </div>
              \`;
            });
          } else {
            document.body.innerHTML = \`
              <div class="container">
                <h1 style="color: #DC2626;">Authentication Error</h1>
                <p>No access token found. Please try signing in again.</p>
              </div>
            \`;
          }
        </script>
      </body>
    </html>
  `;
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
function getSuccessPage() {
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
          // Auto-close after 2 seconds
          setTimeout(() => {
            window.close();
          }, 2000);
        </script>
      </body>
    </html>
  `;
}
