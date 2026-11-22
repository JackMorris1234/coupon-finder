import { load } from 'cheerio';
import { fetchPage, USER_AGENT } from './fetchPage.js';
import { toTs } from './util.js';

// couponfollow.com/site/<domain> renders offers with click-to-reveal codes,
// but the reveal popup calls a public, unauthenticated JSON endpoint:
//   GET /api/v1/public/offer/modal/<domain>/<offerId>
// (needs the merchant page as Referer or the edge returns 403). The response
// carries the full plaintext code plus isVerified/lastVerifiedOn/expiresOn.
// This is the same request every visitor's browser makes — NOT the affiliate
// click tracker (click.couponfollow.com), which we never touch.
export const name = 'CouponFollow';

const MAX_REVEALS = 25;
const REVEAL_DELAY_MS = 400;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function scrape(domain) {
  const url = `https://couponfollow.com/site/${domain}`;
  const html = await fetchPage(url);
  const $ = load(html);

  const offers = [];
  $('article[data-offer-type]').each((_, el) => {
    const a = $(el);
    const title = a.find('h3').first().text().trim();
    if (!title) return;
    const badgeType = a.find('[data-badge-type]').first().attr('data-badge-type') || null;
    const discountBox = a.find('.text-discount-box-sm').first();
    const discountText = `${discountBox.text().trim()} ${discountBox.next().text().trim()}`.trim() || null;
    offers.push({
      offerId: a.attr('data-offer-id') || a.attr('id') || null,
      isCoupon: a.attr('data-offer-type') === 'coupon',
      code: null,
      title,
      description: a.find('p').first().text().trim() || null,
      discountText,
      hasHiddenCode: a.attr('data-has-code') === 'true',
      source: name,
      sourceUrl: url,
      sourceVerified: badgeType === 'official',
    });
  });

  // Reveal full codes through the public modal endpoint (bounded + throttled).
  const toReveal = offers.filter((o) => o.isCoupon && o.hasHiddenCode && o.offerId).slice(0, MAX_REVEALS);
  const expired = new Set();
  for (const offer of toReveal) {
    try {
      const res = await fetch(
        `https://couponfollow.com/api/v1/public/offer/modal/${domain}/${offer.offerId}`,
        {
          headers: { 'User-Agent': USER_AGENT, Accept: 'application/json', Referer: url },
          signal: AbortSignal.timeout(8000),
        }
      );
      if (!res.ok) continue;
      const data = await res.json();
      if (data?.isExpired) { expired.add(offer); continue; }
      if (typeof data?.code === 'string' && data.code.trim()) {
        offer.code = data.code.trim();
        offer.hasHiddenCode = false;
        if (data.isVerified) offer.sourceVerified = true;
        offer.verifiedAt = toTs(data.lastVerifiedOn) ?? offer.verifiedAt;
        offer.expiresAt = toTs(data.expiresOn) ?? offer.expiresAt;
        // The same modal response carries community verification counts —
        // free telemetry on an endpoint we already call.
        offer.telemetry = {
          attempts: Number(data.verificationCount) || 0,
          successes: Number(data.verificationSuccessCount) || 0,
          lastSuccessAt: toTs(data.lastSuccessDate),
          lastVerifiedAt: toTs(data.lastVerifiedOn),
          declaredVerified: Boolean(data.isVerified),
          sources: [name],
        };
      }
    } catch { /* leave as click-to-reveal */ }
    await sleep(REVEAL_DELAY_MS);
  }

  return offers
    .filter((o) => !expired.has(o))
    .map(({ offerId, isCoupon, ...offer }) => offer);
}
