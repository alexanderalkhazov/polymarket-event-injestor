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

  const [orderType, setOrderType]       = useState<"market" | "limit">("market")
  const [limitPrice, setLimitPrice]     = useState<string>("")
  const [extendedHours, setExtendedHours] = useState(false)
  const [leverage, setLeverage]         = useState<1 | 2 | 4>(1)
  const [slMode, setSlMode]         = useState<"fixed" | "trailing">("fixed")
  const [slPts, setSlPts]           = useState<number>(1.0)
  const [trailPct, setTrailPct]     = useState<number>(1.5)
  const [tpPts, setTpPts]           = useState<number>(2.0)
  const [slEnabled, setSlEnabled]   = useState(true)
  const [tpEnabled, setTpEnabled]   = useState(true)

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

  // Derived entry price: limit uses direct dollar input, market uses quote
  const entryPrice = orderType === "limit" && limitPrice
    ? parseFloat(limitPrice) || quotePrice
    : quotePrice
  const slPrice = entryPrice != null
    ? parseFloat((isBuy ? entryPrice - slPts : entryPrice + slPts).toFixed(2))
    : null
  const tpPrice = entryPrice != null
    ? parseFloat((isBuy ? entryPrice + tpPts : entryPrice - tpPts).toFixed(2))
    : null

  const equity        = account?.equity ?? 0
  const positionSize  = equity * sizingPct * leverage
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
      const body: Record<string, any> = { strategy_id: s.id, confirmed: true, order_type: extendedHours ? "limit" : orderType, leverage, ...(extendedHours ? { extended_hours: true } : {}) }
      if (orderType === "limit" && entryPrice) body.limit_price = entryPrice
      if (slEnabled) {
        if (slMode === "trailing") {
          body.trail_percent = trailPct
        } else if (slPrice) {
          body.stop_loss_price = slPrice
        }
      }
      if (tpEnabled && tpPrice && slMode !== "trailing") body.take_profit_price = tpPrice

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
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: orderType === "limit" || extendedHours ? 8 : 0 }}>
          <Label>Order Type</Label>
          <div style={{ display: "flex", gap: 4 }}>
            {(["market", "limit"] as const).map((t) => (
              <button
                key={t}
                onClick={() => { setOrderType(t); if (t === "market") setExtendedHours(false) }}
                title={t === "market" ? "Execute immediately at the current best price." : "Set a specific price — order only fills if the market reaches it."}
                style={{
                  background: (extendedHours ? "limit" : orderType) === t ? "var(--primary)" : "var(--bg2)",
                  border: `1px solid ${(extendedHours ? "limit" : orderType) === t ? "var(--primary)" : "var(--border)"}`,
                  borderRadius: 7, padding: "5px 12px",
                  fontSize: 12, fontWeight: (extendedHours ? "limit" : orderType) === t ? 600 : 400,
                  color: (extendedHours ? "limit" : orderType) === t ? "#fff" : "var(--muted)",
                  cursor: "pointer", textTransform: "capitalize",
                  opacity: extendedHours && t === "market" ? 0.4 : 1,
                }}
              >
                {t}
              </button>
            ))}
          </div>
          {/* Extended hours toggle */}
          <button
            onClick={() => { setExtendedHours(!extendedHours); if (!extendedHours) setOrderType("limit") }}
            title="Trade pre-market (4–9:30 AM ET) and after-hours (4–8 PM ET). Limit orders only."
            style={{
              background: extendedHours ? "rgba(245,158,11,0.15)" : "var(--bg2)",
              border: `1px solid ${extendedHours ? "rgba(245,158,11,0.5)" : "var(--border)"}`,
              borderRadius: 7, padding: "5px 10px",
              fontSize: 11, fontWeight: extendedHours ? 700 : 400,
              color: extendedHours ? "var(--amber)" : "var(--dim)",
              cursor: "pointer",
            }}
          >
            {extendedHours ? "⏰ Ext hrs ON" : "Ext hrs"}
          </button>
          <span style={{ fontSize: 11, color: "var(--dim)" }}>
            {extendedHours
              ? "Pre/after-market · limit only · wider spreads"
              : orderType === "market"
                ? "Fills instantly at best available price"
                : "Only fills if market reaches your price"}
          </span>
        </div>
        {orderType === "limit" && (
          <div style={{
            display: "flex", alignItems: "center", gap: 10,
            background: "var(--bg2)", border: "1px solid var(--border)",
            borderRadius: 8, padding: "8px 12px",
          }}>
            <span style={{ fontSize: 11, color: "var(--dim)" }}>Limit price (USD)</span>
            <input
              type="number"
              step="0.01"
              value={limitPrice}
              onChange={(e) => setLimitPrice(e.target.value)}
              placeholder={quotePrice ? quotePrice.toFixed(2) : "0.00"}
              style={{
                width: 100, background: "var(--bg)", border: "1px solid var(--border)",
                borderRadius: 7, padding: "5px 9px",
                fontFamily: "var(--font-dm-mono)", fontSize: 13, fontWeight: 600,
                color: "var(--text)", outline: "none",
              }}
            />
            {quotePrice && limitPrice && (
              <span style={{ fontSize: 11, color: "var(--dim)" }}>
                {parseFloat(limitPrice) < quotePrice
                  ? `$${(quotePrice - parseFloat(limitPrice)).toFixed(2)} below market`
                  : `$${(parseFloat(limitPrice) - quotePrice).toFixed(2)} above market`}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Leverage selector */}
      <div style={{ marginBottom: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Label>Leverage</Label>
          <div style={{ display: "flex", gap: 4 }}>
            {([1, 2, 4] as const).map((x) => (
              <button
                key={x}
                onClick={() => setLeverage(x)}
                title={x === 1 ? "No margin — cash only" : x === 2 ? "2× margin (overnight eligible)" : "4× margin (intraday only)"}
                style={{
                  background: leverage === x ? "rgba(124,58,237,0.18)" : "var(--bg2)",
                  border: `1px solid ${leverage === x ? "rgba(124,58,237,0.5)" : "var(--border)"}`,
                  borderRadius: 7, padding: "5px 14px",
                  fontSize: 12, fontWeight: leverage === x ? 700 : 400,
                  color: leverage === x ? "#a78bfa" : "var(--muted)",
                  cursor: "pointer",
                }}
              >
                {x}×
              </button>
            ))}
          </div>
          {leverage > 1 && (
            <span style={{ fontSize: 11, color: "var(--amber)" }}>
              ⚠ {leverage}× amplifies losses — requires margin account
            </span>
          )}
        </div>
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
                <div style={{ display: "flex", gap: 4, marginBottom: 8 }}>
                  {(["fixed", "trailing"] as const).map((m) => (
                    <button key={m} onClick={() => setSlMode(m)} style={{
                      background: slMode === m ? "rgba(220,38,38,0.18)" : "var(--bg3)",
                      border: `1px solid ${slMode === m ? "rgba(220,38,38,0.4)" : "var(--border)"}`,
                      borderRadius: 6, padding: "3px 10px",
                      fontSize: 11, fontWeight: slMode === m ? 700 : 400,
                      color: slMode === m ? "var(--red)" : "var(--dim)",
                      cursor: "pointer", textTransform: "capitalize",
                    }}>{m}</button>
                  ))}
                </div>
                {slMode === "fixed" ? (
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
                  <>
                    <PtsStepper value={trailPct} onChange={setTrailPct} color="var(--amber)" min={0.25} />
                    <div style={{ marginTop: 6, fontSize: 11, color: "var(--dim)" }}>
                      trails {trailPct}% below peak price
                      <span style={{ color: "var(--amber)", marginLeft: 6 }}>· TP disabled</span>
                    </div>
                  </>
                )}
              </>
            ) : (
              <span style={{ fontSize: 12, color: "var(--amber)" }}>⚠ No downside protection</span>
            )}
          </div>

          {/* Take profit */}
          <div style={{
            background: "var(--bg2)", border: "1px solid var(--border)",
            borderRadius: 10, padding: "10px 12px",
            opacity: slMode === "trailing" ? 0.4 : 1,
            pointerEvents: slMode === "trailing" ? "none" : undefined,
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
            hint: leverage > 1 ? `${leverage}× leveraged` : "Capital deployed",
            tooltip: "Total dollars allocated based on your risk level setting × leverage multiplier.",
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
