# Crafter Proxy Server

This is a simple Express.js proxy server that handles Claude API calls for the Crafter Figma plugin. It's needed because the Anthropic API doesn't support CORS, which prevents direct browser calls from Figma plugins.

## Setup

### 1. Install Dependencies

```bash
cd proxy-server
npm install
```

### 2. Configure API Key

Create a `.env` file:

```bash
cp .env.example .env
```

Edit `.env` and add your Anthropic API key:

```
ANTHROPIC_API_KEY=sk-ant-your-actual-api-key-here
PORT=3000
```

### 3. Run the Server

**Development mode (auto-restart on changes):**
```bash
npm run dev
```

**Production mode:**
```bash
npm start
```

The server will run on `http://localhost:3000`

## Usage

The server exposes a single endpoint:

**POST /api/generate**

Request body:
```json
{
  "prompt": "Create a dashboard layout",
  "designSystem": {
    "components": [...],
    "colors": [...],
    "textStyles": [...]
  }
}
```

Response:
```json
{
  "layout": { ... },
  "reasoning": "..."
}
```

## Testing

Check if the server is running:
```bash
curl http://localhost:3000
```

You should see:
```json
{"status":"Crafter Proxy Server Running","version":"1.0.0"}
```

## Deployment

For production use, you can deploy this to:
- **Heroku** (free tier available)
- **Railway** (free tier available)
- **Vercel** (serverless)
- **Your own server**

Make sure to:
1. Set the `ANTHROPIC_API_KEY` environment variable
2. Update the plugin to point to your deployed URL
3. Enable HTTPS for security

## Security Notes

- The API key is stored only on the server (never exposed to users)
- CORS is enabled to allow Figma plugin calls
- All API usage goes through your account
- Consider adding rate limiting in production
