"use client"

import { SectionLabel } from "@/components/ui/SectionLabel"

interface Trade {
  id: string
  symbol: string
  side: string
  qty: number
  fill_price: number
  status: string
  strategy_id: string | null
  executed_at: string
}

function fmt(n: number, d = 2) {
  return n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d })
}

export function ClosedTradesTable({ trades }: { trades: Trade[] }) {
  return (
    <div>
      <SectionLabel>Trade history</SectionLabel>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
        <thead>
          <tr style={{ borderBottom: "1px solid var(--border)" }}>
            {["Symbol", "Side", "Qty", "Fill price", "Status", "Strategy", "Time"].map((h) => (
              <th key={h} style={{
                padding: "5px 8px", textAlign: "left",
                fontSize: 9, textTransform: "uppercase", letterSpacing: "0.06em",
                color: "var(--dim)", fontWeight: 500,
              }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {trades.map((t) => (
            <tr key={t.id} style={{ borderBottom: "1px solid var(--border)" }}>
              <td style={{ padding: "8px", fontFamily: "var(--font-dm-mono)", fontWeight: 700 }}>{t.symbol}</td>
              <td style={{ padding: "8px" }}>
                <span style={{
                  fontSize: 10, padding: "2px 6px", borderRadius: 4,
                  background: t.side === "buy" ? "rgba(0,200,100,0.1)" : "rgba(255,60,80,0.1)",
                  color: t.side === "buy" ? "var(--green)" : "var(--red)",
                }}>
                  {t.side.toUpperCase()}
                </span>
              </td>
              <td style={{ padding: "8px", fontFamily: "var(--font-dm-mono)" }}>{t.qty}</td>
              <td style={{ padding: "8px", fontFamily: "var(--font-dm-mono)", color: "var(--muted)" }}>
                {t.fill_price ? `$${fmt(t.fill_price)}` : "—"}
              </td>
              <td style={{ padding: "8px" }}>
                <span style={{
                  fontSize: 10, fontFamily: "var(--font-dm-mono)",
                  color: t.status === "filled" ? "var(--green)" : t.status === "rejected" ? "var(--red)" : "var(--muted)",
                }}>
                  {t.status}
                </span>
              </td>
              <td style={{ padding: "8px", fontFamily: "var(--font-dm-mono)", fontSize: 10, color: "var(--dim)" }}>
                {t.strategy_id ? t.strategy_id.slice(0, 8) + "…" : "—"}
              </td>
              <td style={{ padding: "8px", fontFamily: "var(--font-dm-mono)", fontSize: 10, color: "var(--dim)" }}>
                {new Date(t.executed_at).toLocaleString()}
              </td>
            </tr>
          ))}
          {trades.length === 0 && (
            <tr>
              <td colSpan={7} style={{ padding: "24px 8px", textAlign: "center", color: "var(--muted)" }}>
                No trades yet
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
