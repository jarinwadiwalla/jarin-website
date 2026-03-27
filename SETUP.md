# Jarin Website — Setup Guide

Run these steps in order from the `jarin-website` project directory.

## Step 1: Create the D1 database

```bash
wrangler d1 create jarin-site
```

Copy the `database_id` from the output. Open `wrangler.jsonc` and replace `"PLACEHOLDER"` with the real ID.

## Step 2: Run the database schema

```bash
wrangler d1 execute jarin-site --file=schema/schema.sql --remote
```

This creates all 7 tables (finances, notes, habits, habit_logs, blog_drafts, subscribers, campaigns).

## Step 3: Connect the repo to Cloudflare Pages

1. Go to https://dash.cloudflare.com/ → **Workers & Pages** → **Create** → **Pages** → **Connect to Git**
2. Select the GitHub repo `jarinwadiwalla/jarin-website`
3. Build settings:
   - **Build command:** `npm run build`
   - **Build output directory:** `dist`
   - **Environment variable:** `NODE_VERSION` = `22`
4. Click **Save and Deploy**

Wait for the first deploy to finish. You'll get a URL like `jarin-website.pages.dev`.

## Step 4: Bind the D1 database to Pages

The `wrangler.jsonc` file tells wrangler about the binding, but you also need to set it in the dashboard:

1. Go to **Workers & Pages** → **jarin-website** → **Settings** → **Bindings**
2. Click **Add** → **D1 Database**
3. Variable name: `SITE_DB`
4. Select the `jarin-site` database
5. Save, then **redeploy** (Deployments → latest → Retry deployment)

## Step 5: Set secrets

Go to **Workers & Pages** → **jarin-website** → **Settings** → **Environment variables**

Add these as **Production** (encrypted) variables:

| Variable | Value | How to get it |
|----------|-------|---------------|
| `GITHUB_TOKEN` | GitHub personal access token | GitHub → Settings → Developer settings → Personal access tokens → Generate new token (needs `repo` scope) |
| `RESEND_API_KEY` | Resend API key | Sign up at https://resend.com, create an API key |
| `UNSUBSCRIBE_SECRET` | Random 64-char hex string | Run: `openssl rand -hex 32` |
| `ADMIN_EMAIL` | Jarin's email address | For new-subscriber notifications |

**Note:** `GITHUB_TOKEN` and `RESEND_API_KEY` are needed for blog publishing and newsletter sending respectively. The site works without them — those features will just show errors until configured.

## Step 6: Configure Cloudflare Access

This protects `/guru` so only Jarin can access it.

1. Go to https://one.dash.cloudflare.com/ (Cloudflare Zero Trust dashboard)
2. **Access** → **Applications** → **Add an application**
3. Select **Self-hosted**
4. Application configuration:
   - **Application name:** Jarin Guru
   - **Session duration:** 24 hours
   - **Application domain:** `jarin-website.pages.dev` (or custom domain later)
   - **Path:** `guru`
5. Add a policy:
   - **Policy name:** Allow Jarin
   - **Action:** Allow
   - **Include rule:** Emails — enter Jarin's email
6. Save

Repeat for the API if desired (path: `api`), or skip since the API is only called from the guru dashboard anyway.

## Step 7: Test

1. Visit `https://jarin-website.pages.dev/guru`
2. You should be prompted by Cloudflare Access to verify your email
3. After auth, the guru dashboard should load with all 6 tabs
4. Try adding a note or a finance entry to confirm the D1 database is working

## Step 8: Domain setup (when ready)

### Option A: Transfer domain to Cloudflare (recommended)
1. In Squarespace: Domains → your domain → Transfer away → Unlock and get auth code
2. In Cloudflare: Dashboard → Registrar → Transfer → Enter domain and auth code
3. Follow the steps (takes up to 5 days, ~$10/yr)
4. Once transferred: Workers & Pages → jarin-website → Custom domains → Add `jarinwadiwalla.com`

### Option B: Keep at Squarespace, point DNS
1. In Cloudflare Pages: Custom domains → Add `jarinwadiwalla.com` → it'll give you a CNAME target
2. In Squarespace DNS: Add a CNAME record pointing `@` to the CNAME target from Cloudflare
3. Wait for DNS propagation (up to 48 hours)

### After domain is live
Update the Cloudflare Access application domain from `jarin-website.pages.dev` to `jarinwadiwalla.com`.

## Troubleshooting

- **API returns 500:** Check that the D1 binding `SITE_DB` is configured in Pages settings
- **Blog publish fails:** Verify `GITHUB_TOKEN` is set and has `repo` scope
- **Newsletter fails:** Verify `RESEND_API_KEY` is set and the sending domain is verified in Resend
- **Guru page loads but no auth prompt:** Cloudflare Access isn't configured yet — see Step 6
