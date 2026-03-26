/**
 * Cloudflare Pages Function — /api/blog-posts
 *
 * GET    → lists published blog posts (from GitHub) or fetches a single post by slug
 * DELETE → deletes a published blog post from GitHub
 *
 * Environment bindings required:
 *   - GITHUB_TOKEN (secret)
 */

const CORS_HEADERS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
};

const GITHUB_REPO = "jarinwadiwalla/jarin-website";
const GITHUB_API = "https://api.github.com";
const BRANCH = "main";

const GITHUB_HEADERS = (token) => ({
  Authorization: `Bearer ${token}`,
  Accept: "application/vnd.github.v3+json",
  "User-Agent": "jarin-website",
});

function parseFrontMatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---\n\n?([\s\S]*)$/);
  if (!match) return { meta: {}, body: content };
  const meta = {};
  for (const line of match[1].split("\n")) {
    const idx = line.indexOf(":");
    if (idx > 0) {
      const key = line.slice(0, idx).trim();
      const val = line.slice(idx + 1).trim();
      meta[key] = val;
    }
  }
  return { meta, body: match[2] };
}

export async function onRequestGet(context) {
  try {
    const token = context.env.GITHUB_TOKEN;
    if (!token) {
      return new Response(
        JSON.stringify({ error: "GITHUB_TOKEN not configured." }),
        { status: 500, headers: CORS_HEADERS }
      );
    }

    const url = new URL(context.request.url);
    const slug = url.searchParams.get("slug");

    if (slug) {
      const filePath = `blog/posts/${slug}.md`;
      const res = await fetch(
        `${GITHUB_API}/repos/${GITHUB_REPO}/contents/${filePath}?ref=${BRANCH}`,
        { headers: GITHUB_HEADERS(token) }
      );
      if (!res.ok) {
        return new Response(
          JSON.stringify({ error: "Post not found." }),
          { status: 404, headers: CORS_HEADERS }
        );
      }
      const file = await res.json();
      const raw = decodeURIComponent(escape(atob(file.content)));
      const { meta, body } = parseFrontMatter(raw);
      return new Response(
        JSON.stringify({
          post: {
            slug: meta.slug || slug,
            title: meta.title || "",
            date: meta.date || "",
            author: meta.author || "",
            excerpt: meta.excerpt || "",
            image: meta.image || "",
            body,
          },
        }),
        { status: 200, headers: CORS_HEADERS }
      );
    }

    // List all posts
    const res = await fetch(
      `${GITHUB_API}/repos/${GITHUB_REPO}/contents/blog/posts?ref=${BRANCH}`,
      { headers: GITHUB_HEADERS(token) }
    );
    if (!res.ok) {
      // If directory doesn't exist yet, return empty list
      if (res.status === 404) {
        return new Response(
          JSON.stringify({ posts: [] }),
          { status: 200, headers: CORS_HEADERS }
        );
      }
      return new Response(
        JSON.stringify({ error: "Failed to list posts." }),
        { status: 502, headers: CORS_HEADERS }
      );
    }

    const files = await res.json();
    const mdFiles = files
      .filter((f) => f.type === "file" && f.name.endsWith(".md"))
      .map((f) => f.name.replace(/\.md$/, ""));

    const posts = await Promise.all(
      mdFiles.map(async (slug) => {
        try {
          const filePath = `blog/posts/${slug}.md`;
          const r = await fetch(
            `${GITHUB_API}/repos/${GITHUB_REPO}/contents/${filePath}?ref=${BRANCH}`,
            { headers: GITHUB_HEADERS(token) }
          );
          if (!r.ok) return { slug, title: slug, date: "" };
          const file = await r.json();
          const raw = decodeURIComponent(escape(atob(file.content)));
          const { meta } = parseFrontMatter(raw);
          return { slug, title: meta.title || slug, date: meta.date || "" };
        } catch {
          return { slug, title: slug, date: "" };
        }
      })
    );

    posts.sort((a, b) => (b.date || "").localeCompare(a.date || ""));

    return new Response(
      JSON.stringify({ posts }),
      { status: 200, headers: CORS_HEADERS }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Failed to fetch posts." }),
      { status: 500, headers: CORS_HEADERS }
    );
  }
}

export async function onRequestDelete(context) {
  try {
    const token = context.env.GITHUB_TOKEN;
    if (!token) {
      return new Response(
        JSON.stringify({ error: "GITHUB_TOKEN not configured." }),
        { status: 500, headers: CORS_HEADERS }
      );
    }

    const body = await context.request.json();
    const { slug } = body;
    if (!slug) {
      return new Response(
        JSON.stringify({ error: "Slug is required." }),
        { status: 400, headers: CORS_HEADERS }
      );
    }

    const filePath = `blog/posts/${slug}.md`;

    // Get file SHA first
    const checkRes = await fetch(
      `${GITHUB_API}/repos/${GITHUB_REPO}/contents/${filePath}?ref=${BRANCH}`,
      { headers: GITHUB_HEADERS(token) }
    );

    if (!checkRes.ok) {
      return new Response(
        JSON.stringify({ error: "Post not found." }),
        { status: 404, headers: CORS_HEADERS }
      );
    }

    const existing = await checkRes.json();

    const res = await fetch(
      `${GITHUB_API}/repos/${GITHUB_REPO}/contents/${filePath}`,
      {
        method: "DELETE",
        headers: {
          ...GITHUB_HEADERS(token),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: `Delete blog post: ${slug}`,
          sha: existing.sha,
          branch: BRANCH,
        }),
      }
    );

    if (!res.ok) {
      const errBody = await res.text();
      return new Response(
        JSON.stringify({ error: "Failed to delete post.", details: errBody }),
        { status: 502, headers: CORS_HEADERS }
      );
    }

    return new Response(
      JSON.stringify({ ok: true, message: `Deleted blog post: ${slug}` }),
      { status: 200, headers: CORS_HEADERS }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Failed to delete post." }),
      { status: 500, headers: CORS_HEADERS }
    );
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}
