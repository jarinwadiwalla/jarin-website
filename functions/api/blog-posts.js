/**
 * Cloudflare Pages Function — /api/blog-posts
 *
 * GET  → lists published blog posts (from GitLab) or fetches a single post by slug
 * DELETE → deletes a published blog post from GitLab
 *
 * Environment bindings required:
 *   - GITLAB_TOKEN (secret)
 */

import { jsonResponse, errorResponse } from '../lib/response.js';

const GITLAB_PROJECT = "jarinwadiwalla%2Fjarin-website";
const GITLAB_API = "https://gitlab.com/api/v4";
const BRANCH = "main";

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
    const token = context.env.GITLAB_TOKEN;
    if (!token) {
      return errorResponse("GITLAB_TOKEN not configured.");
    }

    const url = new URL(context.request.url);
    const slug = url.searchParams.get("slug");

    if (slug) {
      // Fetch single post content
      const filePath = encodeURIComponent(`blog/posts/${slug}.md`);
      const res = await fetch(
        `${GITLAB_API}/projects/${GITLAB_PROJECT}/repository/files/${filePath}/raw?ref=${BRANCH}`,
        { headers: { "PRIVATE-TOKEN": token } }
      );
      if (!res.ok) {
        return errorResponse("Post not found.", 404);
      }
      const raw = await res.text();
      const { meta, body } = parseFrontMatter(raw);
      return jsonResponse({
        post: {
          slug: meta.slug || slug,
          title: meta.title || "",
          date: meta.date || "",
          author: meta.author || "",
          excerpt: meta.excerpt || "",
          image: meta.image || "",
          body,
        },
      });
    }

    // List all posts
    const res = await fetch(
      `${GITLAB_API}/projects/${GITLAB_PROJECT}/repository/tree?path=blog/posts&per_page=100&ref=${BRANCH}`,
      { headers: { "PRIVATE-TOKEN": token } }
    );
    if (!res.ok) {
      return errorResponse("Failed to list posts.", 502);
    }

    const files = await res.json();
    const mdFiles = files
      .filter((f) => f.type === "blob" && f.name.endsWith(".md"))
      .map((f) => f.name.replace(/\.md$/, ""));

    // Fetch front matter for each post to get titles and dates
    const posts = await Promise.all(
      mdFiles.map(async (slug) => {
        try {
          const filePath = encodeURIComponent(`blog/posts/${slug}.md`);
          const r = await fetch(
            `${GITLAB_API}/projects/${GITLAB_PROJECT}/repository/files/${filePath}/raw?ref=${BRANCH}`,
            { headers: { "PRIVATE-TOKEN": token } }
          );
          if (!r.ok) return { slug, title: slug, date: "" };
          const raw = await r.text();
          const { meta } = parseFrontMatter(raw);
          return { slug, title: meta.title || slug, date: meta.date || "" };
        } catch {
          return { slug, title: slug, date: "" };
        }
      })
    );

    posts.sort((a, b) => (b.date || "").localeCompare(a.date || ""));

    return jsonResponse({ posts });
  } catch (err) {
    return errorResponse("Failed to fetch posts.");
  }
}

export async function onRequestDelete(context) {
  try {
    const token = context.env.GITLAB_TOKEN;
    if (!token) {
      return errorResponse("GITLAB_TOKEN not configured.");
    }

    const body = await context.request.json();
    const { slug } = body;
    if (!slug) {
      return errorResponse("Slug is required.", 400);
    }

    const filePath = encodeURIComponent(`blog/posts/${slug}.md`);
    const res = await fetch(
      `${GITLAB_API}/projects/${GITLAB_PROJECT}/repository/files/${filePath}`,
      {
        method: "DELETE",
        headers: {
          "PRIVATE-TOKEN": token,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          branch: BRANCH,
          commit_message: `Delete blog post: ${slug}`,
        }),
      }
    );

    if (!res.ok) {
      const errBody = await res.text();
      return jsonResponse({ error: "Failed to delete post.", details: errBody }, 502);
    }

    return jsonResponse({ ok: true, message: `Deleted blog post: ${slug}` });
  } catch (err) {
    return errorResponse("Failed to delete post.");
  }
}
