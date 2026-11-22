import { load } from 'cheerio';
import { fetchPage } from './fetchPage.js';
import { parseAgo, toTs } from './util.js';

// dontpayfull.com/at/<domain>: active cards mask codes as ***SUFFIX (last 5
// chars), but the page's own activity timeline leaks the FULL codes
// ("New code available for <Store>: <span class=activity-code>CODE</span>").
// We join timeline codes to cards by that suffix; unmatched timeline codes
// become standalone offers. One static GET per merchant; no tracker URLs.
export const name = 'DontPayFull';

export async function scrape(domain) {
  const url = `https://www.dontpayfull.com/at/${domain}`;
  let html;
  try {
    html = await fetchPage(url);
  } catch (err) {
    // Their bot wall 403s intermittently; one delayed retry usually clears it.
    if (!/HTTP 403/.test(String(err.message))) throw err;
    await new Promise((resolve) => setTimeout(resolve, 2500));
    html = await fetchPage(url);
  }
  const $ = load(html);
  const nowMs = Date.now();

  const cards = [];
  $('article.card.obox.code, div.card.obox.code').each((_, el) => {
    const card = $(el);
    if (card.hasClass('oexpired') || card.hasClass('to-store')) return;
    const title = card.find('h3.otitle').first().text().trim();
    if (!title) return;
    const mask = card.find('div.ocode').first().text().trim();
    const pct = card.find('.percent__label').first().text().trim();
    const off = card.find('.off__label').first().text().trim();
    const expiresAt = toTs(card.find('.oexpire span').first().text().trim());
    if (expiresAt && expiresAt < nowMs) return;
    // "Verified 2h ago by our staff" / "Used 8h ago" — relative, parsed to ms.
    const cardText = card.text();
    cards.push({
      title,
      suffix: mask.startsWith('***') ? mask.slice(3) : null,
      discountText: pct ? `${pct} ${off}`.trim().toLowerCase() : null,
      verified: (card.attr('data-filter') || '').includes('verified'),
      verifiedAgoAt: parseAgo(cardText.match(/Verified\s+\d+\s*\w+\s*ago/i)?.[0]),
      usedAgoAt: parseAgo(cardText.match(/Used\s+\d+\s*\w+\s*ago/i)?.[0]),
      expiresAt,
      code: null,
    });
  });

  const timeline = [];
  $('.coupon-timeline-item--active').each((_, el) => {
    const item = $(el);
    const code = item.find('.activity-code').first().text().trim();
    if (!code) return;
    const discount = item.find('.coupon-timeline-text').text().match(/(\d+)% off/)?.[1] ?? null;
    timeline.push({
      code,
      discountText: discount ? `${discount}% off` : null,
      postedAt: toTs(item.find('.coupon-timeline-date').first().text().trim()),
      expiresAt: toTs(item.find('.coupon-timeline-valid').text().match(/valid through (.+)/)?.[1]),
    });
  });

  // Join: timeline code tail must equal the card's mask suffix.
  const matched = new Set();
  for (const t of timeline) {
    if (matched.has(t.code)) continue;
    const card = cards.find((c) => !c.code && c.suffix && t.code.endsWith(c.suffix));
    if (card) {
      card.code = t.code;
      card.expiresAt = card.expiresAt ?? t.expiresAt;
      card.postedAt = t.postedAt;
      matched.add(t.code);
    }
  }

  const offers = cards.map((c) => ({
    code: c.code,
    hasHiddenCode: !c.code,
    title: c.title,
    description: null,
    discountText: c.discountText,
    source: name,
    sourceUrl: url,
    sourceVerified: c.verified,
    verifiedAt: c.postedAt ?? c.verifiedAgoAt ?? null,
    expiresAt: c.expiresAt,
    telemetry: {
      lastSuccessAt: c.usedAgoAt ?? null,
      lastVerifiedAt: c.verifiedAgoAt ?? c.postedAt ?? null,
      declaredVerified: c.verified,
      sources: [name],
    },
  }));

  for (const t of timeline) {
    if (matched.has(t.code)) continue;
    if (t.expiresAt && t.expiresAt < nowMs) continue;
    offers.push({
      code: t.code,
      title: `${t.discountText ?? 'Discount'} code (from recent activity)`,
      description: null,
      discountText: t.discountText,
      source: name,
      sourceUrl: url,
      sourceVerified: false,
      verifiedAt: t.postedAt,
      expiresAt: t.expiresAt,
      telemetry: { lastSuccessAt: t.postedAt, sources: [name] },
    });
  }
  return offers;
}
