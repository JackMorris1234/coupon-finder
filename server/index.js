import express from 'express';
import { suggestCompanies } from './resolve.js';
import { scrapeAll } from './scrapers/index.js';
import { searchProductDeals } from './products.js';
import { searchFlyerItems, merchantFlyerItems } from './flyers.js';
import {
  upsertCompany, getCompany, markFetched, upsertOffers, getOffers, pruneStaleOffers,
  recordSearch, getHistory, getFavorites, addFavorite, removeFavorite,
} from './db.js';

const app = express();
app.use(express.json());

const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

app.get('/api/suggest', async (req, res) => {
  const q = String(req.query.q ?? '').trim();
  if (q.length < 2) return res.json([]);
  res.json(await suggestCompanies(q));
});

app.get('/api/search', async (req, res) => {
  const domain = String(req.query.domain ?? '').trim().toLowerCase();
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) {
    return res.status(400).json({ error: 'invalid domain' });
  }
  const name = String(req.query.name ?? '').trim() || domain;
  const logo = String(req.query.logo ?? '').trim() || null;
  const refresh = req.query.refresh === '1';

  upsertCompany({ domain, name, logoUrl: logo });
  recordSearch(domain);

  const company = getCompany(domain);
  const fresh = company.last_fetched_at && Date.now() - company.last_fetched_at < CACHE_TTL_MS;

  let sourceErrors = [];
  let cached = true;
  if (!fresh || refresh) {
    cached = false;
    try {
      const scrapeStart = Date.now();
      const { offers, errors } = await scrapeAll(domain, name);
      sourceErrors = errors;
      upsertOffers(domain, offers);
      if (offers.length > 0) pruneStaleOffers(domain, scrapeStart);
      markFetched(domain);
    } catch (err) {
      return res.status(502).json({ error: `scrape failed: ${err.message}` });
    }
  }

  res.json({
    company: { domain, name: company.name, logoUrl: company.logo_url },
    offers: rankOffers(getOffers(domain)),
    cached,
    fetchedAt: getCompany(domain).last_fetched_at,
    sourceErrors,
  });
});

// Within each group (codes / deals / hidden) rank verified first, then by
// discount size, then freshness — so the best usable code leads the page.
function rankOffers(offers) {
  const groupOf = (o) => (o.code ? 0 : o.kind === 'hidden' ? 2 : 1);
  const value = (o) => Number(o.discountText?.match(/\d+(\.\d+)?/)?.[0] ?? 0);
  return offers.slice().sort((a, b) =>
    groupOf(a) - groupOf(b) ||
    (b.status === 'verified') - (a.status === 'verified') ||
    value(b) - value(a) ||
    b.lastSeenAt - a.lastSeenAt
  );
}

app.get('/api/store-flyer', async (req, res) => {
  const name = String(req.query.name ?? '').trim();
  const postal = String(req.query.postal ?? '').trim().toUpperCase().replace(/\s/g, '');
  if (name.length < 2 || !/^(\d{5}|[A-Z]\d[A-Z]\d[A-Z]\d)$/.test(postal)) {
    return res.json({ items: [], merchant: null });
  }
  try {
    res.json(await merchantFlyerItems(name, postal, 24)); // compact section; full list lives in the flyers tab
  } catch {
    res.json({ items: [], merchant: null }); // flyer section is best-effort
  }
});

app.get('/api/products', async (req, res) => {
  const q = String(req.query.q ?? '').trim();
  if (q.length < 2) return res.json({ deals: [], cached: false });
  try {
    res.json(await searchProductDeals(q));
  } catch (err) {
    res.status(502).json({ error: `product search failed: ${err.message}` });
  }
});

app.get('/api/flyers', async (req, res) => {
  const q = String(req.query.q ?? '').trim();
  const postal = String(req.query.postal ?? '').trim().toUpperCase();
  if (q.length < 2) return res.json({ items: [], cached: false });
  if (!/^(\d{5}|[A-Z]\d[A-Z]\s?\d[A-Z]\d)$/.test(postal)) {
    return res.status(400).json({ error: 'enter a valid US ZIP or Canadian postal code' });
  }
  try {
    const zip = postal.replace(/\s/g, '');
    const result = await searchFlyerItems(q, zip);
    // A store name as the query matches no product items — fall back to that
    // merchant's own flyer ("market basket" -> Market Basket's circular).
    if (result.items.length === 0) {
      const store = await merchantFlyerItems(q, zip);
      if (store.items.length > 0) return res.json(store);
    }
    res.json(result);
  } catch (err) {
    res.status(502).json({ error: `flyer search failed: ${err.message}` });
  }
});

app.get('/api/history', (_req, res) => res.json(getHistory()));
app.get('/api/favorites', (_req, res) => res.json(getFavorites()));
app.post('/api/favorites/:domain', (req, res) => {
  addFavorite(String(req.params.domain).toLowerCase());
  res.json(getFavorites());
});
app.delete('/api/favorites/:domain', (req, res) => {
  removeFavorite(String(req.params.domain).toLowerCase());
  res.json(getFavorites());
});

// Loopback only: LAN devices use the app through Vite's /api proxy, so the
// API itself never needs network exposure.
const PORT = process.env.API_PORT || 3001;
app.listen(PORT, '127.0.0.1', () => console.log(`coupon-finder API listening on http://localhost:${PORT}`));
