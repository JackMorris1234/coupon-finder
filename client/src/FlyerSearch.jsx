import { useState } from 'react';
import useSearch from './useSearch.js';

function savedPostal() {
  try { return localStorage.getItem('postalCode') ?? ''; } catch { return ''; }
}

export default function FlyerSearch() {
  const [postal, setPostal] = useState(savedPostal);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('');
  const { result, loading, error, run } = useSearch();

  const search = () => {
    const q = query.trim();
    if (q.length < 2 || !postal.trim()) return;
    try { localStorage.setItem('postalCode', postal.trim()); } catch { /* ignore */ }
    setFilter('');
    run(`/api/flyers?${new URLSearchParams({ q, postal: postal.trim() })}`);
  };

  const shown = result
    ? result.items.filter((it) => !filter || it.name.toLowerCase().includes(filter.toLowerCase()))
    : [];

  return (
    <div>
      <div className="flyer-inputs">
        <input
          className="postal"
          type="text"
          placeholder="ZIP code"
          value={postal}
          onChange={(e) => setPostal(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && search()}
        />
        <div className="searchbar grow">
          <input
            type="text"
            placeholder="Grocery item or product, e.g. chicken, laundry detergent…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && search()}
          />
        </div>
      </div>

      {loading && <div className="notice">Searching weekly flyers near {postal}…</div>}
      {error && <div className="notice error">Something went wrong: {error}</div>}

      {result && !loading && (
        <section className="results">
          <h3 className="group-title">
            {result.merchant
              ? `This week's flyer — ${result.merchant} (${shown.length}${filter ? ` of ${result.items.length}` : ''})`
              : `Weekly flyer deals (${shown.length}${filter ? ` of ${result.items.length}` : ''})`}
            {result.cached ? ' · cached' : ''}
          </h3>
          {result.items.length > 12 && (
            <div className="searchbar flyer-filter">
              <input
                type="text"
                placeholder="Filter these items… e.g. turkey, pie"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              />
            </div>
          )}
          <div className="cards">
            {shown.map((it, i) => <FlyerCard key={i} item={it} />)}
          </div>
          {result.items.length === 0 && (
            <div className="notice">No flyer items match near that ZIP this week.</div>
          )}
          {result.items.length > 0 && shown.length === 0 && (
            <div className="notice">Nothing in this flyer matches "{filter}".</div>
          )}
        </section>
      )}
      {!result && !loading && !error && (
        <div className="empty">
          Enter your ZIP and a product — this searches the current weekly ads of grocery and
          retail chains near you (the deals stores like Market Basket actually publish).
        </div>
      )}
    </div>
  );
}

export function FlyerCard({ item }) {
  const validTo = item.validTo ? new Date(item.validTo) : null;
  const amount = item.price != null && Number.isFinite(Number(item.price))
    ? `$${Number(item.price).toFixed(2).replace(/\.00$/, '')}`
    : null;
  const price = amount
    ? `${item.prePriceText ? item.prePriceText + ' ' : ''}${amount}${item.postPriceText ? ' ' + item.postPriceText : ''}`
    : item.saleStory;

  return (
    <article className="card flyer-card">
      {item.image && <img className="flyer-img" src={item.image} alt="" loading="lazy" />}
      <h4>{item.name}</h4>
      {amount && item.saleStory && <p className="desc">{item.saleStory}</p>}
      <div className="card-bottom">
        <div className="deal-chips">
          {price && <span className="discount">{price}</span>}
          {item.originalPrice != null && <span className="was">was ${item.originalPrice}</span>}
        </div>
        <span className="freshness">
          {item.merchant}{validTo ? ` · thru ${validTo.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}` : ''}
        </span>
      </div>
    </article>
  );
}
