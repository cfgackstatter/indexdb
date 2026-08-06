import { useEffect, useMemo, useState } from "react";
import { useFetch } from "./hooks/useFetch";

const PAGE_SIZE = 50;
const PASSWORD_KEY = "indexdb_admin_password";

// columns to never show in the table (still searchable)
const HIDDEN_COLS = new Set(["currency"]);

function adminHeaders(password) {
  return password ? { "X-Admin-Password": password } : {};
}

async function parseDetail(res) {
  try {
    const data = await res.json();
    return data.detail ?? data.msg ?? "failed";
  } catch {
    return res.statusText || "failed";
  }
}

export default function Admin() {
  const [indices, setIndices] = useState([]);
  const [filter, setFilter] = useState("");
  const [page, setPage] = useState(1);
  const [providerInput, setProviderInput] = useState("");
  const [symbolInput, setSymbolInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [password, setPassword] = useState(
    () => sessionStorage.getItem(PASSWORD_KEY) ?? ""
  );

  const unlocked = password.length > 0;
  const { data: providers } = useFetch("/admin/providers", []);

  useEffect(() => {
    if (providers?.length) setProviderInput(p => p || providers[0]);
  }, [providers]);

  useEffect(() => {
    if (password) sessionStorage.setItem(PASSWORD_KEY, password);
    else sessionStorage.removeItem(PASSWORD_KEY);
  }, [password]);

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
    if (!providerInput || !symbolInput || !unlocked) return;
    const symbols = symbolInput.split(",").map(s => s.trim()).filter(Boolean);
    setLoading(true);
    setMessage("");
    const results = [];
    try {
      for (const sym of symbols) {
        try {
          const res = await fetch(
            `/admin/ingest/${encodeURIComponent(providerInput)}/${encodeURIComponent(sym)}`,
            { method: "POST", headers: adminHeaders(password) }
          );
          if (res.ok) {
            const data = await res.json();
            results.push(`✓ ${sym}: ${data.rows} rows`);
          } else {
            results.push(`✗ ${sym}: ${await parseDetail(res)}`);
          }
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
    if (!unlocked) return;
    if (!window.confirm(`Delete ${provider}/${symbol}?`)) return;
    const res = await fetch(
      `/admin/indices/${encodeURIComponent(provider)}/${encodeURIComponent(symbol)}`,
      { method: "DELETE", headers: adminHeaders(password) }
    );
    if (!res.ok) {
      setMessage(`✗ ${await parseDetail(res)}`);
      return;
    }
    setIndices(prev => prev.filter(
      i => !(i.provider === provider && i.symbol === symbol)
    ));
  };

  const onRefresh = async (provider, symbol) => {
    if (!unlocked) return;
    setMessage("");
    try {
      const res = await fetch(
        `/admin/indices/${encodeURIComponent(provider)}/${encodeURIComponent(symbol)}/refresh`,
        { method: "POST", headers: adminHeaders(password) }
      );
      if (!res.ok) {
        setMessage(`✗ ${await parseDetail(res)}`);
        return;
      }
      const data = await res.json();
      setMessage(
        data.rows === 0
          ? `✓ ${data.provider}/${data.symbol} already up to date`
          : `✓ Refreshed ${data.rows} new rows for ${data.provider}/${data.symbol}`
      );
    } catch {
      setMessage("✗ Could not connect to backend");
    }
  };

  const onTag = async (provider, symbol) => {
    if (!unlocked) return;
    setMessage("");
    try {
      const res = await fetch(
        `/admin/indices/${encodeURIComponent(provider)}/${encodeURIComponent(symbol)}/tag`,
        { method: "POST", headers: adminHeaders(password) }
      );
      if (!res.ok) {
        setMessage(`✗ ${await parseDetail(res)}`);
        return;
      }
      const data = await res.json();
      setMessage(`✓ Tagged ${provider}/${symbol}: ${data.tags.join(", ")}`);
      await loadIndices();
    } catch {
      setMessage("✗ Could not connect to backend");
    }
  };

  return (
    <>
      <section className="panel">
        <div className="panel-header">
          <div className="panel-title">Admin access</div>
          <div className="panel-badge">
            {unlocked ? "Actions unlocked" : "View only — enter password to edit"}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <input
            className="search-input"
            style={{ maxWidth: 220, paddingLeft: 12 }}
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="Admin password"
          />
          {unlocked && (
            <button
              className="pill-button"
              type="button"
              onClick={() => setPassword("")}
            >
              Lock
            </button>
          )}
        </div>
      </section>

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
            disabled={!unlocked}
          >
            {(providers ?? ["yahoo"]).map(p => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
          <div className="search-input-wrapper">
            <span className="search-icon">⌕</span>
            <input
              className="search-input"
              style={{ maxWidth: 220 }}
              value={symbolInput}
              onChange={e => setSymbolInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && onDownload()}
              placeholder="symbols (e.g. ^GSPC, ^NDX)"
              disabled={!unlocked}
            />
          </div>
          <button
            className="pill-button pill-button-active"
            disabled={loading || !symbolInput || !unlocked}
            onClick={onDownload}
            title={unlocked ? undefined : "Enter admin password to enable"}
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
          style={{ maxWidth: 300, marginBottom: 8, paddingLeft: 12 }}
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
                      disabled={!unlocked}
                      title={unlocked ? undefined : "Enter admin password to enable"}
                      onClick={() => onRefresh(idx.provider, idx.symbol)}>
                      Update
                    </button>
                    <button className="table-button"
                      disabled={!unlocked}
                      title={unlocked ? undefined : "Enter admin password to enable"}
                      onClick={() => onTag(idx.provider, idx.symbol)}>
                      Tag
                    </button>
                    <button className="table-button table-button-danger"
                      disabled={!unlocked}
                      title={unlocked ? undefined : "Enter admin password to enable"}
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
