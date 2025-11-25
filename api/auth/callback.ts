import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const { code, state, redirect } = req.query;

  if (!code || !state) {
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
            p { color: #6B7280; line-height: 1.5; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>Authentication Error</h1>
            <p>Invalid callback parameters. Please try signing in again from the Figma plugin.</p>
          </div>
        </body>
      </html>
    `);
  }

  try {
    // Exchange code for session
    const { data, error } = await supabase.auth.exchangeCodeForSession(code as string);

    if (error || !data.user) {
      throw error || new Error('No user returned');
    }

    const user = data.user;
    const accessToken = data.session?.access_token;

    // Store or update user in database
    const { error: upsertError } = await supabase
      .from('users')
      .upsert({
        id: user.id,
        email: user.email,
        full_name: user.user_metadata.full_name || user.email?.split('@')[0],
        avatar_url: user.user_metadata.avatar_url,
        auth_provider: 'google',
        tier: 'free',
        iterations_used: 0,
        last_login: new Date().toISOString(),
      }, {
        onConflict: 'id',
      });

    if (upsertError) {
      console.error('Error upserting user:', upsertError);
    }

    // If redirecting to Figma, try figma:// protocol first
    if (redirect === 'figma') {
      const figmaUrl = `figma://auth-callback?token=${accessToken}&state=${state}`;

      return res.send(`
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
              <p>Attempting to redirect back to Figma...</p>
              <p class="small-text">If the redirect doesn't work automatically, copy the token below and paste it into the Figma plugin:</p>
              <div class="token-box">${accessToken}</div>
              <button class="button" onclick="copyToken()">Copy Token</button>
              <p class="small-text">Then return to Figma and the plugin should authenticate automatically.</p>
            </div>
            <script>
              // Try to redirect to Figma
              setTimeout(() => {
                window.location.href = '${figmaUrl}';
              }, 1000);

              function copyToken() {
                navigator.clipboard.writeText('${accessToken}');
                event.target.textContent = 'Copied!';
                setTimeout(() => {
                  event.target.textContent = 'Copy Token';
                }, 2000);
              }
            </script>
          </body>
        </html>
      `);
    }

    // Default success page
    return res.send(`
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
              max-width: 400px;
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
            h1 { color: #10B981; margin-bottom: 16px; }
            p { color: #6B7280; line-height: 1.5; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="success-icon">✓</div>
            <h1>Successfully signed in!</h1>
            <p>You can now close this window and return to the Figma plugin.</p>
          </div>
        </body>
      </html>
    `);

  } catch (error) {
    console.error('Callback error:', error);
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
            p { color: #6B7280; line-height: 1.5; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>Authentication Error</h1>
            <p>Failed to complete sign in. Please try again from the Figma plugin.</p>
            <p style="font-size: 12px; margin-top: 16px;">${error instanceof Error ? error.message : 'Unknown error'}</p>
          </div>
        </body>
      </html>
    `);
  }
}
