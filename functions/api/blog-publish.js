/**
 * Cloudflare Pages Function — /api/blog-publish
 *
 * POST → reads draft from D1, builds .md with front matter,
 *        commits to GitLab via Repository Files API, deletes draft from D1
 *
 * Environment bindings required:
 *   - SITE_DB (D1 database)
 *   - GITLAB_TOKEN (secret)
 */

import { jsonResponse, errorResponse } from '../lib/response.js';

const GITLAB_PROJECT = "jarinwadiwalla%2Fjarin-website";
const GITLAB_API = "https://gitlab.com/api/v4";
const BRANCH = "main";

function buildMarkdown(draft) {
  const frontMatter = [
    "---",
    `title: ${draft.title}`,
    `date: ${draft.date}`,
    `author: ${draft.author}`,
    `excerpt: ${draft.excerpt}`,
    `slug: ${draft.slug}`,
    `image: ${draft.image}`,
    "---",
  ].join("\n");

  return frontMatter + "\n\n" + draft.body;
}

export async function onRequestPost(context) {
  try {
    const body = await context.request.json();
    const { slug } = body;

    if (!slug) {
      return errorResponse("Must include slug.", 400);
    }

    const token = context.env.GITLAB_TOKEN;
    if (!token) {
      return errorResponse("GITLAB_TOKEN not configured.");
    }

    // Use inline draft data if provided (allows publishing without saving first),
    // otherwise fall back to reading from D1
    let draft;
    if (body.title && body.body) {
      draft = {
        title: body.title,
        slug: body.slug,
        date: body.date || new Date().toISOString().slice(0, 10),
        author: body.author || "Jarin",
        excerpt: body.description || body.excerpt || "",
        image: body.image || "",
        body: body.body,
      };
    } else {
      draft = await context.env.SITE_DB.prepare(
        "SELECT * FROM blog_drafts WHERE slug = ?"
      ).bind(slug).first();

      if (!draft) {
        return errorResponse("Draft not found.", 404);
      }
    }

    const markdown = buildMarkdown(draft);
    const filePath = `blog/posts/${slug}.md`;
    const encodedPath = encodeURIComponent(filePath);

    const headRes = await fetch(
      `${GITLAB_API}/projects/${GITLAB_PROJECT}/repository/files/${encodedPath}?ref=${BRANCH}`,
      { method: "HEAD", headers: { "PRIVATE-TOKEN": token } }
    );

    const fileExists = headRes.ok;
    const method = fileExists ? "PUT" : "POST";
    const commitMessage = fileExists
      ? `Update blog post: ${draft.title}`
      : `Add blog post: ${draft.title}`;

    const commitRes = await fetch(
      `${GITLAB_API}/projects/${GITLAB_PROJECT}/repository/files/${encodedPath}`,
      {
        method,
        headers: {
          "PRIVATE-TOKEN": token,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          branch: BRANCH,
          content: markdown,
          commit_message: commitMessage,
          encoding: "text",
        }),
      }
    );

    if (!commitRes.ok) {
      const errBody = await commitRes.text();
      return jsonResponse({ error: "GitLab commit failed.", details: errBody }, 502);
    }

    await context.env.SITE_DB.prepare(
      "DELETE FROM blog_drafts WHERE slug = ?"
    ).bind(slug).run();

    return jsonResponse({
      ok: true,
      message: commitMessage,
      file: filePath,
    });
  } catch (err) {
    return errorResponse("Failed to publish blog post.");
  }
}
