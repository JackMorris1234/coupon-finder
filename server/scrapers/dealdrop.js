import { fetchPage } from './fetchPage.js';
import { toTs } from './util.js';

// dealdrop.com is SvelteKit; /<slug>/__data.json exposes the full offer
// objects — including the code strings that are click-to-reveal on the
// website, their verification status and last-verified date. Objects in the
// payload map field names to indices in a flat data array.
export const name = 'DealDrop';
export const usesSlug = true;

export async function scrape(domain, slug) {
  const pageUrl = `https://www.dealdrop.com/${slug}`;
  const raw = await fetchPage(`${pageUrl}/__data.json`);
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    throw new Error('dealdrop: __data.json is not JSON');
  }

  const offers = [];
  const seen = new Set();
  for (const node of payload.nodes ?? []) {
    const data = node?.data;
    if (!Array.isArray(data)) continue;
    for (const value of data) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
      if (!('coupon_code' in value) || !('title' in value)) continue;
      const o = {};
      for (const [key, idx] of Object.entries(value)) {
        o[key] = typeof idx === 'number' ? data[idx] : null;
      }
      if (!o.title || typeof o.title !== 'string') continue;
      const code = typeof o.coupon_code === 'string' && o.coupon_code.trim() ? o.coupon_code.trim() : null;
      const dedupe = code ?? o.title;
      if (seen.has(dedupe)) continue;
      seen.add(dedupe);

      offers.push({
        code,
        title: o.title,
        description: typeof o.description === 'string' ? o.description : null,
        discountText: formatDiscount(o.discount_type, o.discount_value, o.title),
        source: name,
        sourceUrl: pageUrl,
        sourceVerified: o.verification_status === 'verified',
        verifiedAt: toTs(o.last_verified_at),
      });
    }
  }
  return offers;
}

function formatDiscount(type, value, title = '') {
  if (!value || typeof value !== 'number') return null;
  if (type === 'percentage') return `${value}% off`;
  if (type === 'dollar' || type === 'fixed' || /\$/.test(title)) return `$${value} off`;
  return `${value}% off`;
}
