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
  return new Date(str).toLocaleDateString("en-GB", {
    day: "2-digit", month: "short", year: "numeric",
  });
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
        <ResponsiveContainer width="100%" height={340}>
          <LineChart data={chartData}>
            <XAxis
              dataKey="date"
              tick={{ fontSize: 11, fill: "#6b7280" }}
              tickFormatter={v => new Date(v).toLocaleDateString("en-GB", {
                day: "2-digit", month: "short", year: "2-digit",
              })}
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
      )}
    </div>
  );
}
