// Confidence scoring from the sources' own redemption telemetry.
//
// The coupon sites watch what happens when real shoppers redeem a code —
// attempt/success counts, "last worked" timestamps, their own works-scores.
// Pooling that across every source reporting a given code gives a far better
// answer than the binary verified/unconfirmed flag it replaces, which ignored
// all of it (it called a code "Verified" that had succeeded 4 times in 49).
//
// Honesty notes baked into the model:
//  - The counts are self-reported by sites with an incentive to look useful,
//    so treat them as relative signal, not ground truth.
//  - Absence of data is NOT evidence of failure: an offer is only ever called
//    "rarely works" when there is a real sample behind the doubt.

const Z = 1.96;               // 95% Wilson interval
const STRONG_RATE = 0.5;      // a code working for half of real attempts is as good as coupons get
const MIN_SAMPLE_FOR_DOUBT = 20; // below this we never call a code bad
const NO_EVIDENCE_BASE = 0.3;    // the "we simply don't know" baseline
const DAY = 24 * 60 * 60 * 1000;

// Wilson score lower bound — the standard way to rank by success rate without
// letting 1-of-1 (100%) outrank 271-of-465 (58%).
export function wilsonLowerBound(successes, attempts) {
  if (!attempts || attempts <= 0) return null;
  const p = Math.min(1, Math.max(0, successes / attempts));
  const z2 = Z * Z;
  const denominator = 1 + z2 / attempts;
  const center = p + z2 / (2 * attempts);
  const margin = Z * Math.sqrt((p * (1 - p) + z2 / (4 * attempts)) / attempts);
  return Math.max(0, (center - margin) / denominator);
}

export const emptyTelemetry = () => ({
  attempts: 0,            // redemption/verification attempts observed by a source
  successes: 0,           // of those, how many worked
  uses: 0,                // usage count with no success breakdown (weaker signal)
  lastSuccessAt: null,    // when it last demonstrably worked (ms)
  lastVerifiedAt: null,   // when a source last declared it verified (ms)
  sourceScore: null,      // a source's own 0-100 works-score, if published
  sourceConfidence: null, // 0-1 confidence in that score
  declaredVerified: false,
  sources: [],
});

// Pool evidence from every source reporting the same code. Different sites
// count slightly different things (verification attempts vs shopper uses), so
// this is approximate — but discarding it entirely was worse.
export function mergeTelemetry(a, b) {
  if (!a) return b ? { ...emptyTelemetry(), ...b } : emptyTelemetry();
  if (!b) return a;
  const maxTs = (x, y) => (x && y ? Math.max(x, y) : x ?? y ?? null);
  const pickScore = () => {
    // keep the score backed by the higher confidence
    const ac = a.sourceConfidence ?? 0;
    const bc = b.sourceConfidence ?? 0;
    if (a.sourceScore == null) return { sourceScore: b.sourceScore, sourceConfidence: b.sourceConfidence };
    if (b.sourceScore == null) return { sourceScore: a.sourceScore, sourceConfidence: a.sourceConfidence };
    return bc > ac
      ? { sourceScore: b.sourceScore, sourceConfidence: b.sourceConfidence }
      : { sourceScore: a.sourceScore, sourceConfidence: a.sourceConfidence };
  };
  return {
    attempts: (a.attempts ?? 0) + (b.attempts ?? 0),
    successes: (a.successes ?? 0) + (b.successes ?? 0),
    uses: (a.uses ?? 0) + (b.uses ?? 0),
    lastSuccessAt: maxTs(a.lastSuccessAt, b.lastSuccessAt),
    lastVerifiedAt: maxTs(a.lastVerifiedAt, b.lastVerifiedAt),
    ...pickScore(),
    declaredVerified: Boolean(a.declaredVerified || b.declaredVerified),
    sources: [...new Set([...(a.sources ?? []), ...(b.sources ?? [])])],
  };
}

function recencyFactor(ts, nowMs) {
  if (!ts) return 0.35;            // unknown age — neither trusted nor condemned
  const days = (nowMs - ts) / DAY;
  if (days <= 2) return 1;
  if (days <= 7) return 0.95;
  if (days <= 30) return 0.8;
  if (days <= 60) return 0.6;
  if (days <= 90) return 0.45;
  return 0.3;
}

// -> { confidence 0-99, band, evidence, lastWorkedAt, sourceCount }
export function scoreOffer(offer, nowMs = Date.now()) {
  const t = { ...emptyTelemetry(), ...(offer.telemetry ?? {}) };
  const lastGood = Math.max(t.lastSuccessAt ?? 0, t.lastVerifiedAt ?? 0) || null;
  const recency = recencyFactor(lastGood, nowMs);
  const sourceCount = Math.max(t.sources?.length ?? 0, 1);
  const corroboration = Math.min(18, (sourceCount - 1) * 6);

  let base;
  let evidence;
  if (t.attempts >= 1) {
    let estimate = Math.min(1, wilsonLowerBound(t.successes, t.attempts) / STRONG_RATE);
    // Small samples regress toward the no-evidence baseline: a handful of
    // failures must not condemn a code, and a lucky 1-of-1 must not crown it.
    if (t.attempts < MIN_SAMPLE_FOR_DOUBT) {
      const weight = t.attempts / MIN_SAMPLE_FOR_DOUBT;
      estimate = estimate * weight + NO_EVIDENCE_BASE * (1 - weight);
    }
    base = estimate;
    if (t.attempts < MIN_SAMPLE_FOR_DOUBT) {
      // Don't let a damning-sounding ratio stand in for a verdict we are
      // explicitly declining to reach on this little evidence.
      evidence = `only ${t.attempts} redemption${t.attempts === 1 ? '' : 's'} recorded — too few to judge`;
    } else {
      const pct = Math.round((t.successes / t.attempts) * 100);
      evidence = `worked for ${pct}% of ${t.attempts} redemptions`;
    }
  } else if (t.sourceScore != null) {
    const conf = t.sourceConfidence == null ? 0.6 : Math.min(1, Math.max(0, t.sourceConfidence));
    base = (t.sourceScore / 100) * conf;
    evidence = `source works-score ${Math.round(t.sourceScore)}/100`;
  } else if (t.declaredVerified) {
    base = 0.55;
    evidence = 'listed as verified by the source';
  } else if (t.uses > 0) {
    base = 0.35;
    evidence = `used ${t.uses} times (no success breakdown)`;
  } else {
    base = NO_EVIDENCE_BASE;
    evidence = 'no redemption data';
  }

  const confidence = Math.max(0, Math.min(99, Math.round(base * 100 * recency + corroboration)));

  // A real sample is required before we are willing to call a code bad.
  const hasSample = t.attempts >= MIN_SAMPLE_FOR_DOUBT;
  let band;
  if (confidence >= 70) band = 'high';
  else if (confidence >= 45) band = 'likely';
  else if (confidence < 20 && hasSample && offer.code) band = 'poor';
  else band = 'unknown';

  return { confidence, band, evidence, lastWorkedAt: lastGood, sourceCount };
}

// Back-compat: the rest of the app still speaks verified/unconfirmed.
export const statusFromBand = (band) => (band === 'high' || band === 'likely' ? 'verified' : 'unconfirmed');
