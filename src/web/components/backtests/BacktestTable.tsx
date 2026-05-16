"use client"

import { useState } from "react"
import { BacktestRow } from "@/components/backtests/BacktestRow"

interface BacktestResult {
  id: string
  signal_type: string
  symbol: string
  win_rate: number | null
  avg_return_pct: number | null
  sample_size: number | null
  max_drawdown_pct: number | null
  sharpe: number | null
  drop_reason: string | null
  entry_dates: string[]
  created_at: string
}

type SortKey = "symbol" | "win_rate" | "avg_return_pct" | "sample_size" | "created_at"

const HEADERS: { key: SortKey; label: string }[] = [
  { key: "symbol", label: "Symbol" },
  { key: "signal_type" as SortKey, label: "Signal type" },
  { key: "win_rate", label: "Win rate" },
  { key: "avg_return_pct", label: "Avg return" },
  { key: "sample_size", label: "Sample" },
  { key: "max_drawdown_pct" as SortKey, label: "Max DD" },
  { key: "created_at", label: "Status" },
  { key: "created_at", label: "Date" },
]

export function BacktestTable({ results }: { results: BacktestResult[] }) {
  const [sortKey, setSortKey] = useState<SortKey>("created_at")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc")
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const sorted = [...results].sort((a, b) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const av = (a as any)[sortKey] ?? 0
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bv = (b as any)[sortKey] ?? 0
    const cmp = av < bv ? -1 : av > bv ? 1 : 0
    return sortDir === "asc" ? cmp : -cmp
  })

  const handleSort = (key: SortKey) => {
    if (key === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"))
    else { setSortKey(key); setSortDir("desc") }
  }

  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
        <thead>
          <tr style={{ borderBottom: "1px solid var(--border)" }}>
            {HEADERS.map((h, i) => (
              <th
                key={`${h.key}-${i}`}
                onClick={() => handleSort(h.key)}
                style={{
                  padding: "6px 10px", textAlign: "left",
                  fontSize: 9, textTransform: "uppercase", letterSpacing: "0.06em",
                  color: sortKey === h.key ? "var(--text)" : "var(--dim)",
                  cursor: "pointer", userSelect: "none", fontWeight: 500,
                }}
              >
                {h.label} {sortKey === h.key ? (sortDir === "desc" ? "↓" : "↑") : ""}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <BacktestRow
              key={r.id}
              result={r}
              expanded={expandedId === r.id}
              onToggle={() => setExpandedId(expandedId === r.id ? null : r.id)}
            />
          ))}
        </tbody>
      </table>
      {results.length === 0 && (
        <div style={{ textAlign: "center", padding: "40px 0", fontSize: 13, color: "var(--muted)" }}>
          No backtest results yet.
        </div>
      )}
    </div>
  )
}
