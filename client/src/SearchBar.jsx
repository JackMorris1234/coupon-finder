import { useEffect, useRef, useState } from 'react';

export default function SearchBar({ onSelect }) {
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [expanded, setExpanded] = useState(() => new Set());
  const boxRef = useRef(null);
  const skipNextFetch = useRef(false);

  useEffect(() => {
    if (skipNextFetch.current) { skipNextFetch.current = false; return; }
    if (query.trim().length < 2) { setSuggestions([]); setOpen(false); return; }
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/suggest?q=${encodeURIComponent(query.trim())}`);
        const data = await res.json();
        setSuggestions(data);
        setExpanded(new Set());
        setOpen(true);
        setHighlight(0);
      } catch { /* ignore */ }
    }, 200);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    const onClick = (e) => { if (!boxRef.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const pick = (c) => {
    skipNextFetch.current = true;
    setOpen(false);
    setSuggestions([]);
    setExpanded(new Set());
    setQuery(c.name);
    onSelect(c);
  };

  const toggleExpand = (i) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i); else next.add(i);
      return next;
    });
  };

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setHighlight((h) => Math.min(h + 1, suggestions.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlight((h) => Math.max(h - 1, 0)); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      if (open && suggestions[highlight]) pick(suggestions[highlight]);
      else if (/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(query.trim())) {
        pick({ name: query.trim(), domain: query.trim().toLowerCase() });
      }
    } else if (e.key === 'Escape') { setOpen(false); setSuggestions([]); }
  };

  return (
    <div className="searchbar" ref={boxRef}>
      <input
        type="text"
        placeholder="Company name or domain…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => suggestions.length && setOpen(true)}
        onKeyDown={onKeyDown}
        autoFocus
      />
      {open && suggestions.length > 0 && (
        <ul className="suggestions">
          {suggestions.flatMap((c, i) => {
            const rows = [
              <li
                key={`${c.domain}-${i}`}
                className={i === highlight ? 'highlight' : ''}
                onMouseEnter={() => setHighlight(i)}
                onMouseDown={(e) => { e.preventDefault(); pick(c); }}
              >
                {c.logo ? <img src={c.logo} alt="" /> : <span className="logo-placeholder" />}
                <span className="name">{c.name}</span>
                {c.variants > 1 && (
                  <button
                    className={`variants ${expanded.has(i) ? 'open' : ''}`}
                    title={`${c.variants} similar listings merged — click to show`}
                    onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); toggleExpand(i); }}
                  >
                    {expanded.has(i) ? '▾' : '▸'} {c.variants - 1} more
                  </button>
                )}
                <span className="domain">{c.domain}</span>
              </li>,
            ];
            if (expanded.has(i) && c.members) {
              rows.push(...c.members.map((m, j) => (
                <li
                  key={`${c.domain}-${i}-m${j}`}
                  className="member"
                  onMouseDown={(e) => { e.preventDefault(); pick(m); }}
                >
                  {m.logo ? <img src={m.logo} alt="" /> : <span className="logo-placeholder" />}
                  <span className="name">{m.name}</span>
                  <span className="domain">{m.domain}</span>
                </li>
              )));
            }
            return rows;
          })}
        </ul>
      )}
    </div>
  );
}
