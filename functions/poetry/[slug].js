/**
 * Cloudflare Pages Function — /poetry/:slug
 *
 * Renders an individual poem page with proper OG meta tags.
 * Reads from D1 (poems table) and returns full HTML.
 *
 * Environment bindings required:
 *   - SITE_DB (D1 database)
 */

import { escapeHtml as esc } from '../lib/utils.js';
import { parsePoemLinks, stripPoemLinks } from '../lib/markdown.js';

function renderPage(poem) {
  const title = esc(poem.title);
  const escapedBody = (poem.body || "").replace(/</g, "&lt;");
  const bodyLines = parsePoemLinks(escapedBody).split("\n").join("<br>");
  const description = esc(
    stripPoemLinks((poem.body || "")).replace(/\n/g, " ").slice(0, 150).trim() + "..."
  );
  const url = `https://jarinwadiwalla.com/poetry/${encodeURIComponent(poem.id)}/`;
  const image = "https://jarinwadiwalla.com/images/lotus-icon.png";

  let dateHtml = "";
  if (poem.createdAt) {
    const dt = new Date(poem.createdAt);
    const formatted = dt.toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
    dateHtml = `<p class="poem-date">${formatted}</p>`;
  }

  return `<!DOCTYPE html>
<html lang="en-US">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=5">
  <title>${title} - Poetry - Jarin Wadiwalla</title>
  <meta name="description" content="${description}">
  <link rel="stylesheet" href="/css/blog-comments.css">
  <link rel="canonical" href="${url}">
  <link rel="alternate" href="${url}" hreflang="en-us">
  <link rel="alternate" href="${url}" hreflang="en">
  <link rel="alternate" href="${url}" hreflang="x-default">
  <meta property="og:url" content="${url}">
  <meta property="og:type" content="article">
  <meta property="og:title" content="${title} - Poetry - Jarin Wadiwalla">
  <meta property="og:description" content="${description}">
  <meta property="og:image" content="${image}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${title} - Poetry - Jarin Wadiwalla">
  <meta name="twitter:description" content="${description}">
  <meta name="twitter:image" content="${image}">
  <link rel="alternate" type="application/rss+xml" title="Jarin's Blog RSS Feed" href="/blog/feed.xml">
  <link rel="icon" type="image/png" href="/images/lotus-icon.png">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,700;0,900;1,400&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/css/style.css">
  <script>
    (function(){var t=localStorage.getItem('theme')||'light';document.documentElement.setAttribute('data-theme',t)})();
  </script>
</head>
<body>
  <div class="primary-container">
    <header class="site-header">
      <div class="site-logo"><a href="/">Jarin Wadiwalla</a></div>
      <nav class="site-navigation">
        <button aria-label="toggle menu" class="menu-trigger">
          <div class="icon-menu-line">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
          </div>
          <div class="icon-menu-close" style="display:none">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </div>
        </button>
        <ul>
          <li><a href="/">Home</a></li>
          <li><a href="/about">About</a></li>
          <li><a href="/poetry/" class="active">Poetry</a></li>
          <li><a href="/blog/">Blog</a></li>
          <li><a href="/vocabulary/">Gold List</a></li>
          <li class="nav-border"></li>
          <li><button id="theme-toggle-mobile" class="theme-toggle-mobile">Dark Mode</button></li>
        </ul>
      </nav>
      <button id="theme-toggle" class="theme-toggle" aria-label="toggle theme">
        <span id="icon-moon"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3a7 7 0 0 0 9.79 9.79z"/></svg></span>
        <span id="icon-sun" style="display:none"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg></span>
      </button>
    </header>

    <main>
      <div class="container">
        <div style="margin-bottom:16px;">
          <a href="/poetry/" style="color:var(--primary-color);text-decoration:none;font-size:14px;">&larr; All Poetry</a>
        </div>
        <div class="poem-card">
          <h3 class="poem-title" style="font-family:'Playfair Display',serif;font-size:28px;">${title}</h3>
          ${dateHtml}
          <div class="poem-body">${bodyLines}</div>
        </div>

        <!-- Comments -->
        <section id="blog-comments" class="blog-comments" data-slug="poem-${esc(poem.id)}">
          <h2>Comments <span id="comment-count"></span></h2>
          <div id="comment-list" class="comment-list">
            <div class="comment-loading">Loading comments...</div>
          </div>
          <div id="comment-form-root"></div>
        </section>
      </div>
    </main>

    <footer class="site-footer">
      <div class="container">
        <nav class="footer-nav">
          <a href="/">Home</a>
          <a href="/about">About</a>
          <a href="/poetry/">Poetry</a>
          <a href="/blog/">Blog</a>
        </nav>
        <div class="footer-social">
          <a href="https://www.linkedin.com/in/jarin-wadiwalla/" target="_blank" rel="noopener noreferrer" aria-label="LinkedIn">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M19 3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14m-.5 15.5v-5.3a3.26 3.26 0 0 0-3.26-3.26c-.85 0-1.84.52-2.32 1.3v-1.11h-2.79v8.37h2.79v-4.93c0-.77.62-1.4 1.39-1.4a1.4 1.4 0 0 1 1.4 1.4v4.93h2.79M6.88 8.56a1.68 1.68 0 0 0 1.68-1.68c0-.93-.75-1.69-1.68-1.69a1.69 1.69 0 0 0-1.69 1.69c0 .93.76 1.68 1.69 1.68m1.39 9.94v-8.37H5.5v8.37h2.77z"/></svg>
          </a>
          <a href="https://www.youtube.com/channel/UC-qLb3Bs6BtZn_t6D2wYDeA" target="_blank" rel="noopener noreferrer" aria-label="YouTube">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M10 15l5.19-3L10 9v6m11.56-7.83c.13.47.22 1.1.28 1.9.07.8.1 1.49.1 2.09L22 12c0 2.19-.16 3.8-.44 4.83-.25.9-.83 1.48-1.73 1.73-.47.13-1.33.22-2.65.28-1.3.07-2.49.1-3.59.1L12 19c-4.19 0-6.8-.16-7.83-.44-.9-.25-1.48-.83-1.73-1.73-.13-.47-.22-1.1-.28-1.9-.07-.8-.1-1.49-.1-2.09L2 12c0-2.19.16-3.8.44-4.83.25-.9.83-1.48 1.73-1.73.47-.13 1.33-.22 2.65-.28 1.3-.07 2.49-.1 3.59-.1L12 5c4.19 0 6.8.16 7.83.44.9.25 1.48.83 1.73 1.73z"/></svg>
          </a>
          <a href="https://www.instagram.com/jarinwadiwalla/" target="_blank" rel="noopener noreferrer" aria-label="Instagram">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M7.8 2h8.4C19.4 2 22 4.6 22 7.8v8.4a5.8 5.8 0 0 1-5.8 5.8H7.8C4.6 22 2 19.4 2 16.2V7.8A5.8 5.8 0 0 1 7.8 2m-.2 2A3.6 3.6 0 0 0 4 7.6v8.8C4 18.39 5.61 20 7.6 20h8.8a3.6 3.6 0 0 0 3.6-3.6V7.6C20 5.61 18.39 4 16.4 4H7.6m9.65 1.5a1.25 1.25 0 0 1 1.25 1.25A1.25 1.25 0 0 1 17.25 8 1.25 1.25 0 0 1 16 6.75a1.25 1.25 0 0 1 1.25-1.25M12 7a5 5 0 0 1 5 5 5 5 0 0 1-5 5 5 5 0 0 1-5-5 5 5 0 0 1 5-5m0 2a3 3 0 0 0-3 3 3 3 0 0 0 3 3 3 3 0 0 0 3-3 3 3 0 0 0-3-3z"/></svg>
          </a>
        </div>
        <p class="footer-copyright">&copy; 2026 Jarin Wadiwalla</p>
      </div>
    </footer>
  </div>

  <script src="/js/main.js"></script>
  <script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
  <script src="/js/blog-comments.js" defer></script>
</body>
</html>`;
}

