// Confidence scoring from the sources' own redemption telemetry.
//
// The coupon sites watch what happens when real shoppers redeem a code —
// attempt/success counts, "last worked" timestamps, their own works-scores.
// Scoring that beats the binary verified/unconfirmed flag it replaces, which
// called a code "Verified" that had succeeded 4 times in 49.
//
// Hard-won design rules (each one is a bug this module already had):
//  1. NEVER sum counts across sources. Measured 2026-11-21: CouponFollow and
//     DealHack republish identical numbers for the same codes (APP15 = 389
//     attempts / 1 success on both), so summing doubles a single dataset and
//     invents a sample. We use the single best-evidenced source and treat
//     agreement as a separate, modest signal.
//  2. More evidence must never lower a score. Observed rates regress toward
//     the prior built from the other signals, not toward a fixed floor.
//  3. "Rarely works" is a claim about FAILURE, never about staleness or
//     missing data, and it needs a real sample behind it.
//  4. The badge and the evidence sentence beside it must never contradict.
//
// The counts are self-reported by sites with an incentive to look useful, so
// they are relative signal, not ground truth.

const Z = 1.96;                   // 95% Wilson interval
const STRONG_RATE = 0.5;          // a code working for half of real attempts is as good as coupons get
const MIN_SAMPLE_FOR_DOUBT = 20;  // below this we never call a code bad
const NO_EVIDENCE_BASE = 0.3;     // the "we simply don't know" baseline
const WEAK_RATE = 0.2;            // scaled rate below this, with a sample, means it fails
const STALE_DAYS = 120;           // older than this we decline to affirm anything
const DAY = 24 * 60 * 60 * 1000;

// Wilson score lower bound — ranks by success rate without letting 1-of-1
// (100%) outrank 271-of-465 (58%).
export function wilsonLowerBound(successes, attempts) {
  if (!attempts || attempts <= 0) return null;
  const p = Math.min(1, Math.max(0, successes / attempts));
  const z2 = Z * Z;
  const denominator = 1 + z2 / attempts;
  const center = p + z2 / (2 * attempts);
  const margin = Z * Math.sqrt((p * (1 - p) + z2 / (4 * attempts)) / attempts);
  return Math.max(0, (center - margin) / denominator);
}

const finite = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const count = (v) => {
  const n = finite(v);
  return n == null || n < 0 ? 0 : Math.floor(n);
};
// A timestamp of 0 means a 1970 date, i.e. garbage — not "the epoch".
const stamp = (v) => {
  const n = finite(v);
  return n != null && n > 0 ? n : null;
};
const laterOf = (a, b) => (a != null && b != null ? Math.max(a, b) : a ?? b ?? null);

// One source's view of one offer, with impossible values rejected at the door.
function sanitize(raw = {}) {
  const attempts = count(raw.attempts);
  const sourceConfidence = finite(raw.sourceConfidence);
  const rawScore = finite(raw.sourceScore);
  // sourceConfidence === 0 means the source disclaims its own score.
  const usableScore =
    rawScore != null && rawScore >= 0 && (sourceConfidence == null || sourceConfidence > 0);
  return {
    attempts,
    successes: Math.min(count(raw.successes), attempts), // successes can never exceed attempts
    uses: count(raw.uses),
    lastSuccessAt: stamp(raw.lastSuccessAt),
    lastVerifiedAt: stamp(raw.lastVerifiedAt),
    sourceScore: usableScore ? rawScore : null,
    sourceConfidence: sourceConfidence != null && sourceConfidence > 0 ? Math.min(1, sourceConfidence) : null,
    declaredVerified: Boolean(raw.declaredVerified),
  };
}

export const emptyTelemetry = () => ({ bySource: {} });

// Wrap one adapter's flat telemetry as a per-source record.
export function telemetryFor(sourceName, raw) {
  return { bySource: { [sourceName || 'unknown']: sanitize(raw) } };
}

// Combine two records from the SAME source (a site listing one code twice):
// take the better-evidenced view rather than adding them together.
function mergeSameSource(a, b) {
  const attempts = Math.max(a.attempts, b.attempts);
  const preferB = (b.sourceConfidence ?? 0.6) > (a.sourceConfidence ?? 0.6);
  const scored = b.sourceScore != null && (a.sourceScore == null || preferB) ? b : a;
  return {
    attempts,
    successes: Math.min(Math.max(a.successes, b.successes), attempts),
    uses: Math.max(a.uses, b.uses),
    lastSuccessAt: laterOf(a.lastSuccessAt, b.lastSuccessAt),
    lastVerifiedAt: laterOf(a.lastVerifiedAt, b.lastVerifiedAt),
    sourceScore: scored.sourceScore,
    sourceConfidence: scored.sourceConfidence,
    declaredVerified: a.declaredVerified || b.declaredVerified,
  };
}

