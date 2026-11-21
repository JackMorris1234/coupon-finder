import { useState } from 'react';
import CopyCode from './CopyCode.jsx';
import useSearch from './useSearch.js';
import { timeAgo } from './util.js';

export default function ProductSearch() {
  const [query, setQuery] = useState('');
  const { result, loading, error, run } = useSearch();

  const search = () => {
    const q = query.trim();
    if (q.length >= 2) run(`/api/products?q=${encodeURIComponent(q)}`);
  };

  return (
    <div>
      <div className="searchbar">
        <input
          type="text"
          placeholder="Product, e.g. running shoes, air fryer, SSD…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && search()}
          autoFocus
        />
      </div>

      {loading && <div className="notice">Searching product deals…</div>}
      {error && <div className="notice error">Something went wrong: {error}</div>}

      {result && !loading && (
        <section className="results">
          <h3 className="group-title">
            Deals ({result.deals.length}){result.cached ? ' · cached' : ''}
          </h3>
          <div className="deal-list">
            {result.deals.map((d) => <DealRow key={d.link} deal={d} />)}
          </div>
          {result.deals.length === 0 && (
            <div className="notice">No current deals found for this product.</div>
          )}
        </section>
      )}
      {!result && !loading && !error && (
        <div className="empty">Search a product to find current deals and their codes across stores.</div>
      )}
    </div>
  );
}

function DealRow({ deal }) {
  return (
    <article className="card deal-card">
      <h4>
        <a href={deal.link} target="_blank" rel="noreferrer">{deal.title}</a>
      </h4>
      {deal.description && <p className="desc">{deal.description}</p>}
      <div className="card-bottom">
        <div className="deal-chips">
          {deal.price && <span className="discount">{deal.price}</span>}
          {deal.code && <CopyCode code={deal.code} />}
        </div>
        <span className="freshness">
          {deal.publishedAt ? `posted ${timeAgo(deal.publishedAt)}` : ''} · {deal.source}
        </span>
      </div>
    </article>
  );
}
