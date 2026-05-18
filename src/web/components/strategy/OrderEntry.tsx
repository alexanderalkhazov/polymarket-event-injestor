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

interface AccountData { connected: boolean; is_paper: boolean; equity?: number }

interface OrderEntryProps {
  strategy: Strategy
  detail: DetailData | null
  onDismiss: () => void
  onExecuted: () => void
}

const STEP = 0.25  // minimum tick step (pts)
const HOLD_MS = 2500

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: 9, fontWeight: 700, textTransform: "uppercase",
      letterSpacing: "0.1em", color: "var(--dim)", marginBottom: 4,
    }}>
      {children}
    </div>
  )
}

function Mono({ children, color, size }: { children: React.ReactNode; color?: string; size?: number }) {
  return (
    <span style={{ fontFamily: "var(--font-dm-mono)", fontSize: size ?? 13, fontWeight: 600, color: color ?? "var(--text)" }}>
      {children}
    </span>
  )
}

/** Stepper for pts with − / + buttons */
function PtsStepper({
  value, onChange, color, min = STEP,
}: {
  value: number; onChange: (v: number) => void; color: string; min?: number
}) {
  const dec = () => onChange(Math.max(min, parseFloat((value - STEP).toFixed(2))))
  const inc = () => onChange(parseFloat((value + STEP).toFixed(2)))
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 0 }}>
      <button
        onClick={dec}
        style={{
          width: 28, height: 28,
          background: "var(--bg3)", border: "1px solid var(--border)",
          borderRadius: "7px 0 0 7px", cursor: "pointer",
          color: "var(--muted)", fontSize: 16, lineHeight: 1,
          display: "flex", alignItems: "center", justifyContent: "center",
        }}
      >−</button>
      <div style={{
        minWidth: 64, height: 28, padding: "0 10px",
        background: "var(--bg)", border: "1px solid var(--border)",
        borderLeft: "none", borderRight: "none",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        <Mono color={color} size={13}>{value.toFixed(2)} pts</Mono>
      </div>
      <button
        onClick={inc}
        style={{
          width: 28, height: 28,
          background: "var(--bg3)", border: "1px solid var(--border)",
          borderRadius: "0 7px 7px 0", cursor: "pointer",
          color: "var(--muted)", fontSize: 16, lineHeight: 1,
          display: "flex", alignItems: "center", justifyContent: "center",
        }}
      >+</button>
    </div>
  )
}

