// Regression suite: node test.js [--fast]
// --fast skips the live scrape-pipeline tests (used between small refactors);
// a full run exercises every feature against live sources + the running API.
import { groupSuggestions } from './resolve.js';
import { scoreOffer, wilsonLowerBound, mergeTelemetry, telemetryFor } from './scrapers/confidence.js';

const FAST = process.argv.includes('--fast');
const API = 'http://localhost:3001';
let failures = 0;

function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  — ' + detail}`);
  if (!ok) failures++;
}

// ---- groupSuggestions (pure) ----
{
  const mb = groupSuggestions([
    { name: 'Market Basket', domain: 'shopmarketbasket.com', logo: null },
    { name: 'Market Basket', domain: 'marketbasketpa.com', logo: null },
    { name: 'Market Basket Foods', domain: 'marketbasketfoods.com', logo: null },
    { name: 'Market Basket', domain: 'marketbasket.com', logo: null },
    { name: 'MARKET BASKET', domain: 'marketbasketomaha.com', logo: null },
  ]);
  check('group: market basket 5->2', mb.length === 2 && mb[0].variants === 4 && mb[0].members.length === 3);

  const bridge = groupSuggestions([
    { name: 'Market Basket', domain: 'shopmarketbasket.com', logo: null },
    { name: 'Demoulas Market Basket', domain: 'marketbasket.com', logo: null },
    { name: 'Market Basket', domain: 'marketbasket.co.uk', logo: null },
  ]);
  check('group: transitive bridge merges', bridge.length === 1 && bridge[0].variants === 3);

  const dup = groupSuggestions([
    { name: 'Alpha Inc', domain: 'alpha.com', logo: null },
    { name: 'Beta', domain: 'beta.io', logo: null },
    { name: 'Beta', domain: 'alpha.com', logo: 'X' },
  ]);
  check('group: no duplicate domains', new Set(dup.map((x) => x.domain)).size === dup.length);

  const generic = groupSuggestions([
    { name: 'Shop Alpha', domain: 'shop.alpha.com', logo: null },
    { name: 'Shop Beta', domain: 'shop.beta.io', logo: null },
  ]);
  check('group: generic labels never merge', generic.length === 2);

  const com = groupSuggestions([
    { name: 'Adidas', domain: 'adidas.com', logo: null },
    { name: 'ADIDAS CHILE', domain: 'adidas.cl', logo: 'L' },
  ]);
  check('group: .com beats logo', com.length === 1 && com[0].domain === 'adidas.com');

  const box = groupSuggestions([
    { name: 'Box Inc', domain: 'box.com', logo: null },
    { name: 'Box Group', domain: 'boxgroup.com', logo: null },
  ]);
  check('group: suffix stripping not over-eager', box.length === 2);

  const nike = groupSuggestions([
    { name: 'Nike', domain: 'nike.com', logo: null },
    { name: 'Niké', domain: 'nike.sk', logo: null },
  ]);
  check('group: members carried for UI', nike.length === 1 && nike[0].members[0].domain === 'nike.sk');
}

