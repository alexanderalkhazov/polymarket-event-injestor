"use client"

import { useState, useRef, useEffect, useCallback } from "react"
import { showToast } from "@/components/ui/Toast"
import { useCountdown } from "@/hooks/useCountdown"
import type { Strategy } from "@/hooks/useStrategyStream"

interface DetailData {
  sizing_pct?: number | null
  stop_loss_pct?: number | null
  expected_return_pct?: number | null
}

interface AccountData {
  connected: boolean
  is_paper: boolean
  equity?: number
}

interface OrderEntryProps {
  strategy: Strategy
  detail: DetailData | null
  onDismiss: () => void
  onExecuted: () => void
}

const inputCss: React.CSSProperties = {
  background: "var(--bg)",
  border: "1px solid var(--border2)",
  borderRadius: 8, padding: "8px 11px",
  color: "var(--text)", fontSize: 13,
  fontFamily: "var(--font-dm-mono)",
  width: "100%", outline: "none",
  transition: "border-color 0.15s",
}

function NumInput({
  value, onChange, placeholder, color,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  color?: string
}) {
  return (
    <div style={{ position: "relative", flex: 1 }}>
      <span style={{
        position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)",
        color: "var(--dim)", fontSize: 12, pointerEvents: "none",
      }}>$</span>
      <input
        type="number" step="0.01" min="0"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder ?? "0.00"}
        style={{ ...inputCss, paddingLeft: 22, color: color ?? "var(--text)" }}
      />
    </div>
  )
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: 9, textTransform: "uppercase", letterSpacing: "0.09em",
      color: "var(--dim)", fontWeight: 700, marginBottom: 5,
    }}>
      {children}
    </div>
  )
}

function Toggle({ on, color, onClick }: { on: boolean; color: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        background: on ? `${color}18` : "var(--bg3)",
        border: `1px solid ${on ? `${color}44` : "var(--border)"}`,
        borderRadius: 20, padding: "2px 10px",
        fontSize: 10, fontWeight: 700, letterSpacing: "0.05em",
        color: on ? color : "var(--dim)",
        cursor: "pointer", transition: "all 0.15s",
        userSelect: "none",
      }}
    >
      {on ? "ON" : "OFF"}
    </button>
  )
}

