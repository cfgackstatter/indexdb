import { useEffect, useMemo, useState } from "react";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine,
} from "recharts";

const COLORS = ["#3b82f6", "#f97316", "#22c55e", "#a855f7", "#f43f5e", "#14b8a6"];

const RANGES = [
  { label: "1M",  months: 1  },
  { label: "3M",  months: 3  },
  { label: "6M",  months: 6  },
  { label: "1Y",  months: 12 },
  { label: "3Y",  months: 36 },
  { label: "5Y",  months: 60 },
  { label: "All", months: null },
];

function subtractMonths(n) {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  return d.toISOString().slice(0, 10);
}

function fmtDate(str) {
  if (!str) return "";
  const [y, m, d] = str.split("-");
  return new Date(y, m - 1, d).toLocaleDateString("en-GB", {
    day: "2-digit", month: "short", year: "numeric",
  });
}

function computeMetrics(rows) {
  if (!rows || rows.length < 2) return null;

  // daily returns
  const returns = [];
  for (let i = 1; i < rows.length; i++) {
    returns.push((rows[i].close - rows[i - 1].close) / rows[i - 1].close);
  }

  const n = returns.length;
  const years = n / 252;

  // total return
  const totalReturn = (rows[rows.length - 1].close - rows[0].close) / rows[0].close;

  // CAGR
  const cagr = Math.pow(1 + totalReturn, 1 / years) - 1;

  // annualised volatility
  const mean = returns.reduce((s, r) => s + r, 0) / n;
  const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / n;
  const vol = Math.sqrt(variance * 252);

  // max drawdown
  let peak = rows[0].close, maxDD = 0;
  for (const row of rows) {
    if (row.close > peak) peak = row.close;
    const dd = (peak - row.close) / peak;
    if (dd > maxDD) maxDD = dd;
  }

  // Sharpe (risk-free = 0)
  const sharpe = vol > 0 ? cagr / vol : null;

  // Calmar
  const calmar = maxDD > 0 ? cagr / maxDD : null;

  return { totalReturn, cagr, vol, maxDD, sharpe, calmar };
}

const FMT_PCT = v => v == null ? "—" : `${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)}%`;
const FMT_2   = v => v == null ? "—" : v.toFixed(2);

const METRIC_DEFS = [
  { key: "totalReturn", label: "Total Return",  fmt: FMT_PCT, tip: "Cumulative return over the selected range" },
  { key: "cagr",        label: "Ann. Return",   fmt: FMT_PCT, tip: "Compound annual growth rate" },
  { key: "vol",         label: "Ann. Vol",      fmt: FMT_PCT, tip: "Annualised standard deviation of daily returns" },
  { key: "maxDD",       label: "Max Drawdown",  fmt: v => v == null ? "—" : `-${(v * 100).toFixed(1)}%`, tip: "Largest peak-to-trough decline" },
  { key: "sharpe",      label: "Sharpe",        fmt: FMT_2,   tip: "Ann. return / ann. volatility (risk-free = 0)" },
  { key: "calmar",      label: "Calmar",        fmt: FMT_2,   tip: "Ann. return / max drawdown" },
];

