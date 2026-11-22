import { fetchPage } from './fetchPage.js';
import { discountFrom, toTs } from './util.js';

// dealhack.com/coupons/<slug> serves plainly (no bot wall). Offers are inline
// minified JS object literals (not JSON): offerId:"...",title:"...",code:"...",
// with the site's own code-health fields (isVerified, lastWorkedAt,
// lastCheckedAt, expiresOn). We slice per offerId and regex the fields; the
// monetizationQuery values are affiliate click params we never request.
export const name = 'DealHack';
export const usesSlug = true;

const str = (chunk, field) => chunk.match(new RegExp(`${field}:"((?:[^"\\\\]|\\\\.)*)"`))?.[1] ?? null;
const num = (chunk, field) => {
  const m = chunk.match(new RegExp(`${field}:(-?\\d+(?:\\.\\d+)?)`));
  return m ? Number(m[1]) : null;
};

export async function scrape(domain, slug) {
  const url = `https://dealhack.com/coupons/${slug}`;
  const html = await fetchPage(url);

  const nowMs = Date.now();
  const offers = [];
  const seen = new Set();
  for (const chunk of html.split('offerId:"').slice(1)) {
    const scope = chunk.slice(0, 2000);
    const title = str(scope, 'title');
    if (!title) continue;
    // The page's payload also embeds offers for RELATED merchants (e.g.
    // Holabird Sports on the Nike page). Each offer's monetization params name
    // the owning merchant (dn=<domain>) — keep only this merchant's offers.
    const dn = scope.match(/dn=([a-z0-9.-]+)/)?.[1];
    if (dn && dn !== domain) continue;
    const code = str(scope, 'code');
    const key = code ?? title;
    if (seen.has(key)) continue;
    seen.add(key);

    const expiresAt = toTs(str(scope, 'expiresOn'));
    if (expiresAt && expiresAt < nowMs) continue;
    const description = str(scope, 'description');

    offers.push({
      code,
      title: unescapeJs(title),
      description: description ? unescapeJs(description).slice(0, 300) : null,
      discountText: discountFrom(title),
      source: name,
      sourceUrl: url,
      sourceVerified: /isVerified:!0/.test(scope),
      verifiedAt: toTs(str(scope, 'lastWorkedAt')),
      expiresAt,
      // Richest telemetry of any source: real shopper redemption counts plus
      // its own works-score (cesWorksScore) and confidence in that score.
      telemetry: {
        attempts: num(scope, 'shopperUseCount') ?? 0,
        successes: num(scope, 'shopperSuccessCount') ?? 0,
        lastSuccessAt: toTs(str(scope, 'lastWorkedAt')),
        lastVerifiedAt: toTs(str(scope, 'lastCheckedAt')),
        sourceScore: num(scope, 'cesWorksScore'),
        sourceConfidence: num(scope, 'cesConfidence'),
        declaredVerified: /isVerified:!0/.test(scope),
        sources: [name],
      },
    });
  }
  return offers;
}

function unescapeJs(s) {
  return s.replace(/\\(["'\\/])/g, '$1').replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
}
