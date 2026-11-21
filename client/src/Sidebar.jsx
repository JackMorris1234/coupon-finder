export default function Sidebar({ history, favorites, onSelect, activeDomain }) {
  const item = (c) => (
    <li
      key={c.domain}
      className={c.domain === activeDomain ? 'active' : ''}
      onClick={() => onSelect({ name: c.name, domain: c.domain, logo: c.logoUrl })}
    >
      {c.logoUrl ? <img src={c.logoUrl} alt="" /> : <span className="logo-placeholder" />}
      <span>{c.name}</span>
    </li>
  );

  return (
    <aside className="sidebar">
      <h3>Favorites</h3>
      {favorites.length === 0 && <p className="hint">Star a company to pin it here.</p>}
      <ul>{favorites.map(item)}</ul>
      <h3>Recent searches</h3>
      {history.length === 0 && <p className="hint">No searches yet.</p>}
      <ul>{history.map(item)}</ul>
    </aside>
  );
}
