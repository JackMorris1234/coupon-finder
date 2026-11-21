import { load } from 'cheerio';
import { fetchPage } from './fetchPage.js';
import { discountFrom, toTs } from './util.js';

// savings.com renders offers server-side as div.module-deal. The on-page code
// slot is empty, but each code-type offer links a static ~10KB popup page
// (/popup/detail/coupon-<id>.html) whose input.code value holds the FULL code.
// Expiry comes from per-offer ld+json (validThrough). The merchant page mixes
// in related merchants' offers, so we keep only those matching this company.
// Never request the data-referral-url (affiliate click tracker).
export const name = 'Savings.com';

const MAX_POPUPS = 25;

export async function scrape(domain, slug) {
  const url = `https://www.savings.com/coupons/${domain}`;
  const html = await fetchPage(url);
  const $ = load(html);

  // Map offer id -> validThrough from the ld+json Offer blocks.
  const expiry = new Map();
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const data = JSON.parse($(el).text());
      for (const item of Array.isArray(data) ? data : [data]) {
        const offers = item?.makesOffer ?? item?.offers ?? (item?.['@type'] === 'Offer' ? [item] : []);
        for (const o of Array.isArray(offers) ? offers : [offers]) {
          const id = String(o?.url ?? '').match(/#d-(\d+)/)?.[1];
          const ts = toTs(o?.validThrough);
          if (id && ts) expiry.set(id, ts);
        }
      }
    } catch { /* ignore malformed blocks */ }
  });

  const label = domain.split('.')[0].toLowerCase();
  const nowMs = Date.now();
  const entries = [];
  $('div.module-deal').each((_, el) => {
    const card = $(el);
    const merchant = card.find('.deal-merchant-name').first().text().trim().toLowerCase();
    const merchantKey = merchant.replace(/[^a-z0-9]/g, '');
    // Require a positive match: the page mixes in related merchants, and cards
    // without a merchant name are cross-store modules, not this store's offers.
    if (!merchantKey || (!merchantKey.includes(label) && !label.includes(merchantKey))) return;
    const id = (card.attr('id') ?? '').replace(/^d-/, '') || card.attr('data-offer-id');
    const title = card.find('h3').first().text().trim();
    if (!title) return;
    const expiresAt = (id && expiry.get(id)) || null;
    if (expiresAt && expiresAt < nowMs) return;
    entries.push({
      title,
      hasCode: card.hasClass('hasCode'),
      popupPath: card.find('input[name="property-popup-url"]').attr('value') ?? null,
      usageText: card.find('span.usage').first().text().trim() || null,
      expiresAt,
    });
  });

  // Fetch the static popup pages for code-type offers (bounded).
  const codeEntries = entries.filter((e) => e.hasCode && e.popupPath).slice(0, MAX_POPUPS);
  await Promise.allSettled(codeEntries.map(async (e) => {
    const popup = await fetchPage(`https://www.savings.com${e.popupPath}`);
    const code = load(popup)('input.code').attr('value');
    if (code && code.trim()) e.code = code.trim();
  }));

  return entries.map((e) => ({
    code: e.code ?? null,
    hasHiddenCode: e.hasCode && !e.code,
    title: e.title,
    description: e.usageText,
    discountText: discountFrom(e.title),
    source: name,
    sourceUrl: url,
    sourceVerified: false, // no validation dates; corroboration can still verify
    expiresAt: e.expiresAt,
  }));
}
