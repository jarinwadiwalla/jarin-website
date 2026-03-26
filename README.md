# Jarin Wadiwalla — Website

Astro static site + Cloudflare Pages Functions for API endpoints. Includes a private `/guru` admin dashboard protected by Cloudflare Access.

## Tech Stack

- **Frontend:** Astro 6 + Tailwind CSS 4
- **Hosting:** Cloudflare Pages
- **Database:** Cloudflare D1 (SQLite)
- **Auth:** Cloudflare Access (zero-trust, protects `/guru/*` and `/api/*`)
- **Email:** Resend API (newsletter)
- **Blog storage:** GitHub (published posts committed as Markdown files)

## Project Structure

```
├── src/
│   ├── pages/           # Astro pages (static)
│   │   ├── index.astro
│   │   ├── sound.astro
│   │   ├── community.astro
│   │   ├── about.astro
│   │   ├── connect.astro
│   │   └── guru/index.astro   # Admin dashboard
│   ├── components/
│   ├── layouts/
│   └── styles/
├── functions/api/       # Cloudflare Pages Functions
│   ├── finances.js
│   ├── habits.js
│   ├── notes.js
│   ├── blog-drafts.js
│   ├── blog-publish.js
│   ├── blog-posts.js
│   ├── subscribe.js
│   ├── newsletter-send.js
│   ├── unsubscribe.js
│   └── subscribers.js
├── schema/schema.sql    # D1 database schema
├── wrangler.jsonc       # Cloudflare Pages config
└── astro.config.mjs
```

## Guru Dashboard Features

The `/guru` endpoint is a single-page admin dashboard with 6 tabs:

| Feature | Backend | Description |
|---------|---------|-------------|
| **Finances** | D1 | Expense/income tracking with categories |
| **Blog** | D1 + GitHub API | Draft editor, publish to GitHub as Markdown |
| **Newsletter** | D1 + Resend | Compose & send campaigns, subscriber management |
| **Notes** | D1 | Simple notes/todo list with completion |
| **Timer** | Client-side | Meditation, Pomodoro, and Stopwatch |
| **Habits** | D1 | Daily/weekly/monthly habit tracking with streaks |

## Deployment Instructions

### 1. Create the D1 database

```bash
npx wrangler d1 create jarin-site
```

Copy the `database_id` from the output and update `wrangler.jsonc`.

### 2. Run the database schema

```bash
npx wrangler d1 execute jarin-site --file=schema/schema.sql --remote
```

### 3. Connect repo to Cloudflare Pages

1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com/) → Pages → Create a project
2. Connect the GitHub repo `jarinwadiwalla/jarin-website`
3. Build settings:
   - **Build command:** `npm run build`
   - **Build output directory:** `dist`
   - **Node version:** 22

### 4. Set secrets

In the Cloudflare Pages project settings → Environment variables → Production:

| Secret | Purpose |
|--------|---------|
| `GITHUB_TOKEN` | GitHub personal access token (for blog publishing) |
| `RESEND_API_KEY` | Resend API key (for newsletter emails) |
| `UNSUBSCRIBE_SECRET` | Random string for HMAC-signed unsubscribe links |
| `ADMIN_EMAIL` | Email to receive new-subscriber notifications |

To generate the unsubscribe secret:
```bash
openssl rand -hex 32
```

### 5. Configure Cloudflare Access

1. Go to Cloudflare Zero Trust → Access → Applications
2. Create a new application:
   - **Type:** Self-hosted
   - **Application domain:** your-project.pages.dev (or jarinwadiwalla.com later)
   - **Path:** `/guru/*`
3. Add a policy (e.g., email allowlist for Jarin's email)
4. Optionally also protect `/api/*` (recommended)

### 6. Domain setup (when ready)

The site initially runs at `your-project.pages.dev`. To use `jarinwadiwalla.com`:

**Option A — Transfer domain to Cloudflare:**
1. In Cloudflare Dashboard → Registrar → Transfer
2. Unlock the domain at Squarespace and get the auth code
3. Follow the transfer flow (~$10/yr)

**Option B — Keep domain at Squarespace, point DNS:**
1. In Squarespace DNS settings, add a CNAME record:
   - **Host:** `@` (or `www`)
   - **Value:** `your-project.pages.dev`
2. In Cloudflare Pages → Custom domains → Add `jarinwadiwalla.com`

After domain setup, update `astro.config.mjs` `site` field if needed.

### 7. Remove GitHub Pages deployment

Once Cloudflare Pages is working, delete `.github/workflows/deploy.yml` and disable GitHub Pages in repo settings.

## Local Development

```bash
npm install
npm run dev        # Start Astro dev server
npm run build      # Build static site to /dist
npm run preview    # Preview production build
```

Note: API functions only work when deployed to Cloudflare Pages (or via `npx wrangler pages dev dist`).
