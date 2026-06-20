// Build-time fetch + parse of the Substack RSS feed.
// Returns a list of recent posts; on any error returns [] so the build never breaks.

export const SUBSTACK_URL = 'https://jarinwadiwalla.substack.com';
const FEED_URL = `${SUBSTACK_URL}/feed`;

function decode(str = '') {
  return str
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .trim();
}

function tag(block, name) {
  const m = block.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`));
  return m ? decode(m[1]) : '';
}

export async function getSubstackPosts(limit = 6) {
  try {
    const res = await fetch(FEED_URL, { headers: { 'User-Agent': 'jarinwadiwalla.com build' } });
    if (!res.ok) throw new Error(`feed ${res.status}`);
    const xml = await res.text();

    const items = xml.match(/<item>[\s\S]*?<\/item>/g) || [];
    return items.slice(0, limit).map((block) => {
      const enclosure = block.match(/<enclosure[^>]*url="([^"]+)"/);
      const pub = tag(block, 'pubDate');
      return {
        title: tag(block, 'title'),
        link: tag(block, 'link'),
        description: tag(block, 'description'),
        image: enclosure ? enclosure[1] : null,
        date: pub
          ? new Date(pub).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
          : '',
      };
    });
  } catch (err) {
    console.warn('[substack] could not fetch feed at build time:', err.message);
    return [];
  }
}