export function OrderEntry({ strategy: s, detail, onDismiss, onExecuted }: OrderEntryProps) {
  const timeLeft  = useCountdown(s.expires_at)
  const ticker    = (s.tickers ?? [])[0] ?? ""
  const action    = s.action ?? "buy"
  const isBuy     = action !== "sell"
  const sizingPct = s.sizing_pct ?? detail?.sizing_pct ?? 0.03

  const [account, setAccount]       = useState<AccountData | null>(null)
  const [quotePrice, setQuotePrice] = useState<number | null>(null)
  const [atr, setAtr]               = useState<number | null>(null)
  const [loadingData, setLoadingData] = useState(true)

  const [orderType, setOrderType] = useState<"market" | "limit">("market")
  const [limitPts, setLimitPts]   = useState<number>(0)   // offset from quote for limit
  const [slPts, setSlPts]         = useState<number>(1.0)
  const [tpPts, setTpPts]         = useState<number>(2.0)
  const [slEnabled, setSlEnabled] = useState(true)
  const [tpEnabled, setTpEnabled] = useState(true)

  // Hold-to-execute
  const [holdPct, setHoldPct]       = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const rafRef  = useRef<number | null>(null)
  const startTs = useRef(0)

  useEffect(() => {
    ;(async () => {
      setLoadingData(true)
      try {
        const [acctRes, quoteRes] = await Promise.all([
          fetch("/api/trades?type=account").then((r) => r.json()),
          ticker
            ? fetch(`/api/trades?type=quote&symbol=${encodeURIComponent(ticker)}`).then((r) => r.json())
            : Promise.resolve({ price: null, atr: null }),
        ])
        setAccount(acctRes)
        const price: number | null = quoteRes.price ?? null
        const atrVal: number | null = quoteRes.atr ?? null
        setQuotePrice(price)
        setAtr(atrVal)
        // Default SL = 1x ATR, TP = 2x ATR (or 1% / 2% of price as fallback)
        if (atrVal && atrVal > 0) {
          setSlPts(parseFloat(atrVal.toFixed(2)))
          setTpPts(parseFloat((atrVal * 2).toFixed(2)))
        } else if (price && price > 0) {
          setSlPts(parseFloat((price * 0.01).toFixed(2)))
          setTpPts(parseFloat((price * 0.02).toFixed(2)))
        }
      } catch { /* leave defaults */ }
      finally { setLoadingData(false) }
    })()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticker])

  // Derived prices from pts
  const entryPrice    = orderType === "limit" && quotePrice
    ? parseFloat((quotePrice + (isBuy ? -limitPts : limitPts)).toFixed(2))
    : quotePrice
  const slPrice = entryPrice != null
    ? parseFloat((isBuy ? entryPrice - slPts : entryPrice + slPts).toFixed(2))
    : null
  const tpPrice = entryPrice != null
    ? parseFloat((isBuy ? entryPrice + tpPts : entryPrice - tpPts).toFixed(2))
    : null

  const equity        = account?.equity ?? 0
  const positionSize  = equity * sizingPct
  const qty           = entryPrice && entryPrice > 0 ? Math.floor(positionSize / entryPrice) : null
  const maxLoss       = qty && slEnabled ? slPts * qty : null
  const rr            = slPts > 0 ? tpPts / slPts : null

  const atrMultSl = atr && atr > 0 ? (slPts / atr).toFixed(1) : null
  const atrMultTp = atr && atr > 0 ? (tpPts / atr).toFixed(1) : null

  const handleExecute = useCallback(async () => {
    setHoldPct(0)
    setSubmitting(true)
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const body: Record<string, any> = { strategy_id: s.id, confirmed: true, order_type: orderType }
      if (orderType === "limit" && entryPrice) body.limit_price = entryPrice
      if (slEnabled && slPrice)               body.stop_loss_price   = slPrice
      if (tpEnabled && tpPrice)               body.take_profit_price = tpPrice

      const res = await fetch("/api/trades", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      if (res.ok) {
        const data = await res.json()
        showToast(`✓ Order submitted — ${data.qty} shares`)
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
  }, [s.id, orderType, entryPrice, slEnabled, slPrice, tpEnabled, tpPrice, onExecuted])

  const startHold = useCallback(() => {
    if (submitting || !account?.connected) return
    startTs.current = performance.now()
    const tick = (now: number) => {
      const pct = Math.min((now - startTs.current) / HOLD_MS, 1)
      setHoldPct(pct)
      if (pct < 1) { rafRef.current = requestAnimationFrame(tick) }
      else { handleExecute() }
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
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: s.id, status: "dismissed" }),
      })
    } catch { /* best-effort */ }
    showToast("Strategy dismissed")
    onDismiss()
  }

  const isPaper   = account?.is_paper !== false
  const connected = account?.connected ?? false
  const btnColor  = isPaper ? "#2563eb" : "var(--green)"

  return (
    <div style={{ padding: "14px 20px", background: "var(--bg1)" }}>
      {/* Meta row */}
      <div style={{
        display: "flex", alignItems: "center", gap: 10,
        marginBottom: 14, flexWrap: "wrap",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 11, color: "var(--dim)" }}>⏱</span>
          <Mono color="var(--amber)" size={11}>{timeLeft}</Mono>
        </div>
        <div style={{ flex: 1 }} />
        {/* Live price */}
        {quotePrice && (
          <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <span style={{ fontSize: 9, color: "var(--dim)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
              {ticker}
            </span>
            <Mono size={12}>${quotePrice.toFixed(2)}</Mono>
          </div>
        )}
        {atr && (
          <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <span style={{ fontSize: 9, color: "var(--dim)", textTransform: "uppercase", letterSpacing: "0.08em" }}>ATR</span>
            <Mono size={12}>{atr.toFixed(2)}</Mono>
          </div>
        )}
        {!loadingData && (
          <span style={{
            fontSize: 10, fontWeight: 700, letterSpacing: "0.07em",
            color: isPaper ? "#3b82f6" : "var(--green)",
            background: isPaper ? "rgba(59,130,246,0.12)" : "var(--green-bg)",
            border: `1px solid ${isPaper ? "rgba(59,130,246,0.25)" : "rgba(5,150,105,0.25)"}`,
            borderRadius: 10, padding: "1px 8px",
          }}>
            {isPaper ? "PAPER" : "LIVE"}
          </span>
        )}
        {!loadingData && !connected && (
          <span style={{ fontSize: 11, color: "var(--amber)" }}>⚠ Alpaca not connected</span>
        )}
      </div>

      {/* Order type row */}
      <div style={{ marginBottom: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: orderType === "limit" ? 8 : 0 }}>
          <Label>Order Type</Label>
          <div style={{ display: "flex", gap: 4 }}>
            {(["market", "limit"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setOrderType(t)}
                title={t === "market" ? "Execute immediately at the current best price." : "Set a specific price — order only fills if the market reaches it."}
                style={{
                  background: orderType === t ? "var(--primary)" : "var(--bg2)",
                  border: `1px solid ${orderType === t ? "var(--primary)" : "var(--border)"}`,
                  borderRadius: 7, padding: "5px 12px",
                  fontSize: 12, fontWeight: orderType === t ? 600 : 400,
                  color: orderType === t ? "#fff" : "var(--muted)",
                  cursor: "pointer", textTransform: "capitalize",
                }}
              >
                {t}
              </button>
            ))}
          </div>
          <span style={{ fontSize: 11, color: "var(--dim)" }}>
            {orderType === "market"
              ? "Fills instantly at best available price"
              : "Only fills if market reaches your price"}
          </span>
        </div>
        {orderType === "limit" && quotePrice && (
          <div style={{
            display: "flex", alignItems: "center", gap: 8,
            background: "var(--bg2)", border: "1px solid var(--border)",
            borderRadius: 8, padding: "8px 12px",
          }}>
            <span style={{ fontSize: 11, color: "var(--dim)" }}>
              Buy below market by
            </span>
            <PtsStepper value={limitPts} onChange={setLimitPts} color="var(--text)" min={0} />
            <span style={{ fontSize: 11, color: "var(--dim)" }}>
              → limit price <Mono size={12}>${entryPrice?.toFixed(2)}</Mono>
            </span>
          </div>
        )}
      </div>

      {/* Stop loss + Take profit */}
      <div style={{ marginBottom: 10 }}>
        <div style={{ fontSize: 10, color: "var(--dim)", marginBottom: 8, lineHeight: 1.5 }}>
          <strong style={{ color: "var(--muted)" }}>Stop Loss / Take Profit</strong>
          {" "}— set in <strong style={{ color: "var(--muted)" }}>points (pts)</strong>, where 1 pt = $1 per share.
          Defaults are calculated from ATR (Average True Range), a measure of typical daily price movement.
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          {/* Stop loss */}
          <div style={{
            background: "var(--bg2)", border: "1px solid var(--border)",
            borderRadius: 10, padding: "10px 12px",
          }}>
            <div style={{ display: "flex", alignItems: "center", marginBottom: 6 }}>
              <div>
                <Label>Stop Loss</Label>
                <div style={{ fontSize: 10, color: "var(--dim)", marginTop: -2, marginBottom: 6 }}>
                  Exit if price moves against you by this amount
                </div>
              </div>
              <div style={{ flex: 1 }} />
              <button
                onClick={() => setSlEnabled(!slEnabled)}
                style={{
                  background: slEnabled ? "rgba(220,38,38,0.12)" : "var(--bg3)",
                  border: `1px solid ${slEnabled ? "rgba(220,38,38,0.3)" : "var(--border)"}`,
                  borderRadius: 12, padding: "1px 8px",
                  fontSize: 10, fontWeight: 700,
                  color: slEnabled ? "var(--red)" : "var(--dim)",
                  cursor: "pointer",
                }}
              >
                {slEnabled ? "ON" : "OFF"}
              </button>
            </div>
            {slEnabled ? (
              <>
                <PtsStepper value={slPts} onChange={setSlPts} color="var(--red)" />
                <div style={{ marginTop: 6, fontSize: 11, color: "var(--dim)" }}>
                  {atrMultSl && <span style={{ color: "var(--muted)" }}>{atrMultSl}× ATR · </span>}
                  <span style={{ color: "var(--red)", fontFamily: "var(--font-dm-mono)" }}>
                    closes at {slPrice != null ? `$${slPrice.toFixed(2)}` : "—"}
                  </span>
                </div>
              </>
            ) : (
              <span style={{ fontSize: 12, color: "var(--amber)" }}>⚠ No downside protection</span>
            )}
          </div>

          {/* Take profit */}
          <div style={{
            background: "var(--bg2)", border: "1px solid var(--border)",
            borderRadius: 10, padding: "10px 12px",
          }}>
            <div style={{ display: "flex", alignItems: "center", marginBottom: 6 }}>
              <div>
                <Label>Take Profit</Label>
                <div style={{ fontSize: 10, color: "var(--dim)", marginTop: -2, marginBottom: 6 }}>
                  Auto-close when this profit target is hit
                </div>
              </div>
              <div style={{ flex: 1 }} />
              <button
                onClick={() => setTpEnabled(!tpEnabled)}
                style={{
                  background: tpEnabled ? "rgba(5,150,105,0.12)" : "var(--bg3)",
                  border: `1px solid ${tpEnabled ? "rgba(5,150,105,0.3)" : "var(--border)"}`,
                  borderRadius: 12, padding: "1px 8px",
                  fontSize: 10, fontWeight: 700,
                  color: tpEnabled ? "var(--green)" : "var(--dim)",
                  cursor: "pointer",
                }}
              >
                {tpEnabled ? "ON" : "OFF"}
              </button>
            </div>
            {tpEnabled ? (
              <>
                <PtsStepper value={tpPts} onChange={setTpPts} color="var(--green)" />
                <div style={{ marginTop: 6, fontSize: 11, color: "var(--dim)" }}>
                  {atrMultTp && <span style={{ color: "var(--muted)" }}>{atrMultTp}× ATR · </span>}
                  <span style={{ color: "var(--green)", fontFamily: "var(--font-dm-mono)" }}>
                    closes at {tpPrice != null ? `$${tpPrice.toFixed(2)}` : "—"}
                  </span>
                </div>
              </>
            ) : (
              <span style={{ fontSize: 12, color: "var(--dim)" }}>No target — manual close only</span>
            )}
          </div>
        </div>
      </div>

      {/* Position summary row */}
      <div style={{
        display: "grid", gridTemplateColumns: "repeat(4, 1fr)",
        background: "var(--bg0)", border: "1px solid var(--border)",
        borderRadius: 10, overflow: "hidden", marginBottom: 14,
      }}>
        {[
          {
            label: "QTY", value: qty ? `${qty} sh` : loadingData ? "…" : "—",
            hint: "Shares to buy",
            tooltip: "Number of shares calculated from your account equity × position sizing %.",
          },
          {
            label: "ALLOC", value: equity > 0 ? `$${Math.round(positionSize).toLocaleString()}` : "—",
            hint: "Capital deployed",
            tooltip: "Total dollars allocated based on your risk level setting.",
          },
          {
            label: "MAX LOSS", value: maxLoss ? `$${maxLoss.toFixed(0)}` : "—", color: "var(--red)" as const,
            hint: slEnabled ? "If SL triggers" : "No SL set",
            tooltip: "Worst-case dollar loss if the stop loss triggers at the set price. SL pts × shares.",
          },
          {
            label: "R/R", value: rr && slEnabled && tpEnabled ? `1 : ${rr.toFixed(1)}` : "—",
            color: (rr && rr >= 2 ? "var(--green)" : rr && rr >= 1 ? "var(--amber)" : "var(--dim)") as string,
            hint: rr && rr >= 2 ? "Good ratio" : rr && rr >= 1 ? "Acceptable" : "—",
            tooltip: "Risk-to-Reward ratio. 1:2 means risking $1 to make $2. Aim for 1:2 or better.",
          },
        ].map(({ label, value, color, hint, tooltip }, i, arr) => (
          <div
            key={label}
            title={tooltip}
            style={{
              padding: "8px 10px", cursor: "help",
              borderRight: i < arr.length - 1 ? "1px solid var(--border)" : "none",
            }}
          >
            <div style={{ fontSize: 9, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--dim)", marginBottom: 3, fontWeight: 600 }}>
              {label}
            </div>
            <Mono size={12} color={color ?? (value === "—" || value === "…" ? "var(--dim)" : "var(--text)")}>
              {value}
            </Mono>
            {hint && (
              <div style={{ fontSize: 9, color: "var(--dim)", marginTop: 2 }}>{hint}</div>
            )}
          </div>
        ))}
      </div>

      {/* Dismiss + Hold-to-execute */}
      <div style={{ display: "flex", gap: 8 }}>
        <button
          onClick={handleDismiss}
          disabled={submitting}
          style={{
            flexShrink: 0, background: "var(--bg2)",
            border: "1px solid var(--border2)", borderRadius: 10,
            padding: "0 16px", color: "var(--muted)",
            cursor: submitting ? "not-allowed" : "pointer",
            fontSize: 13, fontWeight: 500, opacity: submitting ? 0.5 : 1,
          }}
        >
          Dismiss
        </button>

        <button
          onMouseDown={startHold}
          onMouseUp={cancelHold}
          onMouseLeave={cancelHold}
          onTouchStart={startHold}
          onTouchEnd={cancelHold}
          disabled={!connected || submitting}
          style={{
            position: "relative", flex: 1, overflow: "hidden",
            background: submitting ? "var(--bg3)" : btnColor,
            border: "none", borderRadius: 10, padding: "12px 0",
            color: submitting ? "var(--muted)" : "#fff",
            cursor: connected && !submitting ? "pointer" : "not-allowed",
            fontWeight: 700, fontSize: 13,
            opacity: !connected ? 0.45 : 1,
            userSelect: "none",
          }}
        >
          {holdPct > 0 && (
            <div style={{
              position: "absolute", inset: 0,
              width: `${holdPct * 100}%`,
              background: "rgba(255,255,255,0.2)",
              pointerEvents: "none",
            }} />
          )}
          <span style={{ position: "relative" }}>
            {submitting
              ? "Submitting…"
              : holdPct > 0
                ? `Hold… ${Math.round(holdPct * 100)}%`
                : `Hold to Execute · ${isPaper ? "PAPER" : "LIVE"}`}
          </span>
        </button>
      </div>
    </div>
  )
}