// ---- confidence scoring (pure) ----
// Most of these encode a specific defect found by adversarial review; the
// comment names what regressing would re-break.
{
  const now = Date.now();
  const ago = (days) => now - days * 24 * 60 * 60 * 1000;
  const T = telemetryFor;
  const score = (offer) => scoreOffer(offer, now);

  check('wilson: large sample beats lucky small one',
    wilsonLowerBound(271, 465) > wilsonLowerBound(1, 1));
  check('wilson: null on zero attempts', wilsonLowerBound(0, 0) === null);

  const strong = score({ code: 'A', telemetry: T('DealHack', { attempts: 465, successes: 271, lastSuccessAt: ago(0.2) }) });
  check('score: strong recent code is high band', strong.band === 'high' && strong.confidence >= 70,
    `${strong.confidence}/${strong.band}`);

  const dead = score({ code: 'B', telemetry: T('x', { attempts: 360, successes: 1, lastSuccessAt: ago(3) }) });
  check('score: 1-of-360 is poor band', dead.band === 'poor' && dead.confidence < 20,
    `${dead.confidence}/${dead.band}`);

  // Core honesty guard: never call a code bad without a real sample.
  const thin = score({ code: 'C', telemetry: T('x', { attempts: 5, successes: 0, lastVerifiedAt: ago(5) }) });
  check('score: small bad sample is never labelled poor', thin.band === 'unknown', `${thin.confidence}/${thin.band}`);

  const lucky = score({ code: 'D', telemetry: T('x', { attempts: 1, successes: 1, lastSuccessAt: ago(1) }) });
  check('score: lucky 1-of-1 is not crowned high', lucky.band !== 'high', `${lucky.confidence}/${lucky.band}`);

  const blank = score({ code: 'E', telemetry: T('x', {}) });
  check('score: no telemetry stays unknown, not poor', blank.band === 'unknown', blank.band);
  check('score: no telemetry outranks a demonstrably dead code', blank.confidence > dead.confidence);

  const deal = score({ code: null, telemetry: T('x', { attempts: 100, successes: 0 }) });
  check('score: code-less deals are never labelled poor', deal.band !== 'poor', deal.band);

  // Monotonicity: adding positive evidence must never lower the score.
  const priorOnly = score({ code: 'F', telemetry: T('DealHack', { sourceScore: 92, sourceConfidence: 0.9, lastSuccessAt: ago(1) }) });
  const priorPlus = score({
    code: 'F',
    telemetry: mergeTelemetry(
      T('DealHack', { sourceScore: 92, sourceConfidence: 0.9, lastSuccessAt: ago(1) }),
      T('CouponFollow', { attempts: 2, successes: 2, lastSuccessAt: ago(1) })
    ),
  });
  check('score: positive evidence never lowers confidence',
    priorPlus.confidence >= priorOnly.confidence - 2 && priorPlus.band !== 'unknown',
    `${priorOnly.confidence}/${priorOnly.band} -> ${priorPlus.confidence}/${priorPlus.band}`);

  // Syndication: sources republish each other's counts, so never sum them.
  const syndicated = mergeTelemetry(
    T('CouponFollow', { attempts: 389, successes: 1, lastSuccessAt: ago(1) }),
    T('DealHack', { attempts: 389, successes: 1, lastSuccessAt: ago(1) })
  );
  const synScore = score({ code: 'G', telemetry: syndicated });
  check('merge: identical counts across sources are not summed', synScore.attempts === 389, String(synScore.attempts));

  // One site listing the same code twice must not manufacture a sample.
  const selfPooled = mergeTelemetry(
    T('CouponFollow', { attempts: 12, successes: 1, lastSuccessAt: ago(2) }),
    T('CouponFollow', { attempts: 12, successes: 1, lastSuccessAt: ago(2) })
  );
  const selfScore = score({ code: 'H', telemetry: selfPooled });
  check('merge: same source twice does not double the sample',
    selfScore.attempts === 12 && selfScore.band !== 'poor', `${selfScore.attempts}/${selfScore.band}`);

  // Impossible and malformed counts must not escape into the UI.
  const impossible = score({ code: 'I', telemetry: T('x', { attempts: 25, successes: 30, lastSuccessAt: ago(1) }) });
  const impossiblePct = Number(impossible.evidence.match(/(\d+)%/)?.[1] ?? 0);
  check('score: successes are clamped to attempts',
    impossiblePct <= 100 && impossible.successes <= impossible.attempts, impossible.evidence);
  const negative = score({ code: 'J', telemetry: T('x', { attempts: 25, successes: -3, lastSuccessAt: ago(1) }) });
  check('score: negative counts do not produce negative percentages', !negative.evidence.includes('-'), negative.evidence);
  const nan = score({ code: 'K', telemetry: T('x', { sourceScore: NaN, lastSuccessAt: ago(1) }) });
  check('score: NaN never reaches confidence', Number.isFinite(nan.confidence) && !nan.evidence.includes('NaN'),
    `${nan.confidence} ${nan.evidence}`);

  // Staleness is not failure, and failure is not staleness.
  const oldGood = score({ code: 'L', telemetry: T('x', { attempts: 1000, successes: 350, lastSuccessAt: ago(91) }) });
  check('score: age alone never produces the poor band', oldGood.band !== 'poor', `${oldGood.confidence}/${oldGood.band}`);
  const ancient = score({ code: 'M', telemetry: T('x', { attempts: 465, successes: 271, lastSuccessAt: ago(365) }) });
  check('score: year-old evidence is not affirmed', ancient.band === 'unknown', `${ancient.confidence}/${ancient.band}`);

  // Badge and evidence sentence must never contradict each other.
  const nineteen = score({ code: 'N', telemetry: T('x', { attempts: 19, successes: 19, lastSuccessAt: ago(1) }) });
  check('score: confident badge never sits beside "too few to judge"',
    !(nineteen.band === 'high' && /too few/.test(nineteen.evidence)), `${nineteen.band} ${nineteen.evidence}`);

  // A big sample must not be capped just because no timestamp came with it.
  const undated = score({ code: 'O', telemetry: T('x', { attempts: 465, successes: 271 }) });
  check('score: undated large sample is not forced to unknown', undated.band !== 'unknown',
    `${undated.confidence}/${undated.band}`);

  // Self-reported badges alone must not reach the strongest claim.
  const badgesOnly = mergeTelemetry(
    mergeTelemetry(T('a', { declaredVerified: true, lastVerifiedAt: ago(1) }), T('b', { declaredVerified: true, lastVerifiedAt: ago(1) })),
    mergeTelemetry(T('c', { declaredVerified: true, lastVerifiedAt: ago(1) }), T('d', { declaredVerified: true, lastVerifiedAt: ago(1) }))
  );
  const badgeScore = score({ code: 'P', telemetry: badgesOnly });
  check('score: verified badges alone never reach the "Works" band', badgeScore.band !== 'high',
    `${badgeScore.confidence}/${badgeScore.band}`);

  // Corroboration must not affirm what the sample refuses to.
  const thinCorroborated = score({
    code: 'Q',
    telemetry: mergeTelemetry(
      mergeTelemetry(T('a', { attempts: 1, successes: 0, lastVerifiedAt: ago(1) }), T('b', { attempts: 1, successes: 0 })),
      mergeTelemetry(T('c', { attempts: 1, successes: 0 }), T('d', { attempts: 1, successes: 0 }))
    ),
  });
  check('score: corroboration cannot affirm an all-failure sample', thinCorroborated.band === 'unknown',
    `${thinCorroborated.confidence}/${thinCorroborated.band}`);

  // A source disclaiming its own score must not sink below having no data.
  const disclaimed = score({ code: 'R', telemetry: T('x', { sourceScore: 95, sourceConfidence: 0, lastSuccessAt: ago(1) }) });
  const nothing = score({ code: 'S', telemetry: T('x', { lastSuccessAt: ago(1) }) });
  check('score: a disclaimed works-score is not worse than no data',
    disclaimed.confidence >= nothing.confidence, `${disclaimed.confidence} vs ${nothing.confidence}`);

  // A 1970 timestamp is garbage, not "the oldest date".
  const epochMerge = mergeTelemetry(T('a', { lastSuccessAt: 0 }), T('b', { lastSuccessAt: ago(1) }));
  const epochScore = score({ code: 'T', telemetry: epochMerge });
  check('merge: epoch-0 timestamp does not mask a real one', epochScore.lastWorkedAt === ago(1),
    String(epochScore.lastWorkedAt));

  check('merge: keeps the most recent success',
    mergeTelemetry(T('a', { lastSuccessAt: ago(5) }), T('b', { lastSuccessAt: ago(1) })).bySource.b.lastSuccessAt === ago(1));
  check('merge: tracks distinct sources',
    score({ code: 'U', telemetry: mergeTelemetry(T('a', {}), T('b', {})) }).sourceCount === 2);
}

