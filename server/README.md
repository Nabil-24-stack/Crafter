# Crafter Backend - Secure Vercel Proxy

This is a serverless backend for the Crafter Figma plugin. It securely handles Claude API calls without exposing your Anthropic API key to end users.

## 📁 Project Structure

```
server/
├── api/
│   └── generate.ts      # Serverless function for Claude API calls
├── package.json         # Dependencies
├── tsconfig.json        # TypeScript config
├── vercel.json          # Vercel deployment config
├── .env.example         # Example environment variables
└── README.md            # This file
```

## 🚀 Deployment to Vercel

### Step 1: Install Vercel CLI

```bash
npm install -g vercel
```

### Step 2: Install Dependencies

```bash
cd server
npm install
```

### Step 3: Login to Vercel

```bash
vercel login
```

### Step 4: Deploy to Vercel

**For the first time:**

```bash
vercel
```

You'll be asked:
- **Set up and deploy?** → Yes
- **Which scope?** → Select your account
- **Link to existing project?** → No
- **What's your project's name?** → `crafter-backend` (or your choice)
- **In which directory is your code?** → `./` (current directory)
- **Want to override settings?** → No

This creates a preview deployment.

**To deploy to production:**

```bash
vercel --prod
```

### Step 5: Add Environment Variable

After deployment, add your Anthropic API key:

**Option A: Via Vercel Dashboard**
1. Go to [vercel.com/dashboard](https://vercel.com/dashboard)
2. Select your project
3. Go to **Settings** → **Environment Variables**
4. Add:
   - **Name:** `ANTHROPIC_API_KEY`
   - **Value:** `sk-ant-your-actual-api-key`
   - **Environment:** Production, Preview, Development (select all)
5. Click **Save**

**Option B: Via CLI**
```bash
vercel env add ANTHROPIC_API_KEY
# Paste your API key when prompted
# Select: Production, Preview, Development
```

### Step 6: Redeploy

After adding the environment variable, redeploy:

```bash
vercel --prod
```

### Step 7: Get Your API Endpoint

After deployment, Vercel will give you a URL like:
```
https://crafter-backend.vercel.app
```

Your API endpoint will be:
```
https://crafter-backend.vercel.app/api/generate
```

## 🧪 Testing Locally

### 1. Create `.env` file

```bash
cp .env.example .env
```

Edit `.env` and add your API key:
```
ANTHROPIC_API_KEY=sk-ant-your-actual-key
```

### 2. Run Local Development Server

```bash
npm run dev
```

This starts the Vercel dev server on `http://localhost:3000`

### 3. Test the Endpoint

```bash
curl -X POST http://localhost:3000/api/generate \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "Create a login screen",
    "designSystem": {
      "components": [],
      "colors": [],
      "textStyles": []
    }
  }'
```

## 🔒 Security Features

- ✅ API key stored as Vercel environment variable (never in code)
- ✅ CORS enabled only for Figma plugin requests
- ✅ Request validation
- ✅ Error handling with no sensitive data exposure
- ✅ Serverless - no server to maintain
- ✅ Auto-scaling

## 📊 Monitoring

View logs and analytics:

```bash
vercel logs
```

Or visit the Vercel dashboard.

## 💰 Cost

- **Vercel Free Tier:**
  - 100GB bandwidth/month
  - 100 hours serverless function execution/month
  - Usually enough for personal use

- **Anthropic API:**
  - Pay per token usage
  - Claude 4.5 Sonnet pricing at [anthropic.com/pricing](https://www.anthropic.com/pricing)

## 🔄 Updating the Backend

1. Make changes to `api/generate.ts`
2. Deploy:
   ```bash
   vercel --prod
   ```

## 🗑️ Removing Deployment

```bash
vercel remove crafter-backend
```

## 📝 Environment Variables Reference

| Variable | Description | Required |
|----------|-------------|----------|
| `ANTHROPIC_API_KEY` | Your Anthropic API key | Yes |

## 🐛 Troubleshooting

### Error: "API key not found"
- Make sure you added the `ANTHROPIC_API_KEY` environment variable in Vercel
- Redeploy after adding environment variables

### Error: "CORS error"
- The serverless function includes CORS headers
- Make sure your Figma plugin is calling the correct URL

### Error: "Claude API error: 401"
- Your API key is invalid or expired
- Get a new key from [console.anthropic.com](https://console.anthropic.com/)

### Function times out
- Increase the timeout in `vercel.json` (default is 10s, max 60s on Pro plan)

## 📚 Resources

- [Vercel Documentation](https://vercel.com/docs)
- [Vercel Serverless Functions](https://vercel.com/docs/functions)
- [Anthropic API Docs](https://docs.anthropic.com/)
- [Claude API Reference](https://docs.anthropic.com/claude/reference)
