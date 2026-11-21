import { USER_AGENT } from './scrapers/fetchPage.js';

// Weekly flyer/circular items via Flipp's backend (backflipp.wishabi.com) —
// the data channel the Flipp app itself uses. Grocery chains (Market Basket
// included) publish their weekly deals here, keyed by postal code.
const cache = new Map(); // "postal|query" -> { at, items }
const TTL_MS = 30 * 60 * 1000;

export async function searchFlyerItems(query, postalCode) {
  const key = `${postalCode}|${query.toLowerCase().trim()}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return { items: hit.items, cached: true };

  const data = await fetchJson(
    `https://backflipp.wishabi.com/flipp/items/search?locale=en-us&postal_code=${encodeURIComponent(postalCode)}&q=${encodeURIComponent(query)}`
  );

  const items = (data.items ?? [])
    .filter((i) => i.name && i.merchant_name)
    .map((i) => ({
      name: i.name,
      merchant: i.merchant_name,
      merchantLogo: i.merchant_logo ?? null,
      price: i.current_price ?? null,
      originalPrice: i.original_price ?? null,
      prePriceText: i.pre_price_text ?? null,
      postPriceText: i.post_price_text ?? null,
      saleStory: i.sale_story ?? null,
      image: i.clean_image_url || i.clipping_image_url || null,
      validFrom: i.valid_from ?? null,
      validTo: i.valid_to ?? null,
    }));

  cache.set(key, { at: Date.now(), items });
  return { items, cached: false };
}

// Store-specific flyer, two steps: a merchant-name search returns that
// store's flyer tiles (name:null — not usable as cards, but they carry
// flyer_id), then /flipp/flyers/<id> returns the flyer's full named item
// list. Powers the flyer section on store coupon results.
export async function merchantFlyerItems(companyName, postalCode, limit = Infinity) {
  const key = normalize(companyName);
  const cacheKey = `store|${postalCode}|${key}`;
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.at < TTL_MS) {
    return { ...hit.value, items: hit.value.items.slice(0, limit), cached: true };
  }

  const search = await fetchJson(
    `https://backflipp.wishabi.com/flipp/items/search?locale=en-us&postal_code=${encodeURIComponent(postalCode)}&q=${encodeURIComponent(companyName)}`
  );
  const tile = (search.items ?? []).find((i) => {
    const m = normalize(i.merchant_name);
    return m && (m.includes(key) || key.includes(m)) && i.flyer_id;
  });

  let value = { items: [], merchant: null, total: 0 };
  if (!tile) {
    // Flipp doesn't carry every local chain; some run on Freshop (Instacart's
    // grocery platform) with a public JSON API. Registry of known ones:
    const grocer = FRESHOP_GROCERS.find((g) => key.includes(g.match) || g.match.includes(key));
    if (grocer) value = await freshopFlyer(grocer.appKey);
  }
  if (tile) {
    const flyer = await fetchJson(`https://backflipp.wishabi.com/flipp/flyers/${tile.flyer_id}?locale=en-us`);
    const items = (flyer.items ?? [])
      .filter((i) => i.name)
      .sort((a, b) => (b.current_price ?? b.price ? 1 : 0) - (a.current_price ?? a.price ? 1 : 0))
      .map((i) => ({
        name: i.name,
        merchant: tile.merchant_name,
        merchantLogo: tile.merchant_logo ?? null,
        price: i.current_price ?? i.price ?? null,
        originalPrice: i.original_price ?? null,
        prePriceText: i.pre_price_text ?? null,
        postPriceText: i.post_price_text ?? null,
        saleStory: i.sale_story ?? null,
        image: i.clean_image_url || i.clipping_image_url || i.cutout_image_url || null,
        validFrom: i.valid_from ?? null,
        validTo: i.valid_to ?? null,
      }));
    value = { items, merchant: tile.merchant_name, total: items.length };
  }
  cache.set(cacheKey, { at: Date.now(), value });
  return { ...value, items: value.items.slice(0, limit), cached: false };
}

// Local chains that self-host their weekly ad on Freshop (api.freshop.com,
// public, same calls their own site makes). Add entries as discovered.
const FRESHOP_GROCERS = [
  { match: 'donelans', appKey: 'donelans' }, // Donelan's Supermarkets (Acton MA area)
];

async function freshopFlyer(appKey) {
  const stores = await fetchJson(`https://api.freshop.com/1/stores?app_key=${appKey}`);
  // Prefer the chain-level store ("Donelan's Supermarkets") over a branch
  // ("Donelan's of Wayland"), but not every store carries the circular —
  // walk candidates until one does.
  const candidates = (stores.items ?? [])
    .filter((s) => s.name && !/global/i.test(s.name))
    .sort((a, b) => /\bof\b/i.test(a.name) - /\bof\b/i.test(b.name));
  let store = null;
  let circular = null;
  for (const candidate of candidates.slice(0, 4)) {
    const circulars = await fetchJson(`https://api.freshop.com/1/circulars?app_key=${appKey}&store_id=${candidate.id}`);
    if (circulars.items?.[0]) { store = candidate; circular = circulars.items[0]; break; }
  }
  if (!store) return { items: [], merchant: candidates[0]?.name ?? null, total: 0 };
  const products = await fetchJson(
    `https://api.freshop.com/1/products?app_key=${appKey}&circular_id=${circular.id}&store_id=${store.id}&limit=600`
  );
  const items = (products.items ?? [])
    .filter((p) => p.name)
    .map((p) => ({
      name: p.name,
      merchant: store.name,
      merchantLogo: null,
      price: p.offer_sale_price ?? p.unit_price ?? null,
      originalPrice: p.offer_sale_price != null && p.unit_price != null ? p.unit_price : null,
      prePriceText: null,
      postPriceText: p.size ?? null,
      saleStory: null,
      image: p.cover_image ? `https://images.freshop.ncrcloud.com/${p.cover_image}_large.png` : null,
      validFrom: circular.start_date ?? null,
      validTo: p.sale_finish_date ?? circular.finish_date ?? null,
    }));
  return { items, merchant: store.name, total: items.length };
}

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) throw new Error(`flipp HTTP ${res.status}`);
  return res.json();
}

const normalize = (s) => (s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