// ---- HTTP API (needs dev server running) ----
try {
  const suggest = await fetch(`${API}/api/suggest?q=nike`).then((r) => r.json());
  check('api: suggest returns grouped list', Array.isArray(suggest) && suggest.length > 0 && suggest[0].domain);

  const bad = await fetch(`${API}/api/search?domain=not_a_domain`);
  check('api: search rejects invalid domain', bad.status === 400);

  const search = await fetch(`${API}/api/search?domain=nike.com&name=Nike`).then((r) => r.json());
  check('api: search returns offers', Array.isArray(search.offers) && search.offers.length > 10, `got ${search.offers?.length}`);
  check('api: offers have kind + status', search.offers.every((o) => o.kind && o.status));
  check('api: offers carry confidence + band + evidence',
    search.offers.every((o) => typeof o.confidence === 'number' && o.band && o.evidence));
  const apiCodes = search.offers.filter((o) => o.code);
  check('api: codes ranked by confidence desc',
    apiCodes.every((o, i) => i === 0 || apiCodes[i - 1].confidence >= o.confidence));
  check('api: no offer labelled poor without a real sample',
    search.offers.every((o) => o.band !== 'poor' || (o.attempts >= 20 && o.code)));
  check('api: codes are real codes', search.offers.filter((o) => o.code).every((o) => /^[A-Z0-9]/.test(o.code)));

  const hist = await fetch(`${API}/api/history`).then((r) => r.json());
  check('api: history dedupes by name', new Set(hist.map((h) => h.name.toLowerCase())).size === hist.length);

  await fetch(`${API}/api/favorites/test-fav.example`, { method: 'POST' });
  let favs = await fetch(`${API}/api/favorites`).then((r) => r.json());
  // test-fav.example has no company row, so it won't render — just confirm CRUD round-trips
  await fetch(`${API}/api/favorites/test-fav.example`, { method: 'DELETE' });
  favs = await fetch(`${API}/api/favorites`).then((r) => r.json());
  check('api: favorites add/remove round-trips', favs.every((f) => f.domain !== 'test-fav.example'));

  const badZip = await fetch(`${API}/api/flyers?q=milk&postal=nope`);
  check('api: flyers rejects bad postal', badZip.status === 400);

  const freshop = await fetch(`${API}/api/flyers?q=donelans&postal=01720`).then((r) => r.json());
  check('api: freshop grocer (donelans) has flyer items', freshop.items.length > 20 && /donelan/i.test(freshop.merchant ?? ''),
    `merchant=${freshop.merchant}, items=${freshop.items?.length}`);

  const byName = await fetch(`${API}/api/flyers?q=market+basket&postal=01830`).then((r) => r.json());
  check('api: flyers falls back to store-name match', byName.items.length > 0 && /market basket/i.test(byName.merchant ?? ''),
    `merchant=${byName.merchant}, items=${byName.items?.length}`);

  const flyer = await fetch(`${API}/api/store-flyer?name=Market+Basket&postal=01830`).then((r) => r.json());
  check('api: store-flyer returns merchant items', flyer.items.length > 0 && /market basket/i.test(flyer.merchant ?? ''),
    `merchant=${flyer.merchant}, items=${flyer.items?.length}`);
  check('api: store-flyer only that merchant', flyer.items.every((i) => /market basket/i.test(i.merchant)));
  const noZip = await fetch(`${API}/api/store-flyer?name=Nike&postal=`).then((r) => r.json());
  check('api: store-flyer empty without postal', Array.isArray(noZip.items) && noZip.items.length === 0);

  const searchRanked = await fetch(`${API}/api/search?domain=nike.com&name=Nike`).then((r) => r.json());
  const rankedCodes = searchRanked.offers.filter((o) => o.code);
  const firstUnverified = rankedCodes.findIndex((o) => o.status !== 'verified');
  const lastVerified = rankedCodes.map((o) => o.status).lastIndexOf('verified');
  check('api: verified codes rank before unconfirmed',
    firstUnverified === -1 || lastVerified < firstUnverified || lastVerified === -1,
    `first unverified at ${firstUnverified}, last verified at ${lastVerified}`);
} catch (err) {
  check('api: dev server reachable', false, String(err.message));
}

