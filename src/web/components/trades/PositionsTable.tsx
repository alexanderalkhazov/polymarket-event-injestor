"use client"

import { useState } from "react"
import { SectionLabel } from "@/components/ui/SectionLabel"
import { showToast } from "@/components/ui/Toast"

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

function CloseButton({ symbol, qty, onClosed }: { symbol: string; qty: number; onClosed: () => void }) {
  const [stage, setStage] = useState<"idle" | "confirm" | "closing">("idle")

  const handleClose = async () => {
    setStage("closing")
    try {
      const res = await fetch("/api/trades", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "close_position", symbol, qty }),
      })
      if (res.ok) {
        showToast(`Close order submitted for ${symbol}`)
        onClosed()
      } else {
        const err = await res.json()
        showToast(`Error: ${err.error}`)
        setStage("idle")
      }
    } catch {
      showToast("Network error")
      setStage("idle")
    }
  }

  if (stage === "idle") {
    return (
      <button
        onClick={() => setStage("confirm")}
        style={{
          background: "var(--red-bg)", border: "1px solid rgba(220,38,38,0.25)",
          color: "var(--red)", borderRadius: 7, padding: "4px 10px",
          fontSize: 11, fontWeight: 600, cursor: "pointer",
        }}
      >
        Close
      </button>
    )
  }

  if (stage === "confirm") {
    return (
      <div style={{ display: "flex", gap: 5 }}>
        <button
          onClick={handleClose}
          style={{
            background: "var(--red)", border: "none",
            color: "#fff", borderRadius: 7, padding: "4px 10px",
            fontSize: 11, fontWeight: 700, cursor: "pointer",
          }}
        >
          Confirm
        </button>
        <button
          onClick={() => setStage("idle")}
          style={{
            background: "var(--bg3)", border: "1px solid var(--border)",
            color: "var(--muted)", borderRadius: 7, padding: "4px 8px",
            fontSize: 11, cursor: "pointer",
          }}
        >
          ✕
        </button>
      </div>
    )
  }

  return (
    <span style={{ fontSize: 11, color: "var(--dim)", fontStyle: "italic" }}>Closing…</span>
  )
}

export function PositionsTable({
  positions,
  onMutate,
}: {
  positions: Position[]
  onMutate?: () => void
}) {
  const plTotal   = positions.reduce((s, p) => s + p.unrealized_pl, 0)
  const mktTotal  = positions.reduce((s, p) => s + p.market_value, 0)

  return (
    <div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 10 }}>
        <SectionLabel>Open positions</SectionLabel>
        {positions.length > 0 && (
          <span style={{ fontFamily: "var(--font-dm-mono)", fontSize: 11, color: "var(--dim)" }}>
            {positions.length} position{positions.length !== 1 ? "s" : ""} ·{" "}
            mkt ${fmt(mktTotal, 0)} ·{" "}
            <span style={{ color: plTotal >= 0 ? "var(--green)" : "var(--red)", fontWeight: 600 }}>
              {plTotal >= 0 ? "+" : "−"}${fmt(Math.abs(plTotal))} unrealized
            </span>
          </span>
        )}
      </div>

      <div style={{
        background: "var(--bg1)", borderRadius: 14,
        boxShadow: "var(--shadow-card)", overflow: "hidden",
        border: "1px solid var(--border)",
      }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: "var(--bg2)", borderBottom: "1px solid var(--border)" }}>
              {["Symbol", "Side", "Qty", "Avg cost", "Current", "Mkt value", "P/L", "P/L %", ""].map((h) => (
                <th key={h} style={{
                  padding: "10px 14px", textAlign: "left",
                  fontSize: 10, textTransform: "uppercase",
                  letterSpacing: "0.07em", color: "var(--dim)", fontWeight: 500,
                }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {positions.map((p) => {
              const up = p.unrealized_pl >= 0
              return (
                <tr key={p.symbol} style={{ borderBottom: "1px solid var(--border)" }}>
                  <td style={{
                    padding: "11px 14px",
                    fontFamily: "var(--font-dm-mono)", fontWeight: 700, fontSize: 14,
                  }}>
                    {p.symbol}
                  </td>
                  <td style={{ padding: "11px 14px" }}>
                    <span style={{
                      fontSize: 10, padding: "2px 7px", borderRadius: 5, fontWeight: 700,
                      letterSpacing: "0.06em",
                      background: p.side === "long" ? "var(--green-bg)" : "var(--red-bg)",
                      color: p.side === "long" ? "var(--green)" : "var(--red)",
                    }}>
                      {p.side.toUpperCase()}
                    </span>
                  </td>
                  <td style={{ padding: "11px 14px", fontFamily: "var(--font-dm-mono)", fontSize: 13 }}>
                    {p.qty}
                  </td>
                  <td style={{ padding: "11px 14px", fontFamily: "var(--font-dm-mono)", fontSize: 13, color: "var(--muted)" }}>
                    ${fmt(p.avg_entry_price)}
                  </td>
                  <td style={{ padding: "11px 14px", fontFamily: "var(--font-dm-mono)", fontSize: 13 }}>
                    ${fmt(p.current_price)}
                  </td>
                  <td style={{ padding: "11px 14px", fontFamily: "var(--font-dm-mono)", fontSize: 13 }}>
                    ${fmt(p.market_value)}
                  </td>
                  <td style={{
                    padding: "11px 14px",
                    fontFamily: "var(--font-dm-mono)", fontSize: 13, fontWeight: 600,
                    color: up ? "var(--green)" : "var(--red)",
                  }}>
                    {up ? "+" : "−"}${fmt(Math.abs(p.unrealized_pl))}
                  </td>
                  <td style={{
                    padding: "11px 14px",
                    fontFamily: "var(--font-dm-mono)", fontSize: 13, fontWeight: 600,
                    color: up ? "var(--green)" : "var(--red)",
                  }}>
                    <span style={{
                      background: up ? "var(--green-bg)" : "var(--red-bg)",
                      borderRadius: 5, padding: "2px 6px",
                    }}>
                      {up ? "+" : ""}{(p.unrealized_plpc * 100).toFixed(2)}%
                    </span>
                  </td>
                  <td style={{ padding: "11px 14px", textAlign: "right" }}>
                    <CloseButton
                      symbol={p.symbol}
                      qty={p.qty}
                      onClosed={() => onMutate?.()}
                    />
                  </td>
                </tr>
              )
            })}
            {positions.length === 0 && (
              <tr>
                <td colSpan={9} style={{
                  padding: "40px 14px", textAlign: "center",
                  color: "var(--dim)", fontSize: 13,
                }}>
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
