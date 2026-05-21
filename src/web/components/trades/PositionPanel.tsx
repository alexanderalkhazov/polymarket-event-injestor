"use client"

import { useState, useCallback } from "react"
import { showToast } from "@/components/ui/Toast"
import type { LivePosition } from "@/hooks/useTradesStream"

interface PositionPanelProps {
  position: LivePosition
  onAction: () => void
  onClose: () => void
}

function fmt(n: number, d = 2) {
  return n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d })
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: 9, fontWeight: 700, textTransform: "uppercase",
      letterSpacing: "0.1em", color: "var(--dim)", marginBottom: 4,
    }}>{children}</div>
  )
}

type Tab = "buy_more" | "sell_partial" | "close"

export function PositionPanel({ position: p, onAction, onClose }: PositionPanelProps) {
  const [tab, setTab] = useState<Tab>("buy_more")
  const [qty, setQty] = useState("")
  const [leverage, setLeverage] = useState<1 | 2 | 4>(1)
  const [orderType, setOrderType] = useState<"market" | "limit">("market")
  const [limitPrice, setLimitPrice] = useState("")
  const [stage, setStage] = useState<"idle" | "confirm" | "submitting">("idle")

  const up = p.unrealized_pl >= 0
  const plColor = up ? "var(--green)" : "var(--red)"

  const handleSubmit = useCallback(async () => {
    const qtyNum = parseFloat(qty)
    if (!qtyNum || qtyNum <= 0) { showToast("Enter a valid quantity"); return }
    if (tab === "sell_partial" && qtyNum > p.qty) { showToast(`Max ${p.qty} shares`); return }

    setStage("submitting")
    try {
      const body: Record<string, unknown> = { symbol: p.symbol }
      if (tab === "buy_more") {
        body.action    = "add_to_position"
        body.qty       = Math.round(qtyNum * leverage)
        body.order_type = orderType
        if (orderType === "limit" && limitPrice) body.limit_price = parseFloat(limitPrice)
      } else if (tab === "sell_partial") {
        body.action     = "sell_partial"
        body.qty        = qtyNum
        body.order_type = orderType
        if (orderType === "limit" && limitPrice) body.limit_price = parseFloat(limitPrice)
      } else {
        body.action = "close_position"
        body.qty    = p.qty
      }

      const res = await fetch("/api/trades", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      if (res.ok) {
        const data = await res.json() as { order_id?: string }
        showToast(`Order submitted (${data.order_id?.slice(0, 8) ?? "ok"})`)
        onAction()
        onClose()
      } else {
        const err = await res.json() as { error?: string }
        showToast(`Error: ${err.error ?? "unknown"}`)
        setStage("idle")
      }
    } catch {
      showToast("Network error")
      setStage("idle")
    }
  }, [tab, qty, leverage, orderType, limitPrice, p.symbol, p.qty, onAction, onClose])

  const tabStyle = (t: Tab): React.CSSProperties => ({
    flex: 1,
    padding: "7px 0",
    background: tab === t ? (t === "close" ? "var(--red)" : "var(--primary)") : "var(--bg3)",
    border: `1px solid ${tab === t ? (t === "close" ? "var(--red)" : "var(--primary)") : "var(--border)"}`,
    borderRadius: 8,
    fontSize: 12,
    fontWeight: tab === t ? 700 : 400,
    color: tab === t ? "#fff" : "var(--muted)",
    cursor: "pointer",
  })

  const estimatedCost = (() => {
    const q = parseFloat(qty) || 0
    if (tab === "buy_more") return q * leverage * p.current_price
    if (tab === "sell_partial") return q * p.current_price
    return p.market_value
  })()

  return (
    <div style={{
      background: "var(--bg2)",
      border: "1px solid var(--border)",
      borderRadius: 12,
      padding: "14px 16px",
      marginTop: 4,
    }}>
      {/* Real-time P/L header */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
        <div>
          <div style={{ fontSize: 9, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--dim)", marginBottom: 2 }}>
            Unrealized P/L
          </div>
          <div style={{ fontFamily: "var(--font-dm-mono)", fontSize: 20, fontWeight: 700, color: plColor }}>
            {up ? "+" : "−"}${fmt(Math.abs(p.unrealized_pl))}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 9, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--dim)", marginBottom: 2 }}>
            Return
          </div>
          <div style={{
            fontFamily: "var(--font-dm-mono)", fontSize: 16, fontWeight: 700, color: plColor,
            background: up ? "var(--green-bg)" : "var(--red-bg)",
            borderRadius: 6, padding: "1px 8px", display: "inline-block",
          }}>
            {up ? "+" : ""}{(p.unrealized_plpc * 100).toFixed(2)}%
          </div>
        </div>
        <div style={{ marginLeft: "auto", textAlign: "right" }}>
          <div style={{ fontSize: 9, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--dim)", marginBottom: 2 }}>
            Current / Avg
          </div>
          <div style={{ fontFamily: "var(--font-dm-mono)", fontSize: 13, fontWeight: 600 }}>
            ${fmt(p.current_price)} <span style={{ color: "var(--dim)" }}>/ ${fmt(p.avg_entry_price)}</span>
          </div>
        </div>
        <button
          onClick={onClose}
          style={{
            background: "var(--bg3)", border: "1px solid var(--border)",
            borderRadius: 7, width: 26, height: 26, cursor: "pointer",
            color: "var(--dim)", fontSize: 12, flexShrink: 0,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}
        >✕</button>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
        <button style={tabStyle("buy_more")} onClick={() => { setTab("buy_more"); setStage("idle") }}>
          + Buy More
        </button>
        <button style={tabStyle("sell_partial")} onClick={() => { setTab("sell_partial"); setStage("idle") }}>
          Sell Partial
        </button>
        <button style={tabStyle("close")} onClick={() => { setTab("close"); setStage("idle") }}>
          Close All
        </button>
      </div>

      {tab === "close" ? (
        <div>
          <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 12 }}>
            Close entire position of <strong style={{ fontFamily: "var(--font-dm-mono)" }}>{p.qty} shares</strong> at market price (~${fmt(p.market_value)}).
          </div>
          {stage === "idle" && (
            <button
              onClick={() => setStage("confirm")}
              style={{
                width: "100%", background: "var(--red-bg)",
                border: "1px solid rgba(220,38,38,0.3)",
                borderRadius: 9, padding: "10px 0",
                color: "var(--red)", fontWeight: 700, fontSize: 13, cursor: "pointer",
              }}
            >
              Close All ({p.qty} sh)
            </button>
          )}
          {stage === "confirm" && (
            <div style={{ display: "flex", gap: 8 }}>
              <button
                onClick={handleSubmit}
                style={{
                  flex: 1, background: "var(--red)", border: "none",
                  borderRadius: 9, padding: "10px 0",
                  color: "#fff", fontWeight: 700, fontSize: 13, cursor: "pointer",
                }}
              >
                Confirm Close
              </button>
              <button
                onClick={() => setStage("idle")}
                style={{
                  background: "var(--bg3)", border: "1px solid var(--border)",
                  borderRadius: 9, padding: "10px 16px",
                  color: "var(--muted)", cursor: "pointer", fontSize: 13,
                }}
              >
                Cancel
              </button>
            </div>
          )}
          {stage === "submitting" && (
            <div style={{ textAlign: "center", fontSize: 13, color: "var(--dim)", fontStyle: "italic" }}>
              Submitting…
            </div>
          )}
        </div>
      ) : (
        <div>
          {/* Qty + Order type */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
            <div>
              <Label>Shares</Label>
              <input
                type="number"
                min="1"
                step="1"
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                placeholder={tab === "sell_partial" ? `max ${p.qty}` : "0"}
                style={{
                  width: "100%", boxSizing: "border-box",
                  background: "var(--bg)", border: "1px solid var(--border)",
                  borderRadius: 8, padding: "7px 10px",
                  fontFamily: "var(--font-dm-mono)", fontSize: 14, fontWeight: 600,
                  color: "var(--text)", outline: "none",
                }}
              />
            </div>
            <div>
              <Label>Order type</Label>
              <div style={{ display: "flex", gap: 4 }}>
                {(["market", "limit"] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => setOrderType(t)}
                    style={{
                      flex: 1, padding: "7px 0",
                      background: orderType === t ? "var(--primary)" : "var(--bg3)",
                      border: `1px solid ${orderType === t ? "var(--primary)" : "var(--border)"}`,
                      borderRadius: 7, fontSize: 12,
                      fontWeight: orderType === t ? 700 : 400,
                      color: orderType === t ? "#fff" : "var(--muted)",
                      cursor: "pointer", textTransform: "capitalize",
                    }}
                  >{t}</button>
                ))}
              </div>
            </div>
          </div>

          {/* Limit price (shown only when limit selected) */}
          {orderType === "limit" && (
            <div style={{ marginBottom: 12 }}>
              <Label>Limit price (USD)</Label>
              <input
                type="number"
                step="0.01"
                value={limitPrice}
                onChange={(e) => setLimitPrice(e.target.value)}
                placeholder={`e.g. ${p.current_price.toFixed(2)}`}
                style={{
                  width: "100%", boxSizing: "border-box",
                  background: "var(--bg)", border: "1px solid var(--border)",
                  borderRadius: 8, padding: "7px 10px",
                  fontFamily: "var(--font-dm-mono)", fontSize: 14, fontWeight: 600,
                  color: "var(--text)", outline: "none",
                }}
              />
            </div>
          )}

          {/* Leverage (buy more only) */}
          {tab === "buy_more" && (
            <div style={{ marginBottom: 12 }}>
              <Label>Leverage</Label>
              <div style={{ display: "flex", gap: 4 }}>
                {([1, 2, 4] as const).map((x) => (
                  <button
                    key={x}
                    onClick={() => setLeverage(x)}
                    title={x === 1 ? "Cash only" : x === 2 ? "2× margin" : "4× intraday margin"}
                    style={{
                      flex: 1, padding: "6px 0",
                      background: leverage === x ? "rgba(124,58,237,0.18)" : "var(--bg3)",
                      border: `1px solid ${leverage === x ? "rgba(124,58,237,0.5)" : "var(--border)"}`,
                      borderRadius: 7, fontSize: 12, fontWeight: leverage === x ? 700 : 400,
                      color: leverage === x ? "#a78bfa" : "var(--muted)",
                      cursor: "pointer",
                    }}
                  >{x}×</button>
                ))}
              </div>
              {leverage > 1 && (
                <div style={{ fontSize: 10, color: "var(--amber)", marginTop: 4 }}>
                  ⚠ {leverage}× margin — amplifies both gains and losses. Ensure your account has margin enabled.
                </div>
              )}
            </div>
          )}

          {/* Summary row */}
          <div style={{
            display: "grid", gridTemplateColumns: "repeat(3, 1fr)",
            background: "var(--bg0)", border: "1px solid var(--border)",
            borderRadius: 9, overflow: "hidden", marginBottom: 12,
          }}>
            {[
              { label: "Shares", value: parseFloat(qty) > 0 ? `${tab === "buy_more" ? Math.round(parseFloat(qty) * leverage) : parseFloat(qty)} sh` : "—" },
              { label: "Est. Value", value: parseFloat(qty) > 0 ? `$${fmt(estimatedCost, 0)}` : "—" },
              { label: "Holding", value: `${fmt(p.qty)} sh → ${parseFloat(qty) > 0 ? fmt(tab === "buy_more" ? p.qty + Math.round(parseFloat(qty) * leverage) : p.qty - parseFloat(qty)) : "—"} sh` },
            ].map(({ label, value }, i, arr) => (
              <div key={label} style={{
                padding: "7px 10px",
                borderRight: i < arr.length - 1 ? "1px solid var(--border)" : "none",
              }}>
                <div style={{ fontSize: 9, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--dim)", marginBottom: 2 }}>
                  {label}
                </div>
                <div style={{ fontFamily: "var(--font-dm-mono)", fontSize: 12, fontWeight: 600, color: value === "—" ? "var(--dim)" : "var(--text)" }}>
                  {value}
                </div>
              </div>
            ))}
          </div>

          <button
            onClick={handleSubmit}
            disabled={stage === "submitting" || !qty || parseFloat(qty) <= 0}
            style={{
              width: "100%",
              background: stage === "submitting" ? "var(--bg3)" : (tab === "sell_partial" ? "var(--red)" : "var(--primary)"),
              border: "none", borderRadius: 9, padding: "11px 0",
              color: stage === "submitting" ? "var(--muted)" : "#fff",
              fontWeight: 700, fontSize: 13,
              cursor: stage === "submitting" || !qty || parseFloat(qty) <= 0 ? "not-allowed" : "pointer",
              opacity: !qty || parseFloat(qty) <= 0 ? 0.5 : 1,
            }}
          >
            {stage === "submitting"
              ? "Submitting…"
              : tab === "buy_more"
                ? `Buy ${parseFloat(qty) > 0 ? Math.round(parseFloat(qty) * leverage) : ""} more shares`
                : `Sell ${qty || ""} shares`}
          </button>
        </div>
      )}
    </div>
  )
}
