// Company name -> domain resolution via Clearbit's free autocomplete endpoint (no key needed).
export async function suggestCompanies(query) {
  const url = `https://autocomplete.clearbit.com/v1/companies/suggest?query=${encodeURIComponent(query)}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return [];
    const data = await res.json();
    const entries = (Array.isArray(data) ? data : [])
      .filter((c) => c && c.name && c.domain)
      .map((c) => ({ name: c.name, domain: c.domain, logo: c.logo ?? null }));
    return groupSuggestions(entries);
  } catch {
    return [];
  }
}

// "Market Basket" / "MARKET BASKET" / "Market Basket Inc." -> "market basket".
// Falls back to the plain lowercased name when stripping would leave nothing
// (stopword-only or non-Latin names), so the name key is never empty.
function normalizeName(name) {
  const normalized = name
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // strip accents
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\b(inc|incorporated|llc|ltd|limited|corp|corporation|company|co|plc|gmbh|sa|sau|srl|the)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return normalized || name.toLowerCase().trim();
}

// Labels too generic (or too short) to indicate the same brand — merging on
// these would chain unrelated companies (shop.alpha.com + shop.beta.io).
const GENERIC_LABELS = new Set(['www', 'shop', 'store', 'online', 'get', 'my', 'the', 'go', 'app', 'buy', 'us']);

// "adidas.co.uk" -> "adidas"; null when the label is too generic to merge on.
function mergeLabel(domain) {
  const label = domain.toLowerCase().split('.')[0];
  return label.length >= 3 && !GENERIC_LABELS.has(label) ? label : null;
}

// Clearbit often returns several variations of the same brand (regional TLDs,
// sibling chains with identical names). Merge entries that share a normalized
// name OR a distinctive domain base label — transitively (union-find), so a
// bridging entry joins its groups into one. The representative is the best of
// the group (.com > logo > Clearbit's relevance order); the other members are
// kept on the suggestion so the UI can expand them (nothing becomes
// unreachable when distinct same-named companies collapse together).
export function groupSuggestions(entries) {
  const parent = entries.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const union = (a, b) => { parent[find(a)] = find(b); };

  const byName = new Map();
  const byLabel = new Map();
  entries.forEach((entry, i) => {
    const nameKey = normalizeName(entry.name);
    if (byName.has(nameKey)) union(i, byName.get(nameKey));
    else byName.set(nameKey, i);
    const labelKey = mergeLabel(entry.domain);
    if (labelKey) {
      if (byLabel.has(labelKey)) union(i, byLabel.get(labelKey));
      else byLabel.set(labelKey, i);
    }
  });

  const groups = new Map(); // root index -> members, in first-seen order
  entries.forEach((entry, i) => {
    const root = find(i);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(entry);
  });

  const score = (e) => (e.domain.endsWith('.com') ? 2 : 0) + (e.logo ? 1 : 0);
  return [...groups.values()].map((members) => {
    let best = members[0];
    for (const m of members.slice(1)) if (score(m) > score(best)) best = m;
    if (members.length === 1) return best;
    return { ...best, variants: members.length, members: members.filter((m) => m !== best) };
  });
}
