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

---

## Guru v2 (June 2026): full dashboard port from bijan-john-website

The guru dashboard was replaced with the full life-dashboard from the sibling
`bijan-john-website` repo (rebranded for Jarin). The old single-file Astro page
(`src/pages/guru/index.astro`) is gone; the dashboard is now static files in
`public/guru/` (HTML + 16 JS modules + service worker PWA) talking to the
Pages Functions in `functions/`.

### What was set up automatically
- **D1 migration** `schema/003-guru-port.sql` applied to the remote `jarin-site`
  DB — additive only (14 new tables + new columns incl. `finances.groupTag`).
  Existing data (300 finance rows, habits, subscribers, …) untouched.
- **R2 buckets** created: `jarin-audio` (audio library, goldlist/translation
  audio) and `jarin-blog-images`.
- **KV namespace** created: `SITE_KV` (id `76bd31f0f88548e1b058e24f564a2f20`),
  used by the `/api/health` check.
- All bindings declared in `wrangler.jsonc` (production + preview) — they apply
  on the next Pages deploy.
- New dependency: `aws4fetch` (R2 presigned uploads in `/api/file-presign`).

### Secrets (set via dashboard or `wrangler pages secret put <NAME> --project-name jarin-website`)
| Secret | Used by | Status |
|---|---|---|
| `ADMIN_EMAIL` | new-subscriber + comment notifications | already set |
| `UNSUBSCRIBE_SECRET` | unsubscribe link HMAC | already set |
| `RESEND_API_KEY` | newsletter, goldlist email, intention digest | set if newsletter is live |
| `OPENAI_API_KEY` | translation tab (Whisper transcription) | optional |
| `ANTHROPIC_API_KEY` | translation tab (translation step) | optional |
| `TURNSTILE_SECRET_KEY` | blog comment spam protection | optional |
| `GITLAB_TOKEN` | blog publish pipeline (bijan used GitLab; this repo is GitHub — the Website tab's publish flow stays dormant until adapted) | n/a |

### Notes
- `/guru/` and `/api/` remain protected by Cloudflare Access (no change).
- The old root service worker (`/sw.js`) is now a self-unregistering stub; the
  new worker is scoped to `/guru/` (`public/guru/sw.js`). Bump `CACHE_NAME`
  there when changing guru assets.
- `/api/intention-digest` and `/api/publish-scheduled` are designed to be hit
  by an external cron (e.g. GitHub Actions schedule) — not wired up yet.
