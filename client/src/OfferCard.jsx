import CopyCode from './CopyCode.jsx';
import { timeAgo } from './util.js';

// Confidence bands come from the server (scrapers/confidence.js), scored from
// the coupon sites' own redemption telemetry rather than a yes/no flag.
const BANDS = {
  high: { label: '✓ Works', className: 'badge-high' },
  likely: { label: '✓ Likely works', className: 'badge-likely' },
  unknown: { label: '? Unconfirmed', className: 'badge-unknown' },
  poor: { label: '⚠ Rarely works', className: 'badge-poor' },
};

const EVIDENCE_HINT =
  "Pooled from the coupon sites' own redemption telemetry (how many shoppers tried the code and how many succeeded). Self-reported by those sites, so treat it as relative signal rather than a guarantee.";

export default function OfferCard({ offer, bestPick = false }) {
  const band = BANDS[offer.band] ?? (offer.status === 'verified' ? BANDS.likely : BANDS.unknown);
  // Only claim it "worked" when a source actually recorded a success; a bare
  // activity timestamp means someone used it, not that it applied.
  const workedLabel = offer.successes > 0 ? 'last worked' : 'last seen';
  const detail = [
    offer.evidence,
    offer.lastWorkedAt ? `${workedLabel} ${timeAgo(offer.lastWorkedAt)}` : null,
    offer.sourceCount > 1 ? `${offer.sourceCount} sources agree` : null,
  ].filter(Boolean).join(' · ');

  return (
    <article className={`card ${offer.band === 'high' || offer.band === 'likely' ? 'verified' : ''} ${offer.band === 'poor' ? 'poor' : ''}`}>
      <div className="card-top">
        {bestPick && <span className="best-pick" title="Highest-confidence code for this store">★ Best pick</span>}
        {offer.discountText && <span className="discount">{offer.discountText}</span>}
        <span
          className={`badge ${band.className}`}
          title={offer.confidence != null ? `Confidence ${offer.confidence}/100 — ${EVIDENCE_HINT}` : EVIDENCE_HINT}
        >
          {band.label}
        </span>
      </div>
      <h4>{offer.title}</h4>
      {offer.description && <p className="desc">{offer.description}</p>}
      {detail && <p className="evidence" title={EVIDENCE_HINT}>{detail}</p>}
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