export function OrderEntry({ strategy: s, detail, onDismiss, onExecuted }: OrderEntryProps) {
  const timeLeft = useCountdown(s.expires_at)

  const [account, setAccount] = useState<AccountData | null>(null)
  const [quotePrice, setQuotePrice] = useState<number | null>(null)
  const [loadingData, setLoadingData] = useState(true)

  const [orderType, setOrderType] = useState<"market" | "limit">("market")
  const [limitPrice, setLimitPrice] = useState("")
  const [stopEnabled, setStopEnabled] = useState(true)
  const [stopPrice, setStopPrice] = useState("")
  const [tpEnabled, setTpEnabled] = useState(true)
  const [tpPrice, setTpPrice] = useState("")

  // Hold-to-execute state — RAF-driven smooth fill
  const [holdPct, setHoldPct] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const rafRef  = useRef<number | null>(null)
  const startTs = useRef(0)
  const HOLD_MS = 2500

  const ticker    = (s.tickers ?? [])[0] ?? ""
  const stopFrac  = s.stop_loss_pct ?? detail?.stop_loss_pct ?? null
  const expRet    = s.expected_return_pct ?? detail?.expected_return_pct ?? null
  const sizingPct = s.sizing_pct ?? detail?.sizing_pct ?? 0.03

  useEffect(() => {
    ;(async () => {
      setLoadingData(true)
      try {
        const [acctRes, quoteRes] = await Promise.all([
          fetch("/api/trades?type=account").then((r) => r.json()),
          ticker
            ? fetch(`/api/trades?type=quote&symbol=${encodeURIComponent(ticker)}`).then((r) => r.json())
            : Promise.resolve({ price: null }),
        ])
        setAccount(acctRes)
        const price: number | null = quoteRes.price ?? null
        setQuotePrice(price)
        if (price) {
          if (stopFrac) setStopPrice((price * (1 - stopFrac)).toFixed(2))
          if (expRet)   setTpPrice((price * (1 + expRet / 100)).toFixed(2))
        }
      } catch { /* leave null — UI shows "—" */ }
      finally { setLoadingData(false) }
    })()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticker])

  const equity        = account?.equity ?? 0
  const positionSize  = equity * sizingPct
  const effectivePrice = orderType === "limit" && limitPrice ? parseFloat(limitPrice) : quotePrice
  const qty           = effectivePrice && effectivePrice > 0 ? Math.floor(positionSize / effectivePrice) : null
  const estimatedCost = qty && effectivePrice ? qty * effectivePrice : null

  const handleExecute = useCallback(async () => {
    setHoldPct(0)
    setSubmitting(true)
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const body: Record<string, any> = { strategy_id: s.id, confirmed: true, order_type: orderType }
      if (orderType === "limit" && limitPrice)     body.limit_price        = parseFloat(limitPrice)
      if (stopEnabled && stopPrice)                body.stop_loss_price    = parseFloat(stopPrice)
      if (tpEnabled && tpPrice)                   body.take_profit_price  = parseFloat(tpPrice)

      const res = await fetch("/api/trades", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      if (res.ok) {
        const data = await res.json()
        showToast(`✓ Order submitted — ${data.qty} shares @ ~$${effectivePrice?.toFixed(2) ?? "mkt"}`)
        onExecuted()
      } else {
        const err = await res.json()
        showToast(`Error: ${err.error}`)
      }
    } catch {
      showToast("Network error — order not submitted")
    } finally {
      setSubmitting(false)
    }
  }, [s.id, orderType, limitPrice, stopEnabled, stopPrice, tpEnabled, tpPrice, effectivePrice, onExecuted])

  const startHold = useCallback(() => {
    if (submitting || !account?.connected) return
    startTs.current = performance.now()
    const tick = (now: number) => {
      const pct = Math.min((now - startTs.current) / HOLD_MS, 1)
      setHoldPct(pct)
      if (pct < 1) {
        rafRef.current = requestAnimationFrame(tick)
      } else {
        handleExecute()
      }
    }
    rafRef.current = requestAnimationFrame(tick)
  }, [submitting, account?.connected, handleExecute])

  const cancelHold = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    if (!submitting) setHoldPct(0)
  }, [submitting])

  const handleDismiss = async () => {
    try {
      await fetch("/api/strategies", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: s.id, status: "dismissed" }),
      })
    } catch { /* best-effort */ }
    showToast("Strategy dismissed")
    onDismiss()
  }

  const isPaper   = account?.is_paper !== false
  const connected = account?.connected ?? false
  const btnColor  = isPaper ? "#2563eb" : "var(--green)"
  const btnLabel  = submitting ? "Submitting…" : isPaper ? "Execute · Paper" : "Execute · LIVE"

  return (
    <div style={{
      borderTop: "1px solid var(--border)", background: "var(--bg1)",
      flexShrink: 0,
    }}>
      {/* Top meta bar */}
      <div style={{
        display: "flex", alignItems: "center", gap: 8,
        padding: "10px 20px",
        borderBottom: "1px solid var(--border)",
        background: "var(--bg2)",
      }}>
        <span style={{ fontSize: 11, color: "var(--dim)" }}>⏱ Expires in</span>
        <span style={{ fontFamily: "var(--font-dm-mono)", fontSize: 11, color: "var(--amber)", fontWeight: 600 }}>
          {timeLeft}
        </span>
        <div style={{ flex: 1 }} />
        {!loadingData && connected && (
          <span style={{
            fontSize: 10, fontWeight: 700, letterSpacing: "0.07em",
            color: isPaper ? "var(--blue)" : "var(--green)",
            background: isPaper ? "var(--blue-bg)" : "var(--green-bg)",
            border: `1px solid ${isPaper ? "rgba(37,99,235,0.25)" : "rgba(5,150,105,0.25)"}`,
            borderRadius: 10, padding: "1px 8px",
          }}>
            {isPaper ? "PAPER" : "LIVE"}
          </span>
        )}
        {!loadingData && !connected && (
          <span style={{ fontSize: 11, color: "var(--amber)", fontWeight: 500 }}>
            ⚠ Alpaca not connected
          </span>
        )}
      </div>

      <div style={{ padding: "14px 20px" }}>
        {/* Order type + limit price row */}
        <div style={{ display: "flex", gap: 12, marginBottom: 13, alignItems: "flex-end" }}>
          <div style={{ flexShrink: 0 }}>
            <FieldLabel>Order type</FieldLabel>
            <div style={{ display: "flex", gap: 4 }}>
              {(["market", "limit"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setOrderType(t)}
                  style={{
                    background: orderType === t ? "var(--primary)" : "var(--bg2)",
                    border: `1px solid ${orderType === t ? "var(--primary)" : "var(--border)"}`,
                    borderRadius: 7, padding: "6px 13px",
                    fontSize: 12, fontWeight: orderType === t ? 600 : 400,
                    color: orderType === t ? "#fff" : "var(--muted)",
                    cursor: "pointer", textTransform: "capitalize",
                    transition: "all 0.1s",
                  }}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>
          {orderType === "limit" && (
            <div style={{ flex: 1 }}>
              <FieldLabel>Limit price</FieldLabel>
              <NumInput
                value={limitPrice}
                onChange={setLimitPrice}
                placeholder={quotePrice?.toFixed(2) ?? "0.00"}
              />
            </div>
          )}
        </div>

        {/* Stop loss + Take profit row */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 13 }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", marginBottom: 5 }}>
              <FieldLabel>Stop loss</FieldLabel>
              <div style={{ flex: 1 }} />
              <Toggle on={stopEnabled} color="var(--red)" onClick={() => setStopEnabled(!stopEnabled)} />
            </div>
            {stopEnabled ? (
              <NumInput
                value={stopPrice}
                onChange={setStopPrice}
                placeholder={
                  quotePrice && stopFrac
                    ? (quotePrice * (1 - stopFrac)).toFixed(2)
                    : "0.00"
                }
                color="var(--red)"
              />
            ) : (
              <div style={{
                height: 37, display: "flex", alignItems: "center",
                fontSize: 12, color: "var(--dim)",
              }}>
                Disabled
              </div>
            )}
          </div>
          <div>
            <div style={{ display: "flex", alignItems: "center", marginBottom: 5 }}>
              <FieldLabel>Take profit</FieldLabel>
              <div style={{ flex: 1 }} />
              <Toggle on={tpEnabled} color="var(--green)" onClick={() => setTpEnabled(!tpEnabled)} />
            </div>
            {tpEnabled ? (
              <NumInput
                value={tpPrice}
                onChange={setTpPrice}
                placeholder={
                  quotePrice && expRet
                    ? (quotePrice * (1 + expRet / 100)).toFixed(2)
                    : "0.00"
                }
                color="var(--green)"
              />
            ) : (
              <div style={{
                height: 37, display: "flex", alignItems: "center",
                fontSize: 12, color: "var(--dim)",
              }}>
                Disabled
              </div>
            )}
          </div>
        </div>

        {/* Position estimate */}
        <div style={{
          display: "grid", gridTemplateColumns: "repeat(4, 1fr)",
          background: "var(--bg2)", border: "1px solid var(--border)",
          borderRadius: 10, overflow: "hidden", marginBottom: 13,
        }}>
          {[
            { label: "EQUITY",   value: equity > 0 ? `$${Math.round(equity).toLocaleString()}` : "—" },
            { label: "ALLOC",    value: equity > 0 ? `${(sizingPct * 100).toFixed(0)}%` : "—" },
            { label: ticker || "PRICE", value: quotePrice ? `$${quotePrice.toFixed(2)}` : loadingData ? "…" : "—" },
            { label: "QTY",      value: qty ? `${qty} sh` : "—" },
          ].map(({ label, value }, i, arr) => (
            <div key={label} style={{
              padding: "8px 10px",
              borderRight: i < arr.length - 1 ? "1px solid var(--border)" : "none",
            }}>
              <div style={{
                fontSize: 9, textTransform: "uppercase", letterSpacing: "0.08em",
                color: "var(--dim)", marginBottom: 3, fontWeight: 600,
              }}>
                {label}
              </div>
              <div style={{
                fontFamily: "var(--font-dm-mono)", fontSize: 12, fontWeight: 600,
                color: value === "—" || value === "…" ? "var(--dim)" : "var(--text)",
              }}>
                {value}
              </div>
            </div>
          ))}
        </div>

        {/* Estimated cost + execute */}
        <div style={{ display: "flex", gap: 8, alignItems: "stretch" }}>
          {/* Dismiss */}
          <button
            onClick={handleDismiss}
            disabled={submitting}
            style={{
              flexShrink: 0,
              background: "var(--bg2)", border: "1px solid var(--border2)",
              borderRadius: 10, padding: "0 18px",
              color: "var(--muted)", cursor: submitting ? "not-allowed" : "pointer",
              fontSize: 13, fontWeight: 500, opacity: submitting ? 0.5 : 1,
              transition: "opacity 0.1s",
            }}
          >
            Dismiss
          </button>

          {/* Hold-to-execute — smooth fill */}
          <button
            onMouseDown={startHold}
            onMouseUp={cancelHold}
            onMouseLeave={cancelHold}
            onTouchStart={startHold}
            onTouchEnd={cancelHold}
            disabled={!connected || submitting}
            title={!connected ? "Connect Alpaca in Settings to execute" : "Hold to execute"}
            style={{
              position: "relative", flex: 1, overflow: "hidden",
              background: submitting ? "var(--bg3)" : btnColor,
              border: "none", borderRadius: 10, padding: "12px 0",
              color: submitting ? "var(--muted)" : "#fff",
              cursor: connected && !submitting ? "pointer" : "not-allowed",
              fontWeight: 700, fontSize: 13,
              opacity: !connected ? 0.45 : 1,
              userSelect: "none", transition: "background 0.15s",
            }}
          >
            {/* Progress fill overlay */}
            {holdPct > 0 && (
              <div style={{
                position: "absolute", inset: 0, left: 0, top: 0,
                width: `${holdPct * 100}%`, height: "100%",
                background: "rgba(255,255,255,0.22)",
                pointerEvents: "none",
                transition: "none",
              }} />
            )}
            <span style={{ position: "relative" }}>
              {submitting ? "Submitting…" : holdPct > 0 ? `Hold… ${Math.round(holdPct * 100)}%` : btnLabel}
            </span>
          </button>
        </div>

        {estimatedCost != null && (
          <div style={{
            marginTop: 8, textAlign: "center",
            fontSize: 11, color: "var(--dim)",
            fontFamily: "var(--font-dm-mono)",
          }}>
            Est. cost ~${estimatedCost.toLocaleString("en-US", { maximumFractionDigits: 0 })}
            {stopEnabled && stopPrice && expRet && stopFrac ? (
              <span>  ·  R/R 1:{(expRet / (stopFrac * 100)).toFixed(1)}</span>
            ) : null}
          </div>
        )}
      </div>
    </div>
  )
}
