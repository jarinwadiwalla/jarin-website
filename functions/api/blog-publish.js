/**
 * Cloudflare Pages Function — /api/blog-publish
 *
 * POST → reads draft from D1, builds .md with front matter,
 *        commits to GitHub via Contents API, deletes draft from D1
 *
 * Environment bindings required:
 *   - SITE_DB (D1 database)
 *   - GITHUB_TOKEN (secret)
 */

const CORS_HEADERS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
};

const GITHUB_REPO = "jarinwadiwalla/jarin-website";
const GITHUB_API = "https://api.github.com";
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
      return new Response(
        JSON.stringify({ error: "Must include slug." }),
        { status: 400, headers: CORS_HEADERS }
      );
    }

    const token = context.env.GITHUB_TOKEN;
    if (!token) {
      return new Response(
        JSON.stringify({ error: "GITHUB_TOKEN not configured." }),
        { status: 500, headers: CORS_HEADERS }
      );
    }

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
        return new Response(
          JSON.stringify({ error: "Draft not found." }),
          { status: 404, headers: CORS_HEADERS }
        );
      }
    }

    const markdown = buildMarkdown(draft);
    const filePath = `blog/posts/${slug}.md`;
    const encodedContent = btoa(unescape(encodeURIComponent(markdown)));

    // Check if file already exists (need SHA for update)
    let existingSha = null;
    const checkRes = await fetch(
      `${GITHUB_API}/repos/${GITHUB_REPO}/contents/${filePath}?ref=${BRANCH}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github.v3+json",
          "User-Agent": "jarin-website",
        },
      }
    );

    if (checkRes.ok) {
      const existing = await checkRes.json();
      existingSha = existing.sha;
    }

    const commitMessage = existingSha
      ? `Update blog post: ${draft.title}`
      : `Add blog post: ${draft.title}`;

    const commitBody = {
      message: commitMessage,
      content: encodedContent,
      branch: BRANCH,
    };
    if (existingSha) {
      commitBody.sha = existingSha;
    }

    const commitRes = await fetch(
      `${GITHUB_API}/repos/${GITHUB_REPO}/contents/${filePath}`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github.v3+json",
          "Content-Type": "application/json",
          "User-Agent": "jarin-website",
        },
        body: JSON.stringify(commitBody),
      }
    );

    if (!commitRes.ok) {
      const errBody = await commitRes.text();
      return new Response(
        JSON.stringify({ error: "GitHub commit failed.", details: errBody }),
        { status: 502, headers: CORS_HEADERS }
      );
    }

    await context.env.SITE_DB.prepare(
      "DELETE FROM blog_drafts WHERE slug = ?"
    ).bind(slug).run();

    return new Response(
      JSON.stringify({
        ok: true,
        message: commitMessage,
        file: filePath,
      }),
      { status: 200, headers: CORS_HEADERS }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Failed to publish blog post." }),
      { status: 500, headers: CORS_HEADERS }
    );
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}
