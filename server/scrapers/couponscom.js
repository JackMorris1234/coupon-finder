import { load } from 'cheerio';
import { fetchPage } from './fetchPage.js';
import { toTs } from './util.js';

// coupons.com is Next.js App Router: offers live in RSC flight chunks pushed
// via self.__next_f.push([1, "..."]). Each offer is an OfferListingOffer with
// a voucher object carrying the FULL code string, expiry (endTime) and a
// last-used timestamp. Never request the affiliateUrl click-tracker values.
export const name = 'Coupons.com';
export const usesSlug = true;

export async function scrape(domain, slug) {
  const url = `https://www.coupons.com/coupon-codes/${slug}`;
  const html = await fetchPage(url);
  const $ = load(html);

  // Reassemble the flight payload from all __next_f.push script chunks.
  let payload = '';
  $('script').each((_, el) => {
    const text = $(el).text();
    if (!text.includes('self.__next_f.push')) return;
    const m = text.match(/self\.__next_f\.push\(\[\d+,\s*"([\s\S]*)"\]\)\s*$/);
    if (!m) return;
    try {
      payload += JSON.parse(`"${m[1]}"`); // unescape the JS string literal
    } catch { /* skip malformed chunk */ }
  });
  if (!payload) throw new Error('coupons.com: no flight payload');

  const offers = [];
  const nowMs = Date.now();
  let idx = 0;
  while ((idx = payload.indexOf('"voucher":{', idx)) !== -1) {
    const objText = sliceBalanced(payload, idx + '"voucher":'.length);
    idx += 10;
    if (!objText) continue;
    let v;
    try { v = JSON.parse(objText); } catch { continue; }
    if (!v || typeof v.title !== 'string') continue;
    const expiresAt = toTs(v.endTime);
    if (expiresAt && expiresAt < nowMs) continue;
    const lastUsed = toTs(v.voucherStatistic?.lastUsedDate);
    offers.push({
      code: typeof v.code === 'string' && v.code.trim() ? v.code.trim() : null,
      title: v.title,
      description: typeof v.termsAndConditions === 'string'
        ? v.termsAndConditions.replace(/\s+/g, ' ').slice(0, 300) : null,
      discountText: v.caption1 && v.caption2 ? `${v.caption1} ${v.caption2}` : null,
      source: name,
      sourceUrl: url,
      sourceVerified: Boolean(lastUsed && nowMs - lastUsed < 7 * 24 * 60 * 60 * 1000),
      verifiedAt: lastUsed,
      expiresAt,
      // lastUsedDate is when a shopper last actually redeemed it.
      telemetry: {
        lastSuccessAt: lastUsed,
        declaredVerified: Boolean(lastUsed && nowMs - lastUsed < 7 * 24 * 60 * 60 * 1000),
        sources: [name],
      },
    });
  }
  // The payload repeats objects across chunks; dedupe by title+code.
  const seen = new Set();
  return offers.filter((o) => {
    const key = `${o.code ?? ''}|${o.title}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// Return the balanced {...} JSON object starting at `start` (payload[start]
// must be '{'), honoring strings and escapes; null if unterminated.
function sliceBalanced(text, start) {
  if (text[start] !== '{') return null;
  let depth = 0, inString = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === '\\') i++;
      else if (ch === '"') inString = false;
    } else if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}
