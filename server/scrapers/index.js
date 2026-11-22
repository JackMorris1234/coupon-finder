import * as promocodes from './promocodes.js';
import * as couponfollow from './couponfollow.js';
import * as dealdrop from './dealdrop.js';
import * as couponscom from './couponscom.js';
import * as savingscom from './savingscom.js';
import * as dontpayfull from './dontpayfull.js';
import * as dealhack from './dealhack.js';
import { mergeTelemetry, scoreOffer, statusFromBand, telemetryFor } from './confidence.js';

const ADAPTERS = [promocodes, couponfollow, dealdrop, couponscom, savingscom, dontpayfull, dealhack];

// Candidate slugs for coupon-site merchant pages, tried in order:
// "shopmarketbasket.com" + "Market Basket" -> ["shopmarketbasket", "market-basket", "marketbasket"]
function slugCandidates(domain, name) {
  const fromDomain = domain.split('.')[0].toLowerCase().replace(/[^a-z0-9-]/g, '');
  const normalized = (name || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ').trim();
  const hyphenated = normalized.replace(/ /g, '-');
  const joined = normalized.replace(/ /g, '');
  return [...new Set([fromDomain, hyphenated, joined].filter(Boolean))];
}

// Try an adapter across candidate slugs until one yields offers; a 404 on one
// slug just means the site files the merchant under another name.
async function scrapeWithSlugs(adapter, domain, slugs) {
  let lastError = null;
  for (const slug of slugs) {
    try {
      const offers = await adapter.scrape(domain, slug);
      if (offers.length > 0) return offers;
    } catch (err) {
      lastError = err;
    }
  }
  if (lastError) throw lastError;
  return [];
}

// Verification policy: we cannot test-apply codes at retailers' checkouts (bot
// protection, and automated code-testing is the abuse pattern those defenses
// exist to stop). Instead we pool the telemetry the sources publish about real
// shopper redemptions and score it — see confidence.js.
const withSource = (offer) => telemetryFor(offer.source, offer.telemetry ?? {});

export async function scrapeAll(domain, name) {
  const slugs = slugCandidates(domain, name);
  const results = await Promise.allSettled(
    ADAPTERS.map((a) => (a.usesSlug ? scrapeWithSlugs(a, domain, slugs) : a.scrape(domain, slugs[0])))
  );

  // A real code is caps/digits (possibly several, space-separated) — phrases
  // like "Sign up for code" that sources put in the code field become deals.
  // (case-insensitive: real codes may be mixed-case; phrases still fail on
  // short words like "up"/"for"; the blocklist catches UI text that leaks
  // through reveal endpoints, e.g. "Tab")
  const JUNK_CODES = new Set(['TAB', 'CODE', 'COUPON', 'DEAL', 'SALE', 'CLICK', 'COPY', 'NONE', 'NULL']);
  const isRealCode = (code) =>
    /^[A-Z0-9][A-Z0-9_-]{2,19}(\s[A-Z0-9][A-Z0-9_-]{2,19}){0,2}$/i.test(code) &&
    !JUNK_CODES.has(code.toUpperCase());

  const offers = [];
  const errors = [];
  results.forEach((r, i) => {
    // A rejected code still means the source HAS a code it didn't hand over,
    // so the offer stays click-to-reveal rather than becoming a "deal".
    if (r.status === 'fulfilled') offers.push(...r.value.map((o) => (
      o.code && !isRealCode(o.code) ? { ...o, code: null, hasHiddenCode: true } : o
    )));
    else {
      const message = String(r.reason?.message ?? r.reason);
      // A 404 means the source simply doesn't list this merchant — not an outage.
      if (!/HTTP 404/.test(message)) errors.push({ source: ADAPTERS[i].name, error: message });
    }
  });

  // Dedupe: identical codes across sources collapse into one card, but their
  // telemetry is POOLED first — what three sources saw about the same code is
  // strictly better evidence than whichever entry we happened to keep for
  // display. Code-less deals dedupe on normalized title.
  const byKey = new Map();
  for (const offer of offers) {
    const key = offer.code
      ? `code:${offer.code.toUpperCase()}`
      : `deal:${offer.title.toLowerCase().replace(/[^a-z0-9%$ ]/g, '').slice(0, 60)}`;
    const incoming = withSource(offer);
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, { ...offer, telemetry: incoming });
      continue;
    }
    // Keep the richer presentation, but always pool the evidence.
    const preferIncoming =
      (offer.sourceVerified && !prev.sourceVerified) || (offer.description && !prev.description);
    const winner = preferIncoming ? { ...offer } : prev;
    winner.telemetry = mergeTelemetry(prev.telemetry, incoming);
    winner.corroborated = true;
    byKey.set(key, winner);
  }

  const nowMs = Date.now();
  const scored = [...byKey.values()].map((offer) => {
    const result = scoreOffer(offer, nowMs);
    return { ...offer, ...result, status: statusFromBand(result.band) };
  });

  return { offers: scored, errors };
}
