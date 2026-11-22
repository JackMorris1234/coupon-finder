// Shared adapter helpers.

// Parse a date-ish string to epoch ms, or null (never NaN).
export const toTs = (value) => {
  const ts = value ? Date.parse(value) : NaN;
  return Number.isFinite(ts) ? ts : null;
};

// "Extra 25% Off Select Styles" -> "25% off"; null when no discount phrase.
export const discountFrom = (text) =>
  text?.match(/(\d+%|\$[\d,]+)\s*off/i)?.[0]?.toLowerCase() ?? null;

// "Verified 2h ago" / "Used 8 hours ago" / "3 days ago" -> epoch ms, else null.
// Longest unit alternatives first so "mo" never loses to "m".
export function parseAgo(text, nowMs = Date.now()) {
  const m = String(text ?? '').match(/(\d+)\s*(months?|mo|weeks?|w|days?|d|hours?|hrs?|h|minutes?|mins?|m)\b\s*ago/i);
  if (!m) return null;
  const n = Number(m[1]);
  const unit = m[2].toLowerCase();
  const MINUTE = 60_000, HOUR = 60 * MINUTE, DAY = 24 * HOUR;
  const span = unit.startsWith('mo') ? 30 * DAY
    : unit.startsWith('w') ? 7 * DAY
    : unit.startsWith('d') ? DAY
    : unit.startsWith('h') ? HOUR
    : MINUTE;
  return nowMs - n * span;
}

// "Used 210 Times" -> 210
export const countFrom = (text) => {
  const m = String(text ?? '').match(/([\d,]+)\s*times?/i);
  return m ? Number(m[1].replace(/,/g, '')) : null;
};
