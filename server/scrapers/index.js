import * as promocodes from './promocodes.js';
import * as couponfollow from './couponfollow.js';
import * as dealdrop from './dealdrop.js';
import * as couponscom from './couponscom.js';
import * as savingscom from './savingscom.js';
import * as dontpayfull from './dontpayfull.js';
import * as dealhack from './dealhack.js';

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

const VERIFIED_MAX_AGE_MS = 60 * 24 * 60 * 60 * 1000; // source validation older than 60 days doesn't count

// Verification policy: we cannot test-apply codes at most retailers' checkouts
// (bot protection / needs a real cart session), so a code is "verified" when a
// source recently validated it or it is corroborated by 2+ sources; everything
// else stays "unconfirmed".
function assignStatus(offers) {
  const nowMs = Date.now();
  for (const o of offers) {
    const recentlyValidated = o.verifiedAt && nowMs - o.verifiedAt < VERIFIED_MAX_AGE_MS;
    const sourceVerified = o.sourceVerified && (recentlyValidated || !o.verifiedAt);
    o.status = sourceVerified || recentlyValidated || o.corroborated ? 'verified' : 'unconfirmed';
    if (o.status === 'verified' && !o.verifiedAt) o.verifiedAt = nowMs;
  }
  return offers;
}

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
    if (r.status === 'fulfilled') offers.push(...r.value.map((o) => (
      o.code && !isRealCode(o.code) ? { ...o, code: null } : o
    )));
    else {
      const message = String(r.reason?.message ?? r.reason);
      // A 404 means the source simply doesn't list this merchant — not an outage.
      if (!/HTTP 404/.test(message)) errors.push({ source: ADAPTERS[i].name, error: message });
    }
  });

  // Dedupe: identical codes across sources collapse (prefer the entry that has
  // richer verification data); code-less deals dedupe on normalized title.
  const byKey = new Map();
  for (const o of offers) {
    const key = o.code
      ? `code:${o.code.toUpperCase()}`
      : `deal:${o.title.toLowerCase().replace(/[^a-z0-9%$ ]/g, '').slice(0, 60)}`;
    const prev = byKey.get(key);
    if (!prev || (o.sourceVerified && !prev.sourceVerified) || (o.description && !prev.description)) {
      if (prev) o.corroborated = true;
      byKey.set(key, o);
    } else {
      prev.corroborated = true;
    }
  }

  return { offers: assignStatus([...byKey.values()]), errors };
}