function render404() {
  return `<!DOCTYPE html>
<html lang="en-US">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=5">
  <title>Poem Not Found - Jarin Wadiwalla</title>
  <link rel="icon" type="image/png" href="/images/lotus-icon.png">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,700;0,900;1,400&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/css/style.css">
  <script>
    (function(){var t=localStorage.getItem('theme')||'light';document.documentElement.setAttribute('data-theme',t)})();
  </script>
</head>
<body>
  <div class="primary-container">
    <header class="site-header">
      <div class="site-logo"><a href="/">Jarin Wadiwalla</a></div>
      <nav class="site-navigation">
        <button aria-label="toggle menu" class="menu-trigger">
          <div class="icon-menu-line">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
          </div>
          <div class="icon-menu-close" style="display:none">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </div>
        </button>
        <ul>
          <li><a href="/">Home</a></li>
          <li><a href="/about">About</a></li>
          <li><a href="/poetry/" class="active">Poetry</a></li>
          <li><a href="/blog/">Blog</a></li>
          <li><a href="/vocabulary/">Gold List</a></li>
          <li class="nav-border"></li>
          <li><button id="theme-toggle-mobile" class="theme-toggle-mobile">Dark Mode</button></li>
        </ul>
      </nav>
      <button id="theme-toggle" class="theme-toggle" aria-label="toggle theme">
        <span id="icon-moon"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3a7 7 0 0 0 9.79 9.79z"/></svg></span>
        <span id="icon-sun" style="display:none"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg></span>
      </button>
    </header>

    <main>
      <div class="container" style="text-align:center;padding:60px 20px;">
        <h1 style="font-family:'Playfair Display',serif;">Poem Not Found</h1>
        <p style="margin-top:16px;">This poem doesn't exist or hasn't been published yet.</p>
        <a href="/poetry/" style="display:inline-block;margin-top:24px;color:var(--primary-color);text-decoration:none;">&larr; Browse All Poetry</a>
      </div>
    </main>

    <footer class="site-footer">
      <div class="container">
        <nav class="footer-nav">
          <a href="/">Home</a>
          <a href="/about">About</a>
          <a href="/poetry/">Poetry</a>
          <a href="/blog/">Blog</a>
        </nav>
        <p class="footer-copyright">&copy; 2026 Jarin Wadiwalla</p>
      </div>
    </footer>
  </div>

  <script src="/js/main.js"></script>
</body>
</html>`;
}

export async function onRequestGet(context) {
  const slug = context.params.slug;

  if (!slug) {
    return new Response(render404(), {
      status: 404,
      headers: { "Content-Type": "text/html; charset=UTF-8" },
    });
  }

  try {
    const now = new Date().toISOString();
    const poem = await context.env.SITE_DB.prepare(
      "SELECT * FROM poems WHERE id = ? AND published = 1 AND (scheduledAt IS NULL OR scheduledAt = '' OR scheduledAt <= ?)"
    ).bind(slug, now).first();

    if (!poem) {
      return new Response(render404(), {
        status: 404,
        headers: { "Content-Type": "text/html; charset=UTF-8" },
      });
    }

    return new Response(renderPage(poem), {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=UTF-8",
        "Cache-Control": "public, s-maxage=300",
      },
    });
  } catch (err) {
    return new Response(render404(), {
      status: 500,
      headers: { "Content-Type": "text/html; charset=UTF-8" },
    });
  }
}
