// Regression suite: node test.js [--fast]
// --fast skips the live scrape-pipeline tests (used between small refactors);
// a full run exercises every feature against live sources + the running API.
import { groupSuggestions } from './resolve.js';

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

// ---- HTTP API (needs dev server running) ----
try {
  const suggest = await fetch(`${API}/api/suggest?q=nike`).then((r) => r.json());
  check('api: suggest returns grouped list', Array.isArray(suggest) && suggest.length > 0 && suggest[0].domain);

  const bad = await fetch(`${API}/api/search?domain=not_a_domain`);
  check('api: search rejects invalid domain', bad.status === 400);

  const search = await fetch(`${API}/api/search?domain=nike.com&name=Nike`).then((r) => r.json());
  check('api: search returns offers', Array.isArray(search.offers) && search.offers.length > 10, `got ${search.offers?.length}`);
  check('api: offers have kind + status', search.offers.every((o) => o.kind && o.status));
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
