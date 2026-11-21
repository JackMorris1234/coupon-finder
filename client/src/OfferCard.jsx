import CopyCode from './CopyCode.jsx';
import { timeAgo } from './util.js';

export default function OfferCard({ offer, bestPick = false }) {
  const verified = offer.status === 'verified';

  return (
    <article className={`card ${verified ? 'verified' : ''}`}>
      <div className="card-top">
        {bestPick && <span className="best-pick" title="Highest-value verified code">★ Best pick</span>}
        {offer.discountText && <span className="discount">{offer.discountText}</span>}
        <span
          className={`badge ${verified ? 'badge-verified' : 'badge-unconfirmed'}`}
          title={verified
            ? `Verified ${offer.verifiedAt ? timeAgo(offer.verifiedAt) : ''} via source validation or multiple sources`
            : 'Could not be auto-checked (site security blocks automated validation) — may still work'}
        >
          {verified ? '✓ Verified' : '? Unconfirmed'}
        </span>
      </div>
      <h4>{offer.title}</h4>
      {offer.description && <p className="desc">{offer.description}</p>}
      <div className="card-bottom">
        {offer.code ? (
          <CopyCode code={offer.code} />
        ) : (
          <a className="reveal" href={offer.sourceUrl} target="_blank" rel="noreferrer">
            View on {offer.source} ↗
          </a>
        )}
        <span className="freshness" title={`Source: ${offer.source}`}>
          seen {timeAgo(offer.lastSeenAt)} · {offer.source}
        </span>
      </div>
    </article>
  );
}
