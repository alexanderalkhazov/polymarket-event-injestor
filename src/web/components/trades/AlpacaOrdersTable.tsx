"use client"

import { SectionLabel } from "@/components/ui/SectionLabel"

interface AlpacaOrder {
  id: string
  symbol: string
  side: string
  qty: string
  filled_qty: string
  type: string
  status: string
  filled_avg_price: string | null
  submitted_at: string
  filled_at: string | null
}

function fmt(n: string | null) {
  if (!n) return "—"
  return parseFloat(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function statusColor(s: string) {
  if (s === "filled") return "var(--green)"
  if (s === "canceled" || s === "rejected" || s === "expired") return "var(--red)"
  if (s === "partially_filled" || s === "pending_new") return "var(--amber)"
  return "var(--muted)"
}

export function AlpacaOrdersTable({ orders }: { orders: AlpacaOrder[] }) {
  return (
    <div>
      <SectionLabel>Alpaca orders</SectionLabel>
      <div style={{
        background: "var(--bg1)", borderRadius: 14,
        boxShadow: "var(--shadow-card)", overflow: "hidden",
      }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--border)", background: "var(--bg2)" }}>
              {["Symbol", "Side", "Type", "Qty", "Filled", "Avg Price", "Status", "Submitted"].map((h) => (
                <th key={h} style={{
                  padding: "10px 14px", textAlign: "left",
                  fontSize: 10, textTransform: "uppercase", letterSpacing: "0.07em",
                  color: "var(--dim)", fontWeight: 500,
                }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => (
              <tr key={o.id} style={{ borderBottom: "1px solid var(--border)" }}>
                <td style={{ padding: "10px 14px", fontFamily: "var(--font-dm-mono)", fontWeight: 700, fontSize: 14 }}>
                  {o.symbol}
                </td>
                <td style={{ padding: "10px 14px" }}>
                  <span style={{
                    fontSize: 11, padding: "3px 8px", borderRadius: 5, fontWeight: 600,
                    background: o.side === "buy" ? "var(--green-bg)" : "var(--red-bg)",
                    color: o.side === "buy" ? "var(--green)" : "var(--red)",
                  }}>
                    {o.side.toUpperCase()}
                  </span>
                </td>
                <td style={{ padding: "10px 14px", fontSize: 13, color: "var(--muted)", textTransform: "capitalize" }}>
                  {o.type.replace(/_/g, " ")}
                </td>
                <td style={{ padding: "10px 14px", fontFamily: "var(--font-dm-mono)", fontSize: 13 }}>
                  {o.qty}
                </td>
                <td style={{ padding: "10px 14px", fontFamily: "var(--font-dm-mono)", fontSize: 13, color: "var(--muted)" }}>
                  {o.filled_qty}
                </td>
                <td style={{ padding: "10px 14px", fontFamily: "var(--font-dm-mono)", fontSize: 13 }}>
                  {o.filled_avg_price ? `$${fmt(o.filled_avg_price)}` : "—"}
                </td>
                <td style={{ padding: "10px 14px" }}>
                  <span style={{
                    fontSize: 11, fontFamily: "var(--font-dm-mono)",
                    color: statusColor(o.status), textTransform: "capitalize",
                  }}>
                    {o.status.replace(/_/g, " ")}
                  </span>
                </td>
                <td style={{ padding: "10px 14px", fontFamily: "var(--font-dm-mono)", fontSize: 11, color: "var(--dim)" }}>
                  {new Date(o.submitted_at).toLocaleString()}
                </td>
              </tr>
            ))}
            {orders.length === 0 && (
              <tr>
                <td colSpan={8} style={{ padding: "32px 14px", textAlign: "center", color: "var(--muted)", fontSize: 13 }}>
                  No orders found
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
