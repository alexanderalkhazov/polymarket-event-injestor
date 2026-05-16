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
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
        <thead>
          <tr style={{ borderBottom: "1px solid var(--border)" }}>
            {["Symbol", "Side", "Qty", "Avg cost", "Current", "Mkt value", "P/L", "P/L %"].map((h) => (
              <th key={h} style={{
                padding: "5px 8px", textAlign: "left",
                fontSize: 9, textTransform: "uppercase", letterSpacing: "0.06em",
                color: "var(--dim)", fontWeight: 500,
              }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {positions.map((p) => (
            <tr key={p.symbol} style={{ borderBottom: "1px solid var(--border)" }}>
              <td style={{ padding: "8px", fontFamily: "var(--font-dm-mono)", fontWeight: 700 }}>{p.symbol}</td>
              <td style={{ padding: "8px" }}>
                <span style={{
                  fontSize: 10, padding: "2px 6px", borderRadius: 4,
                  background: p.side === "long" ? "rgba(0,200,100,0.1)" : "rgba(255,60,80,0.1)",
                  color: p.side === "long" ? "var(--green)" : "var(--red)",
                }}>
                  {p.side.toUpperCase()}
                </span>
              </td>
              <td style={{ padding: "8px", fontFamily: "var(--font-dm-mono)" }}>{p.qty}</td>
              <td style={{ padding: "8px", fontFamily: "var(--font-dm-mono)", color: "var(--muted)" }}>${fmt(p.avg_entry_price)}</td>
              <td style={{ padding: "8px", fontFamily: "var(--font-dm-mono)" }}>${fmt(p.current_price)}</td>
              <td style={{ padding: "8px", fontFamily: "var(--font-dm-mono)" }}>${fmt(p.market_value)}</td>
              <td style={{ padding: "8px", fontFamily: "var(--font-dm-mono)", color: p.unrealized_pl >= 0 ? "var(--green)" : "var(--red)" }}>
                {p.unrealized_pl >= 0 ? "+" : ""}${fmt(p.unrealized_pl)}
              </td>
              <td style={{ padding: "8px", fontFamily: "var(--font-dm-mono)", color: p.unrealized_plpc >= 0 ? "var(--green)" : "var(--red)" }}>
                {p.unrealized_plpc >= 0 ? "+" : ""}{(p.unrealized_plpc * 100).toFixed(2)}%
              </td>
            </tr>
          ))}
          {positions.length === 0 && (
            <tr>
              <td colSpan={8} style={{ padding: "24px 8px", textAlign: "center", color: "var(--muted)" }}>
                No open positions
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