function MetricsTable({ seriesMap, indices, colorMap }) {
  const entries = indices
    .map(({ provider, symbol, name }) => {
      const key = `${provider}/${symbol}`;
      const rows = seriesMap[key];
      return { key, label: name ? `${symbol} · ${name}` : symbol, color: colorMap?.[key], metrics: computeMetrics(rows) };
    })
    .filter(e => e.metrics);

  if (!entries.length) return null;

  return (
    <div style={{ marginTop: 20, overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
        <thead>
          <tr>
            <th style={{ textAlign: "left", padding: "4px 8px", color: "var(--text-muted)", fontWeight: 500 }}>Index</th>
            {METRIC_DEFS.map(m => (
              <th key={m.key} title={m.tip}
                style={{ textAlign: "right", padding: "4px 8px", color: "var(--text-muted)", fontWeight: 500, cursor: "help" }}>
                {m.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {entries.map(({ key, label, color, metrics }) => (
            <tr key={key} style={{ borderTop: "1px solid var(--border)" }}>
              <td style={{ padding: "6px 8px", color, fontFamily: "var(--font-mono)", whiteSpace: "nowrap" }}>
                {label}
              </td>
              {METRIC_DEFS.map(m => {
                const v = metrics[m.key];
                const isNeg = typeof v === "number" && v < 0;
                return (
                  <td key={m.key} style={{
                    textAlign: "right", padding: "6px 8px",
                    fontFamily: "var(--font-mono)",
                    color: isNeg ? "#f43f5e" : "var(--text)",
                  }}>
                    {m.fmt(v)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CustomTooltip({ active, payload, label, labelMap = {} }) {
  if (!active || !payload?.length) return null;

  const sorted = [...payload].sort((a, b) => (b.value ?? -Infinity) - (a.value ?? -Infinity));

  return (
    <div style={{
      background: "#0b1020", border: "1px solid #1f2937",
      borderRadius: 8, padding: "8px 12px", fontSize: 12,
    }}>
      <div style={{ color: "#9ca3af", marginBottom: 4 }}>{fmtDate(label)}</div>
      {sorted.map(p => (
        <div key={p.dataKey} style={{ color: p.color, lineHeight: 1.6 }}>
          {labelMap[p.dataKey] ?? p.dataKey}:{" "}
          {p.value >= 0 ? "+" : ""}{p.value.toFixed(2)}%
        </div>
      ))}
    </div>
  );
}

export default function Chart({ indices, colorMap, range, onRangeChange }) {
  const [seriesMap, setSeriesMap] = useState({});
  const [cache, setCache] = useState({});
  const [loading, setLoading] = useState(false);

  const labelMap = useMemo(() =>
    Object.fromEntries(indices.map(i => [
      `${i.provider}/${i.symbol}`,
      i.name ? `${i.symbol} · ${i.name}` : i.symbol,
    ])),
  [indices]);

  // prune removed indices from seriesMap
  useEffect(() => {
    const keys = new Set(indices.map(i => `${i.provider}/${i.symbol}`));
    setSeriesMap(prev => Object.fromEntries(
      Object.entries(prev).filter(([k]) => keys.has(k))
    ));
  }, [indices]);

  // fetch missing series, use cache when available
  useEffect(() => {
    if (!indices.length) return;
    const rangeObj = RANGES.find(r => r.label === range);
    const startParam = rangeObj?.months ? `?start=${subtractMonths(rangeObj.months)}` : "";

    let anyLoading = false;
    indices.forEach(async ({ provider, symbol }) => {
      const key = `${provider}/${symbol}`;
      const cacheKey = `${key}__${range}`;

      if (cache[cacheKey]) {
        setSeriesMap(prev => ({ ...prev, [key]: cache[cacheKey] }));
        return;
      }

      anyLoading = true;
      setLoading(true);
      try {
        const res = await fetch(`/prices/${provider}/${symbol}${startParam}`);
        if (!res.ok) return;
        const data = await res.json();
        setCache(prev => ({ ...prev, [cacheKey]: data }));
        setSeriesMap(prev => ({ ...prev, [key]: data }));
      } finally {
        setLoading(false);
      }
    });
  }, [indices, range]);

  // normalize to cumulative return from first data point = 0%
  const chartData = useMemo(() => {
    const merged = {};
    Object.entries(seriesMap).forEach(([key, rows]) => {
      if (!rows.length) return;
      const base = rows[0].close;
      rows.forEach(r => {
        merged[r.date] = {
          ...merged[r.date],
          date: r.date,
          [key]: ((r.close - base) / base) * 100,
        };
      });
    });
    return Object.values(merged).sort((a, b) => a.date.localeCompare(b.date));
  }, [seriesMap]);

  return (
    <div>
      <div style={{ display: "flex", gap: 4, marginBottom: 10, alignItems: "center" }}>
        {RANGES.map(r => (
          <button
            key={r.label}
            className={`pill-button ${range === r.label ? "pill-button-active" : ""}`}
            style={{ padding: "3px 10px", fontSize: 11 }}
            onClick={() => onRangeChange(r.label)}
          >
            {r.label}
          </button>
        ))}
        {loading && (
          <span style={{ fontSize: 11, color: "var(--text-muted)", marginLeft: 6 }}>
            Loading…
          </span>
        )}
      </div>

      {chartData.length === 0 ? (
        <div style={{
          height: 200,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          border: "1px dashed var(--border)",
          borderRadius: "var(--radius)",
          color: "var(--text-muted)",
          fontSize: 12,
        }}>
          Search and select indices above to display a chart
        </div>
      ) : (
        <>
          <ResponsiveContainer width="100%" height={340}>
            <LineChart data={chartData}>
              <XAxis
                dataKey="date"
                tick={{ fontSize: 11, fill: "#6b7280" }}
                tickFormatter={v => {
                  const [y, m, d] = v.split("-");
                  return new Date(y, m - 1, d).toLocaleDateString("en-GB", {
                    day: "2-digit", month: "short", year: "2-digit",
                  });
                }}
                tickLine={false}
                axisLine={{ stroke: "#1f2937" }}
                interval={Math.floor(chartData.length / 6)}
              />
              <YAxis
                tickFormatter={v => `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`}
                tick={{ fontSize: 11, fill: "#6b7280" }}
                tickLine={false}
                axisLine={false}
                width={54}
              />
              <ReferenceLine
                y={0}
                stroke="#1f2937"
                strokeDasharray="4 4"
                strokeWidth={1}
              />
              <Tooltip content={<CustomTooltip labelMap={labelMap} />} />
              {Object.keys(seriesMap).map((key, i) => (
                <Line
                  key={key}
                  dataKey={key}
                  dot={false}
                  strokeWidth={1.5}
                  stroke={colorMap?.[key] ?? COLORS[i % COLORS.length]}
                  connectNulls
                />
              ))}
            </LineChart>
          </ResponsiveContainer>

          <MetricsTable seriesMap={seriesMap} indices={indices} colorMap={colorMap} />
        </>
      )}
    </div>
  );
}
