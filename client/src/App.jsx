import { useCallback, useEffect, useState } from 'react';
import SearchBar from './SearchBar.jsx';
import OfferCard from './OfferCard.jsx';
import Sidebar from './Sidebar.jsx';
import ProductSearch from './ProductSearch.jsx';
import FlyerSearch, { FlyerCard } from './FlyerSearch.jsx';
import useSearch from './useSearch.js';
import { timeAgo } from './util.js';

export default function App() {
  const [mode, setMode] = useState('stores'); // 'stores' | 'products' | 'flyers'
  const [company, setCompany] = useState(null);
  const [history, setHistory] = useState([]);
  const [favorites, setFavorites] = useState([]);
  const [storeFlyer, setStoreFlyer] = useState(null);
  const { result, loading, error, run } = useSearch();

  // Best-effort weekly-flyer section for the searched store (grocers etc.),
  // using the ZIP saved on the Weekly flyers tab.
  useEffect(() => {
    setStoreFlyer(null);
    const name = result?.company?.name;
    if (!name) return;
    let postal = '';
    try { postal = localStorage.getItem('postalCode') ?? ''; } catch { /* ignore */ }
    if (!postal) { setStoreFlyer({ needZip: true, items: [] }); return; }
    let stale = false;
    fetch(`/api/store-flyer?${new URLSearchParams({ name, postal })}`)
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((data) => { if (!stale) setStoreFlyer(data); })
      .catch(() => {});
    return () => { stale = true; };
  }, [result?.company?.name]);

  const loadSidebar = useCallback(async () => {
    try {
      const [h, f] = await Promise.all([
        fetch('/api/history'),
        fetch('/api/favorites'),
      ]);
      if (h.ok) setHistory(await h.json());
      if (f.ok) setFavorites(await f.json());
    } catch { /* keep current sidebar on transient failures */ }
  }, []);

  useEffect(() => { loadSidebar(); }, [loadSidebar]);

  const search = async (c, { refresh = false } = {}) => {
    setMode('stores'); // sidebar picks from any tab land on the results view
    setCompany(c);
    const params = new URLSearchParams({ domain: c.domain, name: c.name ?? c.domain });
    if (c.logo) params.set('logo', c.logo);
    if (refresh) params.set('refresh', '1');
    await run(`/api/search?${params}`);
    loadSidebar();
  };

  const toggleFavorite = async (domain) => {
    const isFav = favorites.some((f) => f.domain === domain);
    const res = await fetch(`/api/favorites/${domain}`, { method: isFav ? 'DELETE' : 'POST' });
    setFavorites(await res.json());
  };

  const codes = result?.offers.filter((o) => o.code) ?? [];
  // Offers arrive ranked by confidence; only crown a code we actually trust.
  const bestPickId = codes.find((o) => o.band === 'high' || o.band === 'likely')?.id ?? null;
  const deals = result?.offers.filter((o) => !o.code && o.kind !== 'hidden') ?? [];
  const hidden = result?.offers.filter((o) => !o.code && o.kind === 'hidden') ?? [];
  const isFav = company && favorites.some((f) => f.domain === company.domain);

  return (
    <div className="layout">
      <Sidebar
        history={history}
        favorites={favorites}
        onSelect={(c) => search(c)}
        activeDomain={company?.domain}
      />
      <main>
        <header className="hero">
          <h1>Coupon Finder</h1>
          <p className="tagline">Search a company, get its active discount codes.</p>
          <div className="mode-tabs">
            <button className={mode === 'stores' ? 'active' : ''} onClick={() => setMode('stores')}>
              Store coupons
            </button>
            <button className={mode === 'products' ? 'active' : ''} onClick={() => setMode('products')}>
              Product deals
            </button>
            <button className={mode === 'flyers' ? 'active' : ''} onClick={() => setMode('flyers')}>
              Weekly flyers
            </button>
          </div>
          {mode === 'stores' && <SearchBar onSelect={(c) => search(c)} />}
        </header>

        {mode === 'products' && <ProductSearch />}
        {mode === 'flyers' && <FlyerSearch />}
        {mode === 'stores' && <>
        {loading && <div className="notice">Checking coupon sources…</div>}
        {error && <div className="notice error">Something went wrong: {error}</div>}

        {result && !loading && (
          <section className="results">
            <div className="results-header">
              <div className="company">
                {result.company.logoUrl && <img src={result.company.logoUrl} alt="" />}
                <h2>{result.company.name}</h2>
                <span className="domain">{result.company.domain}</span>
                <button
                  className={`star ${isFav ? 'active' : ''}`}
                  title={isFav ? 'Remove from favorites' : 'Add to favorites'}
                  onClick={() => toggleFavorite(result.company.domain)}
                >
                  {isFav ? '★' : '☆'}
                </button>
              </div>
              <div className="meta">
                <span>
                  {result.cached
                    ? `cached · fetched ${timeAgo(result.fetchedAt)}`
                    : 'freshly scraped'}
                </span>
                <button className="refresh" onClick={() => search(company, { refresh: true })}>
                  ⟳ Refresh &amp; re-check
                </button>
              </div>
            </div>

            {result.sourceErrors?.length > 0 && (
              <div className="notice warn">
                {result.sourceErrors.map((e) => e.source).join(', ')} couldn’t be reached — showing
                results from the remaining sources.
              </div>
            )}

            {codes.length > 0 && (
              <>
                <h3 className="group-title">Coupon codes ({codes.length})</h3>
                <div className="cards">
                  {codes.map((o) => <OfferCard key={o.id} offer={o} bestPick={o.id === bestPickId} />)}
                </div>
              </>
            )}
            {deals.length > 0 && (
              <>
                <h3 className="group-title">Deals — no code needed ({deals.length})</h3>
                <div className="cards">{deals.map((o) => <OfferCard key={o.id} offer={o} />)}</div>
              </>
            )}
            {hidden.length > 0 && (
              <details className="hidden-offers">
                <summary>Click-to-reveal codes on other sites ({hidden.length}) — only if the codes above don't cut it</summary>
                <div className="cards">{hidden.map((o) => <OfferCard key={o.id} offer={o} />)}</div>
              </details>
            )}
            {storeFlyer?.items?.length > 0 && (
              <>
                <h3 className="group-title">
                  This week's flyer — {storeFlyer.merchant} ({storeFlyer.items.length}
                  {storeFlyer.total > storeFlyer.items.length ? ` of ${storeFlyer.total} — full flyer on the Weekly flyers tab` : ''})
                </h3>
                <div className="cards">
                  {storeFlyer.items.map((it, i) => <FlyerCard key={i} item={it} />)}
                </div>
              </>
            )}
            {result.offers.length === 0 && !(storeFlyer?.items?.length > 0) && (
              <div className="notice">
                No active offers found. The coupon sources don't list this company — some
                businesses (e.g. discount grocers like Market Basket) don't issue promo codes
                and run weekly-flyer deals instead.
                {storeFlyer?.needZip && ' Save your ZIP on the Weekly flyers tab and this store\'s circular will show here.'}
              </div>
            )}
            {storeFlyer?.needZip && result.offers.length > 0 && (
              <p className="hint-line">
                Tip: save your ZIP on the Weekly flyers tab and this store's weekly circular will appear here too.
              </p>
            )}
          </section>
        )}

        {!result && !loading && !error && (
          <div className="empty">Try searching for Nike, Adidas, DoorDash…</div>
        )}
        </>}
      </main>
    </div>
  );
}