export function mergeTelemetry(a, b) {
  const left = a?.bySource ?? {};
  const right = b?.bySource ?? {};
  const bySource = { ...left };
  for (const [name, record] of Object.entries(right)) {
    bySource[name] = bySource[name] ? mergeSameSource(bySource[name], record) : record;
  }
  return { bySource };
}

function recencyFactor(ts, nowMs) {
  if (!ts) return 0.8; // unknown age is a mild discount, never a verdict
  const days = (nowMs - ts) / DAY;
  if (days <= 2) return 1;
  if (days <= 7) return 0.97;
  if (days <= 30) return 0.9;
  if (days <= 60) return 0.8;
  if (days <= 90) return 0.7;
  return 0.55;
}

// -> { confidence 0-99, band, evidence, lastWorkedAt, sourceCount, attempts, successes }
export function scoreOffer(offer, nowMs = Date.now()) {
  const bySource = offer.telemetry?.bySource ?? {};
  const names = Object.keys(bySource);
  const records = names.length ? Object.values(bySource) : [sanitize({})];

  // Rule 1: pick the best-evidenced single source; never add samples together.
  const best = records.reduce((a, b) => (b.attempts > a.attempts ? b : a), records[0]);
  const scored = records
    .filter((r) => r.sourceScore != null)
    .sort((a, b) => (b.sourceConfidence ?? 0.6) - (a.sourceConfidence ?? 0.6))[0] ?? null;
  const anyVerified = records.some((r) => r.declaredVerified);
  const maxUses = records.reduce((acc, r) => Math.max(acc, r.uses), 0);
  const lastGood = records.reduce(
    (acc, r) => laterOf(acc, laterOf(r.lastSuccessAt, r.lastVerifiedAt)),
    null
  );

  // The prior: what the non-count signals say on their own.
  let prior = NO_EVIDENCE_BASE;
  let evidence = 'no redemption data';
  if (scored) {
    prior = Math.min(1, (scored.sourceScore / 100) * (scored.sourceConfidence ?? 0.6));
    evidence = `source works-score ${Math.round(scored.sourceScore)}/100`;
  } else if (anyVerified) {
    prior = 0.55;
    evidence = 'listed as verified by the source';
  } else if (maxUses > 0) {
    prior = 0.35;
    evidence = `used ${maxUses} times (no success breakdown)`;
  }

  // Rule 2: observed rates regress toward that prior, so adding evidence can
  // refine the estimate but never collapse it.
  let base = prior;
  if (best.attempts >= 1) {
    const observed = Math.min(1, wilsonLowerBound(best.successes, best.attempts) / STRONG_RATE);
    const weight = Math.min(1, best.attempts / MIN_SAMPLE_FOR_DOUBT);
    base = observed * weight + prior * (1 - weight);
    const pct = Math.round((best.successes / best.attempts) * 100);
    // Rule 4: state the fact and flag the limitation — never print a verdict
    // the badge contradicts.
    evidence = best.attempts < MIN_SAMPLE_FOR_DOUBT
      ? `worked for ${pct}% of ${best.attempts} redemption${best.attempts === 1 ? '' : 's'} (small sample)`
      : `worked for ${pct}% of ${best.attempts} redemptions`;
  }

  const sourceCount = Math.max(names.length, 1);
  const corroboration = Math.min(10, (sourceCount - 1) * 4);
  const raw = base * 100 * recencyFactor(lastGood, nowMs) + corroboration;
  const confidence = Number.isFinite(raw) ? Math.max(0, Math.min(99, Math.round(raw))) : 0;

  const hasSample = best.attempts >= MIN_SAMPLE_FOR_DOUBT;
  const scaledRate = best.attempts >= 1
    ? wilsonLowerBound(best.successes, best.attempts) / STRONG_RATE
    : null;
  const observedRate = best.attempts >= 1 ? best.successes / best.attempts : null;
  const stale = lastGood != null && (nowMs - lastGood) / DAY > STALE_DAYS;

  let band;
  if (hasSample && scaledRate < WEAK_RATE && offer.code) {
    band = 'poor';                                   // rule 3: a failure claim, from a real sample
  } else if (stale || (observedRate != null && observedRate < WEAK_RATE)) {
    band = 'unknown';                                // too old, or only ever seen to fail
  } else if (confidence >= 70 && (hasSample || scored)) {
    band = 'high';
  } else if (confidence >= 45 && (hasSample || scored || anyVerified)) {
    band = 'likely';
  } else {
    band = 'unknown';
  }

  return {
    confidence,
    band,
    evidence,
    lastWorkedAt: lastGood,
    sourceCount,
    attempts: best.attempts,
    successes: best.successes,
    hasSuccessData: best.attempts >= 1 || scored != null,
  };
}

// Back-compat: the rest of the app still speaks verified/unconfirmed.
export const statusFromBand = (band) => (band === 'high' || band === 'likely' ? 'verified' : 'unconfirmed');
