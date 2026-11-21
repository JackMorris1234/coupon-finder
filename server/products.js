import { fetchPage } from './scrapers/fetchPage.js';

// Product-level deals via Slickdeals' public RSS search (structured XML, no
// bot wall). Deal descriptions often carry the coupon code itself, which we
// surface as copyable. In-memory cache: product queries are long-tail, no need
// to persist them.
const cache = new Map(); // normalized query -> { at, deals }
const TTL_MS = 15 * 60 * 1000;

export async function searchProductDeals(query) {
  const key = query.toLowerCase().trim();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return { deals: hit.deals, cached: true };

  const url = `https://slickdeals.net/newsearch.php?rss=1&q=${encodeURIComponent(query)}&searcharea=deals&searchin=first`;
  const xml = await fetchPage(url);
  const deals = parseRss(xml);
  cache.set(key, { at: Date.now(), deals });
  return { deals, cached: false };
}

// First ALL-CAPS token following "code"/"coupon" — skips phrases like
// "Coupon code HOLIDAYSAVE25" matching the lowercase word "code" itself.
function extractCode(text) {
  // Optional doubled keyword handles "coupon code HOLIDAYSAVE25".
  for (const m of text.matchAll(/\b(?:code|coupon)(?:[:\s]+(?:code|coupon))?[:\s]+([A-Za-z0-9]{4,20})\b/gi)) {
    const candidate = m[1];
    if (/^[A-Z0-9]+$/.test(candidate) && !['CODE', 'COUPON', 'SAVE', 'FREE', 'SALE'].includes(candidate)) {
      return candidate;
    }
  }
  return null;
}

function decodeEntities(s) {
  return s
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&nbsp;/g, ' ');
}

function field(block, tag) {
  const m = block.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
  if (!m) return null;
  const raw = m[1].replace(/^\s*<!\[CDATA\[/, '').replace(/\]\]>\s*$/, '').trim();
  return decodeEntities(raw);
}

function parseRss(xml) {
  return xml
    .split('<item>').slice(1)
    .map((block) => {
      const title = field(block, 'title');
      const link = field(block, 'link');
      if (!title || !link) return null;
      const description = field(block, 'description') ?? '';
      const pubDate = field(block, 'pubDate');
      const publishedAt = pubDate ? Date.parse(pubDate) : null;
      return {
        title,
        link: link.split('?')[0], // strip the RSS utm params
        description: description.replace(/\s+/g, ' ').slice(0, 300),
        publishedAt: Number.isFinite(publishedAt) ? publishedAt : null,
        price: title.match(/\$[\d,]+(?:\.\d{2})?/)?.[0] ?? null,
        code: extractCode(`${title} ${description}`),
        source: 'Slickdeals',
      };
    })
    .filter(Boolean);
}
