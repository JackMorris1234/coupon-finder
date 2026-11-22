import { fetchPage } from './fetchPage.js';
import { toTs } from './util.js';

// promocodes.com embeds all offers in Next.js __NEXT_DATA__, including full
// coupon codes, isVerified, validatedDate and expirationDate.
export const name = 'PromoCodes.com';
export const usesSlug = true;

function formatSavings(savings, headline = '') {
  if (!savings) return null;
  // A % in the headline wins: "25% Off Orders Over $100" is a percent offer
  // whose $ figure is only the threshold.
  if (/\d\s*%/.test(headline)) return `${savings}% off`;
  if (/\$\s*\d/.test(headline)) return `$${savings} off`;
  return `${savings}% off`;
}

export async function scrape(domain, slug) {
  const url = `https://www.promocodes.com/${slug}`;
  const html = await fetchPage(url);
  const m = html.match(/<script id="__NEXT_DATA__" type="application\/json">(.*?)<\/script>/s);
  if (!m) throw new Error('promocodes: no __NEXT_DATA__');
  const data = JSON.parse(m[1]);

  const found = new Map(); // couponId -> offer object (richest wins)
  (function walk(o) {
    if (o && typeof o === 'object') {
      if ('couponCode' in o && o.couponId && o.headline) {
        const prev = found.get(o.couponId);
        if (!prev || Object.keys(o).length > Object.keys(prev).length) found.set(o.couponId, o);
      }
      for (const k in o) walk(o[k]);
    }
  })(data);

  const nowMs = Date.now();
  const offers = [];
  for (const o of found.values()) {
    const expiresAt = toTs(o.expirationDate);
    if (expiresAt && expiresAt < nowMs) continue; // skip expired
    offers.push({
      code: o.couponCode || null,
      title: o.headline,
      description: o.description || null,
      discountText: formatSavings(o.savings, o.headline),
      source: name,
      sourceUrl: url,
      sourceVerified: Boolean(o.isVerified),
      verifiedAt: toTs(o.validatedDate),
      expiresAt,
      telemetry: {
        uses: Number(o.copyCountToday) || 0,
        lastVerifiedAt: toTs(o.validatedDate),
        lastSuccessAt: toTs(o.latestTransactionDate),
        declaredVerified: Boolean(o.isVerified),
        sources: [name],
      },
    });
  }
  return offers;
}
