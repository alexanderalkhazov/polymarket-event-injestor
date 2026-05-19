"use client"

import { useState } from "react"
import { SectionLabel } from "@/components/ui/SectionLabel"
import { showToast } from "@/components/ui/Toast"
import { PositionPanel } from "@/components/trades/PositionPanel"
import type { LivePosition } from "@/hooks/useTradesStream"

function fmt(n: number, d = 2) {
  return n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d })
}

type PanelTab = "buy_more" | "sell_partial" | "close"

function QuickButton({
  label,
  color,
  bgColor,
  onClick,
}: {
  label: string
  color: string
  bgColor: string
  onClick: (e: React.MouseEvent) => void
}) {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onClick(e) }}
      style={{
        background: bgColor, border: `1px solid ${color}33`,
        color, borderRadius: 6, padding: "3px 9px",
        fontSize: 10, fontWeight: 700, cursor: "pointer",
      }}
    >
      {label}
    </button>
  )
}

export function PositionsTable({
  positions,
  onMutate,
}: {
  positions: LivePosition[]
  onMutate?: () => void
}) {
  const [expanded, setExpanded] = useState<string | null>(null)
  const [initialTab, setInitialTab] = useState<PanelTab>("buy_more")

  // Legacy close-all (no panel) — kept for backward compat
  const [closing, setClosing] = useState<string | null>(null)

  const plTotal  = positions.reduce((s, p) => s + p.unrealized_pl, 0)
  const mktTotal = positions.reduce((s, p) => s + p.market_value, 0)

  const openPanel = (symbol: string, tab: PanelTab) => {
    setInitialTab(tab)
    setExpanded((cur) => (cur === symbol && initialTab === tab ? null : symbol))
  }

  const closeAll = async (symbol: string, qty: number) => {
    setClosing(symbol)
    try {
      const res = await fetch("/api/trades", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "close_position", symbol, qty }),
      })
      if (res.ok) {
        showToast(`Close order submitted for ${symbol}`)
        onMutate?.()
      } else {
        const err = await res.json() as { error?: string }
        showToast(`Error: ${err.error ?? "unknown"}`)
      }
    } catch {
      showToast("Network error")
    } finally {
      setClosing(null)
    }
  }

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
              {["Symbol", "Side", "Qty", "Avg cost", "Current", "Mkt value", "P/L", "P/L %", "Actions"].map((h) => (
                <th key={h} style={{
                  padding: "10px 14px", textAlign: h === "Actions" ? "right" : "left",
                  fontSize: 10, textTransform: "uppercase",
                  letterSpacing: "0.07em", color: "var(--dim)", fontWeight: 500,
                }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {positions.map((p) => {
              const up       = p.unrealized_pl >= 0
              const isOpen   = expanded === p.symbol
              const isClosed = closing === p.symbol

              return (
                <>
                  <tr
                    key={p.symbol}
                    onClick={() => openPanel(p.symbol, initialTab === "buy_more" || expanded !== p.symbol ? "buy_more" : initialTab)}
                    style={{
                      borderBottom: isOpen ? "none" : "1px solid var(--border)",
                      cursor: "pointer",
                      background: isOpen ? "var(--bg2)" : undefined,
                      transition: "background 0.1s",
                    }}
                  >
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
                      <div style={{ display: "flex", gap: 5, justifyContent: "flex-end", alignItems: "center" }}>
                        <QuickButton
                          label="+ Buy"
                          color="var(--primary)"
                          bgColor="rgba(59,130,246,0.1)"
                          onClick={() => openPanel(p.symbol, "buy_more")}
                        />
                        <QuickButton
                          label="Sell"
                          color="var(--amber)"
                          bgColor="var(--amber-bg)"
                          onClick={() => openPanel(p.symbol, "sell_partial")}
                        />
                        <QuickButton
                          label={isClosed ? "…" : "Close"}
                          color="var(--red)"
                          bgColor="var(--red-bg)"
                          onClick={() => closeAll(p.symbol, p.qty)}
                        />
                      </div>
                    </td>
                  </tr>
                  {isOpen && (
                    <tr key={`${p.symbol}-panel`} style={{ borderBottom: "1px solid var(--border)" }}>
                      <td colSpan={9} style={{ padding: "0 14px 12px" }}>
                        <PositionPanel
                          position={p}
                          onAction={() => onMutate?.()}
                          onClose={() => setExpanded(null)}
                        />
                      </td>
                    </tr>
                  )}
                </>
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
