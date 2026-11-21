import Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const db = new Database(path.join(__dirname, 'coupons.db'));
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS companies (
    domain TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    logo_url TEXT,
    last_fetched_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS offers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    domain TEXT NOT NULL REFERENCES companies(domain),
    dedupe_key TEXT NOT NULL,
    code TEXT,
    title TEXT NOT NULL,
    description TEXT,
    discount_text TEXT,
    source TEXT NOT NULL,
    source_url TEXT,
    status TEXT NOT NULL DEFAULT 'unconfirmed',
    verified_at INTEGER,
    expires_at INTEGER,
    first_seen_at INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL,
    UNIQUE(domain, dedupe_key)
  );

  CREATE TABLE IF NOT EXISTS history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    domain TEXT NOT NULL,
    searched_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS favorites (
    domain TEXT PRIMARY KEY,
    added_at INTEGER NOT NULL
  );
`);

// Migration: offers.kind ('code' | 'deal' | 'hidden') — hidden means the
// source has a code but only reveals it on their site.
if (!db.prepare(`SELECT 1 FROM pragma_table_info('offers') WHERE name = 'kind'`).get()) {
  db.exec(`ALTER TABLE offers ADD COLUMN kind TEXT NOT NULL DEFAULT 'deal'`);
}

const now = () => Date.now();

export function upsertCompany({ domain, name, logoUrl }) {
  db.prepare(`
    INSERT INTO companies (domain, name, logo_url) VALUES (?, ?, ?)
    ON CONFLICT(domain) DO UPDATE SET name = excluded.name,
      logo_url = COALESCE(excluded.logo_url, companies.logo_url)
  `).run(domain, name, logoUrl ?? null);
}

export function getCompany(domain) {
  return db.prepare('SELECT * FROM companies WHERE domain = ?').get(domain);
}

export function markFetched(domain) {
  db.prepare('UPDATE companies SET last_fetched_at = ? WHERE domain = ?').run(now(), domain);
}

const upsertOfferStmt = db.prepare(`
  INSERT INTO offers (domain, dedupe_key, code, title, description, discount_text, source, source_url,
                      status, verified_at, expires_at, kind, first_seen_at, last_seen_at)
  VALUES (@domain, @dedupeKey, @code, @title, @description, @discountText, @source, @sourceUrl,
          @status, @verifiedAt, @expiresAt, @kind, @now, @now)
  ON CONFLICT(domain, dedupe_key) DO UPDATE SET
    title = excluded.title,
    kind = excluded.kind,
    description = COALESCE(excluded.description, offers.description),
    discount_text = COALESCE(excluded.discount_text, offers.discount_text),
    source_url = COALESCE(excluded.source_url, offers.source_url),
    status = excluded.status,
    verified_at = COALESCE(excluded.verified_at, offers.verified_at),
    expires_at = COALESCE(excluded.expires_at, offers.expires_at),
    last_seen_at = excluded.last_seen_at
`);

export const upsertOffers = db.transaction((domain, offers) => {
  for (const o of offers) {
    const dedupeKey = (o.code ? `code:${o.code.toUpperCase()}` : `deal:${o.title.toLowerCase().slice(0, 80)}`);
    upsertOfferStmt.run({
      domain,
      dedupeKey,
      code: o.code ?? null,
      title: o.title,
      description: o.description ?? null,
      discountText: o.discountText ?? null,
      source: o.source,
      sourceUrl: o.sourceUrl ?? null,
      status: o.status ?? 'unconfirmed',
      verifiedAt: o.verifiedAt ?? null,
      expiresAt: o.expiresAt ?? null,
      kind: o.code ? 'code' : (o.hasHiddenCode ? 'hidden' : 'deal'),
      now: now(),
    });
  }
});

export function getOffers(domain) {
  return db.prepare(`
    SELECT id, domain, code, title, description, discount_text AS discountText,
           source, source_url AS sourceUrl, status, verified_at AS verifiedAt,
           expires_at AS expiresAt, kind, first_seen_at AS firstSeenAt, last_seen_at AS lastSeenAt
    FROM offers WHERE domain = ?
    ORDER BY (code IS NULL), (kind = 'hidden'), (status != 'verified'), last_seen_at DESC
  `).all(domain);
}

// After a fresh scrape, offers the sources no longer list are gone for real —
// drop them so stale duplicates don't sit next to their refreshed versions.
export function pruneStaleOffers(domain, olderThan) {
  db.prepare('DELETE FROM offers WHERE domain = ? AND last_seen_at < ?').run(domain, olderThan);
}

export function recordSearch(domain) {
  db.prepare('INSERT INTO history (domain, searched_at) VALUES (?, ?)').run(domain, now());
}

export function getHistory(limit = 15) {
  // Outer GROUP BY collapses same-named companies (e.g. several "Market
  // Basket" domains searched before suggestion grouping existed); SQLite's
  // bare-column-with-MAX rule keeps the most recently searched domain.
  return db.prepare(`
    SELECT domain, name, logoUrl, MAX(searchedAt) AS searchedAt FROM (
      SELECT h.domain, MAX(h.searched_at) AS searchedAt, c.name, c.logo_url AS logoUrl
      FROM history h JOIN companies c ON c.domain = h.domain
      GROUP BY h.domain
    )
    GROUP BY LOWER(TRIM(name))
    ORDER BY searchedAt DESC
    LIMIT ?
  `).all(limit);
}

export function getFavorites() {
  return db.prepare(`
    SELECT f.domain, f.added_at AS addedAt, c.name, c.logo_url AS logoUrl
    FROM favorites f JOIN companies c ON c.domain = f.domain
    ORDER BY f.added_at DESC
  `).all();
}

export function addFavorite(domain) {
  db.prepare('INSERT OR IGNORE INTO favorites (domain, added_at) VALUES (?, ?)').run(domain, now());
}

export function removeFavorite(domain) {
  db.prepare('DELETE FROM favorites WHERE domain = ?').run(domain);
}

export default db;
