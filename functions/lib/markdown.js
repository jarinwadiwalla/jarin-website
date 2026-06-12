/**
 * Tiny markdown helpers used by poem rendering.
 *
 * Both functions accept HTML-escaped input. parsePoemLinks should be run
 * AFTER escaping the body so the rest of the input stays safe — only the
 * specific [text](http(s)://url) pattern is converted to a real anchor tag.
 *
 * applyImageCaptions is the canonical implementation of the image-caption
 * convention. The same logic is duplicated inline in scripts/build-blog.js
 * (CJS) and marketing/js/guru-core.js (browser bundle) since neither can
 * import from this ESM module — keep the three copies in sync.
 */

const LINK_RE = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
const IMG_LINE_RE = /^!\[([^\]]*)\]\(([^)]+)\)\s*$/;
const CAPTION_LINE_RE = /^[*_](.+?)[*_]\s*$/;

export function parsePoemLinks(escaped) {
  return escaped.replace(LINK_RE, (m, text, url) => {
    const safeUrl = url.replace(/"/g, '&quot;');
    return '<a href="' + safeUrl + '" target="_blank" rel="noopener noreferrer">' + text + '</a>';
  });
}

export function stripPoemLinks(text) {
  return text.replace(LINK_RE, '$1');
}

// Wraps `![alt](url)\n*caption*` blocks (image alone, italic alone, in
// their own paragraph) into <figure><img><figcaption></figcaption></figure>
// for blog post rendering. Run against raw markdown before further markdown
// processing — the emitted <figure> is a block-level HTML pass-through that
// `marked` and the in-browser markdownToHtml() leave untouched, while the
// blog build's rewriteImages() still sees the inner <img> and upgrades it
// to a <picture>.
//
// Requires both lines to be standalone (preceded and followed by a blank
// line or document boundary) so we don't accidentally restructure inline
// content. Caption text is passed through verbatim — markdown inside
// captions is not re-rendered.
// Inline-width image extension: `![alt|600](url)` lets blog authors set a
// display width on a per-image basis. Runs after markdown → HTML (i.e. on
// rendered HTML containing <img alt="...|600" ...> tags) so it catches both
// inline images and the pass-through <img>s inside <figure> blocks emitted
// by applyImageCaptions. Mirrored verbatim in scripts/build-blog.js (CJS
// build path) and marketing/js/guru-core.js (browser preview bundle) since
// neither can import from this ESM module — keep the three copies in sync.
const IMG_WIDTH_RE = /<img\b([^>]*?)\salt=(["'])([^"']*?)\|(\d+)\2([^>]*)>/gi;
export function applyImageWidths(html) {
  if (!html) return html;
  return html.replace(IMG_WIDTH_RE,
    (m, pre, q, alt, width, post) => `<img${pre} alt=${q}${alt}${q} width="${width}"${post}>`);
}

export function applyImageCaptions(md) {
  if (!md) return md;
  const lines = md.split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const next = lines[i + 1] || '';
    const before = i > 0 ? lines[i - 1] : '';
    const after = lines[i + 2] || '';
    const imgMatch = line.match(IMG_LINE_RE);
    const capMatch = next.match(CAPTION_LINE_RE);
    const standaloneBefore = i === 0 || before.trim() === '';
    const standaloneAfter = (i + 2) >= lines.length || after.trim() === '';
    if (imgMatch && capMatch && standaloneBefore && standaloneAfter) {
      const alt = imgMatch[1].replace(/"/g, '&quot;');
      const url = imgMatch[2].replace(/"/g, '&quot;');
      const caption = capMatch[1];
      out.push('<figure>');
      out.push(`<img src="${url}" alt="${alt}">`);
      out.push(`<figcaption>${caption}</figcaption>`);
      out.push('</figure>');
      i++;
      continue;
    }
    out.push(line);
  }
  return out.join('\n');
}
