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

function statusColor(s: string) {
  if (s === "filled") return "var(--green)"
  if (s === "rejected") return "var(--red)"
  return "var(--muted)"
}

export function ClosedTradesTable({ trades }: { trades: Trade[] }) {
  return (
    <div>
      <SectionLabel>Trade history</SectionLabel>
      <div style={{
        background: "var(--bg1)", borderRadius: 14,
        boxShadow: "var(--shadow-card)", overflow: "hidden",
      }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--border)", background: "var(--bg2)" }}>
              {["Symbol", "Side", "Qty", "Fill price", "Status", "Strategy", "Time"].map((h) => (
                <th key={h} style={{
                  padding: "10px 14px", textAlign: "left",
                  fontSize: 10, textTransform: "uppercase", letterSpacing: "0.07em",
                  color: "var(--dim)", fontWeight: 500,
                }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {trades.map((t) => (
              <tr key={t.id} style={{ borderBottom: "1px solid var(--border)" }}>
                <td style={{ padding: "10px 14px", fontFamily: "var(--font-dm-mono)", fontWeight: 700, fontSize: 14 }}>
                  {t.symbol}
                </td>
                <td style={{ padding: "10px 14px" }}>
                  <span style={{
                    fontSize: 11, padding: "3px 8px", borderRadius: 5, fontWeight: 600,
                    background: t.side === "buy" ? "var(--green-bg)" : "var(--red-bg)",
                    color: t.side === "buy" ? "var(--green)" : "var(--red)",
                  }}>
                    {t.side.toUpperCase()}
                  </span>
                </td>
                <td style={{ padding: "10px 14px", fontFamily: "var(--font-dm-mono)", fontSize: 13 }}>{t.qty}</td>
                <td style={{ padding: "10px 14px", fontFamily: "var(--font-dm-mono)", fontSize: 13, color: "var(--muted)" }}>
                  {t.fill_price ? `$${fmt(t.fill_price)}` : "—"}
                </td>
                <td style={{ padding: "10px 14px" }}>
                  <span style={{ fontSize: 11, fontFamily: "var(--font-dm-mono)", color: statusColor(t.status) }}>
                    {t.status}
                  </span>
                </td>
                <td style={{ padding: "10px 14px", fontFamily: "var(--font-dm-mono)", fontSize: 11, color: "var(--dim)" }}>
                  {t.strategy_id ? t.strategy_id.slice(0, 8) + "…" : "—"}
                </td>
                <td style={{ padding: "10px 14px", fontFamily: "var(--font-dm-mono)", fontSize: 11, color: "var(--dim)" }}>
                  {new Date(t.executed_at).toLocaleString()}
                </td>
              </tr>
            ))}
            {trades.length === 0 && (
              <tr>
                <td colSpan={7} style={{ padding: "32px 14px", textAlign: "center", color: "var(--muted)", fontSize: 13 }}>
                  No trades yet
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