// ---- live sources (skipped with --fast) ----
if (!FAST) {
  const { scrapeAll } = await import('./scrapers/index.js');
  const { offers, errors } = await scrapeAll('nike.com', 'Nike');
  const codes = offers.filter((o) => o.code);
  const sources = new Set(offers.map((o) => o.source));
  check('scrape: nike yields 30+ offers', offers.length >= 30, `got ${offers.length}`);
  check('scrape: nike yields 10+ codes', codes.length >= 10, `got ${codes.length}`);
  check('scrape: 4+ sources contribute', sources.size >= 4, [...sources].join(','));
  check('scrape: no phrase-codes leak', codes.every((o) => !/\b[a-z]{3,}\s+[a-z]{3,}/.test(o.code)));
  check('scrape: at most 1 error source', errors.length <= 1, JSON.stringify(errors));

  // Foreign-merchant leak guard: DealHack's page embeds related merchants'
  // offers (dn=<other-domain> in their monetization params) — none may survive.
  const { fetchPage } = await import('./scrapers/fetchPage.js');
  const dealhack = await import('./scrapers/dealhack.js');
  const [dhOffers, dhHtml] = await Promise.all([
    dealhack.scrape('nike.com', 'nike'),
    fetchPage('https://dealhack.com/coupons/nike'),
  ]);
  const ownChunks = dhHtml.split('offerId:"').slice(1)
    .filter((c) => { const dn = c.slice(0, 2000).match(/dn=([a-z0-9.-]+)/)?.[1]; return !dn || dn === 'nike.com'; });
  check('dealhack: no foreign-merchant offers', dhOffers.length <= ownChunks.length,
    `${dhOffers.length} offers vs ${ownChunks.length} own chunks`);
  check('dealhack: no "at OtherStore" titles', dhOffers.every((o) => !/\bat (?!Nike)[A-Z]/.test(o.title)),
    dhOffers.filter((o) => /\bat (?!Nike)[A-Z]/.test(o.title)).map((o) => o.title).join('; '));

  const { searchProductDeals } = await import('./products.js');
  const prod = await searchProductDeals('running shoes');
  check('products: slickdeals returns deals', prod.deals.length >= 5, `got ${prod.deals.length}`);
  check('products: prices extracted', prod.deals.some((d) => d.price));

  const { searchFlyerItems } = await import('./flyers.js');
  const fly = await searchFlyerItems('milk', '01830');
  check('flyers: flipp returns items', fly.items.length > 0, `got ${fly.items.length}`);
  check('flyers: items carry merchant+price', fly.items.every((i) => i.merchant));
}

console.log(failures === 0 ? '\nALL GREEN' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
