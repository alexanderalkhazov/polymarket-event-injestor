"use client"

import { SectionLabel } from "@/components/ui/SectionLabel"

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

function Stat({ label, value, color }: { label: string; value: string | null; color?: string }) {
  return (
    <div>
      <div style={{ fontSize: 9, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--dim)" }}>{label}</div>
      <div style={{ fontFamily: "var(--font-dm-mono)", fontSize: 13, color: color ?? "var(--text)" }}>
        {value ?? "—"}
      </div>
    </div>
  )
}

export function BacktestRow({ result, expanded, onToggle }: {
  result: BacktestResult
  expanded: boolean
  onToggle: () => void
}) {
  const wr = result.win_rate != null ? Math.round(result.win_rate * 100) : null
  const wrColor = wr == null ? "var(--muted)" : wr >= 60 ? "var(--green)" : wr >= 45 ? "var(--amber)" : "var(--red)"
  const passed = result.drop_reason == null

  return (
    <>
      <tr
        onClick={onToggle}
        style={{
          borderBottom: expanded ? "none" : "1px solid var(--border)",
          cursor: "pointer",
          background: expanded ? "var(--bg2)" : "transparent",
        }}
      >
        <td style={{ padding: "10px 10px", fontFamily: "var(--font-dm-mono)", fontWeight: 600 }}>
          {result.symbol}
        </td>
        <td style={{ padding: "10px 10px", color: "var(--muted)", fontSize: 12 }}>
          {(result.signal_type ?? "").replace(/_/g, " ")}
        </td>
        <td style={{ padding: "10px 10px" }}>
          <span style={{ fontFamily: "var(--font-dm-mono)", fontSize: 12, color: wrColor }}>
            {wr != null ? `${wr}%` : "—"}
          </span>
        </td>
        <td style={{ padding: "10px 10px", fontFamily: "var(--font-dm-mono)", fontSize: 12 }}>
          {result.avg_return_pct != null
            ? <span style={{ color: result.avg_return_pct >= 0 ? "var(--green)" : "var(--red)" }}>
                {result.avg_return_pct > 0 ? "+" : ""}{result.avg_return_pct}%
              </span>
            : "—"}
        </td>
        <td style={{ padding: "10px 10px", fontFamily: "var(--font-dm-mono)", fontSize: 12, color: "var(--dim)" }}>
          {result.sample_size ?? "—"}
        </td>
        <td style={{ padding: "10px 10px", fontFamily: "var(--font-dm-mono)", fontSize: 12, color: "var(--red)" }}>
          {result.max_drawdown_pct != null ? `${result.max_drawdown_pct}%` : "—"}
        </td>
        <td style={{ padding: "10px 10px" }}>
          <span style={{
            fontSize: 10, fontFamily: "var(--font-dm-mono)", padding: "2px 6px", borderRadius: 4,
            background: passed ? "rgba(0,200,100,0.1)" : "rgba(255,60,80,0.1)",
            color: passed ? "var(--green)" : "var(--red)",
          }}>
            {passed ? "passed" : "dropped"}
          </span>
        </td>
        <td style={{ padding: "10px 10px", fontSize: 10, color: "var(--dim)", textAlign: "right" }}>
          {new Date(result.created_at).toLocaleDateString()}
        </td>
      </tr>
      {expanded && (
        <tr style={{ borderBottom: "1px solid var(--border)" }}>
          <td colSpan={8} style={{ padding: "0 10px 16px", background: "var(--bg2)" }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginBottom: 16 }}>
              <Stat label="Sharpe ratio" value={result.sharpe != null ? Number(result.sharpe).toFixed(2) : null} />
              <Stat label="Win rate" value={wr != null ? `${wr}%` : null} color={wrColor} />
              <Stat label="Avg return" value={result.avg_return_pct != null ? `${result.avg_return_pct}%` : null} color="var(--green)" />
              <Stat label="Sample size" value={result.sample_size?.toString() ?? null} color="var(--muted)" />
            </div>
            {result.entry_dates?.length > 0 && (
              <div style={{ marginBottom: 12 }}>
                <SectionLabel>Entry dates</SectionLabel>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {result.entry_dates.slice(0, 10).map((d) => (
                    <span key={d} style={{
                      fontFamily: "var(--font-dm-mono)", fontSize: 10,
                      background: "var(--bg3)", border: "1px solid var(--border)",
                      borderRadius: 4, padding: "2px 8px", color: "var(--muted)",
                    }}>
                      {new Date(d).toLocaleDateString()}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {result.drop_reason && (
              <div style={{
                borderLeft: "2px solid var(--red)", paddingLeft: 10,
                fontSize: 11, color: "var(--muted)",
              }}>
                Drop reason: {result.drop_reason}
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  )
}
