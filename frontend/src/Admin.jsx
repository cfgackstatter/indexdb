import { useEffect, useMemo, useState } from "react";
import { useFetch } from "./hooks/useFetch";

const PAGE_SIZE = 50;

// columns to never show in the table (still searchable)
const HIDDEN_COLS = new Set(["currency"]);

export default function Admin() {
  const [indices, setIndices] = useState([]);
  const [filter, setFilter] = useState("");
  const [page, setPage] = useState(1);
  const [providerInput, setProviderInput] = useState("");
  const [symbolInput, setSymbolInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  const { data: providers } = useFetch("/admin/providers", []);

  useEffect(() => {
    if (providers?.length) setProviderInput(p => p || providers[0]);
  }, [providers]);

  const loadIndices = () =>
    fetch(`/admin/indices`)
      .then(r => r.ok ? r.json() : [])
      .then(setIndices)
      .catch(() => {});

  useEffect(() => { loadIndices(); }, []);

  const columns = useMemo(() => {
    const allKeys = new Set(indices.flatMap(Object.keys));
    const fixed = ["provider", "symbol"];
    return [
      ...fixed,
      ...[...allKeys].filter(k => !fixed.includes(k) && !HIDDEN_COLS.has(k)),
    ];
  }, [indices]);

  const filtered = useMemo(() => {
    if (!filter) return indices;
    const q = filter.toLowerCase();
    return indices.filter(row =>
      Object.values(row).some(v => v != null && String(v).toLowerCase().includes(q))
    );
  }, [indices, filter]);

  // reset page when filter changes
  useEffect(() => setPage(1), [filter]);

  const paginated = filtered.slice(0, page * PAGE_SIZE);
  const hasMore = filtered.length > paginated.length;

  const onDownload = async () => {
    if (!providerInput || !symbolInput) return;
    const symbols = symbolInput.split(",").map(s => s.trim()).filter(Boolean);
    setLoading(true);
    setMessage("");
    const results = [];
    try {
      for (const sym of symbols) {
        try {
          const res = await fetch(
            `/admin/ingest/${encodeURIComponent(providerInput)}/${encodeURIComponent(sym)}`,
            { method: "POST" }
          );
          const data = await res.json();
          results.push(res.ok
            ? `✓ ${sym}: ${data.rows} rows`
            : `✗ ${sym}: ${data.detail ?? "failed"}`
          );
        } catch {
          results.push(`✗ ${sym}: connection error`);
        }
      }
      setMessage(results.join(" · "));
      setSymbolInput("");
      await loadIndices();
    } finally {
      setLoading(false);
    }
  };

  const onDelete = async (provider, symbol) => {
    if (!window.confirm(`Delete ${provider}/${symbol}?`)) return;
    await fetch(
      `/admin/indices/${encodeURIComponent(provider)}/${encodeURIComponent(symbol)}`,
      { method: "DELETE" }
    );
    setIndices(prev => prev.filter(
      i => !(i.provider === provider && i.symbol === symbol)
    ));
  };

  const onRefresh = async (provider, symbol) => {
    setMessage("");
    try {
      const res = await fetch(
        `/admin/indices/${encodeURIComponent(provider)}/${encodeURIComponent(symbol)}/refresh`,
        { method: "POST" }
      );
      const data = await res.json();
      setMessage(res.ok
        ? data.rows === 0
          ? `✓ ${data.provider}/${data.symbol} already up to date`
          : `✓ Refreshed ${data.rows} new rows for ${data.provider}/${data.symbol}`
        : "✗ Refresh failed"
      );
    } catch {
      setMessage("✗ Could not connect to backend");
    }
  };

  const onTag = async (provider, symbol) => {
    setMessage("");
    try {
      const res = await fetch(
        `/admin/indices/${encodeURIComponent(provider)}/${encodeURIComponent(symbol)}/tag`,
        { method: "POST" }
      );
      const data = await res.json();
      setMessage(res.ok
        ? `✓ Tagged ${provider}/${symbol}: ${data.tags.join(", ")}`
        : `✗ ${data.detail ?? "Tagging failed"}`
      );
      if (res.ok) await loadIndices();
    } catch {
      setMessage("✗ Could not connect to backend");
    }
  };

  return (
    <>
      <section className="panel">
        <div className="panel-header">
          <div className="panel-title">Download new index</div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <select
            className="search-input"
            style={{ maxWidth: 140, paddingLeft: 10 }}
            value={providerInput}
            onChange={e => setProviderInput(e.target.value)}
          >
            {(providers ?? ["yahoo"]).map(p => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
          <input
            className="search-input"
            style={{ maxWidth: 220 }}
            value={symbolInput}
            onChange={e => setSymbolInput(e.target.value)}
            onKeyDown={e => e.key === "Enter" && onDownload()}
            placeholder="symbols (e.g. ^GSPC, ^NDX)"
          />
          <button
            className="pill-button pill-button-active"
            disabled={loading || !symbolInput}
            onClick={onDownload}
          >
            {loading ? "Downloading…" : "Download"}
          </button>
        </div>
        {message && (
          <div style={{
            marginTop: 8, fontSize: 12,
            color: message.startsWith("✓") ? "var(--text-secondary)" : "var(--danger)",
          }}>
            {message}
          </div>
        )}
      </section>

      <section className="panel">
        <div className="panel-header">
          <div className="panel-title">Existing indices</div>
          <div className="panel-badge">{indices.length} stored</div>
        </div>

        <input
          className="search-input"
          style={{ maxWidth: 300, marginBottom: 8 }}
          value={filter}
          onChange={e => setFilter(e.target.value)}
          placeholder="Filter across all columns…"
        />

        <div style={{ overflowX: "auto" }}>
          <table className="admin-table">
            <thead>
              <tr>
                {columns.map(col => <th key={col}>{col}</th>)}
                <th style={{ width: 200 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {paginated.map(idx => (
                <tr key={idx.provider + idx.symbol}>
                  {columns.map(col => (
                    <td key={col} title={idx[col] ?? ""}
                      style={{ maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {idx[col] ?? "—"}
                    </td>
                  ))}
                  <td>
                    <button className="table-button"
                      onClick={() => onRefresh(idx.provider, idx.symbol)}>
                      Update
                    </button>
                    <button className="table-button"
                      onClick={() => onTag(idx.provider, idx.symbol)}>
                      Tag
                    </button>
                    <button className="table-button table-button-danger"
                      onClick={() => onDelete(idx.provider, idx.symbol)}>
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={columns.length + 1}
                    style={{ textAlign: "center", fontSize: 12, color: "var(--text-muted)" }}>
                    No indices found
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {hasMore && (
          <div style={{ marginTop: 10, textAlign: "center" }}>
            <button className="pill-button" onClick={() => setPage(p => p + 1)}>
              Load more ({filtered.length - paginated.length} remaining)
            </button>
          </div>
        )}
      </section>
    </>
  );
}
