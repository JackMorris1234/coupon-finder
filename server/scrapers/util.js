// Shared adapter helpers.

// Parse a date-ish string to epoch ms, or null (never NaN).
export const toTs = (value) => {
  const ts = value ? Date.parse(value) : NaN;
  return Number.isFinite(ts) ? ts : null;
};

// "Extra 25% Off Select Styles" -> "25% off"; null when no discount phrase.
export const discountFrom = (text) =>
  text?.match(/(\d+%|\$[\d,]+)\s*off/i)?.[0]?.toLowerCase() ?? null;
