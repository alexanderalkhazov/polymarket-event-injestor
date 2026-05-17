"use client"

import { SectionLabel } from "@/components/ui/SectionLabel"

interface Position {
  symbol: string
  qty: number
  avg_entry_price: number
  current_price: number
  market_value: number
  unrealized_pl: number
  unrealized_plpc: number
  side: string
}

function fmt(n: number, d = 2) {
  return n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d })
}

export function PositionsTable({ positions }: { positions: Position[] }) {
  return (
    <div>
      <SectionLabel>Open positions</SectionLabel>
      <div style={{
        background: "var(--bg1)", borderRadius: 14,
        boxShadow: "var(--shadow-card)", overflow: "hidden",
      }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--border)", background: "var(--bg2)" }}>
              {["Symbol", "Side", "Qty", "Avg cost", "Current", "Mkt value", "P/L", "P/L %"].map((h) => (
                <th key={h} style={{
                  padding: "10px 14px", textAlign: "left",
                  fontSize: 10, textTransform: "uppercase", letterSpacing: "0.07em",
                  color: "var(--dim)", fontWeight: 500,
                }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {positions.map((p) => (
              <tr key={p.symbol} style={{ borderBottom: "1px solid var(--border)" }}>
                <td style={{ padding: "10px 14px", fontFamily: "var(--font-dm-mono)", fontWeight: 700, fontSize: 14 }}>
                  {p.symbol}
                </td>
                <td style={{ padding: "10px 14px" }}>
                  <span style={{
                    fontSize: 11, padding: "3px 8px", borderRadius: 5, fontWeight: 600,
                    background: p.side === "long" ? "var(--green-bg)" : "var(--red-bg)",
                    color: p.side === "long" ? "var(--green)" : "var(--red)",
                  }}>
                    {p.side.toUpperCase()}
                  </span>
                </td>
                <td style={{ padding: "10px 14px", fontFamily: "var(--font-dm-mono)", fontSize: 13 }}>{p.qty}</td>
                <td style={{ padding: "10px 14px", fontFamily: "var(--font-dm-mono)", fontSize: 13, color: "var(--muted)" }}>
                  ${fmt(p.avg_entry_price)}
                </td>
                <td style={{ padding: "10px 14px", fontFamily: "var(--font-dm-mono)", fontSize: 13 }}>
                  ${fmt(p.current_price)}
                </td>
                <td style={{ padding: "10px 14px", fontFamily: "var(--font-dm-mono)", fontSize: 13 }}>
                  ${fmt(p.market_value)}
                </td>
                <td style={{ padding: "10px 14px", fontFamily: "var(--font-dm-mono)", fontSize: 13, fontWeight: 600,
                  color: p.unrealized_pl >= 0 ? "var(--green)" : "var(--red)" }}>
                  {p.unrealized_pl >= 0 ? "+" : ""}${fmt(Math.abs(p.unrealized_pl))}
                </td>
                <td style={{ padding: "10px 14px", fontFamily: "var(--font-dm-mono)", fontSize: 13, fontWeight: 600,
                  color: p.unrealized_plpc >= 0 ? "var(--green)" : "var(--red)" }}>
                  {p.unrealized_plpc >= 0 ? "+" : ""}{(p.unrealized_plpc * 100).toFixed(2)}%
                </td>
              </tr>
            ))}
            {positions.length === 0 && (
              <tr>
                <td colSpan={8} style={{ padding: "32px 14px", textAlign: "center", color: "var(--muted)", fontSize: 13 }}>
                  No open positions
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
