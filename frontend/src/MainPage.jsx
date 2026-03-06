import { useState, useMemo, useEffect, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { API } from "./api";
import Chart from "./Chart";

const COLORS = ["#3b82f6", "#f97316", "#22c55e", "#a855f7", "#f43f5e", "#14b8a6"];

function useDebounce(value, delay) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

// encode: [{provider, symbol, name?}] → "yahoo:SPY,yahoo:QQQ"
function encodeIndices(indices) {
  return indices.map(i => `${i.provider}:${i.symbol}`).join(",");
}

// decode: "yahoo:SPY,yahoo:QQQ" → [{provider, symbol}]
function decodeIndices(str) {
  if (!str) return [];
  return str.split(",").map(s => {
    const [provider, symbol] = s.split(":");
    return provider && symbol ? { provider, symbol } : null;
  }).filter(Boolean);
}

export default function MainPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [searchError, setSearchError] = useState(false);

  // initialise from URL
  const [selected, setSelected] = useState(() => decodeIndices(searchParams.get("indices")));
  const [range, setRange] = useState(() => searchParams.get("range") ?? "1Y");

  const debouncedQuery = useDebounce(query, 200);

  // sync state → URL
  useEffect(() => {
    const params = {};
    if (selected.length) params.indices = encodeIndices(selected);
    if (range !== "1Y") params.range = range;
    setSearchParams(params, { replace: true });
  }, [selected, range]);

  // search
  useEffect(() => {
    if (!debouncedQuery) { setResults([]); return; }
    setSearchError(false);
    fetch(`${API}/search?q=${encodeURIComponent(debouncedQuery)}`)
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(setResults)
      .catch(() => { setSearchError(true); setResults([]); });
  }, [debouncedQuery]);

  // Escape closes dropdown
  useEffect(() => {
    const onKey = e => { if (e.key === "Escape") closeResults(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // when URL-decoded indices have no metadata yet, enrich from search
  useEffect(() => {
    selected.forEach(idx => {
      if (idx.name) return;
      fetch(`${API}/search?q=${encodeURIComponent(idx.symbol)}`)
        .then(r => r.ok ? r.json() : [])
        .then(results => {
          const match = results.find(
            r => r.provider === idx.provider && r.symbol === idx.symbol
          );
          if (match?.name) {
            setSelected(prev => prev.map(s =>
              s.provider === idx.provider && s.symbol === idx.symbol
                ? { ...s, name: match.name }
                : s
            ));
          }
        })
        .catch(() => {});
    });
  }, []); // only on mount to enrich URL-loaded indices

  const colorMap = useMemo(() => {
    const map = {};
    selected.forEach((idx, i) => {
      map[`${idx.provider}/${idx.symbol}`] = COLORS[i % COLORS.length];
    });
    return map;
  }, [selected]);

  const add = (idx) => {
    if (!selected.find(s => s.symbol === idx.symbol && s.provider === idx.provider))
      setSelected(prev => [...prev, idx]);
  };

  const closeResults = () => { setResults([]); setQuery(""); };

  const remove = (idx) =>
    setSelected(prev => prev.filter(
      s => !(s.symbol === idx.symbol && s.provider === idx.provider)
    ));

  return (
    <>
      <section className="search-row">
        <div className="search-input-wrapper">
          <span className="search-icon">⌕</span>
          <input
            className="search-input"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search by symbol, provider or name…"
            autoComplete="off"
          />
          {results.length > 0 && (
            <div className="search-results">
              <div style={{
                display: "flex", justifyContent: "space-between",
                padding: "5px 10px", borderBottom: "1px solid var(--border)"
              }}>
                <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                  {results.length} results — click to add
                </span>
                <span
                  style={{ fontSize: 11, color: "var(--text-muted)", cursor: "pointer" }}
                  onClick={closeResults}
                >
                  ✕ close
                </span>
              </div>
              {results.map(r => {
                const isSelected = !!selected.find(
                  s => s.symbol === r.symbol && s.provider === r.provider
                );
                return (
                  <div
                    key={r.provider + r.symbol}
                    className="search-result-item"
                    onClick={() => add(r)}
                    style={{ opacity: isSelected ? 0.5 : 1 }}
                  >
                    <div>
                      <span className="search-result-symbol">{r.symbol}</span>
                      {r.name && <span className="search-result-meta"> — {r.name}</span>}
                    </div>
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      {isSelected && <span style={{ color: "var(--accent)", fontSize: 11 }}>✓</span>}
                      <span className="search-result-provider">{r.provider}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {selected.length > 0 && (
          <div className="selected-indices">
            {selected.map(idx => {
              const key = `${idx.provider}/${idx.symbol}`;
              const color = colorMap[key];
              return (
                <div
                  key={key}
                  className="index-pill"
                  style={{ borderColor: color }}
                  title={idx.name ?? idx.symbol}
                >
                  <span
                    className="index-pill-badge"
                    style={{ background: `${color}22`, color }}
                  >
                    {idx.provider}
                  </span>
                  <span style={{ color, fontFamily: "var(--font-mono)" }}>
                    {idx.symbol}
                  </span>
                  {idx.name && (
                    <span style={{ color: "var(--text-muted)", fontSize: 10 }}>
                      {idx.name}
                    </span>
                  )}
                  <span className="index-pill-remove" onClick={() => remove(idx)}>
                    ×
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="panel">
        <div className="panel-header">
          <div className="panel-title">Performance</div>
          {selected.length > 0 && (
            <div className="panel-badge">{selected.length} series · cumulative return</div>
          )}
        </div>
        <div className="chart-wrapper">
          <Chart
            indices={selected}
            onRemove={remove}
            colorMap={colorMap}
            range={range}
            onRangeChange={setRange}
          />
        </div>
      </section>
    </>
  );
}
