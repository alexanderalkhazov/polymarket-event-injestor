"use client"

import { useState } from "react"
import { SectionLabel } from "@/components/ui/SectionLabel"
import { showToast } from "@/components/ui/Toast"

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

const CANCELLABLE = new Set(["new", "accepted", "pending_new", "accepted_for_bidding", "partially_filled"])

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

export function AlpacaOrdersTable({ orders, onMutate }: { orders: AlpacaOrder[]; onMutate?: () => void }) {
  const [cancelling, setCancelling] = useState<string | null>(null)

  const cancel = async (orderId: string, symbol: string) => {
    setCancelling(orderId)
    try {
      const res = await fetch("/api/trades", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cancel_order", alpaca_order_id: orderId }),
      })
      if (res.ok) {
        showToast(`Order cancelled — ${symbol}`)
        onMutate?.()
      } else {
        const err = await res.json() as { error?: string }
        showToast(`Error: ${err.error ?? "cancel failed"}`)
      }
    } catch {
      showToast("Network error")
    } finally {
      setCancelling(null)
    }
  }

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
              {["Symbol", "Side", "Type", "Qty", "Filled", "Avg Price", "Status", "Submitted", ""].map((h) => (
                <th key={h} style={{
                  padding: "10px 14px", textAlign: h === "" ? "right" : "left",
                  fontSize: 10, textTransform: "uppercase", letterSpacing: "0.07em",
                  color: "var(--dim)", fontWeight: 500,
                }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => {
              const canCancel = CANCELLABLE.has(o.status)
              return (
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
                  <td style={{ padding: "10px 14px", textAlign: "right" }}>
                    {canCancel && (
                      <button
                        onClick={() => cancel(o.id, o.symbol)}
                        disabled={cancelling === o.id}
                        style={{
                          background: "var(--red-bg)", border: "1px solid rgba(220,38,38,0.3)",
                          color: "var(--red)", borderRadius: 6,
                          padding: "3px 10px", fontSize: 11, fontWeight: 700,
                          cursor: cancelling === o.id ? "not-allowed" : "pointer",
                          opacity: cancelling === o.id ? 0.5 : 1,
                        }}
                      >
                        {cancelling === o.id ? "…" : "Cancel"}
                      </button>
                    )}
                  </td>
                </tr>
              )
            })}
            {orders.length === 0 && (
              <tr>
                <td colSpan={9} style={{ padding: "32px 14px", textAlign: "center", color: "var(--muted)", fontSize: 13 }}>
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
