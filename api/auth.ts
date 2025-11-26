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

    // Use direct Figma OAuth (not Supabase's generic provider)
    const FIGMA_CLIENT_ID = process.env.FIGMA_CLIENT_ID!;
    const REDIRECT_URI = 'https://crafter-ai-kappa.vercel.app/api/auth?action=callback';
    const figmaAuthUrl = `https://www.figma.com/oauth?client_id=${FIGMA_CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&scope=file_content:read,library_assets:read,library_content:read,current_user:read&state=${state}&response_type=code`;

    return res.redirect(figmaAuthUrl);
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

  // Handle OAuth callback from Figma
  if (action === 'callback') {
    const { code, state } = req.query;

    if (!code || !state) {
      return res.status(400).send(getErrorPage('Invalid callback parameters. Please try signing in again from the Figma plugin.'));
    }

    try {
      const FIGMA_CLIENT_ID = process.env.FIGMA_CLIENT_ID!;
      const FIGMA_CLIENT_SECRET = process.env.FIGMA_CLIENT_SECRET!;
      const REDIRECT_URI = 'https://crafter-ai-kappa.vercel.app/api/auth?action=callback';

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

      console.log('Figma user:', figmaUser.email);

      // Create or update user in Supabase Auth using Admin API
      let userId: string | undefined;

      // Try to create user first
      const { data: authUser, error: authError } = await supabase.auth.admin.createUser({
        email: figmaUser.email,
        email_confirm: true, // Skip email verification
        user_metadata: {
          figma_id: figmaUser.id,
          full_name: figmaUser.handle || figmaUser.email.split('@')[0],
          avatar_url: figmaUser.img_url,
          provider: 'figma'
        }
      });

      if (authError) {
        // Check if error is because user already exists
        if (authError.status === 422 || authError.message.includes('already registered') || authError.message.includes('email_exists')) {
          console.log('User already exists, fetching existing user...');
          // Get existing user by email
          const { data: existingUsers } = await supabase.auth.admin.listUsers();
          const existingUser = existingUsers?.users?.find(u => u.email === figmaUser.email);

          if (existingUser) {
            userId = existingUser.id;
            console.log('Found existing user:', userId);

            // Update user metadata
            await supabase.auth.admin.updateUserById(userId, {
              user_metadata: {
                figma_id: figmaUser.id,
                full_name: figmaUser.handle || figmaUser.email.split('@')[0],
                avatar_url: figmaUser.img_url,
                provider: 'figma'
              }
            });
          }
        } else {
          // Other error, throw it
          console.error('Error creating Supabase auth user:', authError);
          throw new Error('Failed to create user in authentication system');
        }
      } else {
        userId = authUser?.user?.id;
        console.log('Created new user:', userId);
      }

      if (!userId) {
        throw new Error('Failed to get user ID');
      }

      // Store session data temporarily for polling (expires in 5 minutes)
      pendingAuthSessions.set(state as string, {
        access_token: accessToken,
        refresh_token: refreshToken,
        user: {
          id: userId,
          email: figmaUser.email,
          user_metadata: {
            full_name: figmaUser.handle || figmaUser.email.split('@')[0],
            avatar_url: figmaUser.img_url
          }
        }
      });

      setTimeout(() => {
        pendingAuthSessions.delete(state as string);
      }, 5 * 60 * 1000);

      return res.send(getSuccessPage());

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
