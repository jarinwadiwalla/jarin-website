/**
 * Cloudflare Pages Function — /api/publish-scheduled
 *
 * POST → checks for scheduled blog drafts and poems that are due,
 *         publishes blog drafts to GitLab and marks poems as live.
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
    const now = new Date().toISOString();
    const results = { blogs: [], poems: [], errors: [] };

    // --- Check scheduled blog drafts ---
    const { results: dueDrafts } = await context.env.SITE_DB.prepare(
      "SELECT * FROM blog_drafts WHERE scheduledAt IS NOT NULL AND scheduledAt != '' AND scheduledAt <= ?"
    ).bind(now).all();

    for (const draft of dueDrafts) {
      const token = context.env.GITLAB_TOKEN;
      if (!token) {
        results.errors.push(`No GITLAB_TOKEN for "${draft.title}"`);
        continue;
      }

      try {
        const markdown = buildMarkdown(draft);
        const filePath = `blog/posts/${draft.slug}.md`;
        const encodedPath = encodeURIComponent(filePath);

        const headRes = await fetch(
          `${GITLAB_API}/projects/${GITLAB_PROJECT}/repository/files/${encodedPath}?ref=${BRANCH}`,
          { method: "HEAD", headers: { "PRIVATE-TOKEN": token } }
        );

        const method = headRes.ok ? "PUT" : "POST";
        const commitMessage = headRes.ok
          ? `Update blog post: ${draft.title}`
          : `Add blog post: ${draft.title} (scheduled)`;

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

        if (commitRes.ok) {
          await context.env.SITE_DB.prepare(
            "DELETE FROM blog_drafts WHERE slug = ?"
          ).bind(draft.slug).run();
          results.blogs.push(draft.title);
        } else {
          const errBody = await commitRes.text();
          results.errors.push(`GitLab error for "${draft.title}": ${errBody}`);
        }
      } catch (e) {
        results.errors.push(`Failed to publish "${draft.title}": ${e.message}`);
      }
    }

    // --- Check scheduled poems ---
    const { results: duePoems } = await context.env.SITE_DB.prepare(
      "SELECT * FROM poems WHERE published = 1 AND scheduledAt IS NOT NULL AND scheduledAt != '' AND scheduledAt <= ?"
    ).bind(now).all();

    for (const poem of duePoems) {
      await context.env.SITE_DB.prepare(
        "UPDATE poems SET scheduledAt=NULL, updatedAt=? WHERE id=?"
      ).bind(now, poem.id).run();
      results.poems.push(poem.title);
    }

    return jsonResponse({
      ok: true,
      published: {
        blogs: results.blogs,
        poems: results.poems,
      },
      errors: results.errors,
    });
  } catch (err) {
    return errorResponse("Failed to process scheduled items.", 500);
  }
}
